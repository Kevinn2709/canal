"use client";

/**
 * PrivacyShield.tsx — Tapa la pantalla al salir de la app.
 *
 * Cuando la web pasa a segundo plano (visibilitychange -> hidden), se cierra
 * (pagehide) o pierde el foco (blur), se pone encima un desenfoque de 20 px y
 * un fondo oscuro. Así, en el selector de apps del teléfono o si alguien mira
 * la computadora, no se ve el contenido. Al volver, se quita.
 *
 * Se puede apagar en Configuración (por dispositivo). Límite: en iPhone, la
 * captura del selector de apps a veces se toma antes de que la web alcance a
 * taparse.
 */

import { useEffect, useState } from "react";
import { loadSettings, onSettingsChange } from "@/lib/push";
import { LockIcon } from "./Icons";

export function PrivacyShield() {
  const [enabled, setEnabled] = useState(true);
  const [covered, setCovered] = useState(false);

  useEffect(() => {
    setEnabled(loadSettings().shield);
    return onSettingsChange((s) => setEnabled(s.shield));
  }, []);

  useEffect(() => {
    if (!enabled) {
      setCovered(false);
      return;
    }
    const cover = () => setCovered(true);
    const update = () => setCovered(document.visibilityState === "hidden" || !document.hasFocus());
    document.addEventListener("visibilitychange", update);
    window.addEventListener("blur", cover);
    window.addEventListener("focus", update);
    window.addEventListener("pagehide", cover);
    window.addEventListener("pageshow", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("blur", cover);
      window.removeEventListener("focus", update);
      window.removeEventListener("pagehide", cover);
      window.removeEventListener("pageshow", update);
    };
  }, [enabled]);

  if (!enabled || !covered) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-neutral-950/70"
      style={{ backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}
      onPointerDown={() => setCovered(document.visibilityState === "hidden")}
      aria-hidden="true"
    >
      <LockIcon className="h-8 w-8 text-neutral-400" />
    </div>
  );
}
