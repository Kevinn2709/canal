"use client";

/**
 * VincularMiembro.tsx — Configuración → Cuenta vinculada (solo en la consola
 * del fundador).
 *
 * El fundador elige una cuenta de miembro ya existente. Desde ese momento, en
 * el monitor aparece el ícono de chat y abre los chats de ESA cuenta. La
 * primera vez pide su correo, contraseña y frase (los chats van cifrados de
 * extremo a extremo y solo esa cuenta tiene sus llaves).
 *
 * La designación se guarda solo en este dispositivo.
 */

import { useEffect, useState } from "react";
import type { Workspace } from "@/hooks/useWorkspace";
import { getLinked, onLinkedChange, setLinked, unlink, type LinkedAccount } from "@/lib/linked";
import { PersonAvatar } from "./Avatar";

const smallButton =
  "shrink-0 rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-40";

export function VincularMiembro({ ws, myUid }: { ws: Workspace; myUid: string }) {
  const [linked, setLinkedState] = useState<LinkedAccount | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLinkedState(getLinked());
    return onLinkedChange(setLinkedState);
  }, []);

  const candidates = [...ws.profiles.values()]
    .filter((p) => p.valid && !p.founder && p.uid !== myUid)
    .sort((a, b) => a.name.localeCompare(b.name));

  const current = linked ? ws.profiles.get(linked.uid) : undefined;

  const doUnlink = async () => {
    setBusy(true);
    await unlink().catch(() => undefined);
    setBusy(false);
  };

  return (
    <section className="space-y-3">
      <h2 className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">Cuenta vinculada (este dispositivo)</h2>

      {linked ? (
        <div className="flex items-center gap-3 rounded-lg bg-neutral-900/60 px-3 py-2">
          {current ? <PersonAvatar ws={ws} uid={current.uid} size={32} /> : null}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-neutral-100">{current?.name || linked.name}</p>
            <p className="text-[11px] text-neutral-500">Se abre con el ícono de chat del monitor.</p>
          </div>
          <button type="button" className={smallButton} disabled={busy} onClick={() => void doUnlink()}>
            {busy ? "…" : "Desvincular"}
          </button>
        </div>
      ) : candidates.length === 0 ? (
        <p className="text-sm text-neutral-500">Todavía no hay cuentas de miembro aprobadas con perfil.</p>
      ) : (
        <ul className="divide-y divide-neutral-900">
          {candidates.map((p) => (
            <li key={p.uid} className="flex items-center gap-3 py-2">
              <PersonAvatar ws={ws} uid={p.uid} size={32} />
              <p className="min-w-0 flex-1 truncate text-sm text-neutral-200">{p.name}</p>
              <button type="button" className={smallButton} onClick={() => setLinked({ uid: p.uid, name: p.name })}>
                Vincular
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-neutral-500">
        En el monitor, el ícono de chat abrirá los chats de esta cuenta. La primera vez te pedirá su correo, contraseña y
        frase, y la recordará en este dispositivo. Debe ser una cuenta de miembro (no de fundador ni de admin). Las
        notificaciones push siguen siendo de tu cuenta de fundador.
      </p>
    </section>
  );
}
