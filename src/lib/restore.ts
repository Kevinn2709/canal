/**
 * restore.ts — Abrir la sesión sin pedir la frase, si se eligió "Recordar en
 * este dispositivo". Si no hay llave recordada (o no sirve), devuelve null y
 * la frase se pide cuando la persona toca "Continuar" o el ícono de chat.
 */

import type { User } from "firebase/auth";
import { getFirebase } from "./firebase";
import { keyId, loadKey } from "./keystore";
import { buildSession, loadKeysDoc, openBundle, probeRole, type Session } from "./session";

export async function restoreSession(user: User): Promise<Session | null> {
  try {
    const { db } = getFirebase();
    const keys = await loadKeysDoc(db, user.uid);
    if (!keys) return null;
    const saved = await loadKey(keyId(user.uid, keys.salt));
    if (!saved) return null;
    const bundle = await openBundle(saved, user.uid, keys);
    if (!bundle) return null;
    const role = await probeRole(db);
    return await buildSession(user.uid, { founder: role.founder, admin: role.admin }, saved, keys, bundle);
  } catch {
    return null;
  }
}
