/**
 * chats.ts — Conversaciones, miembros, llaves y formato de los mensajes.
 *
 * - Cada conversación vive en chats/{id} con la lista de sus miembros. Su
 *   nombre, su proyecto y la vista previa del último mensaje van cifrados.
 * - Cada conversación nueva tiene su propia llave AES-256 aleatoria. Se guarda
 *   en chats/{id}/keys/{uid}, cifrada para cada miembro con ECDH entre quien
 *   la entrega y quien la recibe. Quien no es miembro no tiene la llave y,
 *   además, las reglas no le dejan leer nada de esa conversación.
 * - Las conversaciones de antes (sin lista de miembros) son de los dos
 *   fundadores y siguen con la llave anterior. "General" usa la colección
 *   original "messages", así el historial no se mueve.
 * - Los mensajes (v: 2) guardan cifrado un JSON con el texto, el adjunto, la
 *   respuesta citada y las menciones.
 */

import {
  collection,
  doc,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type CollectionReference,
  type Firestore,
} from "firebase/firestore";
import {
  base64ToBytes,
  bytesToBase64,
  decryptText,
  encryptText,
  importAesKey,
  messageAad,
  openFrom,
  randomKeyBytes,
  sealFor,
  type Sealed,
} from "./crypto";
import type { Session } from "./session";

export const GENERAL_CHAT_ID = "general";
export const MAX_NAME_LENGTH = 60;
export const MAX_MEMBERS = 8;

export interface ChatMeta {
  name: string; // "" en un chat privado: se muestra el nombre del otro
  group: string; // proyecto: "Trabajo", "Personal", …
}

export interface LastPreview {
  by: string;
  text: string;
  m: string[]; // menciones
}

export interface ChatInfo {
  id: string;
  name: string; // para mostrar
  rawName: string; // el guardado
  group: string;
  archived: boolean;
  createdAt: Date | null;
  lastMessageAt: Date | null;
  lastMessageBy: string;
  members: string[];
  legacy: boolean; // conversación de antes, de los dos fundadores
  count: number; // mensajes enviados desde esta versión
  last: LastPreview | null;
  metaOk: boolean; // false si el nombre no se pudo descifrar
  key: CryptoKey | null; // null mientras no llega la llave
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
  | { t: "text"; text: string; re?: ReplyRef; m?: string[] }
  | { t: "file"; text?: string; file: FileInfo; re?: ReplyRef; m?: string[] }
  | { t: "voice"; file: FileInfo; dur: number; re?: ReplyRef }
  | { t: "sticker"; file: FileInfo; re?: ReplyRef; lib?: boolean };

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

function lastAad(chatId: string): string {
  return `canal:last:${chatId}`;
}

function chatKeyContext(chatId: string): string {
  return `chatkey:${chatId}`;
}

function cleanMeta(meta: ChatMeta): ChatMeta {
  const name = meta.name.trim().slice(0, MAX_NAME_LENGTH);
  const group = meta.group.trim().slice(0, MAX_NAME_LENGTH) || "General";
  return { name, group };
}

export async function decryptChatMeta(key: CryptoKey, chatId: string, sealed: Sealed): Promise<ChatMeta> {
  const raw: unknown = JSON.parse(await decryptText(key, sealed, chatMetaAad(chatId)));
  const obj = (raw ?? {}) as { name?: unknown; group?: unknown };
  return cleanMeta({
    name: typeof obj.name === "string" ? obj.name : "",
    group: typeof obj.group === "string" ? obj.group : "",
  });
}

export async function encryptLast(key: CryptoKey, chatId: string, last: LastPreview): Promise<Sealed> {
  return encryptText(key, JSON.stringify(last), lastAad(chatId));
}

export async function decryptLast(key: CryptoKey, chatId: string, sealed: Sealed): Promise<LastPreview | null> {
  try {
    const raw = JSON.parse(await decryptText(key, sealed, lastAad(chatId))) as Record<string, unknown>;
    if (typeof raw.by !== "string" || typeof raw.text !== "string") return null;
    return { by: raw.by, text: raw.text.slice(0, PREVIEW_LENGTH), m: parseMentions(raw.m) };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Llaves de las conversaciones
// ---------------------------------------------------------------------------

/** A quién se le entrega una llave: su uid y su llave pública ya verificada. */
export interface KeyTarget {
  uid: string;
  pub: string;
  fp: string;
}

export interface KeyDoc {
  from: string;
  fp: string;
  iv: string;
  ct: string;
}

/** Cifra la llave de una conversación para un miembro. */
export async function wrapChatKey(session: Session, chatId: string, raw: Uint8Array, target: KeyTarget) {
  const sealed = await sealFor(
    session.identity.priv,
    target.pub,
    session.uid,
    target.uid,
    chatKeyContext(chatId),
    bytesToBase64(raw)
  );
  return { from: session.uid, fp: target.fp, iv: sealed.iv, ct: sealed.ct, at: serverTimestamp() };
}

/** Abre la llave de una conversación que `key.from` (con `fromPub`) cifró para mí. */
export async function unwrapChatKey(
  session: Session,
  chatId: string,
  key: KeyDoc,
  fromPub: string
): Promise<Uint8Array> {
  const b64 = await openFrom(
    session.identity.priv,
    fromPub,
    key.from,
    session.uid,
    chatKeyContext(chatId),
    { iv: key.iv, ct: key.ct }
  );
  const raw = base64ToBytes(b64);
  if (raw.length !== 32) throw new Error("Llave inválida");
  return raw;
}

/**
 * Crea una conversación con su propia llave y se la entrega, cifrada, a cada
 * miembro (incluido quien la crea). Todo en una sola escritura.
 */
export async function createChat(
  db: Firestore,
  session: Session,
  targets: KeyTarget[],
  meta: ChatMeta
): Promise<{ id: string; raw: Uint8Array; key: CryptoKey }> {
  const ref = doc(collection(db, "chats"));
  const raw = randomKeyBytes();
  const key = await importAesKey(raw);
  const sealed = await encryptText(key, JSON.stringify(cleanMeta(meta)), chatMetaAad(ref.id));
  const batch = writeBatch(db);
  batch.set(ref, {
    members: targets.map((t) => t.uid),
    metaIv: sealed.iv,
    metaCt: sealed.ct,
    createdBy: session.uid,
    createdAt: serverTimestamp(),
    lastMessageAt: serverTimestamp(),
    lastMessageBy: session.uid,
    archived: false,
    count: 0,
  });
  for (const t of targets) {
    batch.set(doc(db, "chats", ref.id, "keys", t.uid), await wrapChatKey(session, ref.id, raw, t));
  }
  await batch.commit();
  return { id: ref.id, raw, key };
}

/** Agrega miembros: actualiza la lista y les entrega la llave. Verán el historial. */
export async function addMembers(
  db: Firestore,
  session: Session,
  chatId: string,
  current: string[],
  raw: Uint8Array,
  targets: KeyTarget[]
): Promise<void> {
  const members = Array.from(new Set([...current, ...targets.map((t) => t.uid)]));
  const batch = writeBatch(db);
  batch.update(doc(db, "chats", chatId), { members });
  for (const t of targets) {
    batch.set(doc(db, "chats", chatId, "keys", t.uid), await wrapChatKey(session, chatId, raw, t));
  }
  await batch.commit();
}

/** Quita a un miembro (o a ti mismo, para salir). Deja de poder leer el chat. */
export async function removeMember(db: Firestore, chatId: string, current: string[], uid: string): Promise<void> {
  await updateDoc(doc(db, "chats", chatId), { members: current.filter((m) => m !== uid) });
}

export async function renameChat(db: Firestore, key: CryptoKey, chatId: string, meta: ChatMeta): Promise<void> {
  const sealed = await encryptText(key, JSON.stringify(cleanMeta(meta)), chatMetaAad(chatId));
  await updateDoc(doc(db, "chats", chatId), { metaIv: sealed.iv, metaCt: sealed.ct });
}

export async function setChatArchived(db: Firestore, chatId: string, archived: boolean): Promise<void> {
  await updateDoc(doc(db, "chats", chatId), { archived });
}

/** Nombre para mostrar: el guardado o, en un chat sin nombre, los demás miembros. */
export function displayName(rawName: string, members: string[], myUid: string, nameOf: (uid: string) => string): string {
  if (rawName) return rawName;
  const others = members.filter((m) => m !== myUid);
  if (others.length === 0) return "Solo tú";
  return others.map(nameOf).join(", ");
}

// ---------------------------------------------------------------------------
// Formato de los mensajes
// ---------------------------------------------------------------------------

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

function parseMentions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length <= 128).slice(0, MAX_MEMBERS);
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
  const m = parseMentions(p.m);
  const withRe = (obj: Payload): Payload => (re ? { ...obj, re } : obj);

  if (p.t === "text" && typeof p.text === "string") {
    return withRe(m.length ? { t: "text", text: p.text, m } : { t: "text", text: p.text });
  }

  const file = parseFileInfo(p.file);
  if (!file) return null;
  if (p.t === "file") {
    const base: Payload =
      typeof p.text === "string" && p.text ? { t: "file", text: p.text, file } : { t: "file", file };
    return withRe(m.length && base.t === "file" ? { ...base, m } : base);
  }
  if (p.t === "voice") {
    const dur = typeof p.dur === "number" && p.dur >= 0 ? p.dur : 0;
    return withRe({ t: "voice", file, dur });
  }
  if (p.t === "sticker") return withRe(p.lib === true ? { t: "sticker", file, lib: true } : { t: "sticker", file });
  return null;
}

export function mentionsOf(payload: Payload | null): string[] {
  if (!payload) return [];
  return (payload.t === "text" || payload.t === "file") && payload.m ? payload.m : [];
}

/** Texto corto que describe un mensaje (para respuestas, pendientes y la lista). */
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
