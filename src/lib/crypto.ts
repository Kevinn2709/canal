/**
 * crypto.ts — Cifrado de extremo a extremo con una frase compartida.
 *
 * - La frase se normaliza (sin mayúsculas, acentos, signos ni espacios de
 *   más) para que el autocorrector del teléfono no la cambie.
 * - De la frase sale una llave AES-GCM de 256 bits con PBKDF2-SHA256
 *   (600 000 iteraciones y una sal aleatoria guardada en Firestore).
 * - Cada mensaje se cifra con un IV aleatorio. El remitente va como "datos
 *   adicionales autenticados": si alguien cambia en la base de datos quién
 *   envió un mensaje, ese mensaje deja de descifrarse.
 * - Una "prueba de verificación" (un texto fijo cifrado con la llave) permite
 *   saber si una frase es la correcta sin guardar la frase en ningún lado.
 *
 * El servidor solo ve texto cifrado. La frase y la llave nunca salen del
 * dispositivo.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const DEFAULT_ITERATIONS = 600_000;
export const MIN_PHRASE_LENGTH = 16;
const CHECK_PLAINTEXT = "canal:verificacion:v1";
const CHECK_AAD = "canal:check";

export interface Sealed {
  iv: string; // base64, 12 bytes
  ct: string; // base64, texto cifrado + etiqueta de autenticación
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBytes(b64: string) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Deja la frase en una forma canónica: minúsculas, sin acentos, sin signos de
 * puntuación y con un solo espacio entre palabras. "Tortuga, Cobre  jazmín."
 * y "tortuga cobre jazmin" dan la misma llave.
 */
export function normalizePhrase(phrase: string): string {
  return phrase
    .normalize("NFKC")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos y diéresis
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ") // signos y espacios -> un espacio
    .trim();
}

/** Devuelve un aviso si la frase es demasiado débil, o null si está bien. */
export function phraseProblem(phrase: string): string | null {
  const normalized = normalizePhrase(phrase);
  if (normalized.length < MIN_PHRASE_LENGTH) {
    return `La frase debe tener al menos ${MIN_PHRASE_LENGTH} letras. Cuatro o cinco palabras sin relación entre sí funcionan bien.`;
  }
  if (normalized.split(" ").length < 3) {
    return "Usa al menos tres palabras separadas por espacios.";
  }
  return null;
}

export function randomSalt(): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
}

/** Deriva la llave de la frase. La llave no es extraíble: solo se puede usar. */
export async function deriveKey(
  phrase: string,
  saltB64: string,
  iterations: number
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(normalizePhrase(phrase)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: base64ToBytes(saltB64), iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptText(
  key: CryptoKey,
  plaintext: string,
  aad: string
): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(aad) },
    key,
    encoder.encode(plaintext)
  );
  return { iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ct)) };
}

/** Lanza un error si la llave no corresponde o si el mensaje fue alterado. */
export async function decryptText(
  key: CryptoKey,
  sealed: Sealed,
  aad: string
): Promise<string> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(sealed.iv), additionalData: encoder.encode(aad) },
    key,
    base64ToBytes(sealed.ct)
  );
  return decoder.decode(plain);
}

/** Datos adicionales autenticados de un mensaje: ligan el texto a su remitente. */
export function messageAad(uid: string): string {
  return `canal:msg:${uid}`;
}

/** Crea la prueba de verificación que se guarda junto a la sal. */
export function makeCheck(key: CryptoKey): Promise<Sealed> {
  return encryptText(key, CHECK_PLAINTEXT, CHECK_AAD);
}

/** true si la llave (es decir, la frase) es la correcta. */
export async function verifyKey(key: CryptoKey, check: Sealed): Promise<boolean> {
  try {
    return (await decryptText(key, check, CHECK_AAD)) === CHECK_PLAINTEXT;
  } catch {
    return false;
  }
}
