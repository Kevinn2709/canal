/**
 * useWorkspace.ts — Lista de conversaciones y estado de "leído".
 *
 * - Escucha chats/ y descifra el nombre y el proyecto de cada conversación.
 * - Crea la conversación "General" la primera vez (apunta al historial que
 *   ya existía).
 * - Escucha users/{uid}: guarda hasta cuándo leyó cada uno cada conversación.
 *   Con eso se calculan los no leídos propios y el "visto" del otro.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Timestamp,
} from "firebase/firestore";
import { getFirebase } from "@/lib/firebase";
import {
  GENERAL_CHAT_ID,
  createChat,
  decryptChatMeta,
  type ChatInfo,
  type ChatMeta,
} from "@/lib/chats";

type ReadMap = Record<string, Date>; // chatId -> hasta cuándo leyó

function toDate(value: unknown): Date | null {
  const ts = value as Timestamp | null | undefined;
  return ts && typeof ts.toDate === "function" ? ts.toDate() : null;
}

export interface Workspace {
  chats: ChatInfo[] | null; // null mientras carga
  error: string | null;
  myReads: ReadMap;
  otherReads: ReadMap;
  isUnread: (chat: ChatInfo) => boolean;
  markRead: (chatId: string) => void;
}

export function useWorkspace(uid: string, cryptoKey: CryptoKey): Workspace {
  const [chats, setChats] = useState<ChatInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [myReads, setMyReads] = useState<ReadMap>({});
  const [otherReads, setOtherReads] = useState<ReadMap>({});
  const metaCache = useRef(new Map<string, ChatMeta | null>()); // por id+metaCt
  const creatingGeneral = useRef(false);
  const snapshotSeq = useRef(0);
  const [fromServer, setFromServer] = useState(false);

  // Conversaciones.
  useEffect(() => {
    const { db } = getFirebase();
    return onSnapshot(
      collection(db, "chats"),
      (snap) => {
        const seq = ++snapshotSeq.current;
        setError(null);
        if (!snap.metadata.fromCache) setFromServer(true);
        void Promise.all(
          snap.docs.map(async (d): Promise<ChatInfo> => {
            const data = d.data({ serverTimestamps: "estimate" });
            const metaIv = typeof data.metaIv === "string" ? data.metaIv : "";
            const metaCt = typeof data.metaCt === "string" ? data.metaCt : "";
            const cacheKey = `${d.id}:${metaCt}`;
            let meta = metaCache.current.get(cacheKey);
            if (meta === undefined) {
              try {
                meta = await decryptChatMeta(cryptoKey, d.id, { iv: metaIv, ct: metaCt });
              } catch {
                meta = null;
              }
              metaCache.current.set(cacheKey, meta);
            }
            return {
              id: d.id,
              name: meta ? meta.name : "Conversación sin descifrar",
              group: meta ? meta.group : "Otros",
              metaOk: meta !== null,
              archived: data.archived === true,
              createdAt: toDate(data.createdAt),
              lastMessageAt: toDate(data.lastMessageAt),
              lastMessageBy: typeof data.lastMessageBy === "string" ? data.lastMessageBy : "",
            };
          })
        ).then((list) => {
          if (seq === snapshotSeq.current) setChats(list);
        });
      },
      (err) => {
        setError(
          err.code === "permission-denied"
            ? "Sin permiso para leer las conversaciones. ¿Publicaste las reglas nuevas de Firestore con tus UID?"
            : "No se pudieron cargar las conversaciones. Revisa tu conexión."
        );
      }
    );
  }, [cryptoKey]);

  // La conversación "General" (historial anterior) se crea una sola vez.
  useEffect(() => {
    if (!chats || !fromServer || creatingGeneral.current) return;
    if (chats.some((c) => c.id === GENERAL_CHAT_ID)) return;
    creatingGeneral.current = true;
    const { db } = getFirebase();
    createChat(db, cryptoKey, uid, { name: "General", group: "General" }, GENERAL_CHAT_ID).catch(
      () => {
        // Si el otro la creó al mismo tiempo, su versión ya llegará por el listener.
        creatingGeneral.current = false;
      }
    );
  }, [chats, fromServer, cryptoKey, uid]);

  // Hasta dónde leyó cada uno.
  useEffect(() => {
    const { db } = getFirebase();
    return onSnapshot(collection(db, "users"), (snap) => {
      let mine: ReadMap = {};
      let other: ReadMap = {};
      for (const d of snap.docs) {
        const data = d.data({ serverTimestamps: "estimate" });
        const raw = (data.lastRead ?? {}) as Record<string, unknown>;
        const reads: ReadMap = {};
        for (const [chatId, value] of Object.entries(raw)) {
          const date = toDate(value);
          if (date) reads[chatId] = date;
        }
        if (d.id === uid) mine = reads;
        else other = reads;
      }
      setMyReads(mine);
      setOtherReads(other);
    });
  }, [uid]);

  const isUnread = useCallback(
    (chat: ChatInfo) => {
      if (!chat.lastMessageAt || chat.lastMessageBy === uid) return false;
      const read = myReads[chat.id];
      return !read || chat.lastMessageAt > read;
    },
    [myReads, uid]
  );

  const markRead = useCallback(
    (chatId: string) => {
      const { db } = getFirebase();
      void setDoc(
        doc(db, "users", uid),
        { lastRead: { [chatId]: serverTimestamp() } },
        { merge: true }
      ).catch(() => undefined);
    },
    [uid]
  );

  return useMemo(
    () => ({ chats, error, myReads, otherReads, isUnread, markRead }),
    [chats, error, myReads, otherReads, isUnread, markRead]
  );
}
