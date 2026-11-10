/**
 * useTyping.ts — "escribiendo…" en vivo.
 *
 * Mientras escribes se actualiza chats/{chatId}/typing/{uid} como mucho cada
 * 3 s; al vaciar la caja, enviar o salir se pone en null. Los demás ven
 * "escribiendo…" durante 6 s después de cada aviso, así que si alguien cierra
 * la pestaña a media frase, el aviso se apaga solo. En grupos se sabe quién.
 * Solo se guarda la hora, nunca lo que se está escribiendo.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { collection, doc, onSnapshot, serverTimestamp, setDoc, type Timestamp } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase";

const REFRESH_MS = 3000;
const SHOW_MS = 6000;
const STALE_ON_LOAD_MS = 10000;

function toMillis(value: unknown): number | null {
  const ts = value as Timestamp | null | undefined;
  return ts && typeof ts.toDate === "function" ? ts.toDate().getTime() : null;
}

export function useTyping(chatId: string, uid: string) {
  const [typing, setTypingList] = useState<string[]>([]);
  const lastSent = useRef(0);
  const active = useRef(false);
  const lastSeen = useRef(new Map<string, number | null>()); // uid -> último aviso visto
  const timers = useRef(new Map<string, number>());

  const write = useCallback(
    (on: boolean) => {
      const { db } = getFirebase();
      void setDoc(doc(db, "chats", chatId, "typing", uid), {
        at: on ? serverTimestamp() : null,
      }).catch(() => undefined);
    },
    [chatId, uid]
  );

  /** Llamar cuando cambia el texto: `true` si hay algo escrito. */
  const setTyping = useCallback(
    (on: boolean) => {
      if (on) {
        const now = Date.now();
        if (now - lastSent.current < REFRESH_MS) return;
        lastSent.current = now;
        active.current = true;
        write(true);
      } else if (active.current) {
        active.current = false;
        lastSent.current = 0;
        write(false);
      }
    },
    [write]
  );

  // Lo que hacen los demás.
  useEffect(() => {
    const { db } = getFirebase();
    lastSeen.current = new Map();
    const shown = new Set<string>();
    const publish = () => setTypingList([...shown]);
    const hide = (who: string) => {
      const t = timers.current.get(who);
      if (t) window.clearTimeout(t);
      timers.current.delete(who);
      if (shown.delete(who)) publish();
    };
    const unsubscribe = onSnapshot(
      collection(db, "chats", chatId, "typing"),
      (snap) => {
        for (const d of snap.docs) {
          if (d.id === uid) continue;
          const at = toMillis(d.data().at);
          const firstLook = !lastSeen.current.has(d.id);
          const previous = lastSeen.current.get(d.id);
          lastSeen.current.set(d.id, at);
          if (at === null) {
            hide(d.id);
            continue;
          }
          if (!firstLook && previous === at) continue; // sin novedad
          if (firstLook && Math.abs(Date.now() - at) > STALE_ON_LOAD_MS) continue; // aviso viejo
          shown.add(d.id);
          publish();
          const old = timers.current.get(d.id);
          if (old) window.clearTimeout(old);
          timers.current.set(d.id, window.setTimeout(() => hide(d.id), SHOW_MS));
        }
      },
      () => undefined
    );
    return () => {
      unsubscribe();
      for (const t of timers.current.values()) window.clearTimeout(t);
      timers.current.clear();
      setTypingList([]);
    };
  }, [chatId, uid]);

  // Al salir de la conversación o esconder la pestaña, deja de "escribir".
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") setTyping(false);
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      setTyping(false);
    };
  }, [setTyping]);

  return { typing, setTyping };
}
