/**
 * webpush.ts — Envío de notificaciones push web (lado servidor), sin
 * dependencias: solo Web Crypto y fetch.
 *
 * - RFC 8291: el contenido del aviso va cifrado para el navegador que lo
 *   recibe (ECDH P-256 + HKDF + AES-128-GCM, codificación "aes128gcm").
 * - RFC 8292 (VAPID): cada envío va firmado (ES256) con la llave del sitio,
 *   así el servicio de push (Apple, Google, Mozilla) sabe que viene de aquí.
 *
 * El aviso no lleva el texto del mensaje: solo el id del chat y si te
 * mencionaron. El texto sigue cifrado de extremo a extremo.
 */

const enc = new TextEncoder();

export interface PushTarget {
  endpoint: string;
  p256dh: string; // llave pública del navegador (base64url, 65 bytes)
  auth: string; // secreto de autenticación (base64url, 16 bytes)
}

export interface Vapid {
  publicKey: string; // base64url, 65 bytes (punto sin comprimir)
  privateKey: string; // base64url, 32 bytes (d)
  subject: string; // "mailto:…" o "https://…"
}

export function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", new Uint8Array(ikm), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(salt), info: new Uint8Array(info) },
    key,
    length * 8
  );
  return new Uint8Array(bits);
}

/** Llave privada P-256 desde sus 32 bytes (d) y su pública de 65 bytes. */
async function importPrivateP256(d: Uint8Array, pub: Uint8Array, alg: "ECDH" | "ECDSA"): Promise<CryptoKey> {
  if (pub.length !== 65 || pub[0] !== 4 || d.length !== 32) throw new Error("Llave P-256 inválida");
  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: bytesToB64url(d),
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
    ext: true,
  };
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: alg, namedCurve: "P-256" },
    false,
    alg === "ECDH" ? ["deriveBits"] : ["sign"]
  );
}

export interface EncryptOptions {
  // Solo para pruebas con los vectores del RFC 8291.
  salt?: Uint8Array;
  asPrivate?: Uint8Array;
  asPublic?: Uint8Array;
}

/** Cifra el contenido del aviso para un navegador (RFC 8291, un solo registro). */
export async function encryptPayload(
  target: PushTarget,
  plaintext: Uint8Array,
  options: EncryptOptions = {}
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = b64urlToBytes(target.p256dh);
  const authSecret = b64urlToBytes(target.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error("Suscripción inválida");

  let asPrivate: CryptoKey;
  let asPublic: Uint8Array;
  if (options.asPrivate && options.asPublic) {
    asPrivate = await importPrivateP256(options.asPrivate, options.asPublic, "ECDH");
    asPublic = options.asPublic;
  } else {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  }
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));

  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPrivate, 256));

  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const record = concat(plaintext, new Uint8Array([2])); // 0x02: último registro
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, record));

  const rs = 4096;
  const header = concat(
    salt,
    new Uint8Array([(rs >>> 24) & 255, (rs >>> 16) & 255, (rs >>> 8) & 255, rs & 255]),
    new Uint8Array([asPublic.length]),
    asPublic
  );
  return concat(header, ct);
}

/** Encabezado Authorization con el JWT de VAPID (RFC 8292). */
export async function vapidAuthorization(endpoint: string, vapid: Vapid, now = Date.now()): Promise<string> {
  const pub = b64urlToBytes(vapid.publicKey);
  const key = await importPrivateP256(b64urlToBytes(vapid.privateKey), pub, "ECDSA");
  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = bytesToB64url(
    enc.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now / 1000) + 12 * 3600,
        sub: vapid.subject,
      })
    )
  );
  const unsigned = `${header}.${claims}`;
  // Web Crypto devuelve la firma ECDSA en el formato r||s que pide JWT.
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(unsigned))
  );
  return `vapid t=${unsigned}.${bytesToB64url(sig)}, k=${vapid.publicKey}`;
}

/** Envía un aviso. Devuelve el código HTTP del servicio de push. */
export async function sendPush(
  target: PushTarget,
  payload: string,
  vapid: Vapid,
  options: { topic?: string; ttl?: number; fetchImpl?: typeof fetch } = {}
): Promise<number> {
  const body = await encryptPayload(target, enc.encode(payload));
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(target.endpoint, vapid),
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(options.ttl ?? 86400),
    Urgency: "high",
  };
  if (options.topic) headers.Topic = options.topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  const res = await (options.fetchImpl ?? fetch)(target.endpoint, { method: "POST", headers, body });
  return res.status;
}

/** Crea un par de llaves VAPID nuevo (en el navegador, una sola vez). */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as { d?: string };
  if (!jwk.d) throw new Error("No se pudo exportar la llave");
  return { publicKey: bytesToB64url(pub), privateKey: jwk.d };
}
