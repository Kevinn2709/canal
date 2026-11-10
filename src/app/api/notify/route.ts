/**
 * /api/notify — Envía las notificaciones push (función de Vercel, gratis).
 *
 * GET  -> { publicKey } : la llave pública VAPID (o null si falta configurarla).
 * POST -> avisa a los demás miembros de un chat que hay un mensaje nuevo.
 *
 * Seguridad:
 * - No usa ninguna cuenta de servicio ni llave de Firebase. Lee Firestore con
 *   el token de quien envía el mensaje, así que las reglas de Firestore
 *   aplican igual que en la app: si no es miembro del chat, no puede avisar.
 * - El aviso no lleva el texto del mensaje (sigue cifrado de extremo a
 *   extremo): solo el id del chat, quién escribió y si te mencionaron.
 *
 * Variables de entorno en Vercel: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY y,
 * opcional, VAPID_SUBJECT (un correo "mailto:…" o la URL del sitio).
 */

import { firebaseConfig } from "@/lib/firebase-config";
import { sendPush, type PushTarget, type Vapid } from "@/lib/webpush";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_SUBS_PER_USER = 10;

type FsValue = Record<string, unknown>;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function vapidConfig(origin: string): Vapid | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  const subject = process.env.VAPID_SUBJECT?.trim() || origin;
  return { publicKey, privateKey, subject };
}

/** Convierte un valor del API REST de Firestore a JSON normal. */
function fromValue(v: FsValue | undefined): unknown {
  if (!v) return undefined;
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) {
    const values = ((v.arrayValue as { values?: FsValue[] }).values ?? []) as FsValue[];
    return values.map(fromValue);
  }
  if ("mapValue" in v) return fieldsToObject((v.mapValue as { fields?: Record<string, FsValue> }).fields);
  return undefined;
}

function fieldsToObject(fields: Record<string, FsValue> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields ?? {})) out[k] = fromValue(v);
  return out;
}

/** uid del token (sin verificar aquí: Firestore lo verifica en cada lectura). */
function uidFromToken(token: string): string | null {
  try {
    const part = token.split(".")[1];
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))) as {
      user_id?: unknown;
      sub?: unknown;
    };
    const uid = typeof payload.user_id === "string" ? payload.user_id : payload.sub;
    return typeof uid === "string" && uid ? uid : null;
  } catch {
    return null;
  }
}

class Firestore {
  readonly base: string;
  readonly root: string;
  constructor(
    projectId: string,
    private readonly token: string
  ) {
    this.root = `projects/${projectId}/databases/(default)/documents`;
    this.base = `https://firestore.googleapis.com/v1/${this.root}`;
  }

  private async call(url: string, body?: unknown): Promise<Response> {
    return fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  }

  /** Un documento, o null si no existe. Lanza "denied" si las reglas no dejan. */
  async get(path: string): Promise<Record<string, unknown> | null> {
    const res = await this.call(`${this.base}/${path}`);
    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) throw new Error("denied");
    if (!res.ok) throw new Error(`firestore ${res.status}`);
    const doc = (await res.json()) as { fields?: Record<string, FsValue> };
    return fieldsToObject(doc.fields);
  }

  /** Varios documentos de una vez: id -> datos (los que existen). */
  async batchGet(paths: string[]): Promise<Map<string, Record<string, unknown>>> {
    const out = new Map<string, Record<string, unknown>>();
    if (paths.length === 0) return out;
    const res = await this.call(`${this.base}:batchGet`, { documents: paths.map((p) => `${this.root}/${p}`) });
    if (!res.ok) throw new Error(`firestore ${res.status}`);
    const rows = (await res.json()) as { found?: { name: string; fields?: Record<string, FsValue> } }[];
    for (const row of rows) {
      if (row.found) out.set(row.found.name.split("/").pop() as string, fieldsToObject(row.found.fields));
    }
    return out;
  }

  /** uids con founder == true (miembros de las conversaciones de antes). */
  async founders(): Promise<string[]> {
    const res = await this.call(`${this.base}:runQuery`, {
      structuredQuery: {
        from: [{ collectionId: "users" }],
        where: { fieldFilter: { field: { fieldPath: "founder" }, op: "EQUAL", value: { booleanValue: true } } },
      },
    });
    if (!res.ok) throw new Error(`firestore ${res.status}`);
    const rows = (await res.json()) as { document?: { name: string } }[];
    return rows.filter((r) => r.document).map((r) => (r.document as { name: string }).name.split("/").pop() as string);
  }
}

function subscriptionsOf(data: Record<string, unknown> | undefined): PushTarget[] {
  const subs = (data?.subs ?? {}) as Record<string, unknown>;
  const out: PushTarget[] = [];
  for (const value of Object.values(subs)) {
    const s = value as Record<string, unknown>;
    if (
      typeof s.endpoint === "string" &&
      s.endpoint.startsWith("https://") &&
      typeof s.p256dh === "string" &&
      typeof s.auth === "string"
    ) {
      out.push({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth });
    }
  }
  return out.slice(0, MAX_SUBS_PER_USER);
}

export async function GET(): Promise<Response> {
  return json({ publicKey: process.env.VAPID_PUBLIC_KEY?.trim() || null });
}

export async function POST(req: Request): Promise<Response> {
  const origin = new URL(req.url).origin;
  const vapid = vapidConfig(origin);
  if (!vapid) return json({ error: "not-configured" }, 503);

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const me = token ? uidFromToken(token) : null;
  if (!token || !me) return json({ error: "unauthorized" }, 401);

  let body: { chatId?: unknown; mentions?: unknown; test?: unknown };
  try {
    const text = await req.text();
    if (text.length > 4000) return json({ error: "too-large" }, 413);
    body = JSON.parse(text) as typeof body;
  } catch {
    return json({ error: "bad-request" }, 400);
  }

  const fs = new Firestore(firebaseConfig.projectId, token);
  const test = body.test === true;
  const chatId = typeof body.chatId === "string" ? body.chatId : "";
  if (!test && !ID_RE.test(chatId)) return json({ error: "bad-request" }, 400);
  const mentions = new Set(
    Array.isArray(body.mentions) ? body.mentions.filter((m): m is string => typeof m === "string").slice(0, 8) : []
  );

  // ¿A quién avisar? Solo a miembros del chat (las reglas lo comprueban).
  let recipients: string[];
  try {
    if (test) {
      // Prueba: solo a ti mismo, para comprobar tus dispositivos.
      if (!(await fs.get(`users/${me}`))) return json({ error: "denied" }, 403);
      recipients = [me];
    } else {
      const chat = await fs.get(`chats/${chatId}`);
      if (!chat) return json({ error: "not-found" }, 404);
      const members = Array.isArray(chat.members) ? (chat.members as unknown[]).filter((m): m is string => typeof m === "string") : null;
      const all = members ?? (await fs.founders()); // conversación de antes: los fundadores
      if (!all.includes(me)) return json({ error: "denied" }, 403);
      recipients = all.filter((uid) => uid !== me);
    }
  } catch (err) {
    return json({ error: (err as Error).message === "denied" ? "denied" : "firestore" }, (err as Error).message === "denied" ? 403 : 502);
  }

  if (recipients.length === 0) return json({ ok: true, sent: 0 });

  let pushDocs: Map<string, Record<string, unknown>>;
  try {
    pushDocs = await fs.batchGet(recipients.map((uid) => `push/${uid}`));
  } catch {
    return json({ error: "firestore" }, 502);
  }

  let sent = 0;
  let failed = 0;
  let gone = 0;
  const jobs: Promise<void>[] = [];
  for (const uid of recipients) {
    const data = pushDocs.get(uid);
    const mentioned = mentions.has(uid);
    const muted = Array.isArray(data?.muted) && (data?.muted as unknown[]).includes(chatId);
    if (muted && !mentioned && !test) continue; // chat silenciado (salvo que te mencionen)
    const payload = JSON.stringify(test ? { c: "", t: 1 } : { c: chatId, f: me, m: mentioned ? 1 : 0 });
    for (const target of subscriptionsOf(data)) {
      jobs.push(
        sendPush(target, payload, vapid, { topic: test ? "prueba" : chatId })
          .then((status) => {
            if (status >= 200 && status < 300) sent++;
            else if (status === 404 || status === 410) gone++;
            else failed++;
          })
          .catch(() => {
            failed++;
          })
      );
    }
  }
  await Promise.all(jobs);
  return json({ ok: true, sent, failed, gone });
}
