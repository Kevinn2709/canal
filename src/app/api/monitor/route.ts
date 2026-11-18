/**
 * /api/monitor — Estado de los dominios (solo fundadores).
 *
 * GET con "Authorization: Bearer <token de Firebase>". Para saber si quien
 * pregunta es fundador no se usa ninguna cuenta de servicio: se intenta leer
 * meta/crypto en Firestore con SU token, y las reglas solo dejan leerlo a los
 * fundadores (200, o 404 si el documento no existe; 403 si no es fundador).
 *
 * Por cada dominio de MONITOR_DOMAINS (separados por comas; por defecto
 * glamourgloow.com):
 * - HTTP: GET https://dominio/ siguiendo redirecciones; código y latencia
 *   (tiempo hasta recibir la respuesta).
 * - SSL: conexión TLS al puerto 443; si el certificado es válido, cuántos
 *   días le quedan y quién lo emitió.
 * Se mide desde el servidor de Vercel (región en "region"), no desde el
 * teléfono.
 */

import tls from "node:tls";
import { firebaseConfig } from "@/lib/firebase-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const HTTP_TIMEOUT_MS = 10_000;
const TLS_TIMEOUT_MS = 8_000;
const MAX_DOMAINS = 25;

interface HttpResult {
  status: number | null;
  ms: number | null;
  error: string | null;
  finalUrl: string | null;
}

interface SslResult {
  valid: boolean;
  daysLeft: number | null;
  validTo: string | null;
  issuer: string | null;
  error: string | null;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function domains(): string[] {
  const raw = process.env.MONITOR_DOMAINS?.trim() || "glamourgloow.com";
  const list = raw
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .filter((d) => HOST_RE.test(d));
  return Array.from(new Set(list)).slice(0, MAX_DOMAINS);
}

async function isFounder(token: string): Promise<boolean> {
  if (!firebaseConfig.projectId) return false;
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/meta/crypto`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    return res.status === 200 || res.status === 404;
  } catch {
    return false;
  }
}

function describe(err: unknown): string {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return "Tiempo agotado";
  const code = e?.cause?.code;
  if (code === "ENOTFOUND") return "El dominio no existe (DNS)";
  if (code === "ECONNREFUSED") return "Conexión rechazada";
  if (code === "ECONNRESET") return "Conexión cortada";
  if (code && code.startsWith("CERT_")) return "Certificado no válido";
  return e?.cause?.message || e?.message || "Error de conexión";
}

async function checkHttp(host: string): Promise<HttpResult> {
  const started = performance.now();
  try {
    const res = await fetch(`https://${host}/`, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; monitor-dominios/1.0)" },
    });
    const ms = Math.round(performance.now() - started);
    try {
      await res.body?.cancel();
    } catch {
      // Nada.
    }
    return { status: res.status, ms, error: null, finalUrl: res.url || null };
  } catch (err) {
    return { status: null, ms: null, error: describe(err), finalUrl: null };
  }
}

function checkSsl(host: string): Promise<SslResult> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: SslResult, socket?: tls.TLSSocket) => {
      if (done) return;
      done = true;
      socket?.destroy();
      resolve(r);
    };
    const fail = (error: string) => finish({ valid: false, daysLeft: null, validTo: null, issuer: null, error });

    const socket = tls.connect({ host, port: 443, servername: host, timeout: TLS_TIMEOUT_MS }, () => {
      const cert = socket.getPeerCertificate();
      const validTo = cert?.valid_to ? new Date(cert.valid_to) : null;
      const daysLeft = validTo ? Math.floor((validTo.getTime() - Date.now()) / 86_400_000) : null;
      const issuer = cert?.issuer?.O || cert?.issuer?.CN || null;
      const ok = socket.authorized && daysLeft !== null && daysLeft >= 0;
      finish(
        {
          valid: ok,
          daysLeft,
          validTo: validTo ? validTo.toISOString() : null,
          issuer: typeof issuer === "string" ? issuer : null,
          error: ok ? null : socket.authorizationError ? String(socket.authorizationError) : "Certificado vencido",
        },
        socket
      );
    });
    socket.on("timeout", () => {
      fail("Tiempo agotado (SSL)");
      socket.destroy();
    });
    socket.on("error", (err: NodeJS.ErrnoException) => {
      const code = err.code ?? "";
      fail(
        code === "CERT_HAS_EXPIRED"
          ? "Certificado vencido"
          : code.startsWith("ERR_TLS") || code.includes("CERT")
            ? "Certificado no válido"
            : code === "ENOTFOUND"
              ? "El dominio no existe (DNS)"
              : err.message || "Error SSL"
      );
    });
  });
}

export async function GET(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return json({ error: "unauthenticated" }, 401);
  if (!(await isFounder(token))) return json({ error: "forbidden" }, 403);

  const results = await Promise.all(
    domains().map(async (domain) => {
      const [http, ssl] = await Promise.all([checkHttp(domain), checkSsl(domain)]);
      return { domain, http, ssl };
    })
  );

  return json({ checkedAt: new Date().toISOString(), region: process.env.VERCEL_REGION ?? null, results });
}
