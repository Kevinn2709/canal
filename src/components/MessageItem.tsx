"use client";

/**
 * MessageItem.tsx — Un mensaje de la conversación.
 *
 * - En grupos: nombre (y foto) de quien escribe, al inicio de cada racha.
 * - Cita del mensaje al que responde (tocarla lleva a ese mensaje).
 * - Menciones (@nombre) resaltadas; si te mencionan, el mensaje se marca.
 * - Texto, foto, archivo, video/audio, nota de voz o sticker.
 * - Reacciones debajo; tocar una reacción pone o quita la tuya.
 * - Estrella si está destacado.
 * - Tus mensajes: reloj (enviando), una palomita (guardado en el servidor) o
 *   dos palomitas (leído; en grupos, por todos). La palomita nueva se dibuja.
 * - Burbujas al estilo de Mensajes (iMessage): azul las tuyas, gris las de
 *   los demás; las seguidas de la misma persona se juntan (esquinas internas
 *   más cerradas) y la última de cada racha lleva la "colita".
 * - Memorizado (React.memo): si cambia "escribiendo…", la presencia u otra
 *   cosa que no le toca, el mensaje no se vuelve a dibujar.
 * - Acciones (reaccionar, responder, copiar, pendiente, destacar, eliminar): pulsación larga en el
 *   teléfono, clic derecho o el botón "…" que aparece al pasar el ratón.
 * - Gestos: deslizar a la derecha para responder; doble toque (o doble clic)
 *   para reaccionar con 👍.
 * - Texto oculto: borroso; se lee mientras lo mantienes presionado (o pasas
 *   el ratón encima).
 * - Foto o video de una vista: tarjeta que se abre una sola vez.
 */

import { memo, useEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { isAudio, isImage, isVideo, mentionsOf, type FileInfo, type Payload } from "@/lib/chats";
import type { FileStore } from "@/lib/files";
import type { Reaction } from "@/lib/reactions";
import type { Workspace } from "@/hooks/useWorkspace";
import { PersonAvatar } from "./Avatar";
import {
  FileAttachment,
  ImageAttachment,
  MediaAttachment,
  StickerAttachment,
} from "./Attachments";
import { MoreIcon, ReplyIcon, StarIcon } from "./Icons";
import { VoiceNote } from "./VoiceNote";
import { ViewOnceCard } from "./ViewOnce";

export interface ChatMessage {
  id: string;
  uid: string;
  payload: Payload | null; // null si no se pudo descifrar
  state: "ok" | "failed" | "legacy"; // legacy = mensaje antiguo sin cifrar
  createdAt: Date | null;
  pending: boolean;
  starred: boolean;
}

const LONG_PRESS_MS = 450;
const SWIPE_TRIGGER = 56; // px para responder al soltar
const SWIPE_MAX = 80;
const DOUBLE_TAP_MS = 300;

export type Tick = "pending" | "sent" | "read";

/** Texto con las menciones (@Nombre) resaltadas. */
function withMentions(text: string, names: string[], mineColor: boolean): ReactNode {
  const wanted = names.filter(Boolean).map((n) => `@${n}`);
  if (wanted.length === 0) return text;
  const parts: ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest) {
    let best = -1;
    let found = "";
    for (const w of wanted) {
      const i = rest.toLowerCase().indexOf(w.toLowerCase());
      if (i !== -1 && (best === -1 || i < best)) {
        best = i;
        found = rest.slice(i, i + w.length);
      }
    }
    if (best === -1) {
      parts.push(rest);
      break;
    }
    if (best > 0) parts.push(rest.slice(0, best));
    parts.push(
      <span key={key++} className={mineColor ? "font-semibold underline decoration-white/60 underline-offset-2" : "font-medium text-sky-400"}>
        {found}
      </span>
    );
    rest = rest.slice(best + found.length);
  }
  return parts;
}

/** Palomitas y reloj, dibujados a mano para que se vean finos a 12 px. */
function TickMark({ tick, readClass, animate }: { tick: Tick; readClass: string; animate: boolean }) {
  if (tick === "pending") {
    return (
      <span aria-label="Enviando" title="Enviando" className="inline-flex">
        <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
          <circle cx="6" cy="6" r="4.7" fill="none" stroke="currentColor" strokeWidth="1.25" />
          <path d="M6 3.4V6l1.7 1.1" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (tick === "sent") {
    return (
      <span aria-label="Entregado" title="Entregado" className="inline-flex">
        <svg viewBox="0 0 14 12" className={`h-3 w-[14px] ${animate ? "tick-draw" : ""}`} aria-hidden="true">
          <path d="M2.4 6.5 5.2 9.2 11.6 2.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  return (
    <span aria-label="Leído" title="Leído" className={`inline-flex ${readClass}`}>
      <svg viewBox="0 0 18 12" className={`h-3 w-[18px] ${animate ? "tick-draw" : ""}`} aria-hidden="true">
        <path d="M1.4 6.5 4.2 9.2 10.6 2.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7.7 8.6 8.3 9.2 14.7 2.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/** "Colita" de la última burbuja de una racha (como en Mensajes). */
function BubbleTail({ mine }: { mine: boolean }) {
  return (
    <svg
      viewBox="0 0 12 17"
      className={`pointer-events-none absolute bottom-0 h-[17px] w-3 ${mine ? "-right-[5px] fill-bubble-mine" : "-left-[5px] -scale-x-100 fill-bubble-other"}`}
      aria-hidden="true"
    >
      <path d="M0 0h7c0 8.6 1.6 13.6 5 17H0z" />
    </svg>
  );
}

export interface MessageItemProps {
  m: ChatMessage;
  mine: boolean;
  myUid: string;
  ws: Workspace;
  group: boolean;
  firstOfRun: boolean;
  /** Último mensaje seguido de la misma persona (lleva colita y más aire). */
  lastOfRun: boolean;
  footer: string;
  tick: Tick | null; // solo en tus mensajes
  separator: string | null;
  reactions: Reaction[];
  highlighted: boolean;
  store: FileStore | null;
  once: { opened: boolean; openedByAll: boolean } | null; // foto o video de una vista
  onOpenImage: (file: FileInfo, url: string) => void;
  onActions: (m: ChatMessage) => void;
  onToggleReaction: (m: ChatMessage, emoji: string) => void;
  onJump: (messageId: string) => void;
  onReply: (m: ChatMessage) => void;
  onQuickReact: (m: ChatMessage) => void;
  onOpenOnce: (m: ChatMessage) => void;
}

/** Solo se vuelve a dibujar si cambió algo que este mensaje muestra. */
function sameMessageProps(a: MessageItemProps, b: MessageItemProps): boolean {
  return (
    a.m.id === b.m.id &&
    a.m.uid === b.m.uid &&
    a.m.payload === b.m.payload &&
    a.m.state === b.m.state &&
    a.m.pending === b.m.pending &&
    a.m.starred === b.m.starred &&
    (a.m.createdAt?.getTime() ?? 0) === (b.m.createdAt?.getTime() ?? 0) &&
    a.mine === b.mine &&
    a.myUid === b.myUid &&
    a.group === b.group &&
    a.firstOfRun === b.firstOfRun &&
    a.lastOfRun === b.lastOfRun &&
    a.footer === b.footer &&
    a.tick === b.tick &&
    a.separator === b.separator &&
    a.reactions === b.reactions &&
    a.highlighted === b.highlighted &&
    a.store === b.store &&
    (a.once?.opened ?? null) === (b.once?.opened ?? null) &&
    (a.once?.openedByAll ?? null) === (b.once?.openedByAll ?? null) &&
    // Del espacio de trabajo solo importan nombres, colores y fotos.
    a.ws.profiles === b.ws.profiles &&
    a.ws.avatars === b.ws.avatars &&
    a.ws.nameOf === b.ws.nameOf &&
    a.onOpenImage === b.onOpenImage &&
    a.onActions === b.onActions &&
    a.onToggleReaction === b.onToggleReaction &&
    a.onJump === b.onJump &&
    a.onReply === b.onReply &&
    a.onQuickReact === b.onQuickReact &&
    a.onOpenOnce === b.onOpenOnce
  );
}

export const MessageItem = memo(MessageItemView, sameMessageProps);

function MessageItemView({
  m,
  mine,
  myUid,
  ws,
  group,
  firstOfRun,
  lastOfRun,
  footer,
  tick,
  separator,
  reactions,
  highlighted,
  store,
  once,
  onOpenImage,
  onActions,
  onToggleReaction,
  onJump,
  onReply,
  onQuickReact,
  onOpenOnce,
}: MessageItemProps) {
  const pressTimer = useRef<number | null>(null);
  const gesture = useRef<{ x: number; y: number; moved: boolean; swiping: boolean } | null>(null);
  const longPressed = useRef(false);
  const lastTap = useRef(0);
  const dxRef = useRef(0);
  const [dx, setDxState] = useState(0);
  const [revealed, setRevealed] = useState(false);
  // La palomita se dibuja solo cuando cambia (no al abrir el chat).
  const prevTick = useRef(tick);
  const animateTick = prevTick.current !== tick;
  useEffect(() => {
    prevTick.current = tick;
  }, [tick]);

  const p = m.payload;
  const spoiler = p?.t === "text" && p.sp === true;
  const quickReactable = !!p && (p.t === "text" || p.t === "sticker") && !m.pending;

  const setDx = (v: number) => {
    dxRef.current = v;
    setDxState(v);
  };

  const clearTimer = () => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  const clearPress = () => {
    clearTimer();
    gesture.current = null;
    if (dxRef.current) setDx(0);
    setRevealed(false);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") return;
    longPressed.current = false;
    gesture.current = { x: e.clientX, y: e.clientY, moved: false, swiping: false };
    if (spoiler) {
      // Mantener presionado = leer. Las acciones van por el botón "⋯".
      setRevealed(true);
      return;
    }
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      navigator.vibrate?.(15);
      onActions(m);
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    const ddx = e.clientX - g.x;
    const ddy = e.clientY - g.y;
    if (!g.moved && Math.hypot(ddx, ddy) > 10) {
      g.moved = true;
      clearTimer();
    }
    // Deslizar a la derecha (más horizontal que vertical) = responder.
    if (!g.swiping && ddx > 12 && Math.abs(ddx) > Math.abs(ddy) * 1.5) {
      g.swiping = true;
      setRevealed(false);
    }
    if (g.swiping) {
      const next = Math.max(0, Math.min(SWIPE_MAX, ddx));
      if (dxRef.current < SWIPE_TRIGGER && next >= SWIPE_TRIGGER) navigator.vibrate?.(10);
      setDx(next);
    }
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    clearTimer();
    gesture.current = null;
    if (!g || e.pointerType === "mouse") return;
    setRevealed(false);
    if (g.swiping) {
      if (dxRef.current >= SWIPE_TRIGGER) onReply(m);
      setDx(0);
      return;
    }
    // Doble toque = reacción rápida.
    if (!g.moved && !longPressed.current && quickReactable) {
      const now = Date.now();
      if (now - lastTap.current < DOUBLE_TAP_MS) {
        lastTap.current = 0;
        navigator.vibrate?.(10);
        onQuickReact(m);
      } else {
        lastTap.current = now;
      }
    }
  };

  const onDoubleClick = () => {
    if (!quickReactable) return;
    window.getSelection()?.removeAllRanges();
    onQuickReact(m);
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

  const isSticker = p?.t === "sticker";
  const isMedia = p?.t === "file" || p?.t === "voice";

  // Reacciones agrupadas por emoji.
  const groups: { emoji: string; count: number; mine: boolean; who: string[] }[] = [];
  for (const r of reactions) {
    const who = r.uid === myUid ? "Tú" : ws.nameOf(r.uid);
    const g = groups.find((x) => x.emoji === r.emoji);
    if (g) {
      g.count += 1;
      g.mine = g.mine || r.uid === myUid;
      g.who.push(who);
    } else {
      groups.push({ emoji: r.emoji, count: 1, mine: r.uid === myUid, who: [who] });
    }
  }

  const mentioned = mentionsOf(p);
  const mentionsMe = !mine && mentioned.includes(myUid);
  const mentionNames = mentioned.map((uid) => (uid === myUid ? ws.me?.name ?? "" : ws.nameOf(uid)));
  const showSender = group && !mine && firstOfRun;

  const content = () => {
    if (!p) return <p className="text-[13px] italic opacity-70">No se pudo descifrar este mensaje.</p>;
    if (!store) return <p className="text-[13px] italic opacity-70">Sticker no disponible.</p>;
    switch (p.t) {
      case "text":
        if (p.sp) {
          return (
            <div>
              <p
                className={`select-none whitespace-pre-wrap break-words text-[15px] leading-snug transition-[filter] duration-150 ${
                  revealed ? "" : "blur-[6px]"
                }`}
              >
                {withMentions(p.text, mentionNames, mine)}
              </p>
              {!revealed && (
                <p className="mt-0.5 text-[10px] opacity-60">
                  <span className="[@media(pointer:fine)]:hidden">Mantén presionado para leer</span>
                  <span className="hidden [@media(pointer:fine)]:inline">Pasa el ratón para leer</span>
                </p>
              )}
            </div>
          );
        }
        return (
          <p className="whitespace-pre-wrap break-words text-[15px] leading-snug">
            {withMentions(p.text, mentionNames, mine)}
          </p>
        );
      case "voice":
        return <VoiceNote file={p.file} duration={p.dur} store={store} mine={mine} />;
      case "sticker":
        return <StickerAttachment file={p.file} store={store} />;
      case "file":
        if (p.once) {
          return (
            <ViewOnceCard
              file={p.file}
              mine={mine}
              opened={!!once?.opened}
              openedByAll={!!once?.openedByAll}
              onOpen={() => onOpenOnce(m)}
            />
          );
        }
        return (
          <div className="space-y-1.5">
            {isImage(p.file) ? (
              <ImageAttachment file={p.file} store={store} onOpen={onOpenImage} />
            ) : isVideo(p.file) || isAudio(p.file) ? (
              <MediaAttachment file={p.file} store={store} />
            ) : (
              <FileAttachment file={p.file} store={store} />
            )}
            {p.text && (
              <p className="whitespace-pre-wrap break-words px-1 text-[15px] leading-snug">
                {withMentions(p.text, mentionNames, mine)}
              </p>
            )}
          </div>
        );
    }
  };

  const bubbleColor = isSticker ? "" : mine ? "bg-bubble-mine text-white" : "bg-bubble-other text-neutral-50";
  const padding = isSticker ? "" : isMedia ? "p-1.5" : "px-3.5 py-[7px]";
  const footerColor = isSticker ? "text-neutral-500" : mine ? "text-white/70" : "text-neutral-400";
  // Esquinas: las del lado de quien escribe se cierran entre mensajes seguidos.
  const tail = lastOfRun && !isSticker && !(p?.t === "file" && !p.once);
  const big = "18px";
  const joined = "6px";
  const radius = isSticker
    ? undefined
    : mine
      ? {
          borderRadius: big,
          borderTopRightRadius: firstOfRun ? big : joined,
          borderBottomRightRadius: lastOfRun ? (tail ? "4px" : big) : joined,
        }
      : {
          borderRadius: big,
          borderTopLeftRadius: firstOfRun ? big : joined,
          borderBottomLeftRadius: lastOfRun ? (tail ? "4px" : big) : joined,
        };
  const tickIcon = tick ? <TickMark tick={tick} readClass={isSticker ? "text-sky-500" : mine ? "text-white" : ""} animate={animateTick} /> : null;

  return (
    <div id={`m-${m.id}`} className="relative">
      {separator && <div className="my-4 text-center text-[11px] font-medium text-neutral-500">{separator}</div>}
      {dx > 0 && (
        <span
          className="pointer-events-none absolute bottom-3 left-1 text-neutral-400"
          style={{ opacity: Math.min(1, dx / SWIPE_TRIGGER), transform: `scale(${0.6 + 0.4 * Math.min(1, dx / SWIPE_TRIGGER)})` }}
          aria-hidden="true"
        >
          <ReplyIcon />
        </span>
      )}
      <div
        className={`group flex items-center gap-1 ${lastOfRun ? "mb-2" : "mb-[3px]"} ${mine ? "flex-row-reverse" : ""} ${showSender ? "mt-3" : ""}`}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: dx ? "none" : "transform 180ms ease-out" }}
      >
        {group && !mine && (
          <div className="w-8 shrink-0 self-start pt-5">{showSender && <PersonAvatar ws={ws} uid={m.uid} size={28} />}</div>
        )}
        <div className={`flex min-w-0 max-w-[85%] flex-col sm:max-w-[75%] ${mine ? "items-end" : "items-start"}`}>
          {showSender && (
            <span className="mb-0.5 px-1 text-xs font-medium" style={{ color: ws.profiles.get(m.uid)?.color ?? "#a3a3a3" }}>
              {ws.nameOf(m.uid)}
            </span>
          )}
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={clearPress}
            onPointerLeave={(e) => e.pointerType === "mouse" && clearPress()}
            onPointerEnter={(e) => spoiler && e.pointerType === "mouse" && setRevealed(true)}
            onDoubleClick={onDoubleClick}
            onClickCapture={onClickCapture}
            onContextMenu={onContextMenu}
            className={`relative max-w-full touch-pan-y transition-shadow [-webkit-touch-callout:none] [@media(pointer:coarse)]:select-none ${bubbleColor} ${padding} ${
              highlighted ? (mine ? "ring-2 ring-white/80" : "ring-2 ring-sky-400") : mentionsMe ? "ring-1 ring-sky-500/70" : ""
            }`}
            style={radius}
          >
            {tail && <BubbleTail mine={mine} />}
            {p?.re && (
              <button
                type="button"
                onClick={() => p.re && onJump(p.re.id)}
                className={`mb-1.5 block w-full min-w-[8rem] rounded-[10px] border-l-[3px] px-2 py-1 text-left ${
                  mine ? "border-white/80 bg-white/15" : isSticker ? "border-sky-500 bg-white/[0.06]" : "border-sky-500 bg-white/[0.07]"
                }`}
              >
                <span className={`block text-[11px] font-semibold ${mine ? "text-white" : "text-sky-400"}`}>
                  {p.re.uid === myUid ? "Tú" : ws.nameOf(p.re.uid)}
                </span>
                <span className="block truncate text-xs opacity-75">{p.re.preview}</span>
              </button>
            )}
            {content()}
            <p className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] ${isMedia ? "px-1.5" : ""} ${footerColor}`}>
              {m.starred && (
                <span title="Destacado" aria-label="Destacado" className="text-amber-500">
                  <StarIcon filled className="h-3 w-3" />
                </span>
              )}
              {footer}
              {tickIcon}
              {spoiler && (
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onActions(m);
                  }}
                  className="ml-0.5 rounded px-1 leading-none hover:bg-black/10 [@media(pointer:fine)]:hidden"
                  aria-label="Acciones del mensaje"
                >
                  ⋯
                </button>
              )}
            </p>
          </div>

          {groups.length > 0 && (
            <div className={`relative z-[1] -mt-1.5 flex flex-wrap gap-1 px-1 ${mine ? "justify-end" : ""}`}>
              {groups.map((g) => (
                <button
                  key={g.emoji}
                  type="button"
                  onClick={() => onToggleReaction(m, g.emoji)}
                  className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs ring-2 ring-neutral-950 ${
                    g.mine ? "bg-sky-500/30" : "bg-neutral-800"
                  }`}
                  aria-label={`Reacción ${g.emoji}`}
                  title={g.who.join(", ")}
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
