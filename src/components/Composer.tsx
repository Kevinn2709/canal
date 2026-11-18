"use client";

/**
 * Composer.tsx — La barra para escribir.
 *
 * - Texto (Enter envía en computadora; en el teléfono, el botón). Con
 *   "mantener el teclado abierto" (Configuración), el teclado no se cierra
 *   al enviar.
 * - Clip para adjuntar; también se puede pegar o arrastrar al chat.
 * - Carita para stickers.
 * - Micrófono (cuando la caja está vacía) para notas de voz: tocar para
 *   empezar, luego enviar o descartar.
 * - Barra de "Respondiendo a…" cuando eliges responder un mensaje.
 * - En grupos, al escribir "@" aparece la lista de miembros para mencionar.
 * - Opciones al enviar: "Texto oculto" (se lee manteniendo presionado; para
 *   contraseñas y datos sensibles) y "Ver una vez" (fotos y videos).
 * - Avisa a los demás si escribes o grabas audio.
 * - En un chat donde solo escriben los administradores, un miembro ve un aviso
 *   en lugar de la caja de texto.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { canViewOnce, formatDuration, type FileInfo } from "@/lib/chats";
import { normalizePhrase } from "@/lib/crypto";
import { formatSize, type PreparedFile } from "@/lib/files";
import { MAX_VOICE_SECONDS, useVoiceRecorder, type Recording } from "@/hooks/useVoiceRecorder";
import type { Activity } from "@/hooks/useActivity";
import { StickerPanel } from "./StickerPanel";
import { ArrowUpIcon, CloseIcon, EyeOffIcon, LockIcon, MicIcon, OnceIcon, PlusIcon, SmileIcon, TrashIcon } from "./Icons";

export interface PendingAttachment {
  localId: string;
  prepared: PreparedFile;
  previewUrl: string | null;
}

export const MAX_LENGTH = 4000;

export interface SendOptions {
  spoiler: boolean; // texto oculto
  once: boolean; // fotos y videos de una vista
}

const MENTION_RE = /(^|\s)@([^\s@]{0,30})$/;

export function Composer({
  libKey,
  uid,
  mentionables,
  attachments,
  preparing,
  replyTo,
  focusSignal,
  keepKeyboard,
  locked,
  onAddFiles,
  onRemoveAttachment,
  onCancelReply,
  onSend,
  onSendSticker,
  onSendVoice,
  onActivity,
}: {
  libKey: CryptoKey | null;
  uid: string;
  mentionables: { uid: string; name: string }[];
  attachments: PendingAttachment[];
  preparing: boolean;
  replyTo: { author: string; preview: string } | null;
  focusSignal: number;
  keepKeyboard: boolean;
  locked: boolean; // solo los administradores escriben aquí
  onAddFiles: (files: File[]) => void;
  onRemoveAttachment: (localId: string) => void;
  onCancelReply: () => void;
  onSend: (text: string, options: SendOptions) => Promise<boolean>;
  onSendSticker: (file: FileInfo) => void;
  onSendVoice: (recording: Recording) => void;
  onActivity: (activity: Activity | null) => void;
}) {
  const [draft, setDraft] = useState("");
  const [spoiler, setSpoiler] = useState(false);
  const [once, setOnce] = useState(false);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isTouch = useRef(false);
  const voice = useVoiceRecorder(onSendVoice);

  useEffect(() => {
    isTouch.current = window.matchMedia("(pointer: coarse)").matches;
  }, []);

  useEffect(() => {
    if (focusSignal > 0) inputRef.current?.focus();
  }, [focusSignal]);

  useEffect(() => {
    onActivity(voice.recording ? "voice" : draft.trim().length > 0 ? "text" : null);
  }, [draft, voice.recording, onActivity]);

  // La caja de texto crece con el contenido (hasta un máximo).
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft, voice.recording]);

  const canSend = draft.trim().length > 0 || attachments.length > 0;
  const canSpoiler = draft.trim().length > 0 && attachments.length === 0;
  const canOnce = attachments.some((a) => canViewOnce(a.prepared));

  const updateMention = (value: string, caret: number) => {
    if (mentionables.length === 0) return setMentionQuery(null);
    const match = value.slice(0, caret).match(MENTION_RE);
    setMentionQuery(match ? match[2] : null);
  };

  const suggestions =
    mentionQuery === null
      ? []
      : mentionables.filter((m) => normalizePhrase(m.name).includes(normalizePhrase(mentionQuery)) || !mentionQuery);

  const pickMention = (name: string) => {
    const el = inputRef.current;
    const caret = el ? el.selectionStart ?? draft.length : draft.length;
    const before = draft.slice(0, caret).replace(MENTION_RE, (_all, space: string) => `${space}@${name} `);
    const next = before + draft.slice(caret);
    setDraft(next);
    setMentionQuery(null);
    window.setTimeout(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    }, 0);
  };

  const submit = async () => {
    const text = draft.trim();
    if ((!text && attachments.length === 0) || preparing) return;
    const options: SendOptions = { spoiler: spoiler && canSpoiler, once: once && canOnce };
    setDraft("");
    setMentionQuery(null);
    setSpoiler(false);
    setOnce(false);
    const ok = await onSend(text, options);
    if (!ok) {
      setDraft((current) => (current ? current : text));
      setSpoiler(options.spoiler);
      setOnce(options.once);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length > 0 && (e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
      e.preventDefault();
      pickMention(suggestions[0].name);
      return;
    }
    if (e.key === "Escape" && mentionQuery !== null) {
      setMentionQuery(null);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !isTouch.current) {
      e.preventDefault();
      void submit();
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) {
      e.preventDefault();
      onAddFiles(files);
    }
  };

  const remaining = MAX_VOICE_SECONDS - voice.seconds;

  if (locked) {
    return (
      <div className="flex shrink-0 items-center justify-center gap-2 px-4 pb-[max(0.875rem,env(safe-area-inset-bottom))] pt-3.5 text-xs text-neutral-500">
        <LockIcon className="h-4 w-4 shrink-0" />
        Solo los administradores pueden enviar mensajes en este chat.
      </div>
    );
  }

  const chip = (on: boolean, label: string, icon: ReactNode, toggle: () => void) => (
    <button
      type="button"
      onMouseDown={(e: { preventDefault(): void }) => e.preventDefault()}
      onClick={toggle}
      aria-pressed={on}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
        on ? "border-sky-500/60 bg-sky-500/20 text-sky-300" : "border-white/10 bg-white/[0.04] text-neutral-400 hover:text-neutral-200"
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="shrink-0">
      {replyTo && (
        <div className="anim-pop-in flex items-center gap-2 px-3 pt-2.5">
          <div className="min-w-0 flex-1 rounded-[12px] border-l-[3px] border-sky-500 bg-white/[0.07] px-3 py-1.5">
            <p className="text-[12px] font-semibold text-sky-400">Respondiendo a {replyTo.author}</p>
            <p className="truncate text-xs text-neutral-400">{replyTo.preview}</p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-neutral-300 hover:bg-white/15"
            aria-label="Cancelar respuesta"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      {(attachments.length > 0 || preparing) && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-3 pt-3">
          {attachments.map((a) => (
            <div key={a.localId} className="relative shrink-0">
              {a.previewUrl ? (
                <img src={a.previewUrl} alt={a.prepared.name} className="h-16 w-16 rounded-[12px] object-cover" />
              ) : (
                <div className="flex h-16 w-36 flex-col justify-center rounded-[12px] bg-white/[0.07] px-2.5">
                  <span className="truncate text-xs text-neutral-200">{a.prepared.name}</span>
                  <span className="text-[10px] text-neutral-500">{formatSize(a.prepared.blob.size)}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => onRemoveAttachment(a.localId)}
                className="absolute -right-1.5 -top-1.5 rounded-full bg-neutral-700 p-0.5 text-white"
                aria-label={`Quitar ${a.prepared.name}`}
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {preparing && <div className="flex h-16 items-center px-2 text-xs text-neutral-500">Preparando…</div>}
        </div>
      )}

      {suggestions.length > 0 && !voice.recording && (
        <div className="mx-2 mt-2 overflow-hidden rounded-[14px] bg-white/[0.06] py-1" role="listbox" aria-label="Mencionar a">
          {suggestions.map((m) => (
            <button
              key={m.uid}
              type="button"
              role="option"
              aria-selected={false}
              onMouseDown={(e: { preventDefault(): void }) => e.preventDefault()}
              onClick={() => pickMention(m.name)}
              className="flex min-h-[44px] w-full items-center gap-2 px-3.5 py-2 text-left text-[15px] text-neutral-100 hover:bg-white/10"
            >
              <span className="text-sky-400">@</span>
              {m.name}
            </button>
          ))}
        </div>
      )}

      {stickersOpen && !voice.recording && libKey && (
        <StickerPanel
          ws={libKey}
          uid={uid}
          onPick={(file) => {
            setStickersOpen(false);
            onSendSticker(file);
          }}
        />
      )}

      {!voice.recording && (canSpoiler || canOnce) && (
        <div className="flex gap-2 px-3 pt-2.5">
          {canSpoiler && chip(spoiler, "Texto oculto", <EyeOffIcon className="h-3.5 w-3.5" />, () => setSpoiler((v) => !v))}
          {canOnce && chip(once, "Ver una vez", <OnceIcon className="h-3.5 w-3.5" />, () => setOnce((v) => !v))}
        </div>
      )}

      {voice.error && (
        <div className="flex items-center justify-between gap-2 px-4 pt-2 text-xs text-red-400">
          <span>{voice.error}</span>
          <button type="button" onClick={voice.clearError} className="shrink-0 underline">
            Cerrar
          </button>
        </div>
      )}

      <form
        onSubmit={onSubmit}
        className="flex items-end gap-1.5 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 md:px-4"
      >
        {voice.recording ? (
          <>
            <button
              type="button"
              onClick={() => voice.stop(false)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-red-400 hover:bg-neutral-700"
              aria-label="Descartar nota de voz"
            >
              <TrashIcon />
            </button>
            <div className="flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-[20px] border border-white/15 bg-black/30 px-3.5">
              <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500" />
              <span className="text-sm tabular-nums text-neutral-200">{formatDuration(voice.seconds)}</span>
              <span className="truncate text-xs text-neutral-500">
                Grabando{remaining < 30 ? ` · quedan ${Math.ceil(remaining)} s` : ""}
              </span>
            </div>
            <button
              type="button"
              onClick={() => voice.stop(true)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white transition-transform active:scale-90"
              aria-label="Enviar nota de voz"
            >
              <ArrowUpIcon className="h-[18px] w-[18px]" />
            </button>
          </>
        ) : (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                onAddFiles(files);
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-neutral-300 transition-colors hover:bg-neutral-700"
              aria-label="Adjuntar foto o archivo"
            >
              <PlusIcon className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setStickersOpen((v) => !v)}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-white/10 ${
                stickersOpen ? "text-sky-400" : "text-neutral-400 hover:text-neutral-200"
              }`}
              aria-label="Stickers"
              aria-pressed={stickersOpen}
            >
              <SmileIcon />
            </button>
            <div className="flex min-w-0 flex-1 items-end rounded-[20px] border border-white/15 bg-black/30 transition-colors focus-within:border-white/25">
              <textarea
                ref={inputRef}
                rows={1}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  updateMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
                }}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                maxLength={MAX_LENGTH}
                placeholder={attachments.length === 1 ? "Añade un comentario" : spoiler ? "Texto oculto" : "Mensaje"}
                className="min-w-0 flex-1 resize-none bg-transparent py-[6px] pl-3.5 pr-1 text-[17px] leading-[22px] text-neutral-50 outline-none placeholder:text-neutral-500"
              />
              {canSend ? (
                <button
                  type="submit"
                  disabled={preparing}
                  // Con "mantener el teclado abierto", tocar Enviar no le quita
                  // el foco a la caja de texto (así el teclado no se cierra).
                  onMouseDown={keepKeyboard ? (e: { preventDefault(): void }) => e.preventDefault() : undefined}
                  onTouchEnd={
                    keepKeyboard
                      ? (e: { preventDefault(): void }) => {
                          e.preventDefault();
                          void submit();
                        }
                      : undefined
                  }
                  className="anim-pop-in m-[3px] flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full bg-sky-500 text-white transition-transform active:scale-90 disabled:opacity-30"
                  aria-label="Enviar"
                >
                  <ArrowUpIcon className="h-[17px] w-[17px]" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setStickersOpen(false);
                    void voice.start();
                  }}
                  className="m-[3px] flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full text-neutral-400 hover:text-neutral-200"
                  aria-label="Grabar nota de voz"
                >
                  <MicIcon className="h-[19px] w-[19px]" />
                </button>
              )}
            </div>
          </>
        )}
      </form>
    </div>
  );
}
