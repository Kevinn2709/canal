/*
 * sw.js — Service worker: muestra las notificaciones push y, al tocarlas,
 * abre el chat.
 *
 * El aviso no trae el texto del mensaje (sigue cifrado de extremo a
 * extremo): solo el id del chat, quién escribió y si te mencionaron. Si en
 * Configuración activaste "Mostrar el nombre del chat", los nombres salen de
 * una lista guardada en este dispositivo; si no, dice solo "Nuevo mensaje"
 * (o "Llamada entrante").
 *
 * No guarda la app en caché: siempre se carga la versión más reciente.
 */

const APP_NAME = "Chat";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function readNames() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open("canal", 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("keys")) db.createObjectStore("keys");
        if (!db.objectStoreNames.contains("notif")) db.createObjectStore("notif");
      };
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const db = req.result;
        try {
          const get = db.transaction("notif", "readonly").objectStore("notif").get("names");
          get.onsuccess = () => {
            db.close();
            resolve(get.result || null);
          };
          get.onerror = () => {
            db.close();
            resolve(null);
          };
        } catch (e) {
          db.close();
          resolve(null);
        }
      };
    } catch (e) {
      resolve(null);
    }
  });
}

async function buildNotification(data) {
  if (data.t) {
    return { title: APP_NAME, body: "Las notificaciones funcionan en este dispositivo.", tag: "prueba", chatId: "" };
  }
  const chatId = typeof data.c === "string" ? data.c : "";
  const names = await readNames();
  const chatName = names && names.chats && names.chats[chatId];
  const person = names && names.people && typeof data.f === "string" && names.people[data.f];
  if (data.k) {
    // Llamada entrante: se queda a la vista hasta que la toques.
    return {
      title: chatName || "Llamada",
      body: person ? `${person} te está llamando` : "Llamada entrante",
      tag: `call-${chatId}`,
      chatId,
      call: true,
    };
  }
  const title = chatName || APP_NAME;
  let body;
  if (data.m) body = person ? `${person} te mencionó` : "Te mencionaron";
  else body = person ? `${person}: nuevo mensaje` : "Nuevo mensaje";
  return { title, body, tag: chatId ? `c-${chatId}` : "canal", chatId };
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
      const n = await buildNotification(data);
      await self.registration.showNotification(n.title, {
        body: n.body,
        tag: n.tag,
        renotify: true,
        requireInteraction: !!n.call,
        vibrate: n.call ? [400, 200, 400, 200, 400] : undefined,
        icon: "/icon-192.png",
        badge: "/badge-96.png",
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
