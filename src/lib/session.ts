/**
 * session.ts — La cuenta cifrada de cada persona.
 *
 * Cada quien tiene su propia frase personal. Nadie más la necesita.
 *
 * - keys/{uid}: el "paquete" privado de cada quien, cifrado con su frase
 *   personal: su llave privada, la llave del espacio (perfiles y stickers) y,
 *   para los dos fundadores, la llave anterior (la de la frase compartida, que
 *   abre el historial de antes). Solo su dueño puede leerlo.
 * - users/{uid}: lo público de cada quien: su llave pública, si es fundador,
 *   su perfil (cifrado con la llave del espacio) y hasta dónde leyó cada chat.
 * - meta/space: la llave del espacio cifrada con la llave anterior. Así los
 *   dos fundadores la obtienen solos, sin esperar a que alguien los apruebe.
 * - wraps/{uid}: la llave del espacio (y, para un fundador, la anterior) que un
 *   fundador le pasa cifrada a otro al aprobarlo.
 *
 * Papeles (los decide firestore.rules):
 * - Fundadores originales (founders): los dos de siempre. Crean chats, aprueban
 *   y ven a todos; además tienen las conversaciones de antes.
 * - Fundadores adicionales (admins): igual, pero sin las conversaciones de antes.
 * - Miembros (others): solo usan los chats a los que los agregan. No crean
 *   chats ni ven quién más está en la web.
 */

import { doc, getDoc, serverTimestamp, setDoc, type Firestore } from "firebase/firestore";
import {
  DEFAULT_ITERATIONS,
  base64ToBytes,
  bytesToBase64,
  decryptText,
  deriveKey,
  deriveRawKey,
  encryptText,
  generateIdentity,
  importAesKey,
  importIdentity,
  openFrom,
  randomKeyBytes,
  randomSalt,
  sealFor,
  verifyKey,
  type Identity,
  type Sealed,
} from "./crypto";

export interface Bundle {
  v: 1;
  priv: string; // llave privada (PKCS#8, base64)
  pub: string; // llave pública (SPKI, base64)
  ws?: string; // llave del espacio (32 bytes, base64)
  legacy?: string; // llave anterior (32 bytes, base64), solo fundadores
}

/** Lo que las reglas le permiten a esta cuenta. */
export interface Role {
  founder: boolean; // fundador original: tiene las conversaciones de antes
  admin: boolean; // crea chats, aprueba y ve a todos (fundadores originales y adicionales)
}

export interface Session {
  uid: string;
  founder: boolean; // fundador original (conversaciones de antes)
  admin: boolean; // fundador (original o adicional): crea chats y ve a todos
  identity: Identity;
  personalKey: CryptoKey;
  salt: string;
  iterations: number;
  bundle: Bundle;
  ws: CryptoKey | null; // null mientras nadie lo aprueba
  wsRaw: Uint8Array | null;
  legacy: CryptoKey | null; // abre el historial de antes
  legacyRaw: Uint8Array | null;
}

export interface KeysDoc {
  salt: string;
  iterations: number;
  iv: string;
  ct: string;
}

export interface LegacyMeta {
  salt: string;
  iterations: number;
  checkIv: string;
  checkCt: string;
  createdBy: string;
}

export const SPACE_CONTEXT = "space";

function bundleAad(uid: string): string {
  return `canal:bundle:${uid}`;
}

const SPACE_LEGACY_AAD = "canal:space:legacy";

function errorCode(err: unknown): string {
  return (err as { code?: string }).code ?? "";
}

export class NotAuthorizedError extends Error {
  constructor() {
    super("not-authorized");
  }
}

/** El paquete cifrado de esta cuenta, o null si aún no lo creó. */
export async function loadKeysDoc(db: Firestore, uid: string): Promise<KeysDoc | null> {
  let snap;
  try {
    snap = await getDoc(doc(db, "keys", uid));
  } catch (err) {
    if (errorCode(err) === "permission-denied") throw new NotAuthorizedError();
    throw err;
  }
  if (!snap.exists()) return null;
  const d = snap.data() ?? {};
  if (
    typeof d.salt !== "string" ||
    typeof d.iterations !== "number" ||
    typeof d.iv !== "string" ||
    typeof d.ct !== "string"
  ) {
    return null;
  }
  return { salt: d.salt, iterations: d.iterations, iv: d.iv, ct: d.ct };
}

/**
 * ¿Es fundador? Solo los fundadores pueden leer meta/crypto (la frase
 * compartida de la versión anterior). Devuelve también esos datos, si hay.
 */
export async function probeLegacy(db: Firestore): Promise<{ founder: boolean; meta: LegacyMeta | null }> {
  try {
    const snap = await getDoc(doc(db, "meta", "crypto"));
    if (!snap.exists()) return { founder: true, meta: null };
    const d = snap.data() ?? {};
    if (
      typeof d.salt !== "string" ||
      typeof d.iterations !== "number" ||
      typeof d.checkIv !== "string" ||
      typeof d.checkCt !== "string"
    ) {
      return { founder: true, meta: null };
    }
    return {
      founder: true,
      meta: {
        salt: d.salt,
        iterations: d.iterations,
        checkIv: d.checkIv,
        checkCt: d.checkCt,
        createdBy: typeof d.createdBy === "string" ? d.createdBy : "",
      },
    };
  } catch (err) {
    if (errorCode(err) === "permission-denied") return { founder: false, meta: null };
    throw err;
  }
}

/**
 * ¿Qué papel tiene esta cuenta? Fundador original = puede leer meta/crypto;
 * fundador (original o adicional) = puede leer meta/admin. El documento no
 * necesita existir: basta con que las reglas dejen leerlo.
 */
export async function probeRole(db: Firestore): Promise<Role & { meta: LegacyMeta | null }> {
  const legacy = await probeLegacy(db);
  let admin = legacy.founder;
  if (!admin) {
    try {
      await getDoc(doc(db, "meta", "admin"));
      admin = true;
    } catch (err) {
      if (errorCode(err) !== "permission-denied") throw err;
    }
  }
  return { founder: legacy.founder, admin, meta: legacy.meta };
}

export function roleOf(session: Session): Role {
  return { founder: session.founder, admin: session.admin };
}

/** Comprueba la frase compartida anterior. Devuelve la llave en bruto o null. */
export async function legacyRawFromPhrase(meta: LegacyMeta, phrase: string): Promise<Uint8Array | null> {
  const raw = await deriveRawKey(phrase, meta.salt, meta.iterations);
  const key = await importAesKey(raw);
  return (await verifyKey(key, { iv: meta.checkIv, ct: meta.checkCt })) ? raw : null;
}

export async function personalKeyFor(phrase: string, kd: { salt: string; iterations: number }): Promise<CryptoKey> {
  return deriveKey(phrase, kd.salt, kd.iterations);
}

/** Abre el paquete con la llave personal. null si la frase no corresponde. */
export async function openBundle(personalKey: CryptoKey, uid: string, kd: KeysDoc): Promise<Bundle | null> {
  try {
    const raw = JSON.parse(await decryptText(personalKey, { iv: kd.iv, ct: kd.ct }, bundleAad(uid))) as Partial<Bundle>;
    if (raw.v !== 1 || typeof raw.priv !== "string" || typeof raw.pub !== "string") return null;
    const bundle: Bundle = { v: 1, priv: raw.priv, pub: raw.pub };
    if (typeof raw.ws === "string") bundle.ws = raw.ws;
    if (typeof raw.legacy === "string") bundle.legacy = raw.legacy;
    return bundle;
  } catch {
    return null;
  }
}

export async function buildSession(
  uid: string,
  role: Role,
  personalKey: CryptoKey,
  kd: { salt: string; iterations: number },
  bundle: Bundle
): Promise<Session> {
  const identity = await importIdentity(bundle.priv, bundle.pub);
  const wsRaw = bundle.ws ? base64ToBytes(bundle.ws) : null;
  const legacyRaw = bundle.legacy ? base64ToBytes(bundle.legacy) : null;
  return {
    uid,
    founder: role.founder,
    admin: role.admin || role.founder,
    identity,
    personalKey,
    salt: kd.salt,
    iterations: kd.iterations,
    bundle,
    ws: wsRaw ? await importAesKey(wsRaw) : null,
    wsRaw,
    legacy: legacyRaw ? await importAesKey(legacyRaw) : null,
    legacyRaw,
  };
}

async function writeBundle(
  db: Firestore,
  uid: string,
  personalKey: CryptoKey,
  kd: { salt: string; iterations: number },
  bundle: Bundle
): Promise<void> {
  const sealed = await encryptText(personalKey, JSON.stringify(bundle), bundleAad(uid));
  await setDoc(doc(db, "keys", uid), {
    salt: kd.salt,
    iterations: kd.iterations,
    iv: sealed.iv,
    ct: sealed.ct,
    updatedAt: serverTimestamp(),
  });
}

/** Publica la llave pública (y si es fundador) en users/{uid}. */
export async function publishIdentity(db: Firestore, session: Session): Promise<void> {
  await setDoc(
    doc(db, "users", session.uid),
    { pub: session.identity.pub, founder: session.founder, setupAt: serverTimestamp() },
    { merge: true }
  );
}

/**
 * La llave del espacio para un fundador que tiene la llave anterior: la toma
 * de meta/space o, si es el primero, la crea ahí.
 */
async function spaceKeyFromLegacy(db: Firestore, uid: string, legacyRaw: Uint8Array): Promise<Uint8Array> {
  const legacy = await importAesKey(legacyRaw);
  const ref = doc(db, "meta", "space");
  const read = async (): Promise<Uint8Array | null> => {
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const d = snap.data() ?? {};
    if (typeof d.iv !== "string" || typeof d.ct !== "string" || !d.ct) throw new Error("meta/space sin llave");
    return base64ToBytes(await decryptText(legacy, { iv: d.iv, ct: d.ct }, SPACE_LEGACY_AAD));
  };
  const existing = await read();
  if (existing) return existing;
  const raw = randomKeyBytes();
  const sealed = await encryptText(legacy, bytesToBase64(raw), SPACE_LEGACY_AAD);
  try {
    await setDoc(ref, { iv: sealed.iv, ct: sealed.ct, createdBy: uid, createdAt: serverTimestamp() });
    return raw;
  } catch (err) {
    // El otro fundador la creó al mismo tiempo: se usa la suya.
    const theirs = await read();
    if (theirs) return theirs;
    throw err;
  }
}

/**
 * Espacio nuevo (sin historial anterior): el primer fundador crea la llave
 * del espacio y deja una marca en meta/space. Los demás esperan aprobación.
 */
async function spaceKeyForFreshInstall(db: Firestore, uid: string): Promise<Uint8Array | null> {
  const ref = doc(db, "meta", "space");
  if ((await getDoc(ref)).exists()) return null;
  try {
    await setDoc(ref, { iv: "", ct: "", createdBy: uid, createdAt: serverTimestamp() });
    return randomKeyBytes();
  } catch {
    return null;
  }
}

/**
 * Crea (o vuelve a crear, si olvidó su frase) la cuenta cifrada.
 * `legacyRaw`: la llave anterior, si es fundador y escribió la frase compartida.
 */
export async function createAccount(
  db: Firestore,
  args: { uid: string; role: Role; phrase: string; legacyRaw: Uint8Array | null; freshInstall: boolean }
): Promise<Session> {
  const { uid, role, phrase, legacyRaw } = args;
  const founder = role.founder;
  const kd = { salt: randomSalt(), iterations: DEFAULT_ITERATIONS };
  const personalKey = await deriveKey(phrase, kd.salt, kd.iterations);
  const { identity, privPkcs8 } = await generateIdentity();

  let wsRaw: Uint8Array | null = null;
  if (founder && legacyRaw) wsRaw = await spaceKeyFromLegacy(db, uid, legacyRaw);
  else if (founder && args.freshInstall) wsRaw = await spaceKeyForFreshInstall(db, uid);

  const bundle: Bundle = { v: 1, priv: privPkcs8, pub: identity.pub };
  if (wsRaw) bundle.ws = bytesToBase64(wsRaw);
  if (legacyRaw) bundle.legacy = bytesToBase64(legacyRaw);

  await writeBundle(db, uid, personalKey, kd, bundle);
  const session = await buildSession(uid, role, personalKey, kd, bundle);
  await publishIdentity(db, session);
  return session;
}

/** Cambia la frase personal (sabiendo la actual). */
export async function changePhrase(db: Firestore, session: Session, phrase: string): Promise<Session> {
  const kd = { salt: randomSalt(), iterations: DEFAULT_ITERATIONS };
  const personalKey = await deriveKey(phrase, kd.salt, kd.iterations);
  await writeBundle(db, session.uid, personalKey, kd, session.bundle);
  return { ...session, personalKey, salt: kd.salt, iterations: kd.iterations };
}

/** Agrega la llave anterior (frase compartida) al paquete de un fundador. */
export async function addLegacyKey(db: Firestore, session: Session, legacyRaw: Uint8Array): Promise<Session> {
  let wsRaw = session.wsRaw;
  if (!wsRaw) wsRaw = await spaceKeyFromLegacy(db, session.uid, legacyRaw);
  const bundle: Bundle = { ...session.bundle, legacy: bytesToBase64(legacyRaw), ws: bytesToBase64(wsRaw) };
  await writeBundle(db, session.uid, session.personalKey, session, bundle);
  return buildSession(session.uid, roleOf(session), session.personalKey, session, bundle);
}

// ---------------------------------------------------------------------------
// Aprobación: pasar la llave del espacio a otro miembro
// ---------------------------------------------------------------------------

export interface WrapDoc {
  from: string;
  spub?: string; // llave pública de quien aprueba (las reglas comprueban que es la suya)
  fp: string; // huella de la llave del destinatario para la que se cifró
  iv: string;
  ct: string;
}

/** Aprueba a un miembro: le pasa, cifrada solo para él, la llave del espacio. */
export async function approveMember(
  db: Firestore,
  session: Session,
  target: { uid: string; pub: string; fp: string; founder: boolean }
): Promise<void> {
  if (!session.wsRaw) throw new Error("Sin llave del espacio");
  const body: { ws: string; legacy?: string } = { ws: bytesToBase64(session.wsRaw) };
  // A un fundador también se le pasa la llave anterior (el historial de antes).
  if (target.founder && session.legacyRaw) body.legacy = bytesToBase64(session.legacyRaw);
  const sealed = await sealFor(
    session.identity.priv,
    target.pub,
    session.uid,
    target.uid,
    SPACE_CONTEXT,
    JSON.stringify(body)
  );
  await setDoc(doc(db, "wraps", target.uid), {
    from: session.uid,
    // Va aquí porque un miembro no puede leer users/ de nadie más que de sí mismo.
    spub: session.identity.pub,
    fp: target.fp,
    iv: sealed.iv,
    ct: sealed.ct,
    at: serverTimestamp(),
  });
}

/** Recibe la aprobación: guarda en el paquete la llave del espacio. */
export async function acceptWrap(
  db: Firestore,
  session: Session,
  wrap: WrapDoc,
  fromPub: string
): Promise<Session> {
  const sealed: Sealed = { iv: wrap.iv, ct: wrap.ct };
  const json = await openFrom(session.identity.priv, fromPub, wrap.from, session.uid, SPACE_CONTEXT, sealed);
  const body = JSON.parse(json) as { ws?: unknown; legacy?: unknown };
  if (typeof body.ws !== "string" || base64ToBytes(body.ws).length !== 32) throw new Error("Aprobación inválida");
  const bundle: Bundle = { ...session.bundle, ws: body.ws };
  if (!bundle.legacy && typeof body.legacy === "string" && base64ToBytes(body.legacy).length === 32) {
    bundle.legacy = body.legacy;
  }
  await writeBundle(db, session.uid, session.personalKey, session, bundle);
  return buildSession(session.uid, roleOf(session), session.personalKey, session, bundle);
}
