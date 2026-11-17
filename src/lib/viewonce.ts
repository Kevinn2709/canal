/**
 * viewonce.ts — Fotos y videos que se ven una sola vez.
 *
 * - El mensaje lleva `once: true` (dentro del JSON cifrado).
 * - Al abrirlo, se guarda chats/{chatId}/opened/{mensaje}_{uid}: así sabe tu
 *   otro dispositivo que ya lo viste, y quien lo envió ve "Abierta".
 * - El archivo se descifra sin guardarlo en la caché de la sesión; al cerrar
 *   se revoca su URL y se suelta el Blob.
 * - Cuando todos los demás miembros lo abrieron, quien lo envió borra los
 *   trozos cifrados del archivo.
 * Límite: una web no puede impedir capturas de pantalla.
 */

import { doc, serverTimestamp, setDoc, type Firestore } from "firebase/firestore";

const LOCAL_KEY = "canal:vistos";

export function openedId(msgId: string, uid: string): string {
  return `${msgId}_${uid}`;
}

/** Marca local (por si la escritura en la base tarda o falla). */
export function wasOpenedHere(msgId: string): boolean {
  try {
    const list = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]") as unknown;
    return Array.isArray(list) && list.includes(msgId);
  } catch {
    return false;
  }
}

function rememberOpened(msgId: string): void {
  try {
    const list = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]") as unknown;
    const arr = Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
    if (!arr.includes(msgId)) arr.push(msgId);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(arr.slice(-500)));
  } catch {
    // Sin almacenamiento: queda la marca en la base.
  }
}

export async function markOpened(db: Firestore, chatId: string, msgId: string, uid: string): Promise<void> {
  rememberOpened(msgId);
  await setDoc(doc(db, "chats", chatId, "opened", openedId(msgId, uid)), { msg: msgId, uid, at: serverTimestamp() });
}
