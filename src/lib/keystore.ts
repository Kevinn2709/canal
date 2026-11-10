/**
 * keystore.ts — Lo que se guarda en este dispositivo (IndexedDB).
 *
 * - "Recordar en este dispositivo": la LLAVE personal (nunca la frase). La
 *   llave no es extraíble: el navegador permite usarla, pero ni el código de
 *   la página puede leer sus bytes. Aun así, quien tenga este dispositivo
 *   desbloqueado podrá abrir el chat sin escribir la frase.
 * - Nombres para las notificaciones (solo si lo activas en Configuración): el
 *   service worker los usa para decir de qué chat es un aviso.
 *
 * Si el navegador no permite guardar (modo privado, almacenamiento bloqueado),
 * todo sigue funcionando: simplemente no se recuerda.
 */

const DB_NAME = "canal";
const KEYS = "keys";
const NOTIF = "notif";
const VERSION = 2;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KEYS)) db.createObjectStore(KEYS);
      if (!db.objectStoreNames.contains(NOTIF)) db.createObjectStore(NOTIF);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(
  storeName: string,
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const req = op(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Identificador de la llave personal: por cuenta y por frase (sal). */
export function keyId(uid: string, salt: string): string {
  return `p:${uid}:${salt}`;
}

/** Guarda la llave y borra las anteriores de esa misma cuenta. */
export async function saveKey(uid: string, id: string, key: CryptoKey): Promise<void> {
  try {
    const ids = (await run(KEYS, "readonly", (s) => s.getAllKeys())) as IDBValidKey[];
    for (const old of ids) {
      if (typeof old === "string" && old !== id && old.includes(uid)) {
        await run(KEYS, "readwrite", (s) => s.delete(old));
      }
    }
    await run(KEYS, "readwrite", (s) => s.put(key, id));
  } catch {
    // Sin almacenamiento disponible: no se recuerda.
  }
}

export async function loadKey(id: string): Promise<CryptoKey | null> {
  try {
    const value: unknown = await run(KEYS, "readonly", (s) => s.get(id));
    return value instanceof CryptoKey ? value : null;
  } catch {
    return null;
  }
}

/** Borra las llaves recordadas de una cuenta. */
export async function forgetKeys(uid: string): Promise<void> {
  try {
    const ids = (await run(KEYS, "readonly", (s) => s.getAllKeys())) as IDBValidKey[];
    for (const id of ids) {
      if (typeof id === "string" && id.includes(uid)) await run(KEYS, "readwrite", (s) => s.delete(id));
    }
  } catch {
    // Nada que borrar.
  }
}

export async function clearKeys(): Promise<void> {
  try {
    await run(KEYS, "readwrite", (s) => s.clear());
    await run(NOTIF, "readwrite", (s) => s.clear());
  } catch {
    // Nada que borrar.
  }
}

/** Nombres de chats y personas para las notificaciones (o null para borrarlos). */
export async function saveNotificationNames(
  names: { chats: Record<string, string>; people: Record<string, string> } | null
): Promise<void> {
  try {
    if (names) await run(NOTIF, "readwrite", (s) => s.put(names, "names"));
    else await run(NOTIF, "readwrite", (s) => s.delete("names"));
  } catch {
    // Sin almacenamiento: las notificaciones dicen solo "Nuevo mensaje".
  }
}
