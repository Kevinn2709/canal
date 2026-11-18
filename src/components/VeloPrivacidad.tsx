"use client";

/**
 * VeloPrivacidad.tsx — Tapa la pantalla al salir de la app.
 *
 * Cuándo se pone (en ese mismo instante, cambiando un atributo del DOM, sin
 * esperar a React):
 * - La web pierde el foco (blur): es lo primero que pasa en el iPhone al
 *   abrir el selector de apps, antes de que tome la vista previa.
 * - La web pasa a segundo plano (visibilitychange) o se cierra (pagehide).
 * - La cuenta vinculada (iframe del ícono de chat) avisa que perdió el foco y
 *   la página de arriba tampoco lo tiene: se salió de la app con ese chat
 *   abierto.
 *
 * Cuándo NO se pone: al tocar dentro del ícono de chat (el foco pasa al
 * iframe, pero sigue dentro de la app). Así no vuelve el candado doble de
 * antes.
 *
 * Se quita al volver (con dos cuadros de espera para que lo de abajo ya esté
 * dibujado) o al tocarlo. Se apaga en Configuración → "Tapar la pantalla al
 * salir" (por dispositivo).
 */

import { useEffect, useRef } from "react";
import { hideVeil, showVeil, VEIL_ID } from "@/lib/veil";
import { loadSettings, onSettingsChange } from "@/lib/push";

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

    let raf = 0;
    const uncoverSoon = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(hideVeil);
      });
    };
    const inside = () => document.visibilityState === "visible" && document.hasFocus();

    const onBlur = () => {
      // El foco pasó al chat vinculado (iframe): sigue dentro de la app.
      if (document.activeElement instanceof HTMLIFrameElement) return;
      showVeil();
      // Por si el navegador movió el foco a un iframe un instante después.
      requestAnimationFrame(() => {
        if (inside()) hideVeil();
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") showVeil();
      else if (document.hasFocus()) uncoverSoon();
    };
    const onFocus = () => {
      if (document.visibilityState === "visible") uncoverSoon();
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: string } | null;
      if (d?.type === "canal-blur" && !document.hasFocus()) showVeil();
    };

    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pagehide", showVeil);
    window.addEventListener("pageshow", onFocus);
    window.addEventListener("message", onMessage);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      offSettings();
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pagehide", showVeil);
      window.removeEventListener("pageshow", onFocus);
      window.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <div ref={ref} id={VEIL_ID} className="velo" aria-hidden="true" onPointerDown={hideVeil} />;
}
