/**
 * useNotifier.ts — Avisos con la web abierta.
 *
 * Cuando llega un mensaje de otra persona:
 * - Si la web está a la vista y no estás en ese chat: aviso dentro de la web
 *   (y sonido), si lo tienes activado en Configuración.
 * - Si la web está abierta pero en segundo plano: aviso del sistema, si lo
 *   activaste y este dispositivo no tiene ya las notificaciones push (para
 *   no avisar dos veces). Como las push, no incluye el texto del mensaje.
 * Los chats silenciados no avisan, salvo que te mencionen.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatInfo } from "@/lib/chats";
import { showSystemNotification, type DeviceSettings } from "@/lib/push";
import { playMessageSound } from "@/lib/sound";
import type { Workspace } from "./useWorkspace";

export interface Toast {
  id: number;
  chatId: string;
  title: string;
  body: string;
  mention: boolean;
}

const WAIT_PREVIEW_MS = 1500;
const TOAST_MS = 5000;

export function useNotifier(args: {
  ws: Workspace;
  uid: string;
  viewing: string | null;
  settings: DeviceSettings;
  pushOn: boolean;
}): { toast: Toast | null; dismiss: () => void } {
  const { ws, uid, viewing, settings, pushOn } = args;
  const [toast, setToast] = useState<Toast | null>(null);
  const [tick, setTick] = useState(0);
  const seen = useRef<Map<string, number> | null>(null);
  const pending = useRef(new Map<string, { at: number; since: number }>());
  const toastTimer = useRef<number | null>(null);
  const toastSeq = useRef(0);

  const dismiss = useCallback(() => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = null;
    setToast(null);
  }, []);

  const fire = useCallback(
    (chat: ChatInfo) => {
      const visible = document.visibilityState === "visible";
      if (visible && viewing === chat.id) return;
      const mention = ws.mentionedIn(chat);
      if (ws.muted.has(chat.id) && !mention) return;
      const group = chat.members.length > 2;
      const sender = ws.nameOf(chat.lastMessageBy);
      const text = chat.last ? chat.last.text : "Nuevo mensaje";
      const body = mention ? `${sender} te mencionó: ${text}` : group ? `${sender}: ${text}` : text;
      if (visible) {
        if (!settings.inApp) return;
        if (settings.sound) playMessageSound();
        const id = ++toastSeq.current;
        setToast({ id, chatId: chat.id, title: chat.name, body, mention });
        if (toastTimer.current) window.clearTimeout(toastTimer.current);
        toastTimer.current = window.setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), TOAST_MS);
      } else if (settings.system && !pushOn) {
        // Igual que las push: sin el texto del mensaje (se ve en la pantalla bloqueada).
        const title = settings.names ? chat.name : "Chat";
        const short = mention
          ? settings.names ? `${sender} te mencionó` : "Te mencionaron"
          : settings.names ? `${sender}: nuevo mensaje` : "Nuevo mensaje";
        void showSystemNotification(title, short, chat.id);
      }
    },
    [viewing, ws, settings, pushOn]
  );

  useEffect(() => {
    if (ws.loading) return;
    const chats = ws.chats;
    if (!seen.current) {
      seen.current = new Map(chats.map((c) => [c.id, c.lastMessageAt?.getTime() ?? 0]));
      return;
    }
    const now = Date.now();
    for (const c of chats) {
      const at = c.lastMessageAt?.getTime() ?? 0;
      const before = seen.current.get(c.id);
      seen.current.set(c.id, at);
      if (before === undefined) continue; // chat nuevo para ti: no es un mensaje
      if (at > before && c.lastMessageBy && c.lastMessageBy !== uid) pending.current.set(c.id, { at, since: now });
    }
    let wait = false;
    for (const [id, p] of [...pending.current]) {
      const chat = chats.find((c) => c.id === id);
      if (!chat || (chat.lastMessageAt?.getTime() ?? 0) !== p.at) {
        if (!chat) pending.current.delete(id);
        continue;
      }
      // Espera un momento a que se descifre la vista previa del mensaje.
      if (!chat.last && now - p.since < WAIT_PREVIEW_MS) {
        wait = true;
        continue;
      }
      pending.current.delete(id);
      fire(chat);
    }
    if (wait) {
      const t = window.setTimeout(() => setTick((n) => n + 1), 400);
      return () => window.clearTimeout(t);
    }
  }, [ws.chats, ws.loading, uid, fire, tick]);

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  return { toast, dismiss };
}
