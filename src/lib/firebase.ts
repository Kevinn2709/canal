/**
 * firebase.ts — Inicialización de Firebase (solo en el navegador).
 *
 * Se inicializa la primera vez que se pide, dentro de efectos o eventos del
 * cliente, nunca durante el build de Next.js.
 *
 * Realtime Database es opcional: solo se usa si hay `databaseURL` (variable
 * NEXT_PUBLIC_FIREBASE_DATABASE_URL). Sirve para la presencia ("en línea") y
 * para "escribiendo…", con desconexión instantánea (onDisconnect) y sin gastar
 * escrituras de Firestore.
 */

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getDatabase, onValue, ref, type Database } from "firebase/database";
import { firebaseConfig } from "./firebase-config";

interface FirebaseServices {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}

let services: FirebaseServices | null = null;
let rtdb: Database | null | undefined;
let serverOffset = 0;

/** true si ya se pegó la configuración real en firebase-config.ts */
export function isConfigured(): boolean {
  const apiKey = (firebaseConfig as { apiKey?: unknown }).apiKey;
  return typeof apiKey === "string" && apiKey.length > 0 && !apiKey.startsWith("PEGA");
}

export function getFirebase(): FirebaseServices {
  if (!services) {
    const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
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
