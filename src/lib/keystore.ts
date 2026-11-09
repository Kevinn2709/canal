/**
 * keystore.ts — "Recordar en este dispositivo".
 *
 * Guarda la LLAVE de cifrado (nunca la frase) en IndexedDB del navegador.
 * La llave no es extraíble: el navegador permite usarla, pero ni el código de
 * la página puede leer sus bytes. Aun así, quien tenga este dispositivo
 * desbloqueado podrá abrir el chat sin escribir la frase.
 *
 * Si el navegador no permite guardar (modo privado, almacenamiento bloqueado),
 * todo sigue funcionando: simplemente no se recuerda.
 */

const DB_NAME = "canal";
const STORE = "keys";
const VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Identificador de la llave: por cuenta y por conversación (sal). */
export function keyId(uid: string, salt: string): string {
  return `${uid}:${salt}`;
}

export async function saveKey(id: string, key: CryptoKey): Promise<void> {
  try {
    await run("readwrite", (s) => s.put(key, id));
  } catch {
    // Sin almacenamiento disponible: no se recuerda.
  }
}

export async function loadKey(id: string): Promise<CryptoKey | null> {
  try {
    const value: unknown = await run("readonly", (s) => s.get(id));
    return value instanceof CryptoKey ? value : null;
  } catch {
    return null;
  }
}

export async function deleteKey(id: string): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(id));
  } catch {
    // Nada que borrar.
  }
}

export async function clearKeys(): Promise<void> {
  try {
    await run("readwrite", (s) => s.clear());
  } catch {
    // Nada que borrar.
  }
}
