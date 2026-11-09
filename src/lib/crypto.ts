/**
 * crypto.ts — Núcleo criptográfico E2EE (Web Crypto API)
 *
 * Modelo: llave simétrica derivada de la PASSPHRASE compartida.
 *
 *  - Ambas partes conocen la misma frase secreta.
 *  - Cada una deriva, por su cuenta y en cualquier momento, la MISMA llave
 *    AES-GCM con PBKDF2. No hace falta handshake ni estar conectados a la vez.
 *  - El servidor nunca conoce la passphrase ni la llave: solo ve ciphertext.
 *
 * Por qué así y no ECDH:
 *  - ECDH (llaves efímeras) da forward secrecy, pero exige intercambiar
 *    llaves públicas EN VIVO. Con mensajería asíncrona (no coinciden en línea)
 *    y sin almacenamiento persistente de llaves, ECDH no es viable.
 *  - Contrapartida honesta de este modelo: NO hay forward secrecy. La llave es
 *    estable mientras la passphrase no cambie. Si la frase se filtra, el
 *    ciphertext grabado del pasado se vuelve descifrable. Mitigación: frase
 *    fuerte y rotación periódica.
 */

// ---------- utilidades base64 <-> ArrayBuffer ----------

export function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBuf(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// ---------- derivación de la llave de mensajes ----------

// Costo de PBKDF2: sube esto si quieres endurecer contra fuerza bruta de la
// passphrase (a cambio de un desbloqueo un poco más lento).
export const PBKDF2_ITERATIONS = 250_000;

/**
 * Deriva la llave AES-GCM de 256 bits a partir de la passphrase.
 * Salt constante: ambos lados deben usar el MISMO salt para obtener la MISMA
 * llave. Es público; la seguridad viene de la entropía de la passphrase, así
 * que usa una frase larga y difícil de adivinar.
 *
 * La llave se marca como NO extraíble: ni tu propio código puede exportarla.
 */
export async function deriveMessageKey(passphrase: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const salt = enc.encode("stealth-chat/msgkey/v1");
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// ---------- cifrado / descifrado de mensajes ----------

export interface EncryptedPayload {
  iv: string; // base64, 12 bytes, aleatorio por mensaje (nunca reutilizado)
  ct: string; // base64, ciphertext + tag de autenticación
}

export async function encryptMessage(
  key: CryptoKey,
  plaintext: string
): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return { iv: bufToBase64(iv.buffer), ct: bufToBase64(ct) };
}

/**
 * Descifra. Si el blob fue alterado o la llave no corresponde, AES-GCM lanza
 * (esa es la verificación de integridad). El llamador trata el throw como
 * "mensaje inválido".
 */
export async function decryptMessage(
  key: CryptoKey,
  payload: EncryptedPayload
): Promise<string> {
  const iv = new Uint8Array(base64ToBuf(payload.iv));
  const ct = base64ToBuf(payload.ct);
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(plainBuf);
}
