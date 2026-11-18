"use client";

/**
 * VeloPrivacidad.tsx — Capa de desenfoque que cubre la pantalla al pasar la
 * web a segundo plano desde la consola (ver lib/veil.ts). Se queda montada
 * mientras el fundador está en el monitor o en la consola.
 */

import { useEffect } from "react";
import { hideVeil, VEIL_ID } from "@/lib/veil";

export function VeloPrivacidad() {
  useEffect(() => {
    let raf = 0;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      // Dos cuadros: el monitor ya se dibujó debajo; luego se desvanece.
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(hideVeil);
      });
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, []);

  return <div id={VEIL_ID} className="velo" aria-hidden="true" />;
}
