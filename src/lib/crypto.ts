/**
 * crypto.ts — Piezas de cifrado (Web Crypto, sin dependencias).
 *
 * - Frases: se normalizan (sin mayúsculas, acentos, signos ni espacios de
 *   más) y de ellas sale una llave AES-GCM de 256 bits con PBKDF2-SHA256
 *   (600 000 iteraciones y una sal aleatoria).
 * - Cada mensaje se cifra con AES-GCM y un IV aleatorio. Los "datos
 *   adicionales autenticados" ligan el texto a su conversación y remitente:
 *   si alguien los cambia en la base de datos, deja de descifrarse.
 * - Identidad: cada persona tiene un par de llaves ECDH P-256. La privada se
 *   guarda cifrada con su frase personal; la pública es visible para los
 *   demás miembros. Con ECDH + HKDF dos personas obtienen una llave común
 *   para pasarse, cifradas, las llaves de cada conversación.
 *
 * El servidor solo ve texto cifrado. Las frases y las llaves nunca salen del
 * dispositivo sin cifrar.
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

/** Cifra bytes (trozos de archivos). Devuelve el IV en base64 y los bytes cifrados. */
export async function encryptBytes(
  key: CryptoKey,
  data: Uint8Array,
  aad: string
): Promise<{ iv: string; data: Uint8Array<ArrayBuffer> }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(aad) },
    key,
    new Uint8Array(data)
  );
  return { iv: bytesToBase64(iv), data: new Uint8Array(ct) };
}

/** Descifra bytes. Lanza un error si la llave no corresponde o si fueron alterados. */
export async function decryptBytes(
  key: CryptoKey,
  ivB64: string,
  data: Uint8Array,
  aad: string
): Promise<Uint8Array<ArrayBuffer>> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(ivB64), additionalData: encoder.encode(aad) },
    key,
    new Uint8Array(data)
  );
  return new Uint8Array(plain);
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

// ---------------------------------------------------------------------------
// Llaves AES en bruto (llave de cada conversación, del espacio, la anterior)
// ---------------------------------------------------------------------------

/** 32 bytes aleatorios: una llave AES-256 nueva. */
export function randomKeyBytes(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(32));
}

/** Importa una llave AES-GCM de 32 bytes (no extraíble). */
export function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new Uint8Array(raw), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Los mismos 32 bytes que deriveKey() con la misma frase, sal e iteraciones,
 * pero en bruto, para poder guardarlos cifrados o pasarlos a otro miembro.
 */
export async function deriveRawKey(
  phrase: string,
  saltB64: string,
  iterations: number
): Promise<Uint8Array<ArrayBuffer>> {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(normalizePhrase(phrase)),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: base64ToBytes(saltB64), iterations, hash: "SHA-256" },
    material,
    256
  );
  return new Uint8Array(bits);
}

// ---------------------------------------------------------------------------
// Identidad: par de llaves ECDH P-256 de cada persona
// ---------------------------------------------------------------------------

const P256 = { name: "ECDH", namedCurve: "P-256" } as const;

export interface Identity {
  priv: CryptoKey; // privada, no extraíble
  pub: string; // pública (SPKI en base64)
  fp: string; // huella: SHA-256 de la pública, en hexadecimal
}

/** Crea una identidad nueva. Devuelve también la privada exportada para guardarla cifrada. */
export async function generateIdentity(): Promise<{ identity: Identity; privPkcs8: string }> {
  const pair = await crypto.subtle.generateKey(P256, true, ["deriveBits"]);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  const privPkcs8 = bytesToBase64(pkcs8);
  pkcs8.fill(0);
  return { identity: await importIdentity(privPkcs8, bytesToBase64(spki)), privPkcs8 };
}

export async function importIdentity(privPkcs8: string, pub: string): Promise<Identity> {
  const priv = await crypto.subtle.importKey("pkcs8", base64ToBytes(privPkcs8), P256, false, [
    "deriveBits",
  ]);
  return { priv, pub, fp: await fingerprint(pub) };
}

/** Huella de una llave pública: SHA-256 en hexadecimal (64 caracteres). */
export async function fingerprint(pub: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", base64ToBytes(pub)));
  return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Código de seguridad para comparar en persona o por llamada: 20 cifras en
 * cuatro grupos, sacadas de la huella. Si dos personas ven el mismo código
 * para una cuenta, tienen la misma llave pública de esa cuenta.
 */
export function securityCode(fp: string): string {
  const groups: string[] = [];
  for (let i = 0; i < 4; i++) {
    const n = parseInt(fp.slice(i * 10, i * 10 + 10), 16) % 100000;
    groups.push(String(n).padStart(5, "0"));
  }
  return groups.join(" ");
}

/**
 * Llave común entre dos identidades (ECDH + HKDF-SHA256). Sale la misma de
 * los dos lados: (mi privada, su pública) = (su privada, mi pública).
 * `info` liga la llave a un uso concreto, a quién la envía y a quién.
 */
async function pairKey(priv: CryptoKey, otherPub: string, info: string): Promise<CryptoKey> {
  const pub = await crypto.subtle.importKey("spki", base64ToBytes(otherPub), P256, false, []);
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: pub }, priv, 256);
  const hkdf = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: encoder.encode(info) },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function pairInfo(context: string, fromUid: string, toUid: string): string {
  return `canal:pair:v1:${context}:${fromUid}>${toUid}`;
}

/**
 * Cifra un texto de `fromUid` para `toUid`. Solo `toUid` (con su privada) o
 * `fromUid` pueden abrirlo, y al abrirlo se comprueba que lo creó quien tiene
 * la privada de `fromUid`.
 */
export async function sealFor(
  myPriv: CryptoKey,
  theirPub: string,
  fromUid: string,
  toUid: string,
  context: string,
  plaintext: string
): Promise<Sealed> {
  const key = await pairKey(myPriv, theirPub, pairInfo(context, fromUid, toUid));
  return encryptText(key, plaintext, context);
}

export async function openFrom(
  myPriv: CryptoKey,
  theirPub: string,
  fromUid: string,
  toUid: string,
  context: string,
  sealed: Sealed
): Promise<string> {
  const key = await pairKey(myPriv, theirPub, pairInfo(context, fromUid, toUid));
  return decryptText(key, sealed, context);
}
