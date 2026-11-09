"use client";

/**
 * ChatView.tsx — Una conversación: mensajes cifrados, fotos y archivos.
 *
 * - Escucha los mensajes en vivo y los descifra en el dispositivo.
 * - Adjuntar: botón del clip, pegar (Ctrl+V) o arrastrar al chat.
 *   Los archivos se ven en una bandeja antes de enviarlos. Con un solo
 *   adjunto, el texto escrito se envía como su pie de foto.
 * - "visto" en tu último mensaje cuando el otro ya lo leyó.
 * - Nada se borra: las reglas de Firestore prohíben editar o eliminar.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { User } from "firebase/auth";
import {
  doc,
  limitToLast,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
  type Firestore,
  type Timestamp,
} from "firebase/firestore";
import { getFirebase } from "@/lib/firebase";
import { decryptText, encryptText } from "@/lib/crypto";
import {
  isAudio,
  isImage,
  isVideo,
  messageAadFor,
  messagesCollection,
  parsePayload,
  type ChatInfo,
  type FileInfo,
  type Payload,
} from "@/lib/chats";
import { formatSize, prepareFile, uploadFile, type PreparedFile } from "@/lib/files";
import { dayKey, dayLabel, formatTime } from "@/lib/format";
import { FileAttachment, ImageAttachment, Lightbox, MediaAttachment } from "./Attachments";
import { BackIcon, CloseIcon, FileIcon, MoreIcon, PaperclipIcon, SendIcon } from "./Icons";

type MessageState = "ok" | "failed" | "legacy";

interface Message {
  id: string;
  uid: string;
  payload: Payload | null; // null si no se pudo descifrar
  state: MessageState; // legacy = mensaje antiguo guardado sin cifrar
  createdAt: Date | null;
  pending: boolean; // true mientras el servidor no confirma que lo guardó
}

interface Decrypted {
  payload: Payload | null;
  state: "ok" | "failed";
}

interface PendingAttachment {
  localId: string;
  prepared: PreparedFile;
  previewUrl: string | null;
}

interface Upload {
  localId: string;
  name: string;
  previewUrl: string | null;
  progress: number;
  error: string | null;
}

const PAGE_SIZE = 200;
const MAX_LENGTH = 4000;
const MAX_ATTACHMENTS = 10;

function errorMessage(err: unknown): string {
  return (err as { code?: string }).code === "permission-denied"
    ? "Tu cuenta no tiene permiso para escribir aquí. Revisa las reglas de Firestore."
    : "No se pudo enviar. Revisa tu conexión.";
}

export function ChatView({
  chat,
  user,
  cryptoKey,
  otherRead,
  onMarkRead,
  onBack,
  onEdit,
  onToggleArchive,
}: {
  chat: ChatInfo;
  user: User;
  cryptoKey: CryptoKey;
  otherRead: Date | null;
  onMarkRead: (chatId: string) => void;
  onBack: () => void;
  onEdit: () => void;
  onToggleArchive: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [viewer, setViewer] = useState<{ file: FileInfo; url: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nearBottom = useRef(true);
  const heightBeforeLoadMore = useRef<number | null>(null);
  const prevCount = useRef(0);
  const isTouch = useRef(false);
  const plainCache = useRef(new Map<string, Decrypted>());
  const snapshotSeq = useRef(0);
  const lastMarked = useRef<string | null>(null);

  useEffect(() => {
    isTouch.current = window.matchMedia("(pointer: coarse)").matches;
  }, []);

  // Mensajes en tiempo real (los últimos `limit`).
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
        const aadFor = (uid: string) => messageAadFor(chat.id, uid);

        const list = snap.docs.map(async (d): Promise<Message> => {
          const data = d.data({ serverTimestamps: "estimate" });
          const ts = data.createdAt as Timestamp | null | undefined;
          const uid = typeof data.uid === "string" ? data.uid : "";
          const base = {
            id: d.id,
            uid,
            createdAt: ts ? ts.toDate() : null,
            pending: d.metadata.hasPendingWrites,
          };

          if (typeof data.ct === "string" && typeof data.iv === "string") {
            let plain = plainCache.current.get(d.id);
            if (!plain) {
              try {
                const text = await decryptText(cryptoKey, { iv: data.iv, ct: data.ct }, aadFor(uid));
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

  // Marcar como leído cuando la conversación está abierta y visible.
  useEffect(() => {
    if (!loaded) return;
    const maybeMark = () => {
      if (document.visibilityState !== "visible") return;
      const latest = messages[messages.length - 1];
      const marker = latest ? latest.id : "vacío";
      if (lastMarked.current === marker) return;
      const firstTime = lastMarked.current === null;
      lastMarked.current = marker;
      // Si lo último es tuyo no hace falta escribir (ya lo "leíste").
      if (!firstTime && latest && latest.uid === user.uid) return;
      onMarkRead(chat.id);
    };
    maybeMark();
    document.addEventListener("visibilitychange", maybeMark);
    return () => document.removeEventListener("visibilitychange", maybeMark);
  }, [messages, loaded, chat.id, user.uid, onMarkRead]);

  // Scroll: al final con mensajes nuevos (si ya estabas abajo); conserva tu
  // posición al cargar anteriores.
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
  }, [uploads.length]);

  // La caja de texto crece con el contenido (hasta un máximo).
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const loadMore = () => {
    const el = listRef.current;
    heightBeforeLoadMore.current = el ? el.scrollHeight : null;
    nearBottom.current = false;
    setLimit((l) => l + PAGE_SIZE);
  };

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

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) {
      e.preventDefault();
      void addFiles(files);
    }
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

  /** Cifra y envía un mensaje. Devuelve en cuanto aparece en pantalla. */
  const sendPayload = async (db: Firestore, payload: Payload) => {
    const ref = doc(messagesCollection(db, chat.id));
    const sealed = await encryptText(cryptoKey, JSON.stringify(payload), messageAadFor(chat.id, user.uid));
    plainCache.current.set(ref.id, { payload, state: "ok" });
    const batch = writeBatch(db);
    batch.set(ref, {
      ct: sealed.ct,
      iv: sealed.iv,
      uid: user.uid,
      v: 2,
      createdAt: serverTimestamp(),
    });
    batch.update(doc(db, "chats", chat.id), {
      lastMessageAt: serverTimestamp(),
      lastMessageBy: user.uid,
    });
    return { committed: batch.commit() };
  };

  const send = async () => {
    const text = draft.trim();
    const files = attachments;
    if ((!text && files.length === 0) || preparing) return;
    if (text.length > MAX_LENGTH) {
      setError(`Máximo ${MAX_LENGTH} caracteres por mensaje.`);
      return;
    }
    setDraft("");
    setAttachments([]);
    setError(null);
    nearBottom.current = true;
    const { db } = getFirebase();

    const sendText = async () => {
      try {
        const { committed } = await sendPayload(db, { t: "text", text });
        await committed;
      } catch (err) {
        setError(errorMessage(err));
        setDraft((current) => (current ? current : text));
      }
    };

    if (files.length === 0) {
      await sendText();
      return;
    }

    const caption = files.length === 1 ? text : "";
    for (const a of files) {
      setUploads((u) => [
        ...u,
        { localId: a.localId, name: a.prepared.name, previewUrl: a.previewUrl, progress: 0, error: null },
      ]);
      try {
        const info = await uploadFile(db, cryptoKey, user.uid, a.prepared, (progress) =>
          setUploads((u) => u.map((x) => (x.localId === a.localId ? { ...x, progress } : x)))
        );
        const { committed } = await sendPayload(
          db,
          caption ? { t: "file", text: caption, file: info } : { t: "file", file: info }
        );
        setUploads((u) => u.filter((x) => x.localId !== a.localId));
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
        await committed;
      } catch (err) {
        setUploads((u) =>
          u.map((x) => (x.localId === a.localId ? { ...x, error: errorMessage(err) } : x))
        );
      }
    }
    if (files.length > 1 && text) await sendText();
  };

  const dismissUpload = (localId: string) => {
    setUploads((u) => {
      const item = u.find((x) => x.localId === localId);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return u.filter((x) => x.localId !== localId);
    });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send();
  };

  // En computadora, Enter envía y Shift+Enter hace salto de línea.
  // En el teléfono, Enter hace salto de línea y se envía con el botón.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !isTouch.current) {
      e.preventDefault();
      void send();
    }
  };

  // ---------- Render ----------

  let lastMineId: string | null = null;
  for (const m of messages) if (m.uid === user.uid) lastMineId = m.id;

  const renderContent = (m: Message) => {
    if (!m.payload) {
      return <p className="text-[13px] italic opacity-70">No se pudo descifrar este mensaje.</p>;
    }
    if (m.payload.t === "text") {
      return <p className="whitespace-pre-wrap break-words text-[15px] leading-snug">{m.payload.text}</p>;
    }
    const f = m.payload.file;
    return (
      <div className="space-y-1.5">
        {isImage(f) ? (
          <ImageAttachment file={f} cryptoKey={cryptoKey} onOpen={(file, url) => setViewer({ file, url })} />
        ) : isVideo(f) || isAudio(f) ? (
          <MediaAttachment file={f} cryptoKey={cryptoKey} />
        ) : (
          <FileAttachment file={f} cryptoKey={cryptoKey} />
        )}
        {m.payload.text && (
          <p className="whitespace-pre-wrap break-words px-1 text-[15px] leading-snug">{m.payload.text}</p>
        )}
      </div>
    );
  };

  let lastDay = "";
  const rows = messages.map((m) => {
    const mine = m.uid === user.uid;
    let separator: string | null = null;
    if (m.createdAt) {
      const key = dayKey(m.createdAt);
      if (key !== lastDay) {
        separator = dayLabel(m.createdAt);
        lastDay = key;
      }
    }
    const seen = !!(otherRead && m.createdAt && otherRead >= m.createdAt);
    const status =
      mine && m.id === lastMineId ? (m.pending ? "enviando…" : seen ? "visto" : "enviado") : "";
    const footer = [
      m.createdAt ? formatTime(m.createdAt) : "",
      m.state === "legacy" ? "sin cifrar" : "",
      status,
    ]
      .filter(Boolean)
      .join(" · ");
    const isFile = m.payload?.t === "file";

    return (
      <div key={m.id}>
        {separator && <div className="my-4 text-center text-[11px] text-neutral-500">{separator}</div>}
        <div className={`mb-1.5 flex ${mine ? "justify-end" : "justify-start"}`}>
          <div
            className={`max-w-[85%] rounded-2xl sm:max-w-[75%] ${isFile ? "p-1.5" : "px-3.5 py-2"} ${
              mine ? "bg-neutral-100 text-neutral-900" : "bg-neutral-800 text-neutral-100"
            }`}
          >
            {renderContent(m)}
            <p
              className={`mt-0.5 text-right text-[10px] ${isFile ? "px-1.5" : ""} ${
                mine ? (status === "visto" ? "text-sky-600" : "text-neutral-500") : "text-neutral-400"
              }`}
            >
              {footer}
            </p>
          </div>
        </div>
      </div>
    );
  });

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-neutral-900 px-2 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] md:px-4">
        <button
          onClick={onBack}
          className="rounded-full p-2 text-neutral-300 hover:bg-neutral-900 md:hidden"
          aria-label="Volver a la lista"
        >
          <BackIcon />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium">{chat.name}</p>
          <p className="truncate text-xs text-neutral-500">
            {chat.group}
            {chat.archived ? " · archivada" : ""}
          </p>
        </div>
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-full p-2 text-neutral-300 hover:bg-neutral-900"
            aria-label="Opciones de la conversación"
          >
            <MoreIcon />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 z-30 mt-1 w-56 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 py-1 text-sm shadow-xl">
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onEdit();
                  }}
                  className="block w-full px-3 py-2 text-left hover:bg-neutral-800"
                >
                  Cambiar nombre o proyecto
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onToggleArchive();
                  }}
                  className="block w-full px-3 py-2 text-left hover:bg-neutral-800"
                >
                  {chat.archived ? "Desarchivar" : "Archivar"}
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      <div
        ref={listRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4 [overflow-anchor:none] md:px-6"
      >
        {hasMore && (
          <div className="mb-4 flex justify-center">
            <button
              onClick={loadMore}
              className="rounded-full border border-neutral-800 px-3 py-1.5 text-xs text-neutral-400 hover:bg-neutral-900"
            >
              Cargar mensajes anteriores
            </button>
          </div>
        )}

        {loaded && messages.length === 0 && uploads.length === 0 && !error && (
          <p className="mt-8 text-center text-sm text-neutral-600">
            Todavía no hay mensajes. Escribe el primero.
          </p>
        )}

        {rows}

        {uploads.map((u) => (
          <div key={u.localId} className="mb-1.5 flex justify-end">
            <div className="max-w-[85%] rounded-2xl bg-neutral-100 p-1.5 text-neutral-900 sm:max-w-[75%]">
              {u.previewUrl ? (
                <img src={u.previewUrl} alt={u.name} className="max-h-60 max-w-[260px] rounded-xl opacity-60" />
              ) : (
                <div className="flex items-center gap-2 px-2 py-1.5 text-sm">
                  <FileIcon className="h-5 w-5 shrink-0 opacity-60" />
                  <span className="truncate">{u.name}</span>
                </div>
              )}
              <div className="flex items-center justify-between gap-3 px-1.5 pt-1">
                <span className={`text-[10px] ${u.error ? "text-red-600" : "text-neutral-500"}`}>
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
      </div>

      {chat.archived && (
        <div className="shrink-0 border-t border-neutral-900 px-4 py-2 text-xs text-neutral-500">
          Esta conversación está archivada.{" "}
          <button onClick={onToggleArchive} className="underline">
            Desarchivar
          </button>
        </div>
      )}

      {error && (
        <div className="shrink-0 border-t border-red-900/40 bg-red-950/40 px-4 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {(attachments.length > 0 || preparing) && (
        <div className="flex shrink-0 gap-2 overflow-x-auto border-t border-neutral-900 px-3 pt-3">
          {attachments.map((a) => (
            <div key={a.localId} className="relative shrink-0">
              {a.previewUrl ? (
                <img src={a.previewUrl} alt={a.prepared.name} className="h-16 w-16 rounded-lg object-cover" />
              ) : (
                <div className="flex h-16 w-36 flex-col justify-center rounded-lg border border-neutral-800 bg-neutral-900 px-2.5">
                  <span className="truncate text-xs text-neutral-200">{a.prepared.name}</span>
                  <span className="text-[10px] text-neutral-500">{formatSize(a.prepared.blob.size)}</span>
                </div>
              )}
              <button
                onClick={() => removeAttachment(a.localId)}
                className="absolute -right-1.5 -top-1.5 rounded-full bg-neutral-700 p-0.5 text-white"
                aria-label={`Quitar ${a.prepared.name}`}
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {preparing && (
            <div className="flex h-16 items-center px-2 text-xs text-neutral-500">Preparando…</div>
          )}
        </div>
      )}

      <form
        onSubmit={onSubmit}
        className="flex shrink-0 items-end gap-1.5 border-t border-neutral-900 px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:px-4"
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void addFiles(files);
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="shrink-0 rounded-full p-2.5 text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
          aria-label="Adjuntar foto o archivo"
        >
          <PaperclipIcon />
        </button>
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          maxLength={MAX_LENGTH}
          placeholder={attachments.length === 1 ? "Añade un comentario" : "Mensaje"}
          className="min-w-0 flex-1 resize-none rounded-2xl border border-neutral-800 bg-neutral-900 px-4 py-2 text-base leading-snug outline-none transition-colors focus:border-neutral-600"
        />
        <button
          type="submit"
          disabled={(!draft.trim() && attachments.length === 0) || preparing}
          className="shrink-0 rounded-full bg-neutral-100 p-2.5 text-neutral-900 transition-colors hover:bg-white disabled:opacity-30"
          aria-label="Enviar"
        >
          <SendIcon />
        </button>
      </form>

      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-neutral-500 bg-neutral-950/80 text-sm text-neutral-300">
          Suelta aquí para adjuntar
        </div>
      )}

      {viewer && (
        <Lightbox file={viewer.file} url={viewer.url} cryptoKey={cryptoKey} onClose={() => setViewer(null)} />
      )}
    </div>
  );
}
