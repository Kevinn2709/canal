"use client";

/**
 * Sheet.tsx — Hoja que sube desde abajo (como las de iOS).
 *
 * - Fondo que se oscurece; tocarlo cierra.
 * - Asa arriba: arrastrar hacia abajo más de 110 px cierra.
 * - Escape cierra (computadora).
 * - Al cerrar se reproduce la animación de salida antes de desmontarse.
 * - En pantallas anchas se muestra como una ventana centrada.
 *
 * El vidrio va en una capa propia detrás del contenido, así los elementos
 * "fixed" de adentro no quedan atrapados en la hoja.
 */

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

const CLOSE_MS = 240;
const DRAG_CLOSE_PX = 110;

export function Sheet({
  open,
  onClose,
  title,
  trailing,
  children,
  label,
  tall = false,
}: {
  open: boolean;
  onClose: () => void;
  /** Título centrado en la barra de la hoja. */
  title?: ReactNode;
  /** Botón a la derecha de la barra (por defecto "Listo"). */
  trailing?: ReactNode;
  children: ReactNode;
  /** Nombre para lectores de pantalla (si no hay título de texto). */
  label?: string;
  /** Casi toda la altura de la pantalla. */
  tall?: boolean;
}) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [entered, setEntered] = useState(false);
  const start = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      setEntered(false);
      setDrag(0);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const t = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, CLOSE_MS);
    return () => window.clearTimeout(t);
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    start.current = e.clientY;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (start.current === null) return;
    setDrag(Math.max(0, e.clientY - start.current));
  };
  const onUp = () => {
    if (start.current === null) return;
    start.current = null;
    setDragging(false);
    if (drag > DRAG_CLOSE_PX) onClose();
    else setDrag(0);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="presentation">
      <div
        className={`absolute inset-0 bg-black/55 ${closing ? "anim-fade-out" : "anim-fade-in"}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label ?? (typeof title === "string" ? title : undefined)}
        className={`relative isolate flex w-full flex-col overflow-hidden rounded-t-[28px] text-neutral-50 sm:max-w-lg sm:rounded-[28px] ${
          tall ? "h-[92dvh] sm:h-[80dvh]" : "max-h-[92dvh] sm:max-h-[80dvh]"
        } ${closing ? "anim-sheet-down sm:anim-fade-out" : entered ? "" : "anim-sheet-up sm:anim-pop-in"}`}
        style={
          entered && !closing
            ? { transform: drag ? `translateY(${drag}px)` : undefined, transition: dragging ? "none" : "transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)" }
            : undefined
        }
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget && !closing) setEntered(true);
        }}
      >
        <div className="glass-thick glass-ring absolute inset-0 -z-10" aria-hidden="true" />
        <div
          className="shrink-0 touch-none cursor-grab select-none px-4 pb-1 pt-2 active:cursor-grabbing"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <div className="mx-auto h-[5px] w-9 rounded-full bg-white/25" aria-hidden="true" />
          <div className="mt-2 grid min-h-[36px] grid-cols-[1fr_auto_1fr] items-center gap-2">
            <span />
            <div className="min-w-0 truncate text-center text-[17px] font-semibold">{title}</div>
            <div className="flex justify-end">
              {trailing ?? (
                <button
                  type="button"
                  onClick={onClose}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="min-h-[44px] px-1 text-[17px] font-semibold text-sky-500"
                >
                  Listo
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>
  );
}
