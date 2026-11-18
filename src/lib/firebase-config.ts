/**
 * firebase-config.ts — Configuración pública de Firebase.
 *
 * Se lee de las variables de entorno (en Vercel: Settings → Environment
 * Variables). Así el mismo código sirve para el proyecto de pruebas y para el
 * principal, cada uno con su propio Firebase. Estos valores no son secretos:
 * viajan al navegador de todos modos; lo que protege los datos son las reglas
 * y el cifrado de extremo a extremo.
 *
 * Variables:
 *   NEXT_PUBLIC_FIREBASE_API_KEY
 *   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
 *   NEXT_PUBLIC_FIREBASE_PROJECT_ID
 *   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
 *   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
 *   NEXT_PUBLIC_FIREBASE_APP_ID
 *   NEXT_PUBLIC_FIREBASE_DATABASE_URL   (Realtime Database; opcional)
 *
 * Next.js solo reemplaza process.env.NEXT_PUBLIC_… cuando se escribe completo,
 * por eso cada una aparece por separado.
 */

const databaseURL = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL?.trim();

export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() ?? "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim() ?? "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ?? "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() ?? "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim() ?? "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim() ?? "",
  ...(databaseURL ? { databaseURL } : {}),
};
