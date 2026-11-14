/**
 * /api/ice — Servidores para conectar las llamadas (función de Vercel, gratis).
 *
 * Para que dos teléfonos se encuentren hace falta un servidor STUN (dice a
 * cada uno su dirección pública). Si una red no deja la conexión directa
 * (algunas redes móviles o de oficina), hace falta además un relevo TURN,
 * que reenvía el audio y el video ya cifrados: no puede escucharlos.
 *
 * Solo responde a cuentas de la web: comprueba el token leyendo tu propio
 * users/ en Firestore (lo deciden las reglas).
 *
 * Variables de entorno en Vercel (opcionales; sin ellas, solo STUN):
 * - CF_TURN_KEY_ID y CF_TURN_API_TOKEN: relevo TURN de Cloudflare. Las
 *   credenciales se generan aquí y duran un día.
 * - o TURN_URLS (separadas por comas), TURN_USERNAME y TURN_CREDENTIAL: otro
 *   servidor TURN.
 */

import { firebaseConfig } from "@/lib/firebase-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IceServer = { urls: string | string[]; username?: string; credential?: string };

const STUN: IceServer = { urls: ["stun:stun.cloudflare.com:3478"] };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function uidFromToken(token: string): string | null {
  try {
    const part = token.split(".")[1];
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))) as { user_id?: unknown; sub?: unknown };
    const uid = typeof payload.user_id === "string" ? payload.user_id : payload.sub;
    return typeof uid === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(uid) ? uid : null;
  } catch {
    return null;
  }
}

/** Quita las direcciones del puerto 53: los navegadores las bloquean y solo hacen esperar. */
function withoutPort53(servers: IceServer[]): IceServer[] {
  const ok = (u: string) => !/:53(\?|$)/.test(u);
  return servers
    .map((s) => ({ ...s, urls: Array.isArray(s.urls) ? s.urls.filter(ok) : ok(s.urls) ? s.urls : [] }))
    .filter((s) => (Array.isArray(s.urls) ? s.urls.length > 0 : !!s.urls));
}

async function turnServers(): Promise<IceServer[]> {
  const keyId = process.env.CF_TURN_KEY_ID?.trim();
  const apiToken = process.env.CF_TURN_API_TOKEN?.trim();
  if (keyId && apiToken) {
    try {
      const res = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ ttl: 86400 }),
          cache: "no-store",
        }
      );
      if (!res.ok) return [];
      const data = (await res.json()) as { iceServers?: unknown };
      const list = Array.isArray(data.iceServers) ? (data.iceServers as IceServer[]) : [];
      return withoutPort53(list.filter((s) => s && (typeof s.urls === "string" || Array.isArray(s.urls))));
    } catch {
      return [];
    }
  }
  const urls = (process.env.TURN_URLS ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter((u) => /^turns?:/.test(u));
  const username = process.env.TURN_USERNAME?.trim();
  const credential = process.env.TURN_CREDENTIAL?.trim();
  return urls.length && username && credential ? [{ urls, username, credential }] : [];
}

export async function GET(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const me = token ? uidFromToken(token) : null;
  if (!token || !me) return json({ error: "unauthorized" }, 401);

  // ¿Es una cuenta de la web? Firestore valida el token y las reglas deciden.
  const check = await fetch(
    `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${me}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  ).catch(() => null);
  if (!check || !check.ok) return json({ error: "denied" }, 403);

  const turn = await turnServers();
  const hasStun = turn.some((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => u.startsWith("stun:")));
  return json({ iceServers: hasStun ? turn : [STUN, ...turn], relay: turn.length > 0 });
}
