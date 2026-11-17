/**
 * prefs.ts — Preferencias personales que se sincronizan entre tus
 * dispositivos (prefs/{uid}, solo tú las lees).
 *
 * - Alias: un nombre tuyo para cualquier conversación. Tiene prioridad sobre
 *   el nombre del chat en la lista, el encabezado y los avisos. Va cifrado
 *   con la llave del espacio: en la base solo hay texto cifrado.
 */

import { doc, serverTimestamp, setDoc, type Firestore } from "firebase/firestore";
import { decryptText, encryptText } from "./crypto";

export const MAX_ALIAS_LENGTH = 40;
const MAX_ALIASES = 200;

function aliasAad(uid: string): string {
  return `canal:alias:${uid}`;
}

export async function decryptAliases(ws: CryptoKey, uid: string, iv: string, ct: string): Promise<Record<string, string>> {
  try {
    const raw = JSON.parse(await decryptText(ws, { iv, ct }, aliasAad(uid))) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw ?? {})) {
      if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, MAX_ALIAS_LENGTH);
    }
    return out;
  } catch {
    return {};
  }
}

export async function saveAliases(db: Firestore, ws: CryptoKey, uid: string, aliases: Record<string, string>): Promise<void> {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(aliases).slice(-MAX_ALIASES)) {
    const a = v.trim().slice(0, MAX_ALIAS_LENGTH);
    if (a) clean[k] = a;
  }
  const sealed = await encryptText(ws, JSON.stringify(clean), aliasAad(uid));
  await setDoc(doc(db, "prefs", uid), { aliasIv: sealed.iv, aliasCt: sealed.ct, updatedAt: serverTimestamp() }, { merge: true });
}
