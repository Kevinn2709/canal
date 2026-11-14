/**
 * useWorkspace.ts — Todo lo que la lista de chats necesita, en vivo.
 *
 * - Personas con su perfil descifrado y su foto. Un fundador las ve a todas
 *   (users/ y avatars/). Un miembro solo puede leer su propio users/; a los
 *   demás los conoce por la copia que cada chat guarda de sus miembros
 *   (chats/{id}/people y chats/{id}/avatars), así que solo ve a quienes
 *   comparten un chat con él. Esas copias las mantiene al día cada quien para
 *   sí mismo y los fundadores para todos los miembros de sus chats; las
 *   reglas solo aceptan copias idénticas al original.
 * - Conversaciones donde estás (las de antes, si eres fundador), con su
 *   nombre, proyecto y último mensaje descifrados.
 * - Llaves de cada conversación (chats/{id}/keys): abre la tuya y, si a otro
 *   miembro le falta la suya (recién agregado, o cambió su frase), se la
 *   entrega cifrada. Así nadie se queda sin poder leer.
 * - No leídos (por número de mensajes), menciones, fijados, silenciados y
 *   pendientes abiertos de todas las conversaciones.
 * - "En línea": con la web a la vista, cada quien marca chats/{id}/presence
 *   cada 90 s en todos sus chats. Solo lo ven quienes comparten un chat
 *   contigo. Se puede apagar en Configuración.
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
  writeBatch,
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
import { loadSettings, onSettingsChange, setMuted } from "@/lib/push";
import type { Session } from "@/lib/session";

type Raw = { id: string; data: DocumentData };

const HEARTBEAT_MS = 90_000; // cada cuánto se renueva "en línea"
const ONLINE_MS = 200_000; // sin renovarse en este tiempo, ya no está en línea

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
export function useKeyedListeners(ids: string[], subscribe: (id: string) => Unsubscribe, onRemove: (id: string) => void) {
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

/** Un documento por persona en cada chat (copias de perfil, foto y leídos). */
type PerChat = Map<string, Map<string, DocumentData>>;

function setPerChat(chatId: string, docs: { id: string; data: () => DocumentData }[]) {
  return (prev: PerChat): PerChat => {
    const m = new Map<string, DocumentData>();
    for (const d of docs) m.set(d.id, d.data());
    return new Map(prev).set(chatId, m);
  };
}

function dropPerChat(chatId: string) {
  return (prev: PerChat): PerChat => {
    const next = new Map(prev);
    next.delete(chatId);
    return next;
  };
}

interface ChatKey {
  raw: Uint8Array;
  key: CryptoKey;
  sig: string;
}

export interface Workspace {
  error: string | null;
  loading: boolean;
  admin: boolean; // fundador: crea chats, aprueba y ve a todos
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
  isOnline: (uid: string) => boolean;
  togglePin: (chatId: string) => void;
  toggleMute: (chatId: string) => void;
  chatRaw: (chatId: string) => Uint8Array | null;
  rememberChatKey: (chatId: string, raw: Uint8Array, key: CryptoKey) => void;
}

export function useWorkspace(session: Session): Workspace {
  const uid = session.uid;
  const ws = session.ws as CryptoKey;
  const [error, setError] = useState<string | null>(null);

  // ---------- Personas ----------
  const admin = session.admin;
  const [usersRaw, setUsersRaw] = useState<Raw[] | null>(null); // solo fundadores
  const [ownUser, setOwnUser] = useState<DocumentData | null | undefined>(undefined);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const profileCache = useRef(new Map<string, { fp: string; prof: { name: string; photo: number } | null }>());

  useEffect(() => {
    const { db } = getFirebase();
    return onSnapshot(
      doc(db, "users", uid),
      (snap) => setOwnUser(snap.exists() ? snap.data({ serverTimestamps: "estimate" }) ?? {} : null),
      (err) =>
        setError(
          err.code === "permission-denied"
            ? "Sin permiso para leer tu cuenta. ¿Publicaste las reglas nuevas de Firestore con los UID?"
            : "No se pudo conectar. Revisa tu internet."
        )
    );
  }, [uid]);

  useEffect(() => {
    if (!admin) return;
    const { db } = getFirebase();
    return onSnapshot(
      collection(db, "users"),
      (snap) => setUsersRaw(snap.docs.map((d) => ({ id: d.id, data: d.data({ serverTimestamps: "estimate" }) }))),
      (err) =>
        setError(
          err.code === "permission-denied"
            ? "Sin permiso para leer los miembros. ¿Publicaste las reglas nuevas de Firestore con los UID?"
            : "No se pudo conectar. Revisa tu internet."
        )
    );
  }, [admin]);


  const myLastRead = useMemo(() => dateMap(ownUser?.lastRead), [ownUser]);
  const myReadCount = useMemo(() => numberMap(ownUser?.readCount), [ownUser]);

  // ---------- Fotos ----------
  const [avatarsRaw, setAvatarsRaw] = useState<Map<string, DocumentData> | null>(null); // solo fundadores
  const [ownAvatar, setOwnAvatar] = useState<DocumentData | null>(null);
  useEffect(() => {
    const { db } = getFirebase();
    return onSnapshot(
      doc(db, "avatars", uid),
      (snap) => setOwnAvatar(snap.exists() ? snap.data() ?? null : null),
      () => undefined
    );
  }, [uid]);
  useEffect(() => {
    if (!admin) return;
    const { db } = getFirebase();
    return onSnapshot(
      collection(db, "avatars"),
      (snap) => setAvatarsRaw(new Map(snap.docs.map((d) => [d.id, d.data()]))),
      () => undefined
    );
  }, [admin]);

  // ---------- Aprobaciones entregadas (wraps/, solo fundadores) ----------
  const [wrapInfo, setWrapInfo] = useState<Map<string, { fp: string; spub: boolean }>>(new Map());
  useEffect(() => {
    if (!admin) return;
    const { db } = getFirebase();
    return onSnapshot(
      collection(db, "wraps"),
      (snap) => {
        const m = new Map<string, { fp: string; spub: boolean }>();
        for (const d of snap.docs) {
          const data = d.data();
          if (typeof data.fp === "string") m.set(d.id, { fp: data.fp, spub: typeof data.spub === "string" });
        }
        setWrapInfo(m);
      },
      () => undefined
    );
  }, [admin]);

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
  const allChatIds = useMemo(() => (chatDocs ?? []).map((c) => c.id).sort(), [chatDocs]);
  const allChatsKey = allChatIds.join(",");

  // ---------- En línea ----------
  const [presence, setPresence] = useState<PerChat>(new Map());
  useKeyedListeners(
    allChatIds,
    (chatId) =>
      onSnapshot(
        collection(getFirebase().db, "chats", chatId, "presence"),
        (snap) =>
          setPresence(setPerChat(chatId, snap.docs.map((d) => ({ id: d.id, data: () => d.data({ serverTimestamps: "estimate" }) })))),
        () => undefined
      ),
    (chatId) => setPresence(dropPerChat(chatId))
  );

  // Mientras la web está a la vista, "en línea" en todos tus chats.
  useEffect(() => {
    if (!allChatsKey) return;
    const ids = allChatsKey.split(",");
    const { db } = getFirebase();
    let show = loadSettings().showOnline;
    let lastOn: boolean | null = null;
    let timer: number | undefined;
    const write = (on: boolean) => {
      lastOn = on;
      // De 10 en 10: las reglas revisan cada chat y tienen un límite por escritura.
      for (let i = 0; i < ids.length; i += 10) {
        const batch = writeBatch(db);
        for (const id of ids.slice(i, i + 10)) batch.set(doc(db, "chats", id, "presence", uid), { on, at: serverTimestamp() });
        void batch.commit().catch(() => undefined);
      }
    };
    const update = () => {
      window.clearInterval(timer);
      if (show && document.visibilityState === "visible") {
        write(true);
        timer = window.setInterval(() => write(true), HEARTBEAT_MS);
      } else if (lastOn !== false) {
        write(false);
      }
    };
    const leave = () => {
      window.clearInterval(timer);
      if (lastOn) write(false);
    };
    update();
    document.addEventListener("visibilitychange", update);
    window.addEventListener("pagehide", leave);
    const stop = onSettingsChange((s) => {
      if (s.showOnline !== show) {
        show = s.showOnline;
        update();
      }
    });
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("pagehide", leave);
      stop();
      leave();
    };
  }, [allChatsKey, uid]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const online = useMemo(() => {
    const set = new Set<string>();
    for (const docs of presence.values()) {
      for (const [m, d] of docs) {
        if (m === uid || d.on !== true) continue;
        const at = toDate(d.at);
        if (at && now - at.getTime() < ONLINE_MS) set.add(m);
      }
    }
    return set;
  }, [presence, now, uid]);
  const isOnline = useCallback((id: string) => online.has(id), [online]);

  // ---------- Copias por chat: perfiles, fotos y hasta dónde leyó cada quien ----------
  const [mirrors, setMirrors] = useState<PerChat>(new Map());
  const [mirrorPics, setMirrorPics] = useState<PerChat>(new Map());
  const [reads, setReads] = useState<PerChat>(new Map());
  useKeyedListeners(
    newChatIds,
    (chatId) =>
      onSnapshot(
        collection(getFirebase().db, "chats", chatId, "people"),
        (snap) => setMirrors(setPerChat(chatId, snap.docs)),
        () => undefined
      ),
    (chatId) => setMirrors(dropPerChat(chatId))
  );
  useKeyedListeners(
    newChatIds,
    (chatId) =>
      onSnapshot(
        collection(getFirebase().db, "chats", chatId, "avatars"),
        (snap) => setMirrorPics(setPerChat(chatId, snap.docs)),
        () => undefined
      ),
    (chatId) => setMirrorPics(dropPerChat(chatId))
  );
  useKeyedListeners(
    newChatIds,
    (chatId) =>
      onSnapshot(
        collection(getFirebase().db, "chats", chatId, "reads"),
        (snap) => setReads(setPerChat(chatId, snap.docs.map((d) => ({ id: d.id, data: () => d.data({ serverTimestamps: "estimate" }) })))),
        () => undefined
      ),
    (chatId) => setReads(dropPerChat(chatId))
  );

  // Fundador: el directorio completo. Miembro: él mismo + las copias de sus chats.
  const userDocs = useMemo((): Raw[] | null => {
    if (admin) return usersRaw;
    if (ownUser === undefined) return null;
    const merged = new Map<string, DocumentData>();
    merged.set(uid, ownUser ?? {});
    for (const people of mirrors.values()) {
      for (const [m, d] of people) {
        if (merged.has(m)) continue;
        merged.set(m, { pub: d.pub, profIv: d.profIv, profCt: d.profCt, lastRead: {}, readCount: {} });
      }
    }
    for (const [chatId, rs] of reads) {
      for (const [m, r] of rs) {
        const d = merged.get(m);
        if (!d || m === uid) continue;
        if (r.at) (d.lastRead as Record<string, unknown>)[chatId] = r.at;
        if (typeof r.n === "number") (d.readCount as Record<string, unknown>)[chatId] = r.n;
      }
    }
    return [...merged].map(([id, data]) => ({ id, data }));
  }, [admin, usersRaw, ownUser, mirrors, reads, uid]);

  const avatarDocs = useMemo((): Map<string, DocumentData> => {
    if (admin && avatarsRaw) return avatarsRaw;
    const m = new Map<string, DocumentData>();
    for (const pics of mirrorPics.values()) for (const [id, d] of pics) if (!m.has(id)) m.set(id, d);
    if (ownAvatar) m.set(uid, ownAvatar);
    return m;
  }, [admin, avatarsRaw, mirrorPics, ownAvatar, uid]);

  const [avatars, setAvatars] = useState<Map<string, string>>(new Map());
  const avatarCache = useRef(new Map<string, string>()); // uid:iv -> url
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      [...avatarDocs].map(async ([id, data]): Promise<[string, string] | null> => {
        if (typeof data.iv !== "string" || !data.data) return null;
        const ck = `${id}:${data.iv}`;
        let url = avatarCache.current.get(ck);
        if (!url) {
          const blob = await decryptAvatar(ws, id, data.iv, data.data);
          if (!blob) return null;
          url = URL.createObjectURL(blob);
          avatarCache.current.set(ck, url);
        }
        return [id, url];
      })
    ).then((list) => {
      if (!cancelled) setAvatars(new Map(list.filter((x): x is [string, string] => x !== null)));
    });
    return () => {
      cancelled = true;
    };
  }, [avatarDocs, ws]);

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

  // Mantener las copias al día: cada quien la suya; un fundador, la de todos
  // los miembros de sus chats (así un miembro ve a los demás de ese chat).
  const mirrorAttempts = useRef(new Set<string>());
  useEffect(() => {
    if (!chatDocs) return;
    const { db } = getFirebase();
    const usersById = new Map((usersRaw ?? []).map((u) => [u.id, u.data]));
    for (const c of chatDocs) {
      if (!Array.isArray(c.data.members) || !c.data.members.includes(uid)) continue;
      const people = mirrors.get(c.id);
      const pics = mirrorPics.get(c.id);
      if (!people || !pics) continue; // aún no cargan
      const targets = admin ? (c.data.members as unknown[]).filter((x): x is string => typeof x === "string") : [uid];
      for (const m of targets) {
        const src = m === uid ? ownUser : usersById.get(m);
        if (src && typeof src.pub === "string" && typeof src.profIv === "string" && typeof src.profCt === "string") {
          const cur = people.get(m);
          if (!cur || cur.pub !== src.pub || cur.profIv !== src.profIv || cur.profCt !== src.profCt) {
            const att = `p:${c.id}:${m}:${src.profIv}:${src.pub.slice(-16)}`;
            if (!mirrorAttempts.current.has(att)) {
              mirrorAttempts.current.add(att);
              void setDoc(doc(db, "chats", c.id, "people", m), { pub: src.pub, profIv: src.profIv, profCt: src.profCt }).catch(
                () => mirrorAttempts.current.delete(att)
              );
            }
          }
        }
        const pic = m === uid ? ownAvatar : avatarsRaw?.get(m);
        if (pic && typeof pic.iv === "string" && pic.data) {
          const cur = pics.get(m);
          if (!cur || cur.iv !== pic.iv) {
            const att = `a:${c.id}:${m}:${pic.iv}`;
            if (!mirrorAttempts.current.has(att)) {
              mirrorAttempts.current.add(att);
              void setDoc(doc(db, "chats", c.id, "avatars", m), { iv: pic.iv, data: pic.data }).catch(() =>
                mirrorAttempts.current.delete(att)
              );
            }
          }
        }
      }
    }
  }, [chatDocs, mirrors, mirrorPics, ownUser, ownAvatar, usersRaw, avatarsRaw, admin, uid]);

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
      const read = myLastRead[chat.id];
      const upToDate =
        (myReadCount[chat.id] ?? 0) === chat.count && !!read && (!chat.lastMessageAt || read >= chat.lastMessageAt);
      // En los chats nuevos, los demás miembros ven tu "leído" en chats/{id}/reads.
      const mine = reads.get(chat.id)?.get(uid);
      const sharedOk = chat.legacy || !reads.has(chat.id) || (mine?.n === chat.count && !!mine?.at);
      const marker = `${chat.count}:${chat.lastMessageAt?.getTime() ?? 0}:${upToDate ? 1 : 0}${sharedOk ? 1 : 0}`;
      if ((upToDate && sharedOk) || lastMarked.current.get(chat.id) === marker) return;
      lastMarked.current.set(chat.id, marker);
      const { db } = getFirebase();
      const fail = () => lastMarked.current.delete(chat.id);
      if (!upToDate) {
        void setDoc(
          doc(db, "users", uid),
          { lastRead: { [chat.id]: serverTimestamp() }, readCount: { [chat.id]: chat.count } },
          { merge: true }
        ).catch(fail);
      }
      if (!chat.legacy && (!upToDate || !sharedOk)) {
        void setDoc(doc(db, "chats", chat.id, "reads", uid), { n: chat.count, at: serverTimestamp() }).catch(fail);
      }
    },
    [uid, myLastRead, myReadCount, reads]
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

  // Cuentas que esperan aprobación (solo las ve un fundador). Una aprobación
  // antigua, sin la llave de quien aprobó, se vuelve a pedir: un miembro ya
  // no puede buscar esa llave en users/.
  const pending = useMemo(() => {
    if (!admin) return [];
    return [...profiles.values()].filter((p) => {
      if (p.valid || p.uid === uid) return false;
      const w = wrapInfo.get(p.uid);
      return !w || w.fp !== p.fp || !w.spub;
    });
  }, [profiles, wrapInfo, uid, admin]);

  const mutedSet = useMemo(() => new Set(muted), [muted]);

  return {
    error,
    loading: !chatDocs || !userDocs,
    admin,
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
    isOnline,
    togglePin,
    toggleMute,
    chatRaw,
    rememberChatKey,
  };
}
