/**
 * firebase.ts — Inicialización de Firebase (solo en el navegador).
 *
 * Se inicializa la primera vez que se pide, dentro de efectos o eventos del
 * cliente, nunca durante el build de Next.js.
 */

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { firebaseConfig } from "./firebase-config";

interface FirebaseServices {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}

let services: FirebaseServices | null = null;

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
