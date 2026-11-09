/**
 * stickers.ts — Biblioteca de stickers compartida entre los dos.
 *
 * Cualquiera sube una imagen (PNG con transparencia, GIF animado, foto…) y se
 * convierte en sticker: se reduce a 512 px y se guarda cifrada como cualquier
 * archivo. stickers/{id} solo guarda, cifrados, los datos del archivo.
 * "Quitar" lo oculta de la biblioteca (los mensajes ya enviados lo conservan).
 */

import {
  collection,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import { decryptText, encryptText, type Sealed } from "./crypto";
import { parseFileInfo, type FileInfo } from "./chats";
import { uploadFile, type PreparedFile } from "./files";

const STICKER_SIZE = 512;
const MAX_GIF_SIZE = 1.5 * 1024 * 1024;

export interface Sticker {
  id: string;
  uid: string;
  file: FileInfo;
  createdAt: Date | null;
}

function stickerAad(id: string): string {
  return `canal:sticker:${id}`;
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  // WebP conserva la transparencia y pesa poco; Safari no lo genera, así que
  // ahí se usa PNG.
  const webp = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.9));
  if (webp && webp.type === "image/webp") return webp;
  return new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
}

/** Convierte una imagen en sticker de 512 px. Lanza Error con mensaje para mostrar. */
export async function prepareSticker(file: File): Promise<PreparedFile> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
    throw new Error("El sticker tiene que ser una imagen (PNG, JPG, WebP o GIF).");
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("No se pudo leer esa imagen. Prueba con PNG o JPG.");
  }
  const { width, height } = bitmap;

  // GIF animado: se conserva tal cual para no perder la animación.
  if (file.type === "image/gif") {
    bitmap.close();
    if (file.size > MAX_GIF_SIZE) throw new Error("El GIF es muy pesado para sticker (máx. 1.5 MB).");
    return { blob: file, name: "sticker.gif", mime: "image/gif", w: width, h: height, isImage: true };
  }

  const scale = Math.min(1, STICKER_SIZE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("No se pudo procesar la imagen.");
  }
  ctx.drawImage(bitmap, 0, 0, w, h); // sin fondo: conserva la transparencia
  bitmap.close();
  const blob = await canvasToBlob(canvas);
  if (!blob) throw new Error("No se pudo procesar la imagen.");
  const ext = blob.type === "image/webp" ? "webp" : "png";
  return { blob, name: `sticker.${ext}`, mime: blob.type, w, h, isImage: true };
}

/** Sube un sticker nuevo a la biblioteca. */
export async function addSticker(
  db: Firestore,
  key: CryptoKey,
  uid: string,
  file: File
): Promise<void> {
  const prepared = await prepareSticker(file);
  const info = await uploadFile(db, key, uid, prepared, () => undefined);
  const ref = doc(collection(db, "stickers"));
  const sealed = await encryptText(key, JSON.stringify(info), stickerAad(ref.id));
  await setDoc(ref, {
    ct: sealed.ct,
    iv: sealed.iv,
    uid,
    createdAt: serverTimestamp(),
    hidden: false,
  });
}

export async function hideSticker(db: Firestore, id: string): Promise<void> {
  await updateDoc(doc(db, "stickers", id), { hidden: true });
}

export async function decryptSticker(
  key: CryptoKey,
  id: string,
  sealed: Sealed
): Promise<FileInfo | null> {
  try {
    return parseFileInfo(JSON.parse(await decryptText(key, sealed, stickerAad(id))));
  } catch {
    return null;
  }
}
