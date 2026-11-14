/**
 * calls.ts — Llamadas 1 a 1: cifrado de la señalización y servidores ICE.
 *
 * Cómo se protege una llamada:
 * - El audio y el video van por WebRTC, que siempre los cifra (DTLS-SRTP).
 *   Cuando la red lo permite van directo de un teléfono al otro; si hace
 *   falta un relevo (TURN), este solo reenvía paquetes ya cifrados.
 * - Para conectarse, los dos teléfonos se pasan una "oferta", una
 *   "respuesta" y sus direcciones de red. Eso viaja por Firestore cifrado con
 *   la llave del chat (AES-GCM, ligado al chat, a la llamada, al documento y
 *   a quien lo envía). La oferta y la respuesta llevan la huella del cifrado
 *   de cada teléfono; como nadie sin la llave del chat puede cambiarlas, nadie
 *   puede ponerse en medio de la llamada.
 * - En pantalla sale un código hecho con las dos huellas: si los dos ven el
 *   mismo, la llamada va directo entre ustedes.
 * - Al colgar se borran la oferta y las señales: no queda nada de la llamada
 *   en la base de datos.
 */

import { decryptText, encryptText, type Sealed } from "./crypto";

export const RING_MS = 45_000; // cuánto suena antes de rendirse
export const CONNECT_MS = 30_000; // contestada pero sin conectar: se rinde
export const LOST_MS = 30_000; // conexión perdida: se rinde
export const KEEPALIVE_MS = 4 * 60_000; // señal de "seguimos en la llamada"
export const STALE_IDLE_MS = 10 * 60_000; // restos sin actividad: se borran
export const STALE_UNANSWERED_MS = 2 * 60_000; // nadie contestó: se borra

export interface Offer {
  t: "offer";
  sdp: string;
  video: boolean;
  dev: string; // dispositivo que llama
}

export type Signal =
  | { t: "answer"; n: number; dev: string; sdp: string; video: boolean }
  | { t: "cands"; n: number; dev: string; list: RTCIceCandidateInit[] }
  | { t: "reoffer"; n: number; dev: string; sdp: string }
  | { t: "reanswer"; n: number; dev: string; sdp: string }
  | { t: "decline"; n: number; dev: string }
  | { t: "busy"; n: number; dev: string }
  | { t: "ka"; n: number; dev: string };

function callAad(chatId: string, callId: string, from: string, to: string): string {
  return `canal:call:${chatId}:${callId}:${from}>${to}`;
}

function sigAad(chatId: string, callId: string, sigId: string, from: string): string {
  return `canal:callsig:${chatId}:${callId}:${sigId}:${from}`;
}

const MAX_SDP = 20000;

function str(v: unknown, max = 200): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= max;
}

function parseOffer(raw: unknown): Offer | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (o.t !== "offer" || !str(o.sdp, MAX_SDP) || !str(o.dev)) return null;
  return { t: "offer", sdp: o.sdp, video: o.video === true, dev: o.dev };
}

function parseCandidates(v: unknown): RTCIceCandidateInit[] | null {
  if (!Array.isArray(v) || v.length > 50) return null;
  const out: RTCIceCandidateInit[] = [];
  for (const c of v) {
    const x = (c ?? {}) as Record<string, unknown>;
    if (typeof x.candidate !== "string" || x.candidate.length > 1000) return null;
    out.push({
      candidate: x.candidate,
      sdpMid: typeof x.sdpMid === "string" ? x.sdpMid : null,
      sdpMLineIndex: typeof x.sdpMLineIndex === "number" ? x.sdpMLineIndex : null,
      usernameFragment: typeof x.usernameFragment === "string" ? x.usernameFragment : null,
    });
  }
  return out;
}

function parseSignal(raw: unknown): Signal | null {
  const s = (raw ?? {}) as Record<string, unknown>;
  if (typeof s.n !== "number" || !str(s.dev)) return null;
  const n = s.n;
  const dev = s.dev;
  switch (s.t) {
    case "answer":
      return str(s.sdp, MAX_SDP) ? { t: "answer", n, dev, sdp: s.sdp, video: s.video === true } : null;
    case "reoffer":
    case "reanswer":
      return str(s.sdp, MAX_SDP) ? { t: s.t, n, dev, sdp: s.sdp } : null;
    case "cands": {
      const list = parseCandidates(s.list);
      return list ? { t: "cands", n, dev, list } : null;
    }
    case "decline":
    case "busy":
    case "ka":
      return { t: s.t, n, dev };
    default:
      return null;
  }
}

export function sealOffer(key: CryptoKey, chatId: string, callId: string, from: string, to: string, offer: Offer): Promise<Sealed> {
  return encryptText(key, JSON.stringify(offer), callAad(chatId, callId, from, to));
}

export async function openOffer(
  key: CryptoKey,
  chatId: string,
  callId: string,
  from: string,
  to: string,
  sealed: Sealed
): Promise<Offer | null> {
  try {
    return parseOffer(JSON.parse(await decryptText(key, sealed, callAad(chatId, callId, from, to))));
  } catch {
    return null;
  }
}

export function sealSignal(key: CryptoKey, chatId: string, callId: string, sigId: string, from: string, sig: Signal): Promise<Sealed> {
  return encryptText(key, JSON.stringify(sig), sigAad(chatId, callId, sigId, from));
}

export async function openSignal(
  key: CryptoKey,
  chatId: string,
  callId: string,
  sigId: string,
  from: string,
  sealed: Sealed
): Promise<Signal | null> {
  try {
    return parseSignal(JSON.parse(await decryptText(key, sealed, sigAad(chatId, callId, sigId, from))));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Servidores para conectar (STUN/TURN)
// ---------------------------------------------------------------------------

export interface IceConfig {
  servers: RTCIceServer[];
  relay: boolean; // hay relevo TURN configurado
}

const FALLBACK: IceConfig = { servers: [{ urls: "stun:stun.cloudflare.com:3478" }], relay: false };
let iceCache: { at: number; config: IceConfig } | null = null;

/** Pide a /api/ice los servidores (con relevo si está configurado). */
export async function getIceConfig(getToken: () => Promise<string>): Promise<IceConfig> {
  if (iceCache && Date.now() - iceCache.at < 30 * 60_000) return iceCache.config;
  try {
    const res = await fetch("/api/ice", { headers: { Authorization: `Bearer ${await getToken()}` }, cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { iceServers?: unknown; relay?: unknown };
      if (Array.isArray(data.iceServers)) {
        const config = { servers: data.iceServers as RTCIceServer[], relay: data.relay === true };
        iceCache = { at: Date.now(), config };
        return config;
      }
    }
  } catch {
    // Sin conexión con la función: solo STUN.
  }
  return FALLBACK;
}

// ---------------------------------------------------------------------------
// Código de la llamada
// ---------------------------------------------------------------------------

/** Huella DTLS que viene en la oferta o respuesta ("sha-256 AB:CD:…"). */
export function sdpFingerprint(sdp: string | undefined | null): string | null {
  const m = sdp?.match(/^a=fingerprint:(\S+) ([0-9A-Fa-f:]+)\s*$/m);
  return m ? `${m[1].toLowerCase()} ${m[2].toUpperCase()}` : null;
}

/** Ocho cifras sacadas de las dos huellas: las mismas en los dos teléfonos. */
export async function callCode(a: string, b: string): Promise<string> {
  const data = new TextEncoder().encode([a, b].sort().join("|"));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  const hex = Array.from(hash.slice(0, 6), (x) => x.toString(16).padStart(2, "0")).join("");
  const digits = String(parseInt(hex, 16) % 100_000_000).padStart(8, "0");
  return `${digits.slice(0, 4)} ${digits.slice(4)}`;
}
