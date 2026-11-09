"use client";

/**
 * Chat.tsx — Conversación cifrada de extremo a extremo, con historial.
 *
 * - Escucha la colección "messages" en vivo: lo que escribe uno aparece al
 *   instante en el otro, y quien no estaba conectado lo ve al entrar.
 * - En Firestore solo se guarda texto cifrado; se descifra aquí, en el
 *   dispositivo, con la llave que sale de la frase.
 * - Carga los últimos mensajes y permite cargar los anteriores.
 * - Nada se borra: las reglas de Firestore prohíben editar o eliminar.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { signOut, type User } from "firebase/auth";
import {
  collection,
  doc,
  limitToLast,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type Timestamp,
} from "firebase/firestore";
import { getFirebase } from "@/lib/firebase";
import { decryptText, encryptText, messageAad } from "@/lib/crypto";
import { clearKeys } from "@/lib/keystore";

type MessageState = "ok" | "failed" | "legacy";

interface Message {
  id: string;
  uid: string;
  text: string;
  state: MessageState; // legacy = mensaje antiguo guardado sin cifrar
  createdAt: Date | null;
  pending: boolean; // true mientras el servidor no confirma que lo guardó
}

interface Decrypted {
  text: string;
  state: "ok" | "failed";
}

const PAGE_SIZE = 200;
const MAX_LENGTH = 4000;

const timeFormat = new Intl.DateTimeFormat("es-MX", {
  hour: "2-digit",
  minute: "2-digit",
});
const dayFormat = new Intl.DateTimeFormat("es-MX", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(d: Date): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(d) === dayKey(today)) return "Hoy";
  if (dayKey(d) === dayKey(yesterday)) return "Ayer";
  const label = dayFormat.format(d);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function Chat({ user, cryptoKey }: { user: User; cryptoKey: CryptoKey }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nearBottom = useRef(true);
  const heightBeforeLoadMore = useRef<number | null>(null);
  const prevCount = useRef(0);
  const isTouch = useRef(false);
  // Textos ya descifrados, por id de mensaje (los mensajes no cambian).
  const plainCache = useRef(new Map<string, Decrypted>());
  // Para aplicar solo el resultado de la instantánea más reciente.
  const snapshotSeq = useRef(0);

  useEffect(() => {
    isTouch.current = window.matchMedia("(pointer: coarse)").matches;
  }, []);

  // Suscripción en tiempo real a los últimos `limit` mensajes.
  useEffect(() => {
    const { db } = getFirebase();
    const q = query(
      collection(db, "messages"),
      orderBy("createdAt", "asc"),
      limitToLast(limit)
    );
    const unsubscribe = onSnapshot(
      q,
      // Incluye cambios de metadatos para pasar de "enviando…" a "enviado".
      { includeMetadataChanges: true },
      (snap) => {
        setError(null);
        setHasMore(snap.size >= limit);
        const seq = ++snapshotSeq.current;

        const pendingDecrypt = snap.docs.map(async (d): Promise<Message> => {
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
                plain = {
                  text: await decryptText(
                    cryptoKey,
                    { iv: data.iv, ct: data.ct },
                    messageAad(uid)
                  ),
                  state: "ok",
                };
              } catch {
                plain = { text: "", state: "failed" };
              }
              plainCache.current.set(d.id, plain);
            }
            return { ...base, text: plain.text, state: plain.state };
          }

          if (typeof data.text === "string") {
            return { ...base, text: data.text, state: "legacy" };
          }
          return { ...base, text: "", state: "failed" };
        });

        void Promise.all(pendingDecrypt).then((list) => {
          if (seq !== snapshotSeq.current) return; // llegó una más nueva
          setMessages(list);
          setLoaded(true);
        });
      },
      (err) => {
        setLoaded(true);
        setError(
          err.code === "permission-denied"
            ? "Tu cuenta no tiene acceso a la conversación. Revisa que tu UID esté en las reglas de Firestore."
            : "No se pudo cargar la conversación. Revisa tu conexión."
        );
      }
    );
    return unsubscribe;
  }, [limit, cryptoKey]);

  // Scroll: baja al final con mensajes nuevos (si ya estabas abajo) y conserva
  // tu posición cuando cargas mensajes anteriores.
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

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    if (text.length > MAX_LENGTH) {
      setError(`Máximo ${MAX_LENGTH} caracteres por mensaje.`);
      return;
    }
    setDraft("");
    nearBottom.current = true;
    try {
      const { db } = getFirebase();
      const ref = doc(collection(db, "messages"));
      const sealed = await encryptText(cryptoKey, text, messageAad(user.uid));
      // Ya sabemos el texto: no hace falta descifrar nuestro propio mensaje.
      plainCache.current.set(ref.id, { text, state: "ok" });
      await setDoc(ref, {
        ct: sealed.ct,
        iv: sealed.iv,
        uid: user.uid,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      setError(
        (err as { code?: string }).code === "permission-denied"
          ? "Tu cuenta no tiene permiso para escribir. Revisa las reglas de Firestore."
          : "No se pudo enviar el mensaje. Revisa tu conexión."
      );
      // Devuelve el texto a la caja si no escribiste otra cosa mientras tanto.
      setDraft((current) => (current ? current : text));
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send();
  };

  // En computadora, Enter envía y Shift+Enter hace salto de línea.
  // En el teléfono, Enter hace salto de línea y se envía con el botón.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing &&
      !isTouch.current
    ) {
      e.preventDefault();
      void send();
    }
  };

  const logout = async () => {
    await clearKeys(); // olvida la llave recordada en este dispositivo
    await signOut(getFirebase().auth);
  };

  // Separadores de día entre mensajes.
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
    const time = m.createdAt ? timeFormat.format(m.createdAt) : "";
    const status = mine ? (m.pending ? "enviando…" : "enviado") : "";
    const legacy = m.state === "legacy" ? "sin cifrar" : "";

    return (
      <div key={m.id}>
        {separator && (
          <div className="my-4 text-center text-[11px] text-neutral-500">
            {separator}
          </div>
        )}
        <div className={`mb-1.5 flex ${mine ? "justify-end" : "justify-start"}`}>
          <div
            className={`max-w-[80%] rounded-2xl px-3.5 py-2 ${
              mine ? "bg-neutral-100 text-neutral-900" : "bg-neutral-800 text-neutral-100"
            }`}
          >
            {m.state === "failed" ? (
              <p className="text-[13px] italic opacity-70">
                No se pudo descifrar este mensaje.
              </p>
            ) : (
              <p className="whitespace-pre-wrap break-words text-[15px] leading-snug">
                {m.text}
              </p>
            )}
            <p
              className={`mt-0.5 text-right text-[10px] ${
                mine ? "text-neutral-500" : "text-neutral-400"
              }`}
            >
              {[time, legacy, status].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
      </div>
    );
  });

  return (
    <div className="flex h-dvh flex-col bg-neutral-950 text-neutral-100">
      <header className="flex shrink-0 items-center justify-between border-b border-neutral-900 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="min-w-0">
          <p className="text-sm font-medium">Chat</p>
          <p className="truncate text-xs text-neutral-500">
            Cifrado de extremo a extremo · {user.email}
          </p>
        </div>
        <button
          onClick={() => void logout()}
          className="shrink-0 rounded-md border border-neutral-800 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:bg-neutral-900"
        >
          Cerrar sesión
        </button>
      </header>

      <div
        ref={listRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-4 py-4 [overflow-anchor:none]"
      >
        {hasMore && (
          <div className="mb-4 flex justify-center">
            <button
              onClick={loadMore}
              className="rounded-full border border-neutral-800 px-3 py-1.5 text-xs text-neutral-400 transition-colors hover:bg-neutral-900"
            >
              Cargar mensajes anteriores
            </button>
          </div>
        )}

        {loaded && messages.length === 0 && !error && (
          <p className="mt-8 text-center text-sm text-neutral-600">
            Todavía no hay mensajes. Escribe el primero.
          </p>
        )}

        {rows}
      </div>

      {error && (
        <div className="shrink-0 border-t border-red-900/40 bg-red-950/40 px-4 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <form
        onSubmit={onSubmit}
        className="flex shrink-0 items-end gap-2 border-t border-neutral-900 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3"
      >
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={MAX_LENGTH}
          placeholder="Mensaje"
          className="flex-1 resize-none rounded-2xl border border-neutral-800 bg-neutral-900 px-4 py-2 text-base leading-snug outline-none transition-colors focus:border-neutral-600"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="rounded-full bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-white disabled:opacity-30"
        >
          Enviar
        </button>
      </form>
    </div>
  );
}
