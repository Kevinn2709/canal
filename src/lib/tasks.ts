/**
 * tasks.ts — Pendientes de cada conversación.
 *
 * tasks/{id}: el texto del pendiente (y el mensaje del que salió, si aplica)
 * va cifrado. A la vista quedan solo la conversación a la que pertenece y si
 * está hecho. Los pendientes se marcan como hechos o se reabren; nunca se
 * borran.
 */

import {
  collection,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
  type Timestamp,
} from "firebase/firestore";
import { decryptText, encryptText } from "./crypto";

export const MAX_TASK_LENGTH = 500;

export interface Task {
  id: string;
  chatId: string;
  text: string;
  msgId: string | null; // mensaje del que salió, si lo hay
  createdBy: string;
  createdAt: Date | null;
  done: boolean;
  doneBy: string | null;
  doneAt: Date | null;
  ok: boolean; // false si no se pudo descifrar
}

function taskAad(id: string, chatId: string): string {
  return `canal:task:${id}:${chatId}`;
}

function toDate(value: unknown): Date | null {
  const ts = value as Timestamp | null | undefined;
  return ts && typeof ts.toDate === "function" ? ts.toDate() : null;
}

export async function createTask(
  db: Firestore,
  key: CryptoKey,
  uid: string,
  chatId: string,
  text: string,
  msgId?: string
): Promise<void> {
  const ref = doc(collection(db, "tasks"));
  const body = { text: text.trim().slice(0, MAX_TASK_LENGTH), ...(msgId ? { msgId } : {}) };
  const sealed = await encryptText(key, JSON.stringify(body), taskAad(ref.id, chatId));
  await setDoc(ref, {
    chatId,
    ct: sealed.ct,
    iv: sealed.iv,
    createdBy: uid,
    createdAt: serverTimestamp(),
    done: false,
    doneBy: null,
    doneAt: null,
  });
}

export async function setTaskDone(
  db: Firestore,
  taskId: string,
  uid: string,
  done: boolean
): Promise<void> {
  await updateDoc(
    doc(db, "tasks", taskId),
    done
      ? { done: true, doneBy: uid, doneAt: serverTimestamp() }
      : { done: false, doneBy: null, doneAt: null }
  );
}

/** Convierte un documento de tasks/ en un pendiente descifrado. */
export async function decryptTask(
  key: CryptoKey,
  id: string,
  data: Record<string, unknown>
): Promise<Task> {
  const chatId = typeof data.chatId === "string" ? data.chatId : "";
  let text = "";
  let msgId: string | null = null;
  let ok = false;
  try {
    const raw = JSON.parse(
      await decryptText(
        key,
        { iv: String(data.iv ?? ""), ct: String(data.ct ?? "") },
        taskAad(id, chatId)
      )
    ) as { text?: unknown; msgId?: unknown };
    text = typeof raw.text === "string" ? raw.text : "";
    msgId = typeof raw.msgId === "string" ? raw.msgId : null;
    ok = true;
  } catch {
    ok = false;
  }
  return {
    id,
    chatId,
    text,
    msgId,
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    createdAt: toDate(data.createdAt),
    done: data.done === true,
    doneBy: typeof data.doneBy === "string" ? data.doneBy : null,
    doneAt: toDate(data.doneAt),
    ok,
  };
}
