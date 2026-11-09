"use client";

/**
 * MessageItem.tsx — Un mensaje de la conversación.
 *
 * - Cita del mensaje al que responde (tocarla lleva a ese mensaje).
 * - Texto, foto, archivo, video/audio, nota de voz o sticker.
 * - Reacciones debajo; tocar una reacción pone o quita la tuya.
 * - Acciones (reaccionar, responder, copiar, pendiente): pulsación larga en el
 *   teléfono, clic derecho o el botón "…" que aparece al pasar el ratón.
 */

import { useRef, type MouseEvent, type PointerEvent } from "react";
import { isAudio, isImage, isVideo, type FileInfo, type Payload } from "@/lib/chats";
import type { Reaction } from "@/lib/reactions";
import {
  FileAttachment,
  ImageAttachment,
  MediaAttachment,
  StickerAttachment,
} from "./Attachments";
import { MoreIcon } from "./Icons";
import { VoiceNote } from "./VoiceNote";

export interface ChatMessage {
  id: string;
  uid: string;
  payload: Payload | null; // null si no se pudo descifrar
  state: "ok" | "failed" | "legacy"; // legacy = mensaje antiguo sin cifrar
  createdAt: Date | null;
  pending: boolean;
}

const LONG_PRESS_MS = 450;

export function MessageItem({
  m,
  mine,
  myUid,
  footer,
  footerSeen,
  separator,
  reactions,
  highlighted,
  cryptoKey,
  onOpenImage,
  onActions,
  onToggleReaction,
  onJump,
}: {
  m: ChatMessage;
  mine: boolean;
  myUid: string;
  footer: string;
  footerSeen: boolean;
  separator: string | null;
  reactions: Reaction[];
  highlighted: boolean;
  cryptoKey: CryptoKey;
  onOpenImage: (file: FileInfo, url: string) => void;
  onActions: (m: ChatMessage) => void;
  onToggleReaction: (m: ChatMessage, emoji: string) => void;
  onJump: (messageId: string) => void;
}) {
  const pressTimer = useRef<number | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const longPressed = useRef(false);

  const clearPress = () => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
    pressStart.current = null;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") return;
    longPressed.current = false;
    pressStart.current = { x: e.clientX, y: e.clientY };
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      navigator.vibrate?.(15);
      onActions(m);
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = pressStart.current;
    if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) clearPress();
  };

  // Tras una pulsación larga, no abras la foto ni sigas enlaces.
  const onClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    if (longPressed.current) {
      longPressed.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const onContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    clearPress();
    if (!longPressed.current) onActions(m);
  };

  const p = m.payload;
  const isSticker = p?.t === "sticker";
  const isMedia = p?.t === "file" || p?.t === "voice";

  // Reacciones agrupadas por emoji.
  const groups: { emoji: string; count: number; mine: boolean }[] = [];
  for (const r of reactions) {
    const g = groups.find((x) => x.emoji === r.emoji);
    if (g) {
      g.count += 1;
      g.mine = g.mine || r.uid === myUid;
    } else {
      groups.push({ emoji: r.emoji, count: 1, mine: r.uid === myUid });
    }
  }

  const content = () => {
    if (!p) return <p className="text-[13px] italic opacity-70">No se pudo descifrar este mensaje.</p>;
    switch (p.t) {
      case "text":
        return <p className="whitespace-pre-wrap break-words text-[15px] leading-snug">{p.text}</p>;
      case "voice":
        return <VoiceNote file={p.file} duration={p.dur} cryptoKey={cryptoKey} mine={mine} />;
      case "sticker":
        return <StickerAttachment file={p.file} cryptoKey={cryptoKey} />;
      case "file":
        return (
          <div className="space-y-1.5">
            {isImage(p.file) ? (
              <ImageAttachment file={p.file} cryptoKey={cryptoKey} onOpen={onOpenImage} />
            ) : isVideo(p.file) || isAudio(p.file) ? (
              <MediaAttachment file={p.file} cryptoKey={cryptoKey} />
            ) : (
              <FileAttachment file={p.file} cryptoKey={cryptoKey} />
            )}
            {p.text && (
              <p className="whitespace-pre-wrap break-words px-1 text-[15px] leading-snug">{p.text}</p>
            )}
          </div>
        );
    }
  };

  const bubbleColor = isSticker
    ? ""
    : mine
      ? "bg-neutral-100 text-neutral-900"
      : "bg-neutral-800 text-neutral-100";
  const padding = isSticker ? "" : isMedia ? "p-1.5" : "px-3.5 py-2";
  const footerColor = isSticker
    ? "text-neutral-500"
    : mine
      ? footerSeen
        ? "text-sky-600"
        : "text-neutral-500"
      : "text-neutral-400";

  return (
    <div id={`m-${m.id}`}>
      {separator && <div className="my-4 text-center text-[11px] text-neutral-500">{separator}</div>}
      <div className={`group mb-1.5 flex items-center gap-1 ${mine ? "flex-row-reverse" : ""}`}>
        <div className={`flex min-w-0 max-w-[85%] flex-col sm:max-w-[75%] ${mine ? "items-end" : "items-start"}`}>
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={clearPress}
            onPointerCancel={clearPress}
            onPointerLeave={clearPress}
            onClickCapture={onClickCapture}
            onContextMenu={onContextMenu}
            className={`max-w-full rounded-2xl transition-shadow [-webkit-touch-callout:none] [@media(pointer:coarse)]:select-none ${bubbleColor} ${padding} ${
              highlighted ? "ring-2 ring-sky-400" : ""
            }`}
          >
            {p?.re && (
              <button
                type="button"
                onClick={() => p.re && onJump(p.re.id)}
                className={`mb-1.5 block w-full min-w-[8rem] rounded-lg border-l-2 border-sky-500 px-2 py-1 text-left ${
                  mine || isSticker ? "bg-black/5" : "bg-white/5"
                }`}
              >
                <span className="block text-[11px] font-medium text-sky-600">
                  {p.re.uid === myUid ? "Tú" : "Tu socio"}
                </span>
                <span className="block truncate text-xs opacity-75">{p.re.preview}</span>
              </button>
            )}
            {content()}
            <p className={`mt-0.5 text-right text-[10px] ${isMedia ? "px-1.5" : ""} ${footerColor}`}>{footer}</p>
          </div>

          {groups.length > 0 && (
            <div className={`-mt-1 flex flex-wrap gap-1 px-1 ${mine ? "justify-end" : ""}`}>
              {groups.map((g) => (
                <button
                  key={g.emoji}
                  type="button"
                  onClick={() => onToggleReaction(m, g.emoji)}
                  className={`flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs ${
                    g.mine ? "border-sky-500/60 bg-sky-500/15" : "border-neutral-800 bg-neutral-900"
                  }`}
                  aria-label={`Reacción ${g.emoji}`}
                >
                  <span>{g.emoji}</span>
                  {g.count > 1 && <span className="text-neutral-400">{g.count}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => onActions(m)}
          className="hidden shrink-0 rounded-full p-1.5 text-neutral-500 opacity-0 transition-opacity hover:bg-neutral-900 focus:opacity-100 group-hover:opacity-100 sm:block"
          aria-label="Acciones del mensaje"
        >
          <MoreIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
