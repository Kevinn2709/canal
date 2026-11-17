/**
 * useRealtime.ts — Presencia en Realtime Database (RTDB).
 *
 * Estructura en RTDB (reglas en database.rules.json):
 *   chatMembers/{chatId}/{uid} = true   copia de los miembros de cada chat.
 *                                       La escriben los administradores
 *                                       (fundadores y admins) desde Firestore;
 *                                       cada quien puede borrarse a sí mismo.
 *   presence/{chatId}/{uid} = { on, at }  "en línea" por chat: solo lo leen
 *                                       los miembros de ese chat.
 *   activity/{chatId}/{uid} = { k, at }   "escribiendo…", "grabando audio…",
 *                                       "enviando archivo…" (useActivity.ts).
 *
 * Presencia:
 * - Al conectar (.info/connected) y con la web a la vista, cada quien marca
 *   { on: true } en sus chats y deja registrado onDisconnect() -> { on: false }:
 *   si se cierra la pestaña o se corta la red, el servidor lo apaga solo.
 * - Latido cada 30 s; quien lo ve lo da por desconectado si el último latido
 *   tiene más de 45 s (cubre cortes de red bruscos que el servidor tarda en
 *   notar).
 * - Al esconder la web o apagar "Mostrar cuando estoy en línea": { on: false }.
 * RTDB no cobra por escritura, así que no gasta la cuota de Firestore.
 */

import { useEffect, useRef, useState } from "react";
import {
  onDisconnect,
  onValue,
  ref,
  remove,
  serverTimestamp,
  set,
  type Database,
} from "firebase/database";
import { serverNow } from "@/lib/firebase";
import { loadSettings, onSettingsChange } from "@/lib/push";

export const HEARTBEAT_MS = 30_000;
export const PRESENCE_TIMEOUT_MS = 45_000;

/** Escucha un nodo por cada id y suelta los que ya no están. */
function useKeyedRtdb(ids: string[], subscribe: (id: string) => () => void, onRemove: (id: string) => void) {
  const unsubs = useRef(new Map<string, () => void>());
  const sub = useRef(subscribe);
  const rem = useRef(onRemove);
  sub.current = subscribe;
  rem.current = onRemove;
  const key = ids.join(",");
  useEffect(() => {
    const wanted = new Set(key ? key.split(",") : []);
    for (const [id, un] of unsubs.current) {
      if (!wanted.has(id)) {
        un();
        unsubs.current.delete(id);
        rem.current(id);
      }
    }
    for (const id of wanted) if (!unsubs.current.has(id)) unsubs.current.set(id, sub.current(id));
  }, [key]);
  useEffect(
    () => () => {
      for (const un of unsubs.current.values()) un();
      unsubs.current.clear();
    },
    []
  );
}

/**
 * Chats en los que ya estoy en la copia de miembros de RTDB. Solo en esos se
 * puede leer y escribir presencia y actividad (lo exigen las reglas).
 */
export function useRtdbMembership(db: Database | null, chatIds: string[], uid: string): Set<string> {
  const [members, setMembers] = useState<Set<string>>(new Set());
  useKeyedRtdb(
    db ? chatIds : [],
    (chatId) =>
      onValue(
        ref(db as Database, `chatMembers/${chatId}/${uid}`),
        (snap) =>
          setMembers((prev) => {
            const on = snap.val() === true;
            if (prev.has(chatId) === on) return prev;
            const next = new Set(prev);
            if (on) next.add(chatId);
            else next.delete(chatId);
            return next;
          }),
        () => undefined
      ),
    (chatId) =>
      setMembers((prev) => {
        if (!prev.has(chatId)) return prev;
        const next = new Set(prev);
        next.delete(chatId);
        return next;
      })
  );
  return members;
}

/**
 * Administradores: mantienen en RTDB la copia de los miembros de cada chat
 * (la fuente es Firestore). Se reescribe cuando cambian los miembros.
 */
export function useRtdbMirrorSync(db: Database | null, admin: boolean, chats: { id: string; members: string[] }[]) {
  const written = useRef(new Map<string, string>());
  const sig = chats.map((c) => `${c.id}:${[...c.members].sort().join("+")}`).join(",");
  useEffect(() => {
    if (!db || !admin || !sig) return;
    for (const part of sig.split(",")) {
      const [id, list] = part.split(":");
      if (!id || written.current.get(id) === list) continue;
      const members = list ? list.split("+").filter(Boolean) : [];
      if (members.length === 0) continue;
      written.current.set(id, list);
      void set(ref(db, `chatMembers/${id}`), Object.fromEntries(members.map((m) => [m, true]))).catch(() =>
        written.current.delete(id)
      );
    }
  }, [db, admin, sig]);
}

/** Al salir de un chat: se quita uno mismo de la copia de miembros. */
export async function leaveRtdbChat(db: Database | null, chatId: string, uid: string): Promise<void> {
  if (!db) return;
  await Promise.all([
    set(ref(db, `presence/${chatId}/${uid}`), { on: false, at: serverTimestamp() }).catch(() => undefined),
    remove(ref(db, `activity/${chatId}/${uid}`)).catch(() => undefined),
  ]);
  await remove(ref(db, `chatMembers/${chatId}/${uid}`)).catch(() => undefined);
}

type PresenceEntry = { on: boolean; at: number };

/**
 * Presencia de los demás (y la mía, escrita) en los chats donde la copia de
 * miembros ya me incluye. Devuelve los uid en línea.
 */
export function useRtdbPresence(db: Database | null, chatIds: string[], uid: string): Set<string> {
  const key = [...chatIds].sort().join(",");

  // ---------- Escribir la mía ----------
  useEffect(() => {
    if (!db || !key) return;
    const ids = key.split(",");
    const refs = ids.map((id) => ref(db, `presence/${id}/${uid}`));
    let show = loadSettings().showOnline;
    let connected = false;
    let lastOn: boolean | null = null;
    let timer: number | undefined;

    const write = (on: boolean) => {
      lastOn = on;
      for (const r of refs) void set(r, { on, at: serverTimestamp() }).catch(() => undefined);
    };
    const update = () => {
      window.clearInterval(timer);
      if (!connected) return; // al reconectar se vuelve a llamar
      if (show && document.visibilityState === "visible") {
        // Primero se deja dicho qué hacer si se corta; luego "en línea".
        for (const r of refs) void onDisconnect(r).set({ on: false, at: serverTimestamp() }).catch(() => undefined);
        write(true);
        timer = window.setInterval(() => write(true), HEARTBEAT_MS);
      } else if (lastOn !== false) {
        write(false);
      }
    };
    const leave = () => {
      window.clearInterval(timer);
      if (connected && lastOn) write(false);
    };

    const stopConn = onValue(ref(db, ".info/connected"), (snap) => {
      connected = snap.val() === true;
      if (!connected) {
        window.clearInterval(timer);
        lastOn = null; // el servidor ya aplicó onDisconnect
      }
      update();
    });
    document.addEventListener("visibilitychange", update);
    window.addEventListener("pagehide", leave);
    const stopSettings = onSettingsChange((s) => {
      if (s.showOnline !== show) {
        show = s.showOnline;
        update();
      }
    });
    return () => {
      stopConn();
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("pagehide", leave);
      stopSettings();
      leave();
    };
  }, [db, key, uid]);

  // ---------- Leer la de los demás ----------
  const entries = useRef(new Map<string, Map<string, PresenceEntry>>());
  const [online, setOnline] = useState<Set<string>>(new Set());
  const onlineKey = useRef("");

  const recompute = useRef<() => void>(() => undefined);
  recompute.current = () => {
    const now = serverNow();
    const s = new Set<string>();
    for (const people of entries.current.values()) {
      for (const [m, e] of people) {
        if (m !== uid && e.on && now - e.at < PRESENCE_TIMEOUT_MS) s.add(m);
      }
    }
    const k = [...s].sort().join(",");
    if (k !== onlineKey.current) {
      onlineKey.current = k;
      setOnline(s);
    }
  };

  useKeyedRtdb(
    db ? chatIds : [],
    (chatId) =>
      onValue(
        ref(db as Database, `presence/${chatId}`),
        (snap) => {
          const m = new Map<string, PresenceEntry>();
          const val = (snap.val() ?? {}) as Record<string, { on?: unknown; at?: unknown }>;
          for (const [who, e] of Object.entries(val)) {
            if (e && typeof e.at === "number") m.set(who, { on: e.on === true, at: e.at });
          }
          entries.current.set(chatId, m);
          recompute.current();
        },
        () => undefined
      ),
    (chatId) => {
      entries.current.delete(chatId);
      recompute.current();
    }
  );

  // Revisa cada 5 s si a alguien se le venció el latido.
  useEffect(() => {
    if (!db) return;
    const t = window.setInterval(() => recompute.current(), 5000);
    return () => window.clearInterval(t);
  }, [db]);

  return online;
}
