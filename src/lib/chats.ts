/**
 * chats.ts — Conversaciones, proyectos y formato de los mensajes.
 *
 * - Cada conversación vive en chats/{id}. Su nombre y su proyecto van
 *   cifrados (metaIv, metaCt); Firestore solo ve texto cifrado.
 * - La conversación "General" usa la colección original "messages", así el
 *   historial que ya existía sigue ahí sin migrar nada.
 * - Los mensajes nuevos (v: 2) guardan cifrado un JSON con el texto y, si
 *   hay, los datos del archivo adjunto.
 */

import {
  collection,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  type CollectionReference,
  type Firestore,
} from "firebase/firestore";
import { decryptText, encryptText, messageAad, type Sealed } from "./crypto";

export const GENERAL_CHAT_ID = "general";
export const MAX_NAME_LENGTH = 60;

export interface ChatMeta {
  name: string;
  group: string; // proyecto: "Trabajo", "Personal", …
}

export interface ChatInfo extends ChatMeta {
  id: string;
  archived: boolean;
  createdAt: Date | null;
  lastMessageAt: Date | null;
  lastMessageBy: string;
  metaOk: boolean; // false si el nombre no se pudo descifrar
}

export interface FileInfo {
  id: string;
  name: string;
  mime: string;
  size: number; // bytes
  chunks: number;
  w?: number; // ancho y alto, solo imágenes
  h?: number;
}

export type Payload =
  | { t: "text"; text: string }
  | { t: "file"; text?: string; file: FileInfo };

export function messagesCollection(db: Firestore, chatId: string): CollectionReference {
  return chatId === GENERAL_CHAT_ID
    ? collection(db, "messages")
    : collection(db, "chats", chatId, "messages");
}

/** Datos autenticados del mensaje: ligan el texto a su conversación y remitente. */
export function messageAadFor(chatId: string, uid: string): string {
  return chatId === GENERAL_CHAT_ID ? messageAad(uid) : `canal:msg:${chatId}:${uid}`;
}

function chatMetaAad(chatId: string): string {
  return `canal:chat:${chatId}`;
}

function cleanMeta(meta: ChatMeta): ChatMeta {
  const name = meta.name.trim().slice(0, MAX_NAME_LENGTH) || "Sin nombre";
  const group = meta.group.trim().slice(0, MAX_NAME_LENGTH) || "General";
  return { name, group };
}

export async function decryptChatMeta(
  key: CryptoKey,
  chatId: string,
  sealed: Sealed
): Promise<ChatMeta> {
  const raw: unknown = JSON.parse(await decryptText(key, sealed, chatMetaAad(chatId)));
  const obj = (raw ?? {}) as { name?: unknown; group?: unknown };
  return cleanMeta({
    name: typeof obj.name === "string" ? obj.name : "",
    group: typeof obj.group === "string" ? obj.group : "",
  });
}

/** Crea una conversación. Con `id` fijo se usa para "General". */
export async function createChat(
  db: Firestore,
  key: CryptoKey,
  uid: string,
  meta: ChatMeta,
  id?: string
): Promise<string> {
  const ref = id ? doc(db, "chats", id) : doc(collection(db, "chats"));
  const sealed = await encryptText(key, JSON.stringify(cleanMeta(meta)), chatMetaAad(ref.id));
  await setDoc(ref, {
    metaIv: sealed.iv,
    metaCt: sealed.ct,
    createdBy: uid,
    createdAt: serverTimestamp(),
    lastMessageAt: serverTimestamp(),
    lastMessageBy: uid,
    archived: false,
  });
  return ref.id;
}

export async function renameChat(
  db: Firestore,
  key: CryptoKey,
  chatId: string,
  meta: ChatMeta
): Promise<void> {
  const sealed = await encryptText(key, JSON.stringify(cleanMeta(meta)), chatMetaAad(chatId));
  await updateDoc(doc(db, "chats", chatId), { metaIv: sealed.iv, metaCt: sealed.ct });
}

export async function setChatArchived(
  db: Firestore,
  chatId: string,
  archived: boolean
): Promise<void> {
  await updateDoc(doc(db, "chats", chatId), { archived });
}

/** Valida el JSON descifrado de un mensaje nuevo. */
export function parsePayload(json: string): Payload | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const p = raw as { t?: unknown; text?: unknown; file?: unknown };
  if (p.t === "text" && typeof p.text === "string") return { t: "text", text: p.text };
  if (p.t === "file" && p.file && typeof p.file === "object") {
    const f = p.file as Record<string, unknown>;
    if (
      typeof f.id === "string" &&
      typeof f.name === "string" &&
      typeof f.mime === "string" &&
      typeof f.size === "number" &&
      typeof f.chunks === "number" &&
      f.chunks >= 1 &&
      f.chunks <= 64
    ) {
      const file: FileInfo = {
        id: f.id,
        name: f.name,
        mime: f.mime,
        size: f.size,
        chunks: f.chunks,
      };
      if (typeof f.w === "number" && typeof f.h === "number") {
        file.w = f.w;
        file.h = f.h;
      }
      return typeof p.text === "string" && p.text
        ? { t: "file", text: p.text, file }
        : { t: "file", file };
    }
  }
  return null;
}

export function isImage(file: FileInfo): boolean {
  return file.mime.startsWith("image/") && file.mime !== "image/svg+xml" && !!file.w && !!file.h;
}

export function isVideo(file: FileInfo): boolean {
  return file.mime.startsWith("video/");
}

export function isAudio(file: FileInfo): boolean {
  return file.mime.startsWith("audio/");
}
