/**
 * files.ts — Fotos y archivos cifrados de extremo a extremo.
 *
 * El plan gratis de Firebase no incluye Cloud Storage, así que los archivos
 * se guardan en Firestore, cifrados y partidos en trozos de 900 KB:
 *   files/{fileId}/chunks/0000, 0001, …
 * Cada trozo se cifra con la llave de la conversación, y sus datos
 * autenticados incluyen el id del archivo, su número y el total: si alguien
 * cambia, reordena o quita un trozo, el archivo no se descifra.
 *
 * Las fotos se comprimen antes de subir (máx. 1920 px, JPEG): quedan en unos
 * cientos de KB y caben miles en el 1 GiB gratis.
 */

import {
  Bytes,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  type Firestore,
} from "firebase/firestore";
import { decryptBytes, encryptBytes } from "./crypto";
import type { FileInfo } from "./chats";

export const CHUNK_SIZE = 900 * 1024;
export const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1920;
const KEEP_ORIGINAL_UNDER = 500 * 1024;
const MAX_FILE_NAME = 120;

export interface PreparedFile {
  blob: Blob;
  name: string;
  mime: string;
  w?: number;
  h?: number;
  isImage: boolean;
}

function chunkId(i: number): string {
  return String(i).padStart(4, "0");
}

function fileAad(fileId: string, index: number, total: number): string {
  return `canal:file:${fileId}:${index}:${total}`;
}

function cleanName(name: string, fallback: string): string {
  const n = name.replace(/[\u0000-\u001f]/g, "").trim();
  return (n || fallback).slice(0, MAX_FILE_NAME);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Comprime una foto. Devuelve null si el navegador no puede leerla (p. ej. HEIC). */
async function prepareImage(file: File): Promise<PreparedFile | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null;
  }
  const { width, height } = bitmap;
  const small = Math.max(width, height) <= MAX_IMAGE_DIMENSION;
  const webSafe = ["image/jpeg", "image/png", "image/webp"].includes(file.type);

  // GIF (animados) y fotos ya ligeras se envían tal cual.
  if (file.type === "image/gif" || (webSafe && small && file.size <= KEEP_ORIGINAL_UNDER)) {
    bitmap.close();
    return {
      blob: file,
      name: cleanName(file.name, "imagen"),
      mime: file.type,
      w: width,
      h: height,
      isImage: true,
    };
  }

  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return null;
  }
  ctx.fillStyle = "#ffffff"; // fondo para PNG con transparencia
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.85)
  );
  if (!blob) return null;
  const base = cleanName(file.name, "foto").replace(/\.[^.]+$/, "");
  return { blob, name: `${base}.jpg`, mime: "image/jpeg", w, h, isImage: true };
}

/**
 * Prepara un archivo para enviarlo: comprime fotos y valida el tamaño.
 * Lanza un Error con un mensaje para mostrar si no se puede enviar.
 */
export async function prepareFile(file: File): Promise<PreparedFile> {
  let prepared: PreparedFile | null = null;
  if (file.type.startsWith("image/") && file.type !== "image/svg+xml") {
    prepared = await prepareImage(file);
  }
  if (!prepared) {
    prepared = {
      blob: file,
      name: cleanName(file.name, "archivo"),
      mime: file.type || "application/octet-stream",
      isImage: false,
    };
  }
  if (prepared.blob.size > MAX_FILE_SIZE) {
    throw new Error(
      `"${prepared.name}" pesa ${formatSize(prepared.blob.size)}. El máximo es ${formatSize(MAX_FILE_SIZE)}.`
    );
  }
  return prepared;
}

/** Cifra y sube el archivo en trozos. `onProgress` recibe de 0 a 1. */
export async function uploadFile(
  db: Firestore,
  key: CryptoKey,
  uid: string,
  prepared: PreparedFile,
  onProgress: (fraction: number) => void
): Promise<FileInfo> {
  const bytes = new Uint8Array(await prepared.blob.arrayBuffer());
  const total = Math.max(1, Math.ceil(bytes.length / CHUNK_SIZE));
  const fileId = doc(collection(db, "files")).id;

  onProgress(0);
  for (let i = 0; i < total; i++) {
    const part = bytes.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    const sealed = await encryptBytes(key, part, fileAad(fileId, i, total));
    await setDoc(doc(db, "files", fileId, "chunks", chunkId(i)), {
      data: Bytes.fromUint8Array(sealed.data),
      iv: sealed.iv,
      uid,
      createdAt: serverTimestamp(),
    });
    onProgress((i + 1) / total);
  }

  // Quien sube ya tiene el archivo: se guarda en caché para mostrarlo al instante.
  const typed = prepared.blob.type === prepared.mime
    ? prepared.blob
    : new Blob([bytes], { type: prepared.mime });
  blobCache.set(fileId, Promise.resolve(typed));

  const info: FileInfo = {
    id: fileId,
    name: prepared.name,
    mime: prepared.mime,
    size: bytes.length,
    chunks: total,
  };
  if (prepared.w && prepared.h) {
    info.w = prepared.w;
    info.h = prepared.h;
  }
  return info;
}

// Archivos ya descargados y descifrados durante esta sesión.
const blobCache = new Map<string, Promise<Blob>>();
const urlCache = new Map<string, Promise<string>>();

/** Descarga, verifica y descifra un archivo (con caché). */
export function getFileBlob(db: Firestore, key: CryptoKey, info: FileInfo): Promise<Blob> {
  let pending = blobCache.get(info.id);
  if (!pending) {
    pending = (async () => {
      const parts = await Promise.all(
        Array.from({ length: info.chunks }, async (_, i) => {
          const snap = await getDoc(doc(db, "files", info.id, "chunks", chunkId(i)));
          const d = snap.data();
          if (!d || !(d.data instanceof Bytes) || typeof d.iv !== "string") {
            throw new Error("Falta una parte del archivo.");
          }
          return decryptBytes(key, d.iv, d.data.toUint8Array(), fileAad(info.id, i, info.chunks));
        })
      );
      return new Blob(parts, { type: info.mime });
    })();
    blobCache.set(info.id, pending);
    pending.catch(() => blobCache.delete(info.id));
  }
  return pending;
}

/** URL local (blob:) para mostrar una foto, un video o un audio. */
export function getFileUrl(db: Firestore, key: CryptoKey, info: FileInfo): Promise<string> {
  let pending = urlCache.get(info.id);
  if (!pending) {
    pending = getFileBlob(db, key, info).then((blob) => URL.createObjectURL(blob));
    urlCache.set(info.id, pending);
    pending.catch(() => urlCache.delete(info.id));
  }
  return pending;
}

/** Descarga el archivo al dispositivo con su nombre original. */
export async function downloadFile(db: Firestore, key: CryptoKey, info: FileInfo): Promise<void> {
  const url = await getFileUrl(db, key, info);
  const a = document.createElement("a");
  a.href = url;
  a.download = info.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Libera la memoria de los archivos descifrados (al cerrar sesión). */
export function clearFileCache(): void {
  for (const pending of urlCache.values()) {
    pending.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
  }
  urlCache.clear();
  blobCache.clear();
}
