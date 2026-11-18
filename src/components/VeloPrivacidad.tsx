"use client";

/**
 * VeloPrivacidad.tsx — Tapa la pantalla al salir de la app.
 *
 * Cuándo se pone (en ese mismo instante, cambiando un atributo del DOM):
 * - Un dedo toca la barra de inicio del iPhone (la franja de abajo, debajo de
 *   todos los botones). Es el inicio del gesto para ir al selector de apps o
 *   a la pantalla de inicio, y es la única señal que llega ANTES de que iOS
 *   tome la foto del selector. Si fue solo un toque, se quita al soltar; si
 *   fue el gesto, se queda hasta volver o tocar la pantalla.
 *   También lo avisa la cuenta vinculada si el dedo toca ahí dentro de su
 *   panel.
 * - La web pierde el foco (blur), pasa a segundo plano (visibilitychange) o
 *   se cierra (pagehide).
 *
 * Cuándo NO se pone: al tocar dentro del ícono de chat (el foco pasa al
 * iframe, pero sigue dentro de la app).
 *
 * Se quita al volver o al tocarlo. Se apaga en Configuración → "Tapar la
 * pantalla al salir" (por dispositivo).
 */

import { useEffect, useRef } from "react";
import { hideVeil, homeBarInset, logVeil, showVeil, VEIL_ID } from "@/lib/veil";
import { loadSettings, onSettingsChange } from "@/lib/push";

const TAP_MAX_PX = 12;

export function VeloPrivacidad() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    const setEnabled = (on: boolean) => {
      if (el) el.dataset.enabled = on ? "1" : "0";
      if (!on) hideVeil();
    };
    setEnabled(loadSettings().cover);
    const offSettings = onSettingsChange((s) => setEnabled(s.cover));

    // Franja de la barra de inicio: solo en teléfonos que la tienen.
    const inset = homeBarInset();
    const edge = inset >= 12 ? inset - 4 : 0;

    let raf = 0;
    let armed = false;
    let startY = 0;
    const inside = () => document.visibilityState === "visible" && document.hasFocus();
    const uncoverSoon = (why: string) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => hideVeil(why));
      });
    };
    // Al soltar: si fue un toque (sin deslizar), no era salir y se quita. Si
    // el sistema se llevó el gesto (touchcancel) o fue un deslizamiento, se
    // queda tapado hasta volver (focus / visible) o tocar la pantalla.
    const release = (tap: boolean) => {
      if (tap) uncoverSoon("se quita: fue un toque, no salir");
      else logVeil("posible salida: se queda tapado");
    };

    const onTouchStart = (e: TouchEvent) => {
      if (!edge || e.touches.length !== 1) return;
      const y = e.touches[0].clientY;
      if (y >= window.innerHeight - edge) {
        armed = true;
        startY = y;
        showVeil("barra de inicio (dedo abajo)");
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!armed) return;
      armed = false;
      const y = e.changedTouches[0]?.clientY ?? startY;
      release(e.type === "touchend" && Math.abs(y - startY) < TAP_MAX_PX);
    };
    const onBlur = () => {
      // El foco pasó al chat vinculado (iframe): sigue dentro de la app.
      if (document.activeElement instanceof HTMLIFrameElement) {
        logVeil("blur hacia el chat vinculado (ignorado)");
        return;
      }
      showVeil("blur");
      requestAnimationFrame(() => {
        if (inside() && !armed) hideVeil("se quita: el foco sigue en la app");
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") showVeil("segundo plano (visibilitychange)");
      else if (document.hasFocus()) uncoverSoon("vuelve (visible)");
      else logVeil("visible sin foco");
    };
    const onFocus = () => {
      if (document.visibilityState === "visible") uncoverSoon("vuelve (focus)");
    };
    const onPageHide = () => showVeil("pagehide");
    const onPageShow = () => uncoverSoon("vuelve (pageshow)");
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: string; phase?: string; tap?: unknown } | null;
      if (d?.type === "canal-blur" && !document.hasFocus()) showVeil("blur en el chat vinculado");
      else if (d?.type === "canal-edge" && d.phase === "start") showVeil("barra de inicio (chat vinculado)");
      else if (d?.type === "canal-edge" && d.phase === "end") release(d.tap === true);
    };

    const capture = { capture: true, passive: true } as const;
    document.addEventListener("touchstart", onTouchStart, capture);
    document.addEventListener("touchend", onTouchEnd, capture);
    document.addEventListener("touchcancel", onTouchEnd, capture);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("message", onMessage);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      offSettings();
      document.removeEventListener("touchstart", onTouchStart, capture);
      document.removeEventListener("touchend", onTouchEnd, capture);
      document.removeEventListener("touchcancel", onTouchEnd, capture);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div ref={ref} id={VEIL_ID} className="velo" aria-hidden="true" onPointerDown={() => hideVeil("se quita: tocado")}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon-192.png" alt="" width={64} height={64} className="h-16 w-16 rounded-[16px] opacity-90" />
    </div>
  );
}
