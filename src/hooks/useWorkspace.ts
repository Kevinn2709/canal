/**
 * useWorkspace.ts — Todo lo que la lista de chats necesita, en vivo.
 *
 * - Miembros (users/) con su perfil descifrado y su foto (avatars/).
 * - Conversaciones donde estás (las de antes, si eres fundador), con su
 *   nombre, proyecto y último mensaje descifrados.
 * - Llaves de cada conversación (chats/{id}/keys): abre la tuya y, si a otro
 *   miembro le falta la suya (recién agregado, o cambió su frase), se la
 *   entrega cifrada. Así nadie se queda sin poder leer.
 * - No leídos (por número de mensajes), menciones, fijados, silenciados y
 *   pendientes abiertos de todas las conversaciones.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  type DocumentData,
  type Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebase } from "@/lib/firebase";
import { fingerprint, importAesKey, securityCode } from "@/lib/crypto";
import { colorFor, decryptAvatar, decryptProfile, type Profile } from "@/lib/members";
import {
  decryptChatMeta,
  decryptLast,
  displayName,
  unwrapChatKey,
  wrapChatKey,
  type ChatInfo,
  type ChatMeta,
  type KeyDoc,
  type LastPreview,
} from "@/lib/chats";
import { decryptTask, type Task } from "@/lib/tasks";
import { setMuted } from "@/lib/push";
import type { Session } from "@/lib/session";

type Raw = { id: string; data: DocumentData };

function toDate(value: unknown): Date | null {
  const ts = value as Timestamp | null | undefined;
  return ts && typeof ts.toDate === "function" ? ts.toDate() : null;
}

function dateMap(value: unknown): Record<string, Date> {
  const out: Record<string, Date> = {};
  for (const [k, v] of Object.entries((value ?? {}) as Record<string, unknown>)) {
    const d = toDate(v);
    if (d) out[k] = d;
  }
  return out;
}

function numberMap(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries((value ?? {}) as Record<string, unknown>)) {
    if (typeof v === "number") out[k] = v;
  }
  return out;
}

function parseKeyDoc(d: DocumentData): KeyDoc | null {
  if (typeof d.from !== "string" || typeof d.fp !== "string" || typeof d.iv !== "string" || typeof d.ct !== "string") {
    return null;
  }
  return { from: d.from, fp: d.fp, iv: d.iv, ct: d.ct };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Escucha una colección por cada id y desuscribe los que ya no están. */
function useKeyedListeners(ids: string[], subscribe: (id: string) => Unsubscribe, onRemove: (id: string) => void) {
  const unsubs = useRef(new Map<string, Unsubscribe>());
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

interface ChatKey {
  raw: Uint8Array;
  key: CryptoKey;
  sig: string;
}

export interface Workspace {
  error: string | null;
  loading: boolean;
  profiles: Map<string, Profile>;
  avatars: Map<string, string>; // uid -> URL de la foto
  me: Profile | null;
  founders: string[]; // miembros de las conversaciones de antes
  pending: Profile[]; // cuentas nuevas esperando aprobación
  chats: ChatInfo[];
  pinned: string[];
  muted: Set<string>;
  openTasks: Task[];
  nameOf: (uid: string) => string;
  unreadOf: (chat: ChatInfo) => number;
  mentionedIn: (chat: ChatInfo) => boolean;
  markRead: (chat: ChatInfo) => void;
  togglePin: (chatId: string) => void;
  toggleMute: (chatId: string) => void;
  chatRaw: (chatId: string) => Uint8Array | null;
  rememberChatKey: (chatId: string, raw: Uint8Array, key: CryptoKey) => void;
}

export function useWorkspace(session: Session): Workspace {
  const uid = session.uid;
  const ws = session.ws as CryptoKey;
  const [error, setError] = useState<string | null>(null);

  // ---------- Miembros ----------
  const [userDocs, setUserDocs] = useState<Raw[] | null>(null);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const profileCache = useRef(new Map<string, { fp: string; prof: { name: string; photo: number } | null }>());

  useEffect(() => {
    const { db } = getFirebase();
    return onSnapshot(
      collection(db, "users"),
      (snap) => setUserDocs(snap.docs.map((d) => ({ id: d.id, data: d.data({ serverTimestamps: "estimate" }) }))),
      (err) =>
        setError(
          err.code === "permission-denied"
            ? "Sin permiso para leer los miembros. ¿Publicaste las reglas nuevas de Firestore con los UID?"
            : "No se pudo conectar. Revisa tu internet."
        )
    );
  }, []);

  useEffect(() => {
    if (!userDocs) return;
    let cancelled = false;
    void (async () => {
      const map = new Map<string, Profile>();
      for (const { id, data } of userDocs) {
        const pub = typeof data.pub === "string" ? data.pub : "";
        if (!pub) continue; // aún no actualiza a esta versión
        const ck = `${id}:${pub}:${String(data.profCt ?? "")}`;
        let c = profileCache.current.get(ck);
        if (!c) {
          const fp = await fingerprint(pub);
          const prof =
            typeof data.profIv === "string" && typeof data.profCt === "string"
              ? await decryptProfile(ws, id, fp, { iv: data.profIv, ct: data.profCt })
              : null;
          c = { fp, prof };
          profileCache.current.set(ck, c);
        }
        map.set(id, {
          uid: id,
          pub,
          fp: c.fp,
          code: securityCode(c.fp),
          founder: data.founder === true,
          name: c.prof?.name ?? "",
          valid: !!c.prof,
          photo: c.prof?.photo ?? 0,
          color: colorFor(id),
          lastRead: dateMap(data.lastRead),
          readCount: numberMap(data.readCount),
        });
      }
      if (!cancelled) setProfiles(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [userDocs, ws]);

  const myDoc = userDocs?.find((d) => d.id === uid)?.data;
  const myLastRead = useMemo(() => dateMap(myDoc?.lastRead), [myDoc]);
  const myReadCount = useMemo(() => numberMap(myDoc?.readCount), [myDoc]);

  // ---------- Fotos ----------
  const [avatars, setAvatars] = useState<Map<string, string>>(new Map());
  const avatarCache = useRef(new Map<string, string>()); // uid:iv -> url
  useEffect(() => {
    const { db } = getFirebase();
    return onSnapshot(
      collection(db, "avatars"),
      (snap) => {
        void Promise.all(
          snap.docs.map(async (d): Promise<[string, string] | null> => {
            const data = d.data();
            if (typeof data.iv !== "string" || !data.data) return null;
            const ck = `${d.id}:${data.iv}`;
            let url = avatarCache.current.get(ck);
            if (!url) {
              const blob = await decryptAvatar(ws, d.id, data.iv, data.data);
              if (!blob) return null;
              url = URL.createObjectURL(blob);
              avatarCache.current.set(ck, url);
            }
            return [d.id, url];
          })
        ).then((list) => setAvatars(new Map(list.filter((x): x is [string, string] => x !== null))));
      },
      () => undefined
    );
  }, [ws]);

  // ---------- Aprobaciones entregadas (wraps/) ----------
  const [wrapFps, setWrapFps] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    const { db } = getFirebase();
    return onSnapshot(
      collection(db, "wraps"),
      (snap) => {
        const m = new Map<string, string>();
        for (const d of snap.docs) {
          const fp = d.data().fp;
          if (typeof fp === "string") m.set(d.id, fp);
        }
        setWrapFps(m);
      },
      () => undefined
    );
  }, []);

  // ---------- Preferencias: fijados y silenciados ----------
  const [pinned, setPinned] = useState<string[]>([]);
  const [muted, setMutedState] = useState<string[]>([]);
  useEffect(() => {
    const { db } = getFirebase();
    const a = onSnapshot(
      doc(db, "prefs", uid),
      (snap) => {
        const p = snap.data()?.pinned;
        setPinned(Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : []);
      },
      () => undefined
    );
    const b = onSnapshot(
      doc(db, "push", uid),
      (snap) => {
        const m = snap.data()?.muted;
        setMutedState(Array.isArray(m) ? m.filter((x): x is string => typeof x === "string") : []);
      },
      () => undefined
    );
    return () => {
      a();
      b();
    };
  }, [uid]);

  // ---------- Conversaciones ----------
  const [chatDocs, setChatDocs] = useState<Raw[] | null>(null);
  useEffect(() => {
    const { db } = getFirebase();
    // Los fundadores leen también las conversaciones de antes (sin lista de miembros).
    const q = session.founder
      ? collection(db, "chats")
      : query(collection(db, "chats"), where("members", "array-contains", uid));
    return onSnapshot(
      q,
      (snap) => {
        setError(null);
        const docs = snap.docs
          .map((d) => ({ id: d.id, data: d.data({ serverTimestamps: "estimate" }) }))
          .filter(({ data }) => (Array.isArray(data.members) ? data.members.includes(uid) : session.founder));
        setChatDocs(docs);
      },
      (err) =>
        setError(
          err.code === "permission-denied"
            ? "Sin permiso para leer las conversaciones. ¿Publicaste las reglas nuevas de Firestore con los UID?"
            : "No se pudieron cargar las conversaciones. Revisa tu conexión."
        )
    );
  }, [uid, session.founder]);

  const newChatIds = useMemo(
    () => (chatDocs ?? []).filter((c) => Array.isArray(c.data.members)).map((c) => c.id).sort(),
    [chatDocs]
  );

  // ---------- Llaves de las conversaciones ----------
  const [keyDocs, setKeyDocs] = useState<Map<string, Map<string, KeyDoc>>>(new Map());
  useKeyedListeners(
    newChatIds,
    (chatId) =>
      onSnapshot(
        collection(getFirebase().db, "chats", chatId, "keys"),
        (snap) => {
          const m = new Map<string, KeyDoc>();
          for (const d of snap.docs) {
            const k = parseKeyDoc(d.data());
            if (k) m.set(d.id, k);
          }
          setKeyDocs((prev) => new Map(prev).set(chatId, m));
        },
        () => undefined
      ),
    (chatId) =>
      setKeyDocs((prev) => {
        const next = new Map(prev);
        next.delete(chatId);
        return next;
      })
  );

  const chatKeys = useRef(new Map<string, ChatKey>());
  const [keysVersion, setKeysVersion] = useState(0);
  const keyAttempts = useRef(new Set<string>());

  const rememberChatKey = useCallback((chatId: string, raw: Uint8Array, key: CryptoKey) => {
    chatKeys.current.set(chatId, { raw, key, sig: "" });
    setKeysVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!chatDocs) return;
    let cancelled = false;
    const { db } = getFirebase();
    const me = { uid, pub: session.identity.pub, fp: session.identity.fp };
    void (async () => {
      let changed = false;
      for (const [chatId, docs] of keyDocs) {
        // 1) Abrir la mía.
        const mine = docs.get(uid);
        const have = chatKeys.current.get(chatId);
        if (mine && mine.fp === me.fp) {
          const sig = `${mine.from}:${mine.iv}`;
          if (!have || have.sig !== sig) {
            const from = mine.from === uid ? me : profiles.get(mine.from);
            if (from && (mine.from === uid || (from as Profile).valid)) {
              try {
                const raw = await unwrapChatKey(session, chatId, mine, from.pub);
                if (!have || !sameBytes(have.raw, raw)) {
                  chatKeys.current.set(chatId, { raw, key: await importAesKey(raw), sig });
                  changed = true;
                } else {
                  have.sig = sig;
                }
                // Me la quedo cifrada por mí mismo: así no dependo de que
                // quien me la dio conserve su llave.
                const att = `self:${chatId}:${mine.iv}`;
                if (mine.from !== uid && !keyAttempts.current.has(att)) {
                  keyAttempts.current.add(att);
                  void wrapChatKey(session, chatId, raw, me)
                    .then((data) => setDoc(doc(db, "chats", chatId, "keys", uid), data))
                    .catch(() => undefined);
                }
              } catch {
                // No se pudo abrir: se reintenta cuando cambie algo.
              }
            }
          }
        }
        // 2) Entregar la llave a quien le falte.
        const current = chatKeys.current.get(chatId);
        const chat = chatDocs.find((c) => c.id === chatId);
        if (!current || !chat || !Array.isArray(chat.data.members)) continue;
        for (const m of chat.data.members as string[]) {
          if (m === uid) continue;
          const p = profiles.get(m);
          if (!p || !p.valid) continue;
          const theirs = docs.get(m);
          if (theirs && theirs.fp === p.fp) continue;
          const att = `heal:${chatId}:${m}:${p.fp}`;
          if (keyAttempts.current.has(att)) continue;
          keyAttempts.current.add(att);
          void wrapChatKey(session, chatId, current.raw, p)
            .then((data) => setDoc(doc(db, "chats", chatId, "keys", m), data))
            .catch(() => undefined);
        }
      }
      if (changed && !cancelled) setKeysVersion((v) => v + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [keyDocs, profiles, chatDocs, session, uid]);

  const keyFor = useCallback(
    (chat: Raw): CryptoKey | null =>
      Array.isArray(chat.data.members) ? chatKeys.current.get(chat.id)?.key ?? null : session.legacy,
    [session.legacy, keysVersion]
  );

  // ---------- Nombre, proyecto y último mensaje (descifrados) ----------
  const metaCache = useRef(new Map<string, ChatMeta | null>());
  const lastCache = useRef(new Map<string, LastPreview | null>());
  const [decVersion, setDecVersion] = useState(0);
  useEffect(() => {
    if (!chatDocs) return;
    let cancelled = false;
    void (async () => {
      let added = false;
      for (const c of chatDocs) {
        const key = keyFor(c);
        if (!key) continue;
        const metaKey = `${c.id}:${String(c.data.metaCt ?? "")}`;
        if (!metaCache.current.has(metaKey)) {
          let meta: ChatMeta | null = null;
          try {
            meta = await decryptChatMeta(key, c.id, { iv: String(c.data.metaIv ?? ""), ct: String(c.data.metaCt ?? "") });
          } catch {
            meta = null;
          }
          metaCache.current.set(metaKey, meta);
          added = true;
        }
        if (typeof c.data.lastCt === "string") {
          const lastKey = `${c.id}:${c.data.lastCt}`;
          if (!lastCache.current.has(lastKey)) {
            lastCache.current.set(
              lastKey,
              await decryptLast(key, c.id, { iv: String(c.data.lastIv ?? ""), ct: c.data.lastCt })
            );
            added = true;
          }
        }
      }
      if (added && !cancelled) setDecVersion((v) => v + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [chatDocs, keyFor]);

  const founders = useMemo(() => {
    const list = [...profiles.values()].filter((p) => p.founder && p.valid).map((p) => p.uid);
    if (session.founder && !list.includes(uid)) list.push(uid);
    return list;
  }, [profiles, session.founder, uid]);

  const nameOf = useCallback(
    (id: string) => {
      const p = profiles.get(id);
      return p && p.valid ? p.name : "Miembro";
    },
    [profiles]
  );

  const chats = useMemo((): ChatInfo[] => {
    void decVersion;
    return (chatDocs ?? []).map((c): ChatInfo => {
      const d = c.data;
      const legacy = !Array.isArray(d.members);
      const key = keyFor(c);
      const meta = key ? metaCache.current.get(`${c.id}:${String(d.metaCt ?? "")}`) ?? null : null;
      const last = typeof d.lastCt === "string" ? lastCache.current.get(`${c.id}:${d.lastCt}`) ?? null : null;
      const members = legacy ? founders : (d.members as unknown[]).filter((m): m is string => typeof m === "string");
      const rawName = meta ? meta.name : "";
      return {
        id: c.id,
        rawName,
        name: meta ? displayName(rawName, members, uid, nameOf) : key ? "Conversación sin descifrar" : "Esperando la llave…",
        group: meta ? meta.group : "Otros",
        archived: d.archived === true,
        createdAt: toDate(d.createdAt),
        lastMessageAt: toDate(d.lastMessageAt),
        lastMessageBy: typeof d.lastMessageBy === "string" ? d.lastMessageBy : "",
        members,
        legacy,
        count: typeof d.count === "number" ? d.count : 0,
        last,
        metaOk: meta !== null,
        key,
      };
    });
  }, [chatDocs, decVersion, keyFor, founders, uid, nameOf]);

  // ---------- Pendientes abiertos ----------
  const [legacyTaskDocs, setLegacyTaskDocs] = useState<Raw[]>([]);
  useEffect(() => {
    if (!session.founder || !session.legacy) return;
    const { db } = getFirebase();
    return onSnapshot(
      query(collection(db, "tasks"), where("done", "==", false)),
      (snap) => setLegacyTaskDocs(snap.docs.map((d) => ({ id: d.id, data: d.data({ serverTimestamps: "estimate" }) }))),
      () => undefined
    );
  }, [session.founder, session.legacy]);

  const [chatTaskDocs, setChatTaskDocs] = useState<Map<string, Raw[]>>(new Map());
  useKeyedListeners(
    newChatIds,
    (chatId) =>
      onSnapshot(
        query(collection(getFirebase().db, "chats", chatId, "tasks"), where("done", "==", false)),
        (snap) =>
          setChatTaskDocs((prev) =>
            new Map(prev).set(
              chatId,
              snap.docs.map((d) => ({ id: d.id, data: d.data({ serverTimestamps: "estimate" }) }))
            )
          ),
        () => undefined
      ),
    (chatId) =>
      setChatTaskDocs((prev) => {
        const next = new Map(prev);
        next.delete(chatId);
        return next;
      })
  );

  const [openTasks, setOpenTasks] = useState<Task[]>([]);
  const taskCache = useRef(new Map<string, Task>());
  useEffect(() => {
    let cancelled = false;
    const visible = new Set(chats.map((c) => c.id));
    const jobs: Promise<Task | null>[] = [];
    const add = (raw: Raw, key: CryptoKey | null) => {
      jobs.push(
        (async () => {
          if (!key) return null;
          const ck = `${raw.id}:${String(raw.data.ct)}:${String(raw.data.done)}`;
          const cached = taskCache.current.get(ck);
          if (cached) return cached;
          const t = await decryptTask(key, raw.id, raw.data);
          taskCache.current.set(ck, t);
          return t;
        })()
      );
    };
    for (const t of legacyTaskDocs) add(t, session.legacy);
    for (const [chatId, list] of chatTaskDocs) {
      const key = chatKeys.current.get(chatId)?.key ?? null;
      for (const t of list) add(t, key);
    }
    void Promise.all(jobs).then((list) => {
      if (cancelled) return;
      const tasks = list.filter((t): t is Task => t !== null && visible.has(t.chatId));
      tasks.sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
      setOpenTasks(tasks);
    });
    return () => {
      cancelled = true;
    };
  }, [legacyTaskDocs, chatTaskDocs, keysVersion, session.legacy, chats]);

  // ---------- Leídos ----------
  const unreadOf = useCallback(
    (chat: ChatInfo) => {
      if (!chat.lastMessageAt || chat.lastMessageBy === uid) return 0;
      if (chat.count > 0) return Math.max(0, chat.count - (myReadCount[chat.id] ?? 0));
      if (!chat.legacy) return 0;
      const read = myLastRead[chat.id];
      return !read || chat.lastMessageAt > read ? 1 : 0;
    },
    [uid, myReadCount, myLastRead]
  );

  const mentionedIn = useCallback(
    (chat: ChatInfo) => unreadOf(chat) > 0 && !!chat.last && chat.last.by !== uid && chat.last.m.includes(uid),
    [unreadOf, uid]
  );

  const lastMarked = useRef(new Map<string, string>());
  const markRead = useCallback(
    (chat: ChatInfo) => {
      const marker = `${chat.count}:${chat.lastMessageAt?.getTime() ?? 0}`;
      const read = myLastRead[chat.id];
      const upToDate =
        (myReadCount[chat.id] ?? 0) === chat.count && !!read && (!chat.lastMessageAt || read >= chat.lastMessageAt);
      if (upToDate || lastMarked.current.get(chat.id) === marker) return;
      lastMarked.current.set(chat.id, marker);
      void setDoc(
        doc(getFirebase().db, "users", uid),
        { lastRead: { [chat.id]: serverTimestamp() }, readCount: { [chat.id]: chat.count } },
        { merge: true }
      ).catch(() => lastMarked.current.delete(chat.id));
    },
    [uid, myLastRead, myReadCount]
  );

  const togglePin = useCallback(
    (chatId: string) => {
      const next = pinned.includes(chatId) ? pinned.filter((p) => p !== chatId) : [chatId, ...pinned].slice(0, 20);
      setPinned(next);
      void setDoc(doc(getFirebase().db, "prefs", uid), { pinned: next, updatedAt: serverTimestamp() }).catch(
        () => undefined
      );
    },
    [pinned, uid]
  );

  const toggleMute = useCallback(
    (chatId: string) => {
      const next = muted.includes(chatId) ? muted.filter((m) => m !== chatId) : [...muted, chatId].slice(-200);
      setMutedState(next);
      void setMuted(getFirebase().db, uid, next).catch(() => undefined);
    },
    [muted, uid]
  );

  const chatRaw = useCallback((chatId: string) => chatKeys.current.get(chatId)?.raw ?? null, []);

  const pending = useMemo(
    () => [...profiles.values()].filter((p) => !p.valid && p.uid !== uid && wrapFps.get(p.uid) !== p.fp),
    [profiles, wrapFps, uid]
  );

  const mutedSet = useMemo(() => new Set(muted), [muted]);

  return {
    error,
    loading: !chatDocs || !userDocs,
    profiles,
    avatars,
    me: profiles.get(uid) ?? null,
    founders,
    pending,
    chats,
    pinned,
    muted: mutedSet,
    openTasks,
    nameOf,
    unreadOf,
    mentionedIn,
    markRead,
    togglePin,
    toggleMute,
    chatRaw,
    rememberChatKey,
  };
}
