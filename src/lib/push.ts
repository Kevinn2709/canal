/**
 * push.ts — Notificaciones (lado del navegador).
 *
 * - Ajustes de este dispositivo (avisos dentro de la web, sonido, avisos del
 *   sistema con la web abierta, nombres en las notificaciones). Se guardan en
 *   este navegador; cada dispositivo tiene los suyos.
 * - Push con la web cerrada: registra el service worker, suscribe este
 *   dispositivo y guarda la suscripción en push/{uid}. Al enviar un mensaje,
 *   la app le pide a /api/notify que avise a los demás miembros.
 * - En iPhone, el push solo funciona si la web se agregó a la pantalla de
 *   inicio y se abrió desde ese ícono (iOS 16.4 o posterior).
 */

import { doc, getDoc, setDoc, updateDoc, type Firestore } from "firebase/firestore";

// ---------------------------------------------------------------------------
// Ajustes de este dispositivo
// ---------------------------------------------------------------------------

export interface DeviceSettings {
  inApp: boolean; // aviso dentro de la web cuando llega un mensaje de otro chat
  sound: boolean; // sonido con ese aviso
  system: boolean; // aviso del sistema con la web abierta pero en segundo plano
  names: boolean; // las notificaciones dicen de qué chat y de quién es
}

const SETTINGS_KEY = "canal:ajustes";
const DEFAULTS: DeviceSettings = { inApp: true, sound: true, system: false, names: false };
const SETTINGS_EVENT = "canal-ajustes";

export function loadSettings(): DeviceSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<DeviceSettings>;
    return {
      inApp: typeof raw.inApp === "boolean" ? raw.inApp : DEFAULTS.inApp,
      sound: typeof raw.sound === "boolean" ? raw.sound : DEFAULTS.sound,
      system: typeof raw.system === "boolean" ? raw.system : DEFAULTS.system,
      names: typeof raw.names === "boolean" ? raw.names : DEFAULTS.names,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: DeviceSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Sin almacenamiento: los ajustes duran hasta recargar.
  }
  window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: settings }));
}

export function onSettingsChange(cb: (s: DeviceSettings) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<DeviceSettings>).detail);
  window.addEventListener(SETTINGS_EVENT, handler);
  return () => window.removeEventListener(SETTINGS_EVENT, handler);
}

// ---------------------------------------------------------------------------
// Capacidades del navegador
// ---------------------------------------------------------------------------

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

/** true si la web se abrió desde el ícono de la pantalla de inicio. */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  return notificationsSupported() ? Notification.permission : "unsupported";
}

let swPromise: Promise<ServiceWorkerRegistration | null> | null = null;

/** Registra el service worker (una vez). */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!swPromise) {
    swPromise =
      typeof navigator !== "undefined" && "serviceWorker" in navigator
        ? navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => null)
        : Promise.resolve(null);
  }
  return swPromise;
}

/** Muestra un aviso del sistema (con la web abierta). */
export async function showSystemNotification(title: string, body: string, chatId: string): Promise<void> {
  if (notificationPermission() !== "granted") return;
  const reg = await registerServiceWorker();
  const options = { body, tag: `c-${chatId}`, icon: "/icon-192.png", data: { chatId } };
  try {
    if (reg) {
      await reg.showNotification(title, options);
      return;
    }
    const n = new Notification(title, options);
    n.onclick = () => {
      window.focus();
      window.location.hash = `#c=${chatId}`;
      n.close();
    };
  } catch {
    // El navegador no permite avisos aquí.
  }
}

// ---------------------------------------------------------------------------
// Push con la web cerrada
// ---------------------------------------------------------------------------

let vapidPromise: Promise<string | null> | null = null;

/** Llave pública VAPID del servidor, o null si falta configurarla en Vercel. */
export function getVapidKey(): Promise<string | null> {
  if (!vapidPromise) {
    vapidPromise = fetch("/api/notify", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ publicKey?: unknown }>) : { publicKey: null }))
      .then((d) => (typeof d.publicKey === "string" && d.publicKey ? d.publicKey : null))
      .catch(() => null);
  }
  return vapidPromise;
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function endpointId(endpoint: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint)));
  return Array.from(hash.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await registerServiceWorker();
  if (!reg) return null;
  try {
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

const STALE_MS = 90 * 24 * 3600 * 1000;

type SubEntry = { endpoint: string; p256dh: string; auth: string; at: number };

async function writeSubscription(db: Firestore, uid: string, sub: PushSubscription | null, removeEndpoint?: string) {
  const ref = doc(db, "push", uid);
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() ?? {} : {};
  const subs: Record<string, SubEntry> = {};
  const now = Date.now();
  for (const [id, value] of Object.entries((data.subs ?? {}) as Record<string, SubEntry>)) {
    if (value && typeof value.at === "number" && now - value.at < STALE_MS) subs[id] = value;
  }
  if (removeEndpoint) delete subs[await endpointId(removeEndpoint)];
  if (sub) {
    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (json.endpoint && json.keys?.p256dh && json.keys.auth) {
      subs[await endpointId(json.endpoint)] = { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth, at: now };
    }
  }
  if (snap.exists()) await updateDoc(ref, { subs });
  else await setDoc(ref, { subs, muted: [] });
}

/**
 * Activa el push en este dispositivo. Debe llamarse desde un toque del
 * usuario (iPhone lo exige para pedir permiso). Lanza Error con mensaje.
 */
export async function enablePush(db: Firestore, uid: string): Promise<void> {
  if (!pushSupported()) {
    throw new Error(
      isIOS() && !isStandalone()
        ? "En iPhone, primero agrega la web a la pantalla de inicio y ábrela desde ese ícono."
        : "Este navegador no permite notificaciones push."
    );
  }
  // Primero el permiso, sin esperar nada antes: Safari solo lo pide si la
  // llamada sale directamente del toque.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("No diste permiso. Puedes activarlo en los ajustes del navegador para este sitio.");
  }
  const key = await getVapidKey();
  if (!key) throw new Error("Falta configurar las notificaciones en Vercel (ver abajo).");
  const reg = await registerServiceWorker();
  if (!reg) throw new Error("No se pudo registrar el servicio de notificaciones.");
  let sub = await reg.pushManager.getSubscription();
  // Si la llave del servidor cambió, se rehace la suscripción.
  const current = sub?.options?.applicationServerKey;
  if (sub && current) {
    const a = new Uint8Array(current);
    const b = b64urlToBytes(key);
    if (a.length !== b.length || a.some((x, i) => x !== b[i])) {
      await sub.unsubscribe().catch(() => undefined);
      sub = null;
    }
  }
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(key) });
    } catch {
      throw new Error("No se pudo suscribir este dispositivo. Intenta de nuevo.");
    }
  }
  await writeSubscription(db, uid, sub);
}

export async function disablePush(db: Firestore, uid: string): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => undefined);
  await writeSubscription(db, uid, null, endpoint);
}

/** Al abrir la app: renueva la suscripción de este dispositivo si ya estaba activa. */
export async function refreshPush(db: Firestore, uid: string): Promise<boolean> {
  if (notificationPermission() !== "granted") return false;
  const sub = await currentSubscription();
  if (!sub) return false;
  await writeSubscription(db, uid, sub).catch(() => undefined);
  return true;
}

/** Silencia o reactiva un chat (no llegan push salvo que te mencionen). */
export async function setMuted(db: Firestore, uid: string, muted: string[]): Promise<void> {
  const ref = doc(db, "push", uid);
  const snap = await getDoc(ref);
  if (snap.exists()) await updateDoc(ref, { muted });
  else await setDoc(ref, { subs: {}, muted });
}

// ---------------------------------------------------------------------------
// Avisar a los demás
// ---------------------------------------------------------------------------

const lastNotify = new Map<string, number>();
const pendingNotify = new Map<string, number>();
const THROTTLE_MS = 4000;

async function post(getToken: () => Promise<string>, body: unknown): Promise<Response | null> {
  if (!(await getVapidKey())) return null;
  const token = await getToken();
  return fetch("/api/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    keepalive: true,
  });
}

/**
 * Pide a /api/notify que avise a los demás miembros. Si mandas varios
 * mensajes seguidos, se agrupan en un solo aviso cada 4 s.
 */
export function notifyChat(getToken: () => Promise<string>, chatId: string, mentions: string[]): void {
  const send = (m: string[]) => {
    lastNotify.set(chatId, Date.now());
    void post(getToken, { chatId, mentions: m }).catch(() => undefined);
  };
  const since = Date.now() - (lastNotify.get(chatId) ?? 0);
  if (since >= THROTTLE_MS || mentions.length > 0) {
    send(mentions);
    return;
  }
  if (pendingNotify.has(chatId)) return;
  pendingNotify.set(
    chatId,
    window.setTimeout(() => {
      pendingNotify.delete(chatId);
      send([]);
    }, THROTTLE_MS - since)
  );
}

/** Envía un aviso de prueba a tus propios dispositivos. */
export async function sendTestPush(getToken: () => Promise<string>): Promise<{ sent: number; failed: number; gone: number }> {
  const res = await post(getToken, { test: true });
  if (!res) throw new Error("Falta configurar las notificaciones en Vercel.");
  const data = (await res.json().catch(() => ({}))) as { sent?: number; failed?: number; gone?: number; error?: string };
  if (!res.ok) throw new Error(data.error === "not-configured" ? "Falta configurar las notificaciones en Vercel." : "El servidor no pudo enviar la prueba.");
  return { sent: data.sent ?? 0, failed: data.failed ?? 0, gone: data.gone ?? 0 };
}
