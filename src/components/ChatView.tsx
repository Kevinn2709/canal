"use client";

/**
 * ChatView.tsx — Una conversación.
 *
 * - Mensajes en vivo, descifrados en el dispositivo con la llave del chat.
 * - Texto, fotos, archivos, notas de voz y stickers; responder citando,
 *   reaccionar y mencionar (@nombre); "Escribiendo…", "Grabando audio…" y
 *   "Enviando archivo…" con quién.
 * - Palomitas: reloj al enviar, una al guardarse en el servidor, dos (azules)
 *   hasta el último mensaje que el otro vio (marca de agua: lastReadMessageId).
 *   Los mensajes posteriores siguen con una hasta que vuelva a enfocar el chat.
 * - Texto oculto y fotos/videos de una vista.
 * - Gestos: deslizar hacia abajo en los mensajes cierra el teclado; deslizar
 *   un mensaje a la derecha lo responde; doble toque reacciona con 👍.
 * - Al enviar: se actualiza la vista previa cifrada de la lista, el contador
 *   de no leídos y se avisa (push) a los demás miembros.
 * - Pendientes, destacados e información del chat en paneles laterales.
 * - Destacar (cualquiera), eliminar para todos (quien lo envió o un
 *   fundador) y vaciar el chat menos los destacados (solo fundadores).
 * - En chats de dos: "En línea" / "Desconectado" y botones de llamada y
 *   videollamada.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";
import type { User } from "firebase/auth";
import {
  collection,
  doc,
  increment,
  limitToLast,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
  type Firestore,
  type Timestamp,
} from "firebase/firestore";
import { getFirebase, getRtdb } from "@/lib/firebase";
import { decryptText, encryptText } from "@/lib/crypto";
import {
  canViewOnce,
  encryptLast,
  setChatArchived,
  mentionsOf,
  messageAadFor,
  messagesCollection,
  parsePayload,
  previewOf,
  type ChatInfo,
  type FileInfo,
  type Payload,
  type ReplyRef,
} from "@/lib/chats";
import {
  MAX_FILE_SIZE,
  chatFileStore,
  libraryFileStore,
  prepareFile,
  uploadFile,
  type FileStore,
  type PreparedFile,
} from "@/lib/files";
import { REACTION_EMOJIS, setReaction, type Reaction } from "@/lib/reactions";
import { clearChat, deleteFileChunks, deleteMessage, setStar, type StoredMessage } from "@/lib/messages";
import { markOpened, wasOpenedHere } from "@/lib/viewonce";
import { createTask, MAX_TASK_LENGTH, type Task } from "@/lib/tasks";
import { notifyChat } from "@/lib/push";
import { dayKey, dayLabel, formatTime } from "@/lib/format";
import type { Session } from "@/lib/session";
import { useReactions } from "@/hooks/useReactions";
import { activityLabel, useActivity, type Activity } from "@/hooks/useActivity";
import type { Workspace } from "@/hooks/useWorkspace";
import { extensionFor, type Recording } from "@/hooks/useVoiceRecorder";
import { Lightbox } from "./Attachments";
import { ChatAvatar } from "./Avatar";
import { ChatInfoPanel } from "./ChatInfoPanel";
import { Composer, MAX_LENGTH, type PendingAttachment, type SendOptions } from "./Composer";
import { MessageActions } from "./MessageActions";
import { MessageItem, type ChatMessage, type Tick } from "./MessageItem";
import { ViewOnceViewer } from "./ViewOnce";
import { TasksPanel } from "./Tasks";
import { StarredPanel } from "./StarredPanel";
import { BackIcon, BellOffIcon, FileIcon, MicIcon, MoreIcon, PhoneIcon, TasksIcon, VideoIcon } from "./Icons";

interface Decrypted {
  payload: Payload | null;
  state: "ok" | "failed";
}

interface Upload {
  localId: string;
  name: string;
  previewUrl: string | null;
  voice: boolean;
  progress: number;
  error: string | null;
}

const PAGE_SIZE = 200;
/** Lista vacía compartida (misma identidad: no rompe el React.memo de los mensajes). */
const NO_REACTIONS: Reaction[] = [];
const MAX_ATTACHMENTS = 10;

function errorMessage(err: unknown): string {
  return (err as { code?: string }).code === "permission-denied"
    ? "Tu cuenta no tiene permiso para esto. Revisa las reglas de Firestore."
    : "No se pudo enviar. Revisa tu conexión.";
}

interface ViewProps {
  chat: ChatInfo;
  user: User;
  session: Session;
  ws: Workspace;
  openTasks: Task[];
  keepKeyboard: boolean;
  onCall: ((video: boolean) => void) | null; // null: no se puede llamar en este chat
  onBack: () => void;
  onEdit: () => void;
  onLeft: () => void;
}

/** "@Nombre" que aparecen en el texto -> uids mencionados. */
function findMentions(text: string, members: string[], myUid: string, nameOf: (uid: string) => string): string[] {
  const lower = text.toLowerCase();
  return members.filter((m) => {
    if (m === myUid) return false;
    const name = nameOf(m);
    return name !== "Miembro" && lower.includes(`@${name.toLowerCase()}`);
  });
}

export function ChatView(props: ViewProps) {
  const { chat } = props;
  if (!chat.key) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-neutral-900 px-2 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] md:px-4">
          <button onClick={props.onBack} className="rounded-full p-2 text-neutral-300 hover:bg-neutral-900 md:hidden" aria-label="Volver a la lista">
            <BackIcon />
          </button>
          <p className="truncate text-[15px] font-medium">{chat.name}</p>
        </header>
        <div className="flex flex-1 items-center justify-center px-8 text-center text-sm text-neutral-500">
          {chat.legacy
            ? "Esta conversación es de antes. Para leerla, escribe la frase compartida de antes en Configuración → Seguridad."
            : "Esperando la llave de este chat. Otro miembro te la entregará en cuanto abra la web."}
        </div>
      </div>
    );
  }
  return <ChatRoom {...props} cryptoKey={chat.key} />;
}

function ChatRoom({
  chat,
  user,
  session,
  ws,
  cryptoKey,
  openTasks,
  keepKeyboard,
  onCall,
  onBack,
  onEdit,
  onLeft,
}: ViewProps & { cryptoKey: CryptoKey }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [viewer, setViewer] = useState<{ file: FileInfo; url: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [replyTo, setReplyTo] = useState<ReplyRef | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const [actionFor, setActionFor] = useState<ChatMessage | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [panel, setPanel] = useState<"tasks" | "info" | "starred" | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState<string | null>(null);
  const [onceViewer, setOnceViewer] = useState<ChatMessage | null>(null);
  const [opened, setOpened] = useState<Map<string, Set<string>>>(new Map()); // mensaje -> quiénes lo abrieron

  const reactions = useReactions(chat.id, cryptoKey);
  // Con RTDB (y la copia de miembros lista), "escribiendo…" va por ahí; si no, por Firestore.
  const rtdb = ws.rtdbChats.has(chat.id) ? getRtdb() : null;
  const { active, setActivity } = useActivity(chat.id, user.uid, rtdb);
  const otherTyping = active.length > 0;
  // Memorizados: los mensajes (React.memo) los comparan por identidad.
  const fileStore: FileStore = useMemo(
    () => chatFileStore({ id: chat.id, legacy: chat.legacy }, cryptoKey),
    [chat.id, chat.legacy, cryptoKey]
  );
  const libKey = session.ws;
  const libStore: FileStore | null = useMemo(() => (libKey ? libraryFileStore(libKey) : null), [libKey]);
  const group = chat.members.length > 2;
  const muted = ws.muted.has(chat.id);

  const listRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const heightBeforeLoadMore = useRef<number | null>(null);
  const prevCount = useRef(0);
  const plainCache = useRef(new Map<string, Decrypted>());
  const snapshotSeq = useRef(0);
  const noticeTimer = useRef<number | null>(null);

  const showNotice = (text: string) => {
    setNotice(text);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2500);
  };

  // ---------- Mensajes en tiempo real (los últimos `limit`) ----------
  useEffect(() => {
    const { db } = getFirebase();
    const q = query(messagesCollection(db, chat.id), orderBy("createdAt", "asc"), limitToLast(limit));
    return onSnapshot(
      q,
      { includeMetadataChanges: true }, // para pasar de "enviando…" a "enviado"
      (snap) => {
        setError(null);
        setHasMore(snap.size >= limit);
        const seq = ++snapshotSeq.current;

        const list = snap.docs.map(async (d): Promise<ChatMessage> => {
          const data = d.data({ serverTimestamps: "estimate" });
          const ts = data.createdAt as Timestamp | null | undefined;
          const uid = typeof data.uid === "string" ? data.uid : "";
          const base = {
            id: d.id,
            uid,
            createdAt: ts ? ts.toDate() : null,
            pending: d.metadata.hasPendingWrites,
            starred: data.star === true,
          };

          if (typeof data.ct === "string" && typeof data.iv === "string") {
            let plain = plainCache.current.get(d.id);
            if (!plain) {
              try {
                const text = await decryptText(cryptoKey, { iv: data.iv, ct: data.ct }, messageAadFor(chat.id, uid));
                if (data.v === 2) {
                  const payload = parsePayload(text);
                  plain = payload ? { payload, state: "ok" } : { payload: null, state: "failed" };
                } else {
                  plain = { payload: { t: "text", text }, state: "ok" };
                }
              } catch {
                plain = { payload: null, state: "failed" };
              }
              plainCache.current.set(d.id, plain);
            }
            return { ...base, payload: plain.payload, state: plain.state };
          }
          if (typeof data.text === "string") {
            return { ...base, payload: { t: "text", text: data.text }, state: "legacy" };
          }
          return { ...base, payload: null, state: "failed" };
        });

        void Promise.all(list).then((result) => {
          if (seq !== snapshotSeq.current) return; // ya llegó una instantánea más nueva
          setMessages(result);
          setLoaded(true);
        });
      },
      (err) => {
        setLoaded(true);
        setError(
          err.code === "permission-denied"
            ? "Tu cuenta no tiene acceso a esta conversación. Revisa las reglas de Firestore."
            : "No se pudo cargar la conversación. Revisa tu conexión."
        );
      }
    );
  }, [chat.id, limit, cryptoKey]);

  // ---------- Fotos y videos de una vista: quién ya los abrió ----------
  useEffect(() => {
    const { db } = getFirebase();
    return onSnapshot(
      collection(db, "chats", chat.id, "opened"),
      (snap) => {
        const m = new Map<string, Set<string>>();
        for (const d of snap.docs) {
          const data = d.data();
          if (typeof data.msg !== "string" || typeof data.uid !== "string") continue;
          if (!m.has(data.msg)) m.set(data.msg, new Set());
          m.get(data.msg)?.add(data.uid);
        }
        setOpened(m);
      },
      () => undefined
    );
  }, [chat.id]);

  // Cuando todos los demás abrieron tu foto o video de una vista, se borran
  // sus trozos cifrados (el mensaje queda como "Abierta").
  const cleaned = useRef(new Set<string>());
  useEffect(() => {
    const others = chat.members.filter((x) => x !== user.uid);
    if (others.length === 0) return;
    for (const m of messages) {
      if (m.uid !== user.uid || m.payload?.t !== "file" || !m.payload.once || cleaned.current.has(m.id)) continue;
      const who = opened.get(m.id);
      if (!who || !others.every((o) => who.has(o))) continue;
      cleaned.current.add(m.id);
      void deleteFileChunks(getFirebase().db, chat, m.payload.file).catch(() => cleaned.current.delete(m.id));
    }
  }, [opened, messages, chat, user.uid]);

  // ---------- Marcar como leído (marca de agua) con el chat a la vista y enfocado ----------
  const { markRead } = ws;
  let lastSeenId = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!messages[i].pending) {
      lastSeenId = messages[i].id;
      break;
    }
  }
  useEffect(() => {
    if (!loaded) return;
    const maybeMark = () => {
      if (document.visibilityState === "visible" && document.hasFocus()) markRead(chat, lastSeenId || undefined);
    };
    maybeMark();
    document.addEventListener("visibilitychange", maybeMark);
    window.addEventListener("focus", maybeMark);
    return () => {
      document.removeEventListener("visibilitychange", maybeMark);
      window.removeEventListener("focus", maybeMark);
    };
  }, [loaded, chat, markRead, messages.length, lastSeenId]);

  // ---------- Scroll ----------
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const before = heightBeforeLoadMore.current;
    if (before !== null && messages.length > prevCount.current) {
      el.scrollTop += el.scrollHeight - before;
      heightBeforeLoadMore.current = null;
    } else if (nearBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevCount.current = messages.length;
  }, [messages]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [uploads.length, otherTyping, reactions]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  // Barras de vidrio: los mensajes pasan por debajo de la barra de arriba y
  // de la de escribir. El espacio que ocupan se aplica directo en el DOM (sin
  // volver a dibujar la lista) y, si estabas abajo, sigues abajo.
  useLayoutEffect(() => {
    const list = listRef.current;
    const head = headerRef.current;
    const foot = bottomRef.current;
    if (!list || !head || !foot) return;
    const apply = () => {
      const stick = nearBottom.current;
      list.style.paddingTop = `${head.offsetHeight + 12}px`;
      list.style.paddingBottom = `${foot.offsetHeight + 10}px`;
      if (stick) list.scrollTop = list.scrollHeight;
    };
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(apply);
    ro.observe(head);
    ro.observe(foot);
    return () => ro.disconnect();
  }, []);

  // Deslizar hacia abajo sobre los mensajes cierra el teclado (como en las apps).
  const touchY = useRef<number | null>(null);
  const onListTouchStart = (e: ReactTouchEvent<HTMLDivElement>) => {
    touchY.current = e.touches[0]?.clientY ?? null;
  };
  const onListTouchMove = (e: ReactTouchEvent<HTMLDivElement>) => {
    const start = touchY.current;
    const y = e.touches[0]?.clientY;
    if (start === null || y === undefined || y - start < 12) return;
    touchY.current = null;
    const el = document.activeElement;
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) el.blur();
  };

  const loadMore = () => {
    const el = listRef.current;
    heightBeforeLoadMore.current = el ? el.scrollHeight : null;
    nearBottom.current = false;
    setLimit((l) => l + PAGE_SIZE);
  };

  const jumpTo = useCallback((id: string) => {
    const el = document.getElementById(`m-${id}`);
    if (!el) {
      setError("Ese mensaje es anterior a los cargados. Usa “Cargar mensajes anteriores”.");
      return;
    }
    nearBottom.current = false;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setHighlight(id);
    window.setTimeout(() => setHighlight((h) => (h === id ? null : h)), 1800);
  }, []);

  // ---------- Adjuntos ----------
  const addFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setPreparing(true);
    setError(null);
    const added: PendingAttachment[] = [];
    for (const file of files.slice(0, MAX_ATTACHMENTS)) {
      try {
        const prepared = await prepareFile(file);
        added.push({
          localId: crypto.randomUUID(),
          prepared,
          previewUrl: prepared.isImage ? URL.createObjectURL(prepared.blob) : null,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo adjuntar el archivo.");
      }
    }
    setAttachments((current) => [...current, ...added].slice(0, MAX_ATTACHMENTS));
    setPreparing(false);
  };

  const removeAttachment = (localId: string) => {
    setAttachments((current) => {
      const item = current.find((a) => a.localId === localId);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return current.filter((a) => a.localId !== localId);
    });
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (Array.from(e.dataTransfer.types).includes("Files")) {
      e.preventDefault();
      setDragOver(true);
    }
  };
  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (!next || !e.currentTarget.contains(next)) setDragOver(false);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    void addFiles(Array.from(e.dataTransfer.files));
  };

  // ---------- Envío ----------

  /**
   * Cifra y envía un mensaje, actualiza la vista previa cifrada y el contador
   * del chat, y avisa a los demás. Vuelve en cuanto aparece en pantalla.
   */
  const sendPayload = async (db: Firestore, payload: Payload) => {
    const ref = doc(messagesCollection(db, chat.id));
    const sealed = await encryptText(cryptoKey, JSON.stringify(payload), messageAadFor(chat.id, user.uid));
    const mentions = mentionsOf(payload);
    const last = await encryptLast(cryptoKey, chat.id, { by: user.uid, text: previewOf(payload), m: mentions });
    plainCache.current.set(ref.id, { payload, state: "ok" });
    const batch = writeBatch(db);
    batch.set(ref, { ct: sealed.ct, iv: sealed.iv, uid: user.uid, v: 2, createdAt: serverTimestamp() });
    batch.update(doc(db, "chats", chat.id), {
      lastMessageAt: serverTimestamp(),
      lastMessageBy: user.uid,
      lastIv: last.iv,
      lastCt: last.ct,
      count: increment(1),
    });
    const committed = batch.commit().then(() => {
      notifyChat(() => user.getIdToken(), chat.id, mentions);
    });
    return { committed };
  };

  /** Sube un archivo cifrado mostrando el progreso y luego envía su mensaje. */
  const uploadAndSend = async (
    db: Firestore,
    localId: string,
    prepared: PreparedFile,
    previewUrl: string | null,
    makePayload: (info: FileInfo) => Payload,
    voice = false
  ) => {
    setUploads((u) => [...u, { localId, name: prepared.name, previewUrl, voice, progress: 0, error: null }]);
    try {
      const info = await uploadFile(db, fileStore, user.uid, prepared, (progress) =>
        setUploads((u) => u.map((x) => (x.localId === localId ? { ...x, progress } : x)))
      );
      const { committed } = await sendPayload(db, makePayload(info));
      setUploads((u) => u.filter((x) => x.localId !== localId));
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      await committed;
    } catch (err) {
      setUploads((u) => u.map((x) => (x.localId === localId ? { ...x, error: errorMessage(err) } : x)));
    }
  };

  const takeReply = (): ReplyRef | undefined => {
    const re = replyTo ?? undefined;
    setReplyTo(null);
    return re;
  };

  const onSend = async (text: string, options: SendOptions): Promise<boolean> => {
    if (text.length > MAX_LENGTH) {
      setError(`Máximo ${MAX_LENGTH} caracteres por mensaje.`);
      return false;
    }
    const files = attachments;
    const re = takeReply();
    const m = findMentions(text, chat.members, user.uid, ws.nameOf);
    setAttachments([]);
    setError(null);
    setActivity(null);
    nearBottom.current = true;
    const { db } = getFirebase();

    const sendText = async (withReply?: ReplyRef) => {
      try {
        let base: Payload = m.length ? { t: "text", text, m } : { t: "text", text };
        if (options.spoiler && base.t === "text") base = { ...base, sp: true };
        const { committed } = await sendPayload(db, withReply ? { ...base, re: withReply } : base);
        await committed;
        return true;
      } catch (err) {
        setError(errorMessage(err));
        if (withReply) setReplyTo(withReply);
        return false;
      }
    };

    if (files.length === 0) return sendText(re);

    const caption = files.length === 1 ? text : "";
    for (const [i, a] of files.entries()) {
      const reHere = i === 0 ? re : undefined;
      await uploadAndSend(db, a.localId, a.prepared, a.previewUrl, (file) => {
        let base: Payload = caption ? (m.length ? { t: "file", text: caption, file, m } : { t: "file", text: caption, file }) : { t: "file", file };
        if (options.once && base.t === "file" && canViewOnce(file)) base = { ...base, once: true };
        return reHere ? { ...base, re: reHere } : base;
      });
    }
    if (files.length > 1 && text) return sendText();
    return true;
  };

  const onSendSticker = (file: FileInfo) => {
    const re = takeReply();
    nearBottom.current = true;
    const { db } = getFirebase();
    void sendPayload(db, re ? { t: "sticker", file, lib: true, re } : { t: "sticker", file, lib: true })
      .then(({ committed }) => committed)
      .catch((err) => setError(errorMessage(err)));
  };

  const onSendVoice = (recording: Recording) => {
    if (recording.blob.size > MAX_FILE_SIZE) {
      setError("La nota de voz es demasiado larga.");
      return;
    }
    const re = takeReply();
    nearBottom.current = true;
    const prepared: PreparedFile = {
      blob: recording.blob,
      name: `nota-de-voz.${extensionFor(recording.mime)}`,
      mime: recording.mime,
      isImage: false,
    };
    const dur = Math.round(recording.seconds * 10) / 10;
    void uploadAndSend(
      getFirebase().db,
      crypto.randomUUID(),
      prepared,
      null,
      (file) => (re ? { t: "voice", file, dur, re } : { t: "voice", file, dur }),
      true
    );
  };

  // "Enviando archivo…" mientras sube algo; si no, lo que diga la caja de texto.
  const uploading = uploads.some((u) => !u.error);
  const uploadingRef = useRef(false);
  useEffect(() => {
    uploadingRef.current = uploading;
    setActivity(uploading ? "file" : null);
  }, [uploading, setActivity]);
  const onComposerActivity = useCallback(
    (k: Activity | null) => {
      if (!uploadingRef.current) setActivity(k);
    },
    [setActivity]
  );

  const dismissUpload = (localId: string) => {
    setUploads((u) => {
      const item = u.find((x) => x.localId === localId);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return u.filter((x) => x.localId !== localId);
    });
  };

  // ---------- Acciones de un mensaje ----------
  const myReaction = (msgId: string) =>
    reactions.get(msgId)?.find((r) => r.uid === user.uid)?.emoji ?? null;

  const toggleReaction = (m: ChatMessage, emoji: string) => {
    const next = myReaction(m.id) === emoji ? "" : emoji;
    void setReaction(getFirebase().db, cryptoKey, chat.id, m.id, user.uid, next).catch(() =>
      setError("No se pudo guardar la reacción.")
    );
  };

  /** Doble toque: 👍 (o la quita si ya estaba). */
  const quickReact = (m: ChatMessage) => toggleReaction(m, REACTION_EMOJIS[0]);

  const replyToMessage = (m: ChatMessage) => {
    setReplyTo({ id: m.id, uid: m.uid, preview: previewOf(m.payload) });
    setFocusSignal((n) => n + 1);
  };

  // Versiones estables de las acciones para los mensajes (React.memo): no
  // cambian de identidad en cada dibujo y siempre llaman a la más reciente.
  const latest = useRef({ toggleReaction, quickReact, replyToMessage });
  latest.current = { toggleReaction, quickReact, replyToMessage };
  const onToggleReactionStable = useCallback((m: ChatMessage, emoji: string) => latest.current.toggleReaction(m, emoji), []);
  const onQuickReactStable = useCallback((m: ChatMessage) => latest.current.quickReact(m), []);
  const onReplyStable = useCallback((m: ChatMessage) => latest.current.replyToMessage(m), []);
  const onOpenImage = useCallback((file: FileInfo, url: string) => setViewer({ file, url }), []);

  const copyMessage = (m: ChatMessage) => {
    const text =
      m.payload?.t === "text" ? m.payload.text : m.payload?.t === "file" && !m.payload.once ? m.payload.text ?? "" : "";
    if (!text) return;
    navigator.clipboard
      ?.writeText(text)
      .then(() => showNotice("Texto copiado"))
      .catch(() => setError("No se pudo copiar."));
  };

  const toggleStar = (m: ChatMessage) => {
    setStar(getFirebase().db, chat.id, m.id, !m.starred)
      .then(() => showNotice(m.starred ? "Ya no está destacado" : "Mensaje destacado"))
      .catch(() => setError("No se pudo destacar el mensaje."));
  };

  const canDelete = (m: ChatMessage) => !m.pending && (m.uid === user.uid || ws.admin);

  const removeMessage = async (m: ChatMessage) => {
    // Si era el último, la vista previa de la lista pasa al anterior.
    const i = messages.findIndex((x) => x.id === m.id);
    let newLast: StoredMessage | null | undefined;
    if (i !== -1 && i === messages.length - 1) {
      const prev = messages[i - 1];
      newLast = prev ? { id: prev.id, uid: prev.uid, createdAt: prev.createdAt, payload: prev.payload } : hasMore ? undefined : null;
    }
    try {
      await deleteMessage(getFirebase().db, chat, cryptoKey, user.uid, m, newLast);
      plainCache.current.delete(m.id);
      if (replyTo?.id === m.id) setReplyTo(null);
      showNotice("Mensaje eliminado");
    } catch (err) {
      setError(
        (err as { code?: string }).code === "permission-denied"
          ? "No tienes permiso para eliminar ese mensaje."
          : "No se pudo eliminar. Revisa tu conexión."
      );
    }
  };

  const runClear = async () => {
    setConfirmClear(false);
    setClearing("Vaciando…");
    try {
      const r = await clearChat(getFirebase().db, chat, cryptoKey, user.uid, (done, total) =>
        setClearing(`Vaciando… ${done} de ${total}`)
      );
      plainCache.current.clear();
      showNotice(
        r.deleted === 0
          ? "No había mensajes para borrar."
          : `Chat vaciado: ${r.deleted} ${r.deleted === 1 ? "mensaje borrado" : "mensajes borrados"}${
              r.kept ? `, ${r.kept} ${r.kept === 1 ? "destacado conservado" : "destacados conservados"}` : ""
            }.`
      );
    } catch {
      setError("No se pudo vaciar por completo. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setClearing(null);
    }
  };

  const taskFromMessage = (m: ChatMessage) => {
    const text =
      m.payload?.t === "text" && !m.payload.sp ? m.payload.text.slice(0, MAX_TASK_LENGTH) : previewOf(m.payload);
    createTask(getFirebase().db, cryptoKey, user.uid, chat, text, m.id)
      .then(() => showNotice("Agregado a pendientes"))
      .catch((err) => setError(errorMessage(err)));
  };

  // ---------- Render ----------
  let lastMineId: string | null = null;
  for (const m of messages) if (m.uid === user.uid) lastMineId = m.id;

  // Palomitas: hasta qué mensaje leyó cada quien (marca de agua). Si su último
  // mensaje visto no está entre los cargados, se compara por hora.
  const others = chat.members.filter((x) => x !== user.uid);
  const marks = ws.readMarks(chat.id);
  const indexById = new Map<string, number>(messages.map((m, i): [string, number] => [m.id, i]));
  const hasRead = (o: string, m: ChatMessage, i: number): boolean => {
    if (chat.legacy) {
      const at = ws.profiles.get(o)?.lastRead[chat.id];
      return !!(at && m.createdAt && at >= m.createdAt);
    }
    const mark = marks.get(o);
    if (!mark) return false;
    const li = mark.last ? indexById.get(mark.last) : undefined;
    if (li !== undefined) return i <= li;
    return !!(mark.at && m.createdAt && mark.at >= m.createdAt);
  };
  const readersOf = (m: ChatMessage, i: number) => others.filter((o) => hasRead(o, m, i));
  const tickOf = (m: ChatMessage, i: number): Tick => {
    if (m.pending) return "pending";
    if (others.length === 0) return "sent";
    return readersOf(m, i).length === others.length ? "read" : "sent";
  };
  // En grupos, debajo de tu último mensaje: quién lo vio.
  const groupSeen = (m: ChatMessage, i: number): string => {
    if (!group || m.pending) return "";
    const readers = readersOf(m, i);
    if (readers.length === 0 || readers.length === others.length) return readers.length ? "visto por todos" : "";
    return `visto por ${readers.length <= 2 ? readers.map(ws.nameOf).join(" y ") : readers.length}`;
  };

  // Fotos y videos de una vista.
  const onceState = (m: ChatMessage) => {
    if (m.payload?.t !== "file" || !m.payload.once) return null;
    const who = opened.get(m.id) ?? new Set<string>();
    return {
      opened: m.uid === user.uid ? false : who.has(user.uid) || wasOpenedHere(m.id),
      openedByAll: others.length > 0 && others.every((o) => who.has(o)),
    };
  };

  let lastDay = "";
  let prevUid = "";
  const rows = messages.map((m, i) => {
    const mine = m.uid === user.uid;
    let separator: string | null = null;
    if (m.createdAt) {
      const key = dayKey(m.createdAt);
      if (key !== lastDay) {
        separator = dayLabel(m.createdAt);
        lastDay = key;
      }
    }
    const firstOfRun = separator !== null || prevUid !== m.uid;
    prevUid = m.uid;
    const next = messages[i + 1];
    const lastOfRun =
      !next ||
      next.uid !== m.uid ||
      (!!next.createdAt && !!m.createdAt && dayKey(next.createdAt) !== dayKey(m.createdAt));
    const seen = mine && m.id === lastMineId ? groupSeen(m, i) : "";
    const footer = [m.createdAt ? formatTime(m.createdAt) : "", m.state === "legacy" ? "sin cifrar" : "", seen]
      .filter(Boolean)
      .join(" · ");
    const isSticker = m.payload?.t === "sticker";
    return (
      <MessageItem
        key={m.id}
        m={m}
        mine={mine}
        myUid={user.uid}
        ws={ws}
        group={group || !chat.members.includes(m.uid)}
        firstOfRun={firstOfRun}
        lastOfRun={lastOfRun}
        footer={footer}
        tick={mine ? tickOf(m, i) : null}
        separator={separator}
        reactions={reactions.get(m.id) ?? NO_REACTIONS}
        highlighted={highlight === m.id}
        store={isSticker && m.payload?.t === "sticker" && m.payload.lib ? libStore : fileStore}
        once={onceState(m)}
        onOpenImage={onOpenImage}
        onActions={setActionFor}
        onToggleReaction={onToggleReactionStable}
        onJump={jumpTo}
        onReply={onReplyStable}
        onQuickReact={onQuickReactStable}
        onOpenOnce={setOnceViewer}
      />
    );
  });

  const typingLabel = activityLabel(active, group, ws.nameOf);
  const other = !group ? others[0] : undefined;
  const otherOnline = !!other && ws.isOnline(other);
  const subtitle = group
    ? chat.members.map((x) => (x === user.uid ? "Tú" : ws.nameOf(x))).join(", ")
    : `${chat.group}${chat.archived ? " · archivada" : ""}`;

  return (
    <div className="flex h-full min-h-0">
      <div
        className="relative min-w-0 flex-1 overflow-hidden"
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <header
          ref={headerRef}
          className="absolute inset-x-0 top-0 z-20 isolate flex items-center gap-0.5 px-1.5 pb-2 pt-[max(0.625rem,env(safe-area-inset-top))] md:px-4"
        >
          <div className="glass glass-edge-top absolute inset-0 -z-10" aria-hidden="true" />
          <button
            onClick={onBack}
            className="flex h-10 w-9 items-center justify-center rounded-full text-sky-500 hover:bg-white/10 md:hidden"
            aria-label="Volver a la lista"
          >
            <BackIcon className="h-6 w-6" />
          </button>
          <button
            type="button"
            onClick={() => setPanel((p) => (p === "info" ? null : "info"))}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-0.5 pl-1 text-left"
            aria-label="Información del chat"
          >
            <ChatAvatar ws={ws} chat={chat} myUid={user.uid} size={36} />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[16px] font-semibold tracking-tight">{chat.name}</span>
                {muted && <BellOffIcon className="h-3.5 w-3.5 shrink-0 text-neutral-500" />}
              </span>
              <span className="block truncate text-xs text-neutral-500">
                {typingLabel ? (
                  <span className="text-sky-400">{typingLabel}</span>
                ) : other ? (
                  otherOnline ? (
                    <span className="text-emerald-400">En línea</span>
                  ) : (
                    "Desconectado"
                  )
                ) : (
                  subtitle
                )}
              </span>
            </span>
          </button>
          {onCall && (
            <>
              <button
                onClick={() => onCall(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full text-sky-500 hover:bg-white/10"
                aria-label="Llamar"
                title="Llamada cifrada"
              >
                <PhoneIcon />
              </button>
              <button
                onClick={() => onCall(true)}
                className="flex h-10 w-10 items-center justify-center rounded-full text-sky-500 hover:bg-white/10"
                aria-label="Videollamada"
                title="Videollamada cifrada"
              >
                <VideoIcon />
              </button>
            </>
          )}
          <button
            onClick={() => setPanel((p) => (p === "tasks" ? null : "tasks"))}
            className={`relative flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10 ${panel === "tasks" ? "text-sky-300" : "text-sky-500"}`}
            aria-label={`Pendientes (${openTasks.length})`}
            aria-pressed={panel === "tasks"}
          >
            <TasksIcon />
            {openTasks.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 min-w-[1.1rem] rounded-full bg-amber-500 px-1 text-center text-[10px] font-semibold leading-[1.1rem] text-neutral-950">
                {openTasks.length}
              </span>
            )}
          </button>
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex h-10 w-10 items-center justify-center rounded-full text-sky-500 hover:bg-white/10"
              aria-label="Opciones de la conversación"
            >
              <MoreIcon />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
                <div className="anim-pop-in absolute right-0 z-30 mt-1 w-60 overflow-hidden rounded-[14px] bg-neutral-800/95 py-1 text-[15px] shadow-[0_20px_50px_rgba(0,0,0,0.6)] ring-1 ring-white/10">
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setPanel("info");
                    }}
                    className="block min-h-[44px] w-full px-4 py-2.5 text-left hover:bg-white/10"
                  >
                    Información y miembros
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setPanel("starred");
                    }}
                    className="block min-h-[44px] w-full px-4 py-2.5 text-left hover:bg-white/10"
                  >
                    Mensajes destacados
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      ws.toggleMute(chat.id);
                    }}
                    className="block min-h-[44px] w-full px-4 py-2.5 text-left hover:bg-white/10"
                  >
                    {muted ? "Quitar silencio" : "Silenciar"}
                  </button>
                  {ws.admin && (
                    <>
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          onEdit();
                        }}
                        className="block min-h-[44px] w-full px-4 py-2.5 text-left hover:bg-white/10"
                      >
                        Cambiar nombre o proyecto
                      </button>
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          void setChatArchived(getFirebase().db, chat.id, !chat.archived).catch(() => undefined);
                        }}
                        className="block min-h-[44px] w-full px-4 py-2.5 text-left hover:bg-white/10"
                      >
                        {chat.archived ? "Desarchivar" : "Archivar"}
                      </button>
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          setConfirmClear(true);
                        }}
                        disabled={!!clearing}
                        className="block min-h-[44px] w-full px-4 py-2.5 text-left text-red-400 hover:bg-white/10 disabled:opacity-40"
                      >
                        Vaciar chat…
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </header>

        <div
          ref={listRef}
          onScroll={onScroll}
          onTouchStart={onListTouchStart}
          onTouchMove={onListTouchMove}
          className="absolute inset-0 overflow-y-auto overflow-x-hidden overscroll-contain px-3 [overflow-anchor:none] md:px-6"
        >
          {hasMore && (
            <div className="mb-4 flex justify-center">
              <button
                onClick={loadMore}
                className="rounded-full bg-neutral-900 px-3.5 py-1.5 text-[13px] text-sky-400 hover:bg-neutral-800"
              >
                Cargar mensajes anteriores
              </button>
            </div>
          )}

          {loaded && messages.length === 0 && uploads.length === 0 && !error && (
            <p className="mt-8 text-center text-sm text-neutral-600">Todavía no hay mensajes. Escribe el primero.</p>
          )}

          {rows}

          {uploads.map((u) => (
            <div key={u.localId} className="mb-2 flex justify-end">
              <div className="max-w-[85%] rounded-[18px] bg-bubble-mine p-1.5 text-white sm:max-w-[75%]">
                {u.previewUrl ? (
                  <img src={u.previewUrl} alt={u.name} className="max-h-60 max-w-[260px] rounded-xl opacity-60" />
                ) : (
                  <div className="flex items-center gap-2 px-2 py-1.5 text-sm">
                    {u.voice ? (
                      <MicIcon className="h-5 w-5 shrink-0 opacity-60" />
                    ) : (
                      <FileIcon className="h-5 w-5 shrink-0 opacity-60" />
                    )}
                    <span className="truncate">{u.voice ? "Nota de voz" : u.name}</span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3 px-1.5 pt-1">
                  <span className={`text-[10px] ${u.error ? "font-semibold text-white" : "text-white/70"}`}>
                    {u.error ?? `Cifrando y subiendo… ${Math.round(u.progress * 100)}%`}
                  </span>
                  {u.error && (
                    <button onClick={() => dismissUpload(u.localId)} className="text-[10px] underline">
                      Quitar
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}

          {otherTyping && (
            <div className="anim-pop-in mb-2 flex justify-start pl-1" role="status" aria-label={typingLabel || "escribiendo"}>
              <div className="relative flex h-[36px] items-center gap-[5px] rounded-[18px] bg-bubble-other px-[14px]">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="typing-dot h-[7px] w-[7px] rounded-full bg-neutral-400"
                    style={{ animationDelay: `${i * 0.18}s` }}
                  />
                ))}
                <span className="absolute -bottom-[2px] -left-[2px] h-[11px] w-[11px] rounded-full bg-bubble-other" aria-hidden="true" />
                <span className="absolute -bottom-[8px] -left-[7px] h-[5px] w-[5px] rounded-full bg-bubble-other" aria-hidden="true" />
              </div>
            </div>
          )}
        </div>

        <div ref={bottomRef} className="absolute inset-x-0 bottom-0 z-10 isolate">
          <div className="glass glass-edge-bottom absolute inset-0 -z-10" aria-hidden="true" />
          {chat.archived && (
            <div className="px-4 pb-1 pt-2 text-center text-[12px] text-neutral-500">
              Esta conversación está archivada.{" "}
              <button onClick={() => void setChatArchived(getFirebase().db, chat.id, false).catch(() => undefined)} className="text-sky-400">
                Desarchivar
              </button>
            </div>
          )}

          {error && (
            <div className="mx-3 mt-2 flex items-start justify-between gap-3 rounded-[12px] bg-red-500/15 px-3.5 py-2 text-[13px] text-red-300" role="alert">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="shrink-0 font-semibold text-red-200">
                Cerrar
              </button>
            </div>
          )}

          {(clearing || notice) && (
            <div className="anim-pop-in mx-auto mt-2 w-fit rounded-full bg-white/10 px-3.5 py-1.5 text-[13px] text-neutral-200" role="status">
              {clearing ?? notice}
            </div>
          )}

          <Composer
            libKey={session.ws}
            uid={user.uid}
            mentionables={group ? others.map((o) => ({ uid: o, name: ws.nameOf(o) })).filter((o) => o.name !== "Miembro") : []}
            attachments={attachments}
            preparing={preparing}
            replyTo={replyTo ? { author: replyTo.uid === user.uid ? "ti" : ws.nameOf(replyTo.uid), preview: replyTo.preview } : null}
            focusSignal={focusSignal}
            keepKeyboard={keepKeyboard}
            locked={chat.locked && !ws.admin}
            onAddFiles={(files) => void addFiles(files)}
            onRemoveAttachment={removeAttachment}
            onCancelReply={() => setReplyTo(null)}
            onSend={onSend}
            onSendSticker={onSendSticker}
            onSendVoice={onSendVoice}
            onActivity={onComposerActivity}
          />
        </div>

        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-2 border-dashed border-sky-500/70 bg-neutral-950/80 text-sm text-neutral-300">
            Suelta aquí para adjuntar
          </div>
        )}
      </div>

      {panel === "tasks" && (
        <TasksPanel
          chat={chat}
          ws={ws}
          openTasks={openTasks}
          uid={user.uid}
          cryptoKey={cryptoKey}
          onJump={jumpTo}
          onClose={() => setPanel(null)}
        />
      )}

      {panel === "starred" && (
        <StarredPanel
          chat={chat}
          ws={ws}
          uid={user.uid}
          cryptoKey={cryptoKey}
          onJump={jumpTo}
          onClose={() => setPanel(null)}
        />
      )}

      {panel === "info" && (
        <ChatInfoPanel
          chat={chat}
          session={session}
          ws={ws}
          onEdit={onEdit}
          onClose={() => setPanel(null)}
          onLeft={onLeft}
        />
      )}

      {actionFor && (
        <MessageActions
          preview={previewOf(actionFor.payload)}
          myReaction={myReaction(actionFor.id)}
          canCopy={
            actionFor.payload?.t === "text" || (actionFor.payload?.t === "file" && !!actionFor.payload.text)
          }
          starred={actionFor.starred}
          canDelete={canDelete(actionFor)}
          onStar={() => {
            toggleStar(actionFor);
            setActionFor(null);
          }}
          onDelete={() => {
            void removeMessage(actionFor);
            setActionFor(null);
          }}
          onReact={(emoji) => {
            toggleReaction(actionFor, emoji);
            setActionFor(null);
          }}
          onReply={() => {
            replyToMessage(actionFor);
            setActionFor(null);
          }}
          onCopy={() => {
            copyMessage(actionFor);
            setActionFor(null);
          }}
          onTask={() => {
            taskFromMessage(actionFor);
            setActionFor(null);
          }}
          onClose={() => setActionFor(null)}
        />
      )}

      {confirmClear && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center" onClick={() => setConfirmClear(false)}>
          <div
            role="dialog"
            aria-label="Vaciar chat"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm space-y-3 rounded-t-2xl border border-neutral-800 bg-neutral-900 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-2xl"
          >
            <p className="text-[15px] font-medium text-neutral-100">¿Vaciar «{chat.name}»?</p>
            <p className="text-sm text-neutral-400">
              Se borran para todos los mensajes de este chat, con sus reacciones, fotos y notas de voz.{" "}
              <strong className="text-neutral-200">Los mensajes destacados se conservan.</strong> No se puede deshacer.
            </p>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="flex-1 rounded-xl border border-neutral-700 py-2.5 text-sm text-neutral-300 hover:bg-neutral-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void runClear()}
                className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-medium text-white hover:bg-red-500"
              >
                Vaciar
              </button>
            </div>
          </div>
        </div>
      )}

      {viewer && <Lightbox file={viewer.file} url={viewer.url} store={fileStore} onClose={() => setViewer(null)} />}

      {onceViewer && onceViewer.payload?.t === "file" && (
        <ViewOnceViewer
          file={onceViewer.payload.file}
          store={fileStore}
          onShown={() => void markOpened(getFirebase().db, chat.id, onceViewer.id, user.uid).catch(() => undefined)}
          onClose={() => setOnceViewer(null)}
        />
      )}
    </div>
  );
}
