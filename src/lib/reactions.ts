/**
 * reactions.ts — Reacciones a mensajes, cifradas.
 *
 * chats/{chatId}/reactions/{mensaje}_{uid}: una reacción por persona y
 * mensaje. El emoji va cifrado; quitar la reacción la deja vacía (no se
 * borra nada). El remitente, el mensaje y la conversación van en los datos
 * autenticados: no se puede mover una reacción a otro mensaje.
 */

import { doc, serverTimestamp, setDoc, type Firestore } from "firebase/firestore";
import { decryptText, encryptText, type Sealed } from "./crypto";

export const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export interface Reaction {
  msg: string;
  uid: string;
  emoji: string;
}

function reactionAad(chatId: string, msgId: string, uid: string): string {
  return `canal:react:${chatId}:${msgId}:${uid}`;
}

/** Pone, cambia o quita (emoji vacío) tu reacción a un mensaje. */
export async function setReaction(
  db: Firestore,
  key: CryptoKey,
  chatId: string,
  msgId: string,
  uid: string,
  emoji: string
): Promise<void> {
  const sealed = await encryptText(key, emoji, reactionAad(chatId, msgId, uid));
  await setDoc(doc(db, "chats", chatId, "reactions", `${msgId}_${uid}`), {
    msg: msgId,
    uid,
    ct: sealed.ct,
    iv: sealed.iv,
    updatedAt: serverTimestamp(),
  });
}

export async function decryptReaction(
  key: CryptoKey,
  chatId: string,
  msgId: string,
  uid: string,
  sealed: Sealed
): Promise<string> {
  const emoji = await decryptText(key, sealed, reactionAad(chatId, msgId, uid));
  return emoji.slice(0, 16);
}
