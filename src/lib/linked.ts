/**
 * linked.ts — La cuenta de miembro vinculada a este dispositivo.
 *
 * El fundador designa, desde la consola (Configuración → Cuenta vinculada),
 * una cuenta de miembro. En el monitor, el ícono de chat abre esa cuenta.
 *
 * Solo se guarda en ESTE dispositivo (localStorage): uid y nombre para
 * mostrar. Nada de esto va a Firestore, así que en la base de datos no queda
 * ningún rastro de qué cuenta está vinculada a cuál.
 *
 * Abrir los chats de esa cuenta requiere su correo, contraseña y frase la
 * primera vez (cifrado de extremo a extremo): por eso solo puede vincularse
 * una cuenta cuyos datos conoces.
 */

import { forgetKeys } from "./keystore";
import { signOutLinkedAccount } from "./firebase";

export interface LinkedAccount {
  uid: string;
  name: string;
}

const KEY = "canal:cuenta-vinculada";
const EVENT = "canal-vinculada";

export function getLinked(): LinkedAccount | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<LinkedAccount> | null;
    if (raw && typeof raw.uid === "string" && raw.uid && typeof raw.name === "string") {
      return { uid: raw.uid, name: raw.name };
    }
  } catch {
    // Sin almacenamiento o dato roto.
  }
  return null;
}

function emit(): void {
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function setLinked(account: LinkedAccount): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(account));
  } catch {
    // Sin almacenamiento: no se puede vincular en este navegador.
  }
  emit();
}

/** Cambios hechos aquí o en la otra página (iframe) del mismo sitio. */
export function onLinkedChange(cb: (a: LinkedAccount | null) => void): () => void {
  const handler = () => cb(getLinked());
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) handler();
  };
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Desvincula: olvida la designación, cierra la sesión de esa cuenta en este
 * dispositivo y borra su llave recordada. No borra nada de Firestore.
 */
export async function unlink(): Promise<void> {
  const current = getLinked();
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nada.
  }
  emit();
  if (current) await forgetKeys(current.uid);
  await signOutLinkedAccount();
}
