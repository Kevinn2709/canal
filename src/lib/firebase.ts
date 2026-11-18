/**
 * firebase.ts — Inicialización de Firebase (solo en el navegador).
 *
 * Se inicializa la primera vez que se pide, dentro de efectos o eventos del
 * cliente, nunca durante el build de Next.js.
 *
 * En la página /vinculada (la cuenta de miembro vinculada que abre el monitor
 * del fundador) se usa una instancia con nombre propio ("vinculada"): tiene
 * su propio inicio de sesión guardado y sus propias conexiones, separadas de
 * las del fundador.
 *
 * Realtime Database es opcional: solo se usa si hay `databaseURL` (variable
 * NEXT_PUBLIC_FIREBASE_DATABASE_URL). Sirve para la presencia ("en línea") y
 * para "escribiendo…", con desconexión instantánea (onDisconnect) y sin gastar
 * escrituras de Firestore.
 */

import { deleteApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, signOut, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getDatabase, goOffline, goOnline, onValue, ref, type Database } from "firebase/database";
import { firebaseConfig } from "./firebase-config";
import { LINKED_APP_NAME, isLinkedScope } from "./scope";

interface FirebaseServices {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}

let services: FirebaseServices | null = null;
let rtdb: Database | null | undefined;
let serverOffset = 0;

/** true si hay configuración de Firebase (variables de entorno). */
export function isConfigured(): boolean {
  const { apiKey, projectId, appId } = firebaseConfig;
  return !!apiKey && !!projectId && !!appId;
}

function appFor(name: string | null): FirebaseApp {
  const wanted = name ?? "[DEFAULT]";
  const existing = getApps().find((a) => a.name === wanted);
  if (existing) return existing;
  return name ? initializeApp(firebaseConfig, name) : initializeApp(firebaseConfig);
}

export function getFirebase(): FirebaseServices {
  if (!services) {
    const app = appFor(isLinkedScope() ? LINKED_APP_NAME : null);
    services = { app, auth: getAuth(app), db: getFirestore(app) };
  }
  return services;
}

/** Realtime Database, o null si no está configurada. */
export function getRtdb(): Database | null {
  if (rtdb === undefined) {
    const { app } = getFirebase();
    if (!app.options.databaseURL) {
      rtdb = null;
    } else {
      try {
        rtdb = getDatabase(app);
        // Diferencia entre el reloj del servidor y el de este dispositivo.
        onValue(ref(rtdb, ".info/serverTimeOffset"), (snap) => {
          const v = snap.val();
          serverOffset = typeof v === "number" ? v : 0;
        });
      } catch {
        rtdb = null;
      }
    }
  }
  return rtdb;
}

/** Hora del servidor de Realtime Database (ms), estimada en este dispositivo. */
export function serverNow(): number {
  return Date.now() + serverOffset;
}

/**
 * Corta (o reanuda) la conexión con Realtime Database de esta sesión. Al
 * cortarla, el servidor aplica al instante los onDisconnect: la presencia
 * pasa a "desconectado".
 */
export function setRtdbConnected(on: boolean): void {
  const db = getRtdb();
  if (!db) return;
  try {
    if (on) goOnline(db);
    else goOffline(db);
  } catch {
    // Nada.
  }
}

/**
 * Cierra la sesión de la cuenta vinculada desde la página principal (al
 * desvincularla o al cerrar la sesión del fundador). Usa la misma instancia
 * con nombre, que comparte el inicio de sesión guardado con /vinculada.
 */
export async function signOutLinkedAccount(): Promise<void> {
  if (!isConfigured() || isLinkedScope()) return;
  const app = appFor(LINKED_APP_NAME);
  try {
    const auth = getAuth(app);
    await auth.authStateReady();
    if (auth.currentUser) await signOut(auth);
  } catch {
    // Nada que cerrar.
  } finally {
    await deleteApp(app).catch(() => undefined);
  }
}
