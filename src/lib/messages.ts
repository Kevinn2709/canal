/**
 * messages.ts — Destacar, eliminar y vaciar.
 *
 * - Destacar: el mensaje lleva star: true. Cualquier miembro del chat puede
 *   destacar o quitar el destacado; todos lo ven.
 * - Eliminar: el mensaje se borra de verdad, para todos, junto con sus
 *   reacciones y sus archivos (fotos, notas de voz). Puede hacerlo quien lo
 *   envió o un fundador.
 * - Vaciar (solo fundadores): borra todos los mensajes del chat menos los
 *   destacados, con sus reacciones y archivos.
 * Si se borra el último mensaje, la vista previa de la lista se actualiza
 * (cifrada). Las reglas de Firestore comprueban quién puede hacer qué.
 */

import {
  collection,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type Firestore,
} from "firebase/firestore";
import { decryptText, type Sealed } from "./crypto";
import { encryptLast, messageAadFor, messagesCollection, parsePayload, previewOf, type FileInfo, type Payload } from "./chats";
import { chatFileChunks } from "./files";

/** Escrituras por lote: pocas, para no pasar los límites de las reglas. */
const BATCH = 100;

type ChatRef = { id: string; legacy: boolean };

export interface StoredMessage {
  id: string;
  uid: string;
  createdAt: Date | null;
  payload: Payload | null;
}

export function messageRef(db: Firestore, chatId: string, id: string): DocumentReference {
  return doc(messagesCollection(db, chatId), id);
}

/** Descifra un mensaje guardado. null si no se puede. */
export async function decryptMessage(key: CryptoKey, chatId: string, data: DocumentData): Promise<Payload | null> {
  const uid = typeof data.uid === "string" ? data.uid : "";
  if (typeof data.ct === "string" && typeof data.iv === "string") {
    try {
      const text = await decryptText(key, { iv: data.iv, ct: data.ct }, messageAadFor(chatId, uid));
      return data.v === 2 ? parsePayload(text) : { t: "text", text };
    } catch {
      return null;
    }
  }
  if (typeof data.text === "string") return { t: "text", text: data.text };
  return null;
}

/** Archivos guardados en el chat que usa un mensaje (no los de la biblioteca de stickers). */
export function filesOf(payload: Payload | null): FileInfo[] {
  if (!payload) return [];
  if (payload.t === "file" || payload.t === "voice") return [payload.file];
  if (payload.t === "sticker" && !payload.lib) return [payload.file];
  return [];
}

export async function setStar(db: Firestore, chatId: string, id: string, on: boolean): Promise<void> {
  await updateDoc(messageRef(db, chatId, id), { star: on });
}

/** Vista previa cifrada para la lista: el mensaje que queda al final, o vacía. */
async function previewFor(key: CryptoKey, chatId: string, last: StoredMessage | null, myUid: string): Promise<Sealed> {
  return encryptLast(key, chatId, last ? { by: last.uid, text: previewOf(last.payload), m: [] } : { by: myUid, text: "", m: [] });
}

/**
 * Elimina un mensaje para todos, con sus reacciones y archivos, en una sola
 * escritura. `newLast`: si era el último mensaje del chat, el que queda al
 * final (o null si ya no queda ninguno); undefined si no era el último.
 */
export async function deleteMessage(
  db: Firestore,
  chat: ChatRef,
  key: CryptoKey,
  myUid: string,
  msg: { id: string; payload: Payload | null },
  newLast?: StoredMessage | null
): Promise<void> {
  const reactions = await getDocs(query(collection(db, "chats", chat.id, "reactions"), where("msg", "==", msg.id)));
  const batch = writeBatch(db);
  batch.delete(messageRef(db, chat.id, msg.id));
  for (const r of reactions.docs) batch.delete(doc(db, "chats", chat.id, "reactions", r.id));
  for (const f of filesOf(msg.payload)) for (const ref of chatFileChunks(db, chat, f)) batch.delete(ref);
  if (newLast !== undefined) {
    const sealed = await previewFor(key, chat.id, newLast, myUid);
    batch.update(doc(db, "chats", chat.id), { lastIv: sealed.iv, lastCt: sealed.ct });
  }
  await batch.commit();
}

/**
 * Vacía el chat: borra todos los mensajes menos los destacados (con sus
 * reacciones y archivos). Devuelve cuántos borró y cuántos quedaron.
 */
export async function clearChat(
  db: Firestore,
  chat: ChatRef,
  key: CryptoKey,
  myUid: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ deleted: number; kept: number }> {
  const snap = await getDocs(messagesCollection(db, chat.id));
  const drop: string[] = [];
  const kept: StoredMessage[] = [];
  const refs: DocumentReference[] = [];
  for (const d of snap.docs) {
    const data = d.data();
    const createdAt = data.createdAt && typeof data.createdAt.toDate === "function" ? (data.createdAt.toDate() as Date) : null;
    if (data.star === true) {
      kept.push({ id: d.id, uid: typeof data.uid === "string" ? data.uid : "", createdAt, payload: null });
      continue;
    }
    drop.push(d.id);
    refs.push(messageRef(db, chat.id, d.id));
    for (const f of filesOf(await decryptMessage(key, chat.id, data))) refs.push(...chatFileChunks(db, chat, f));
  }
  if (drop.length === 0) return { deleted: 0, kept: kept.length };
  const dropped = new Set(drop);
  const reactions = await getDocs(collection(db, "chats", chat.id, "reactions"));
  for (const r of reactions.docs) {
    if (dropped.has(String(r.data().msg))) refs.push(doc(db, "chats", chat.id, "reactions", r.id));
  }

  onProgress?.(0, refs.length);
  for (let i = 0; i < refs.length; i += BATCH) {
    const batch = writeBatch(db);
    for (const ref of refs.slice(i, i + BATCH)) batch.delete(ref);
    await batch.commit();
    onProgress?.(Math.min(refs.length, i + BATCH), refs.length);
  }

  // La vista previa pasa al último destacado (o queda vacía).
  kept.sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
  let last = kept[kept.length - 1] ?? null;
  if (last) {
    const d = snap.docs.find((x) => x.id === last?.id);
    last = { ...last, payload: d ? await decryptMessage(key, chat.id, d.data()) : null };
  }
  const sealed = await previewFor(key, chat.id, last, myUid);
  await updateDoc(doc(db, "chats", chat.id), { lastIv: sealed.iv, lastCt: sealed.ct });
  return { deleted: drop.length, kept: kept.length };
}
