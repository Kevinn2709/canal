"use client";

/**
 * ChatWidget.tsx — Ícono flotante de chat (abajo a la derecha).
 *
 * Modos:
 * - "inactive": sin sesión. Se ve, pero al tocarlo solo avisa que hay que
 *   iniciar sesión.
 * - "locked": con sesión pero sin la frase todavía. Al tocarlo se pide la
 *   frase.
 * - "own": miembros y admins. Abre sus chats (los `children`).
 * - "linked": en el monitor del fundador. Abre la cuenta de miembro
 *   vinculada, que corre en /vinculada dentro de un iframe del mismo sitio,
 *   con su propia sesión de Firebase.
 *
 * El panel ocupa toda la pantalla en el teléfono y flota en la computadora.
 * Se queda montado aunque esté cerrado, para que lleguen los mensajes, el
 * número de no leídos y las llamadas.
 *
 * `raised`: en el monitor el botón flota encima de la barra de pestañas.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { LINKED_PATH } from "@/lib/scope";

export type WidgetMode = "inactive" | "locked" | "own" | "linked";

function BubbleIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M8.2 5h7.6A5.2 5.2 0 0 1 21 10.2c0 2.2-1.3 4-3.1 4.8v3.6l-3.2-3.2H8.2A5.2 5.2 0 0 1 3 10.2 5.2 5.2 0 0 1 8.2 5Z"
      />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function ChatWidget({
  mode,
  open,
  onOpenChange,
  onLockedTap,
  unread = 0,
  linkedName,
  raised = false,
  children,
}: {
  mode: WidgetMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLockedTap?: () => void;
  unread?: number;
  linkedName?: string;
  /** Botón por encima de la barra de pestañas del monitor. */
  raised?: boolean;
  children?: ReactNode;
}) {
  const [hint, setHint] = useState(false);
  const [linkedUnread, setLinkedUnread] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const usable = mode === "own" || mode === "linked";

  const tap = () => {
    if (mode === "inactive") return setHint(true);
    if (mode === "locked") return onLockedTap?.();
    onOpenChange(!open);
  };

  useEffect(() => {
    if (!hint) return;
    const t = window.setTimeout(() => setHint(false), 3500);
    return () => window.clearTimeout(t);
  }, [hint]);

  // ---------- Conversación con la cuenta vinculada (iframe) ----------
  const postOpen = useCallback(() => {
    frame.current?.contentWindow?.postMessage({ type: "canal-widget", open: openRef.current }, window.location.origin);
  }, []);

  useEffect(() => {
    if (mode !== "linked") return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      const d = e.data as { type?: string; n?: unknown } | null;
      if (d?.type === "canal-hello") postOpen();
      else if (d?.type === "canal-unread" && typeof d.n === "number") setLinkedUnread(d.n);
      else if (d?.type === "canal-attention") onOpenChange(true);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [mode, onOpenChange, postOpen]);

  useEffect(() => {
    if (mode === "linked") postOpen();
  }, [mode, open, postOpen]);

  // Escape cierra el panel (computadora).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const count = mode === "linked" ? linkedUnread : unread;

  return (
    <>
      {usable && (
        <div
          className={`${open ? "flex anim-widget-up md:anim-widget-pop" : "hidden"} fixed inset-0 z-40 flex-col overflow-hidden bg-neutral-950 text-neutral-100 md:inset-auto md:right-5 md:w-[min(60rem,calc(100vw-2.5rem))] md:rounded-[28px] md:shadow-[0_30px_80px_rgba(0,0,0,0.7)] md:ring-1 md:ring-white/10 ${
            raised ? "md:bottom-[9.5rem] md:h-[min(44rem,calc(100dvh-12rem))]" : "md:bottom-24 md:h-[min(44rem,calc(100dvh-8rem))]"
          }`}
          // Las ventanas "fijas" de la app (fotos, llamadas, menús) quedan
          // dentro del panel y no se salen de él.
          style={{ transform: "translateZ(0)" }}
          role="dialog"
          aria-label="Mensajes"
          aria-hidden={!open}
        >
          <div className="relative isolate flex shrink-0 items-center justify-between px-3 pb-1 pt-[max(0.25rem,env(safe-area-inset-top))] md:pt-1">
            <div className="glass glass-edge-top absolute inset-0 -z-10" aria-hidden="true" />
            <p className="min-w-0 truncate pl-1 text-[13px] font-semibold text-neutral-400">
              Mensajes{mode === "linked" && linkedName ? <span className="font-normal text-neutral-500"> · {linkedName}</span> : null}
            </p>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-neutral-300 transition-colors hover:bg-white/15"
              aria-label="Cerrar mensajes"
            >
              <ChevronDown />
            </button>
          </div>
          <div className="in-panel relative min-h-0 flex-1">
            <div className="absolute inset-0 overflow-hidden">
              {mode === "own" ? (
                children
              ) : (
                <iframe
                  ref={frame}
                  src={LINKED_PATH}
                  title="Mensajes"
                  className="h-full w-full border-0 bg-neutral-950"
                  allow="microphone; camera; autoplay; clipboard-write"
                  onLoad={postOpen}
                />
              )}
            </div>
          </div>
        </div>
      )}

      <div
        className={`${open ? "hidden md:flex" : "flex"} fixed right-5 z-40 flex-col items-end gap-2 ${
          raised ? "bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.75rem)]" : "bottom-[max(1.25rem,env(safe-area-inset-bottom))]"
        }`}
      >
        {hint && (
          <p role="status" className="anim-pop-in relative isolate max-w-[16rem] overflow-hidden rounded-[14px] px-3.5 py-2.5 text-[13px] text-neutral-100">
            <span className="glass-thick glass-ring absolute inset-0 -z-10" aria-hidden="true" />
            Inicia sesión para usar el chat.
          </p>
        )}
        <button
          type="button"
          onClick={tap}
          className={`relative flex h-14 w-14 items-center justify-center rounded-full transition-transform duration-200 ease-ios active:scale-90 ${
            usable
              ? "bg-gradient-to-b from-[#3a9bff] to-[#0a6cff] text-white shadow-[0_10px_30px_rgba(10,108,255,0.45),inset_0_0.5px_0_rgba(255,255,255,0.35)]"
              : "bg-neutral-800 text-neutral-400 shadow-[0_10px_30px_rgba(0,0,0,0.5),inset_0_0.5px_0_rgba(255,255,255,0.12)]"
          }`}
          aria-label={open ? "Cerrar mensajes" : count > 0 ? `Mensajes, ${count} sin leer` : "Mensajes"}
        >
          <BubbleIcon />
          {usable && count > 0 && (
            <span className="anim-pop-in absolute -right-0.5 -top-0.5 flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[12px] font-semibold text-white ring-2 ring-black">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </button>
      </div>
    </>
  );
}
