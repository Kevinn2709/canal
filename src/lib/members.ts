/**
 * members.ts — Perfiles de los miembros (nombre y foto), cifrados.
 *
 * - El perfil va en users/{uid} cifrado con la llave del espacio. Sus datos
 *   autenticados incluyen la huella de la llave pública de esa persona: solo
 *   un miembro aprobado (que tiene la llave del espacio) puede publicar un
 *   perfil válido, y queda ligado a esa llave pública. Si alguien cambiara en
 *   la base de datos la llave pública de un miembro, su perfil dejaría de
 *   validar y la app no le pasaría llaves de chats.
 * - La foto va aparte, en avatars/{uid}, cifrada con la llave del espacio.
 */

import { Bytes, doc, serverTimestamp, setDoc, type Firestore } from "firebase/firestore";
import { decryptBytes, decryptText, encryptBytes, encryptText, securityCode, type Sealed } from "./crypto";
import type { Session } from "./session";

export const MAX_PROFILE_NAME = 40;
const AVATAR_SIZE = 192;

export interface Profile {
  uid: string;
  pub: string;
  fp: string;
  code: string; // código de seguridad para comparar
  founder: boolean;
  name: string; // "" si aún no tiene perfil válido
  valid: boolean; // perfil publicado con la llave del espacio y ligado a su llave pública
  photo: number; // versión de la foto (0 = sin foto)
  color: string;
  lastRead: Record<string, Date>;
  readCount: Record<string, number>;
}

const COLORS = ["#f59e0b", "#10b981", "#38bdf8", "#a78bfa", "#f472b6", "#fb7185", "#34d399", "#facc15"];

export function colorFor(uid: string): string {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = Array.from(words[0])[0] ?? "";
  const second = words.length > 1 ? Array.from(words[words.length - 1])[0] ?? "" : "";
  return (first + second).toUpperCase();
}

function profileAad(uid: string, fp: string): string {
  return `canal:profile:${uid}:${fp}`;
}

function avatarAad(uid: string): string {
  return `canal:avatar:${uid}`;
}

export async function decryptProfile(
  ws: CryptoKey,
  uid: string,
  fp: string,
  sealed: Sealed
): Promise<{ name: string; photo: number } | null> {
  try {
    const raw = JSON.parse(await decryptText(ws, sealed, profileAad(uid, fp))) as { name?: unknown; ph?: unknown };
    if (typeof raw.name !== "string" || !raw.name.trim()) return null;
    return {
      name: raw.name.trim().slice(0, MAX_PROFILE_NAME),
      photo: typeof raw.ph === "number" && raw.ph > 0 ? raw.ph : 0,
    };
  } catch {
    return null;
  }
}

/** Recorta al centro y reduce a 192 px. Lanza Error con mensaje para mostrar. */
export async function prepareAvatar(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
    throw new Error("La foto tiene que ser una imagen (JPG, PNG o WebP).");
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("No se pudo leer esa imagen. Prueba con JPG o PNG.");
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("No se pudo procesar la imagen.");
  }
  ctx.fillStyle = "#262626";
  ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  if (!blob) throw new Error("No se pudo procesar la imagen.");
  return blob;
}

/**
 * Guarda el perfil. `photo`: Blob nuevo, null para quitarla, undefined para
 * dejar la que había (`currentPhoto`).
 */
export async function saveProfile(
  db: Firestore,
  session: Session,
  name: string,
  photo: Blob | null | undefined,
  currentPhoto: number
): Promise<void> {
  if (!session.ws) throw new Error("Sin llave del espacio");
  const clean = name.trim().slice(0, MAX_PROFILE_NAME);
  if (!clean) throw new Error("Escribe tu nombre.");
  let ph = currentPhoto;
  if (photo) {
    const sealed = await encryptBytes(session.ws, new Uint8Array(await photo.arrayBuffer()), avatarAad(session.uid));
    await setDoc(doc(db, "avatars", session.uid), {
      iv: sealed.iv,
      data: Bytes.fromUint8Array(sealed.data),
      updatedAt: serverTimestamp(),
    });
    ph = Date.now();
  } else if (photo === null) {
    ph = 0;
  }
  const sealed = await encryptText(
    session.ws,
    JSON.stringify({ name: clean, ph }),
    profileAad(session.uid, session.identity.fp)
  );
  await setDoc(doc(db, "users", session.uid), { profIv: sealed.iv, profCt: sealed.ct }, { merge: true });
}

export async function decryptAvatar(ws: CryptoKey, uid: string, iv: string, data: Bytes): Promise<Blob | null> {
  try {
    const plain = await decryptBytes(ws, iv, data.toUint8Array(), avatarAad(uid));
    return new Blob([plain], { type: "image/jpeg" });
  } catch {
    return null;
  }
}

export function makeCode(fp: string): string {
  return securityCode(fp);
}

/** Nombre para mostrar de un miembro. */
export function nameOf(profiles: Map<string, Profile>, uid: string, myUid: string, me = "Tú"): string {
  if (uid === myUid) return me;
  const p = profiles.get(uid);
  return p && p.valid ? p.name : "Miembro";
}
