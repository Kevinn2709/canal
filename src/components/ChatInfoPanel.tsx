"use client";

/**
 * ChatInfoPanel.tsx — Información del chat: miembros (agregar, quitar,
 * salir), silenciar, fijar, renombrar y archivar.
 *
 * Al agregar a alguien se le entrega la llave del chat: verá todo el
 * historial. Al quitarlo, las reglas de Firestore le cierran el acceso.
 */

import { useState } from "react";
import { addMembers, removeMember, setChatArchived, type ChatInfo, type KeyTarget } from "@/lib/chats";
import { getFirebase } from "@/lib/firebase";
import type { Session } from "@/lib/session";
import type { Workspace } from "@/hooks/useWorkspace";
import { ChatAvatar, PersonAvatar } from "./Avatar";
import { BackIcon, CheckIcon, CloseIcon } from "./Icons";

export function ChatInfoPanel({
  chat,
  session,
  ws,
  onEdit,
  onClose,
  onLeft,
}: {
  chat: ChatInfo;
  session: Session;
  ws: Workspace;
  onEdit: () => void;
  onClose: () => void;
  onLeft: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const uid = session.uid;
  const muted = ws.muted.has(chat.id);
  const pinned = ws.pinned.includes(chat.id);
  const admin = ws.admin; // solo un fundador cambia nombre, archiva o cambia miembros
  const candidates = [...ws.profiles.values()].filter((p) => p.valid && !chat.members.includes(p.uid));

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch {
      setError("No se pudo guardar. Revisa tu conexión.");
    }
    setBusy(false);
  };

  const add = () =>
    run(async () => {
      const raw = ws.chatRaw(chat.id);
      if (!raw) throw new Error("sin llave");
      const targets: KeyTarget[] = selected
        .map((id) => ws.profiles.get(id))
        .filter((p): p is NonNullable<typeof p> => !!p && p.valid)
        .map((p) => ({ uid: p.uid, pub: p.pub, fp: p.fp }));
      await addMembers(getFirebase().db, session, chat.id, chat.members, raw, targets);
      setSelected([]);
      setAdding(false);
    });

  const remove = (member: string) =>
    run(async () => {
      await removeMember(getFirebase().db, chat.id, chat.members, member);
      setConfirmRemove(null);
      if (member === uid) onLeft();
    });

  const row = (label: string, onClick: () => void, danger = false) => (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`block w-full px-4 py-3 text-left text-sm hover:bg-neutral-900 disabled:opacity-50 ${danger ? "text-red-400" : "text-neutral-200"}`}
    >
      {label}
    </button>
  );

  return (
    <aside className="fixed inset-0 z-30 flex flex-col bg-neutral-950 lg:static lg:z-auto lg:w-80 lg:shrink-0 lg:border-l lg:border-neutral-900">
      <div className="flex shrink-0 items-center gap-2 border-b border-neutral-900 px-3 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onClose} className="rounded-full p-2 text-neutral-300 hover:bg-neutral-900" aria-label="Cerrar información">
          <span className="lg:hidden">
            <BackIcon />
          </span>
          <span className="hidden lg:block">
            <CloseIcon />
          </span>
        </button>
        <p className="text-[15px] font-medium">Información del chat</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
          <ChatAvatar ws={ws} chat={chat} myUid={uid} size={80} />
          <p className="text-lg font-medium">{chat.name}</p>
          <p className="text-xs text-neutral-500">
            {chat.group}
            {chat.legacy ? " · conversación de antes" : ""}
          </p>
        </div>

        <div className="divide-y divide-neutral-900 border-y border-neutral-900">
          {row(muted ? "Quitar silencio" : "Silenciar notificaciones", () => ws.toggleMute(chat.id))}
          {row(pinned ? "Desfijar de la lista" : "Fijar arriba en la lista", () => ws.togglePin(chat.id))}
          {admin && chat.key && row("Cambiar nombre o proyecto", onEdit)}
          {admin &&
            row(chat.archived ? "Desarchivar" : "Archivar", () =>
              void run(() => setChatArchived(getFirebase().db, chat.id, !chat.archived))
            )}
        </div>

        <div className="px-4 pb-2 pt-5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">
            {chat.members.length} {chat.members.length === 1 ? "miembro" : "miembros"}
          </p>
        </div>
        <ul className="divide-y divide-neutral-900">
          {chat.members.map((m) => {
            const p = ws.profiles.get(m);
            return (
              <li key={m} className="flex items-center gap-3 px-4 py-2.5">
                <PersonAvatar ws={ws} uid={m} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-neutral-200">{m === uid ? `${ws.nameOf(m)} (tú)` : ws.nameOf(m)}</p>
                  {p && <p className="font-mono text-[10px] text-neutral-600">{p.code}</p>}
                </div>
                {admin && !chat.legacy && m !== uid && chat.members.length > 2 && (
                  confirmRemove === m ? (
                    <button type="button" onClick={() => void remove(m)} disabled={busy} className="text-xs text-red-400 underline">
                      Confirmar
                    </button>
                  ) : (
                    <button type="button" onClick={() => setConfirmRemove(m)} className="text-xs text-neutral-500 hover:text-red-400">
                      Quitar
                    </button>
                  )
                )}
              </li>
            );
          })}
        </ul>

        {admin && !chat.legacy && chat.key && (
          <div className="px-4 pt-3">
            {!adding ? (
              <button
                type="button"
                onClick={() => setAdding(true)}
                disabled={candidates.length === 0}
                className="w-full rounded-lg border border-neutral-800 py-2 text-sm text-neutral-200 hover:bg-neutral-900 disabled:opacity-40"
              >
                {candidates.length === 0 ? "No hay más miembros para agregar" : "Agregar miembros"}
              </button>
            ) : (
              <div className="space-y-2 rounded-lg border border-neutral-800 p-2">
                {candidates.map((p) => {
                  const on = selected.includes(p.uid);
                  return (
                    <button
                      key={p.uid}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => setSelected((s) => (on ? s.filter((x) => x !== p.uid) : [...s, p.uid]))}
                      className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-neutral-900"
                    >
                      <PersonAvatar ws={ws} uid={p.uid} size={28} />
                      <span className="flex-1 text-sm">{p.name}</span>
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${on ? "border-emerald-500 bg-emerald-500 text-neutral-950" : "border-neutral-600"}`}>
                        {on && <CheckIcon className="h-3.5 w-3.5" />}
                      </span>
                    </button>
                  );
                })}
                <p className="px-2 text-[11px] text-neutral-500">Verán todo el historial de este chat.</p>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setAdding(false)} className="px-3 py-1.5 text-xs text-neutral-400">
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => void add()}
                    disabled={busy || selected.length === 0}
                    className="rounded-md bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-900 disabled:opacity-30"
                  >
                    Agregar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {chat.legacy && (
          <p className="px-4 pt-3 text-xs text-neutral-500">
            Las conversaciones de antes son solo de los dos fundadores. Para incluir a alguien más, crea un chat nuevo.
          </p>
        )}

        {!chat.legacy && chat.members.length > 1 && (
          <div className="mt-6 border-t border-neutral-900">
            {confirmRemove === uid ? (
              <div className="space-y-2 px-4 py-3">
                <p className="text-xs text-neutral-400">Ya no podrás leer este chat (salvo que te vuelvan a agregar).</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setConfirmRemove(null)} className="text-xs text-neutral-400">
                    Cancelar
                  </button>
                  <button type="button" onClick={() => void remove(uid)} disabled={busy} className="text-xs text-red-400 underline">
                    Salir del chat
                  </button>
                </div>
              </div>
            ) : (
              row("Salir del chat", () => setConfirmRemove(uid), true)
            )}
          </div>
        )}

        {error && <p className="px-4 pt-3 text-sm text-red-400">{error}</p>}
      </div>
    </aside>
  );
}
