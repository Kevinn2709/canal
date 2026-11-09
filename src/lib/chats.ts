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

/** Mensaje al que se responde (va cifrado dentro del mensaje nuevo). */
export interface ReplyRef {
  id: string;
  uid: string;
  preview: string;
}

export type Payload =
  | { t: "text"; text: string; re?: ReplyRef }
  | { t: "file"; text?: string; file: FileInfo; re?: ReplyRef }
  | { t: "voice"; file: FileInfo; dur: number; re?: ReplyRef }
  | { t: "sticker"; file: FileInfo; re?: ReplyRef };

const PREVIEW_LENGTH = 140;

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

/** Valida los datos de un archivo que vienen dentro de un mensaje descifrado. */
export function parseFileInfo(value: unknown): FileInfo | null {
  if (!value || typeof value !== "object") return null;
  const f = value as Record<string, unknown>;
  if (
    typeof f.id !== "string" ||
    typeof f.name !== "string" ||
    typeof f.mime !== "string" ||
    typeof f.size !== "number" ||
    typeof f.chunks !== "number" ||
    f.chunks < 1 ||
    f.chunks > 64
  ) {
    return null;
  }
  const file: FileInfo = { id: f.id, name: f.name, mime: f.mime, size: f.size, chunks: f.chunks };
  if (typeof f.w === "number" && typeof f.h === "number") {
    file.w = f.w;
    file.h = f.h;
  }
  return file;
}

function parseReply(value: unknown): ReplyRef | undefined {
  if (!value || typeof value !== "object") return undefined;
  const r = value as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.uid !== "string" || typeof r.preview !== "string") {
    return undefined;
  }
  return { id: r.id, uid: r.uid, preview: r.preview.slice(0, PREVIEW_LENGTH) };
}

/** Valida el JSON descifrado de un mensaje nuevo. */
export function parsePayload(json: string): Payload | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const p = (raw ?? {}) as Record<string, unknown>;
  const re = parseReply(p.re);
  const withRe = (obj: Payload): Payload => (re ? { ...obj, re } : obj);

  if (p.t === "text" && typeof p.text === "string") return withRe({ t: "text", text: p.text });

  const file = parseFileInfo(p.file);
  if (!file) return null;
  if (p.t === "file") {
    return withRe(
      typeof p.text === "string" && p.text ? { t: "file", text: p.text, file } : { t: "file", file }
    );
  }
  if (p.t === "voice") {
    const dur = typeof p.dur === "number" && p.dur >= 0 ? p.dur : 0;
    return withRe({ t: "voice", file, dur });
  }
  if (p.t === "sticker") return withRe({ t: "sticker", file });
  return null;
}

/** Texto corto que describe un mensaje (para respuestas y pendientes). */
export function previewOf(payload: Payload | null): string {
  if (!payload) return "Mensaje";
  let text: string;
  switch (payload.t) {
    case "text":
      text = payload.text;
      break;
    case "file":
      text = payload.text || (isImage(payload.file) ? "Foto" : `Archivo: ${payload.file.name}`);
      if (payload.text && isImage(payload.file)) text = `Foto: ${payload.text}`;
      break;
    case "voice":
      text = `Nota de voz (${formatDuration(payload.dur)})`;
      break;
    case "sticker":
      text = "Sticker";
      break;
  }
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > PREVIEW_LENGTH ? `${oneLine.slice(0, PREVIEW_LENGTH - 1)}…` : oneLine;
}

/** 75 -> "1:15" */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
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
