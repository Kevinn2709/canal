"use client";

/**
 * VeloDiagnostico.tsx — Últimos eventos del velo de privacidad (para ver en
 * el teléfono qué avisa iOS al salir de la app y en qué orden).
 */

import { useEffect, useState } from "react";
import { clearVeilLog, readVeilLog, type VeilEvent } from "@/lib/veil";

function hms(t: number): string {
  const d = new Date(t);
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

export function VeloDiagnostico() {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<VeilEvent[]>([]);

  useEffect(() => {
    if (!open) return;
    setList(readVeilLog());
    const t = window.setInterval(() => setList(readVeilLog()), 1000);
    return () => window.clearInterval(t);
  }, [open]);

  return (
    <div className="rounded-lg bg-neutral-900/60 px-3 py-2">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full text-left text-xs text-sky-400" aria-expanded={open}>
        {open ? "Ocultar diagnóstico del velo" : "Ver diagnóstico del velo"}
      </button>
      {open && (
        <div className="mt-2 space-y-1">
          {list.length === 0 ? (
            <p className="text-[11px] text-neutral-500">Sin eventos todavía. Sal de la app y vuelve para registrar.</p>
          ) : (
            list.map((x, i) => (
              <p key={`${x.t}-${i}`} className="font-mono text-[11px] text-neutral-300">
                <span className="text-neutral-500">{hms(x.t)}</span> {x.e}
              </p>
            ))
          )}
          <button
            type="button"
            onClick={() => {
              clearVeilLog();
              setList([]);
            }}
            className="mt-1 text-[11px] text-red-400"
          >
            Borrar registro
          </button>
        </div>
      )}
    </div>
  );
}
