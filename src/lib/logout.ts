/**
 * logout.ts — Cerrar sesión en este dispositivo.
 *
 * - Sesión principal: borra las llaves recordadas, desvincula la cuenta de
 *   miembro (si había) y cierra la sesión.
 * - Sesión vinculada (/vinculada): solo olvida la llave de ESA cuenta; no toca
 *   la del fundador.
 */

import { signOut } from "firebase/auth";
import { getFirebase } from "./firebase";
import { clearFileCache } from "./files";
import { clearKeys, forgetKeys, saveNotificationNames } from "./keystore";
import { isLinkedScope } from "./scope";
import { unlink } from "./linked";

export async function logoutHere(uid: string | null): Promise<void> {
  clearFileCache();
  if (isLinkedScope()) {
    if (uid) await forgetKeys(uid);
    await signOut(getFirebase().auth);
    return;
  }
  await saveNotificationNames(null);
  await unlink().catch(() => undefined);
  await clearKeys();
  await signOut(getFirebase().auth);
}
