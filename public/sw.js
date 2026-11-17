/*
 * sw.js — Service worker: muestra las notificaciones push y, al tocarlas,
 * abre la app en ese chat.
 *
 * Las push solo las reciben los administradores (fundadores y admins).
 * El aviso es siempre neutro, porque puede verse con la pantalla bloqueada:
 * nunca lleva el texto del mensaje, ni el nombre del chat, ni quién escribió.
 * Solo dice "Nuevo mensaje" (o "Llamada entrante"). El id del chat viaja
 * dentro del aviso cifrado de Web Push y solo sirve para abrir ese chat.
 *
 * No guarda la app en caché: siempre se carga la versión más reciente.
 */

const APP_NAME = "Chat";
const ICON = "/notification-icon.png";
const BADGE = "/badge-96.png";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function buildNotification(data) {
  if (data.t) {
    return { title: APP_NAME, body: "Las notificaciones funcionan en este dispositivo.", tag: "prueba", chatId: "" };
  }
  const chatId = typeof data.c === "string" ? data.c : "";
  if (data.k) {
    // Llamada entrante: se queda a la vista hasta que la toques.
    return { title: APP_NAME, body: "Llamada entrante", tag: `call-${chatId}`, chatId, call: true };
  }
  return { title: APP_NAME, body: "Nuevo mensaje", tag: chatId ? `c-${chatId}` : "canal", chatId };
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  event.waitUntil(
    (async () => {
      const n = buildNotification(data);
      await self.registration.showNotification(n.title, {
        body: n.body,
        tag: n.tag,
        renotify: true,
        requireInteraction: !!n.call,
        vibrate: n.call ? [400, 200, 400, 200, 400] : undefined,
        icon: ICON,
        badge: BADGE,
        data: { chatId: n.chatId },
      });
      // Si ya tienes ese chat abierto y a la vista, no hace falta el aviso.
      // Una llamada suena dentro de la web si está a la vista.
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const viewing = windows.some(
        (w) =>
          w.visibilityState === "visible" &&
          (n.call || (w.focused && n.chatId && w.url.includes(`#c=${n.chatId}`)))
      );
      if (viewing) {
        const shown = await self.registration.getNotifications({ tag: n.tag });
        shown.forEach((x) => x.close());
      }
    })()
  );
});

// Al tocar el aviso: se cierra y se abre la app (la PWA) en ese chat.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const chatId = (event.notification.data && event.notification.data.chatId) || "";
  const target = chatId ? `/#c=${chatId}` : "/";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of windows) {
        if ("focus" in w) {
          w.postMessage({ type: "open-chat", chatId });
          return w.focus();
        }
      }
      return self.clients.openWindow(target);
    })()
  );
});
