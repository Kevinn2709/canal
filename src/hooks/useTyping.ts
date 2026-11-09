/**
 * useTyping.ts — "escribiendo…" en vivo.
 *
 * Mientras escribes se actualiza chats/{chatId}/typing/{uid} como mucho cada
 * 3 s; al vaciar la caja, enviar o salir se pone en null. Del otro lado se
 * muestra "escribiendo…" durante 6 s después de cada aviso, así que si el
 * otro cierra la pestaña a media frase, el aviso se apaga solo.
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
  const [otherTyping, setOtherTyping] = useState(false);
  const lastSent = useRef(0);
  const active = useRef(false);
  const lastSeenAt = useRef<number | null | undefined>(undefined); // undefined = aún no visto
  const hideTimer = useRef<number | null>(null);

  const write = useCallback(
    (typing: boolean) => {
      const { db } = getFirebase();
      void setDoc(doc(db, "chats", chatId, "typing", uid), {
        at: typing ? serverTimestamp() : null,
      }).catch(() => undefined);
    },
    [chatId, uid]
  );

  /** Llamar cuando cambia el texto: `true` si hay algo escrito. */
  const setTyping = useCallback(
    (typing: boolean) => {
      if (typing) {
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

  // Lo que hace el otro.
  useEffect(() => {
    const { db } = getFirebase();
    lastSeenAt.current = undefined;
    const hide = () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
      setOtherTyping(false);
    };
    const unsubscribe = onSnapshot(
      collection(db, "chats", chatId, "typing"),
      (snap) => {
        const other = snap.docs.find((d) => d.id !== uid);
        if (!other) return;
        const at = toMillis(other.data().at);
        const previous = lastSeenAt.current;
        lastSeenAt.current = at;
        if (at === null) return hide();
        if (previous === at) return; // sin novedad del otro
        if (previous === undefined && Math.abs(Date.now() - at) > STALE_ON_LOAD_MS) return; // aviso viejo
        setOtherTyping(true);
        if (hideTimer.current) window.clearTimeout(hideTimer.current);
        hideTimer.current = window.setTimeout(hide, SHOW_MS);
      },
      () => undefined
    );
    return () => {
      unsubscribe();
      hide();
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

  return { otherTyping, setTyping };
}
