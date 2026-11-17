/**
 * useActivity.ts — "Escribiendo…", "Grabando audio…", "Enviando archivo…".
 *
 * - Con Realtime Database (y la copia de miembros lista): activity/{chat}/{uid}
 *   = { k, at }, con onDisconnect().remove(): si cierras la pestaña o se cae
 *   la red, el aviso desaparece solo. No gasta escrituras de Firestore.
 * - Sin RTDB: chats/{chatId}/typing/{uid} = { at, k } en Firestore, como antes.
 *
 * "Escribiendo" se renueva con cada tecla (como mucho cada 3 s) y los demás lo
 * ven 6 s después del último aviso. Grabar y enviar archivo se renuevan solos
 * cada 3 s mientras duran. Al terminar, enviar o salir se borra. Solo se
 * guarda el tipo y la hora, nunca lo que se escribe.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { collection, doc, onSnapshot, serverTimestamp, setDoc, type Timestamp } from "firebase/firestore";
import {
  onDisconnect,
  onValue,
  ref,
  remove,
  serverTimestamp as rtdbTimestamp,
  set,
  type Database,
} from "firebase/database";
import { getFirebase, serverNow } from "@/lib/firebase";

export type Activity = "text" | "voice" | "file";
export interface ActiveUser {
  uid: string;
  k: Activity;
}

const REFRESH_MS = 3000;
const SHOW_MS: Record<Activity, number> = { text: 6000, voice: 8000, file: 8000 };
const STALE_ON_LOAD_MS = 10000;

function parseKind(v: unknown): Activity {
  return v === "voice" || v === "file" ? v : "text";
}

function toMillis(value: unknown): number | null {
  if (typeof value === "number") return value;
  const ts = value as Timestamp | null | undefined;
  return ts && typeof ts.toDate === "function" ? ts.toDate().getTime() : null;
}

/** `rtdb`: base de RTDB si este chat ya se puede usar ahí; null para Firestore. */
export function useActivity(chatId: string, uid: string, rtdb: Database | null) {
  const [active, setActive] = useState<ActiveUser[]>([]);
  const current = useRef<Activity | null>(null);
  const lastSent = useRef(0);
  const refresh = useRef<number | undefined>(undefined);
  const disconnectSet = useRef(false);

  const write = useCallback(
    (k: Activity | null) => {
      if (rtdb) {
        const r = ref(rtdb, `activity/${chatId}/${uid}`);
        if (k === null) {
          void remove(r).catch(() => undefined);
          return;
        }
        if (!disconnectSet.current) {
          disconnectSet.current = true;
          void onDisconnect(r)
            .remove()
            .catch(() => {
              disconnectSet.current = false;
            });
        }
        void set(r, { k, at: rtdbTimestamp() }).catch(() => undefined);
        return;
      }
      const { db } = getFirebase();
      void setDoc(doc(db, "chats", chatId, "typing", uid), k === null ? { at: null } : { at: serverTimestamp(), k }).catch(
        () => undefined
      );
    },
    [chatId, uid, rtdb]
  );

  /** Llamar cada vez que cambia lo que haces (null = nada). */
  const setActivity = useCallback(
    (k: Activity | null) => {
      const now = Date.now();
      if (k === null) {
        window.clearInterval(refresh.current);
        refresh.current = undefined;
        if (current.current !== null) {
          current.current = null;
          lastSent.current = 0;
          write(null);
        }
        return;
      }
      const changed = current.current !== k;
      current.current = k;
      if (k === "text") {
        window.clearInterval(refresh.current);
        refresh.current = undefined;
        if (!changed && now - lastSent.current < REFRESH_MS) return;
        lastSent.current = now;
        write(k);
        return;
      }
      // Grabar o enviar archivo: se renueva solo mientras dure.
      if (changed) {
        lastSent.current = now;
        write(k);
        window.clearInterval(refresh.current);
        refresh.current = window.setInterval(() => {
          if (current.current) {
            lastSent.current = Date.now();
            write(current.current);
          }
        }, REFRESH_MS);
      }
    },
    [write]
  );

  // Lo que hacen los demás.
  useEffect(() => {
    const lastSeen = new Map<string, number | null>(); // uid -> último aviso visto
    const shown = new Map<string, Activity>();
    const timers = new Map<string, number>();
    const publish = () => setActive([...shown].map(([who, k]) => ({ uid: who, k })));
    const hide = (who: string) => {
      const t = timers.get(who);
      if (t) window.clearTimeout(t);
      timers.delete(who);
      if (shown.delete(who)) publish();
    };
    const apply = (docs: { id: string; at: number | null; k: Activity }[], now: number) => {
      const present = new Set(docs.map((d) => d.id));
      for (const who of [...shown.keys()]) if (!present.has(who)) hide(who);
      for (const d of docs) {
        if (d.id === uid) continue;
        const firstLook = !lastSeen.has(d.id);
        const previous = lastSeen.get(d.id);
        lastSeen.set(d.id, d.at);
        if (d.at === null) {
          hide(d.id);
          continue;
        }
        if (!firstLook && previous === d.at && shown.get(d.id) === d.k) continue; // sin novedad
        if (firstLook && Math.abs(now - d.at) > STALE_ON_LOAD_MS) continue; // aviso viejo
        shown.set(d.id, d.k);
        publish();
        const old = timers.get(d.id);
        if (old) window.clearTimeout(old);
        timers.set(d.id, window.setTimeout(() => hide(d.id), SHOW_MS[d.k]));
      }
    };

    let unsubscribe: () => void;
    if (rtdb) {
      unsubscribe = onValue(
        ref(rtdb, `activity/${chatId}`),
        (snap) => {
          const val = (snap.val() ?? {}) as Record<string, { k?: unknown; at?: unknown }>;
          apply(
            Object.entries(val).map(([id, e]) => ({ id, at: toMillis(e?.at), k: parseKind(e?.k) })),
            serverNow()
          );
        },
        () => undefined
      );
    } else {
      const { db } = getFirebase();
      unsubscribe = onSnapshot(
        collection(db, "chats", chatId, "typing"),
        (snap) =>
          apply(
            snap.docs.map((d) => {
              const data = d.data();
              return { id: d.id, at: toMillis(data.at), k: parseKind(data.k) };
            }),
            Date.now()
          ),
        () => undefined
      );
    }
    return () => {
      unsubscribe();
      for (const t of timers.values()) window.clearTimeout(t);
      timers.clear();
      setActive([]);
    };
  }, [chatId, uid, rtdb]);

  // Al salir de la conversación o esconder la pestaña, deja de "escribir".
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") setActivity(null);
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      setActivity(null);
      disconnectSet.current = false;
    };
  }, [setActivity]);

  return { active, setActivity };
}

/** "Ana está escribiendo…" / "grabando audio…" / "enviando archivo…". */
export function activityLabel(active: ActiveUser[], group: boolean, nameOf: (uid: string) => string): string {
  if (active.length === 0) return "";
  const verb = (k: Activity, plural: boolean) =>
    k === "voice"
      ? plural ? "están grabando audio…" : "está grabando audio…"
      : k === "file"
        ? plural ? "están enviando archivos…" : "está enviando un archivo…"
        : plural ? "están escribiendo…" : "está escribiendo…";
  if (!group) {
    const k = active[0].k;
    return k === "voice" ? "Grabando audio…" : k === "file" ? "Enviando archivo…" : "Escribiendo…";
  }
  if (active.length === 1) return `${nameOf(active[0].uid)} ${verb(active[0].k, false)}`;
  const kinds = new Set(active.map((a) => a.k));
  const k = kinds.size === 1 ? active[0].k : "text";
  return `${active.map((a) => nameOf(a.uid)).join(" y ")} ${verb(k, true)}`;
}
