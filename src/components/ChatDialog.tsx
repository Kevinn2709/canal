"use client";

/**
 * ChatDialog.tsx — Crear un chat (privado o de grupo) o cambiarle el nombre
 * y el proyecto.
 *
 * - Privado: eliges a una persona; el nombre es opcional (si lo dejas vacío
 *   se muestra el nombre de esa persona).
 * - Grupo: eliges a varias y le pones nombre.
 * Solo aparecen los miembros ya aprobados.
 */

import { useState, type FormEvent } from "react";
import { MAX_NAME_LENGTH, type ChatMeta } from "@/lib/chats";
import type { Workspace } from "@/hooks/useWorkspace";
import { PersonAvatar } from "./Avatar";
import { CheckIcon } from "./Icons";

const DEFAULT_GROUPS = ["Trabajo", "Personal"];

export function ChatDialog({
  mode,
  ws,
  myUid,
  initial,
  groups,
  onSubmit,
  onClose,
}: {
  mode: "create" | "edit";
  ws: Workspace;
  myUid: string;
  initial: ChatMeta;
  groups: string[];
  onSubmit: (meta: ChatMeta, members: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [group, setGroup] = useState(initial.group);
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const people = [...ws.profiles.values()].filter((p) => p.valid && p.uid !== myUid).sort((a, b) => a.name.localeCompare(b.name));
  const suggestions = Array.from(new Set([...DEFAULT_GROUPS, ...groups])).filter(Boolean);
  const creating = mode === "create";
  const isGroup = members.length > 1;
  const nameRequired = creating ? isGroup || members.length === 0 : false;
  const canSubmit = creating ? members.length > 0 && (!nameRequired || !!name.trim()) : true;

  const toggle = (uid: string) =>
    setMembers((m) => (m.includes(uid) ? m.filter((x) => x !== uid) : [...m, uid]));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ name: name.trim(), group: group.trim() || "General" }, members);
      onClose();
    } catch {
      setError("No se pudo guardar. Revisa tu conexión.");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-sm space-y-4 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950 p-5 text-neutral-200 shadow-2xl"
      >
        <h2 className="text-base font-medium">{creating ? "Nuevo chat" : "Editar chat"}</h2>

        {creating && (
          <div className="space-y-1.5">
            <span className="text-xs text-neutral-400">Con quién</span>
            {people.length === 0 ? (
              <p className="rounded-md border border-neutral-800 px-3 py-2.5 text-sm text-neutral-500">
                Aún no hay otros miembros aprobados.
              </p>
            ) : (
              <div className="divide-y divide-neutral-900 overflow-hidden rounded-lg border border-neutral-800">
                {people.map((p) => {
                  const on = members.includes(p.uid);
                  return (
                    <button
                      key={p.uid}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggle(p.uid)}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-neutral-900"
                    >
                      <PersonAvatar ws={ws} uid={p.uid} size={32} />
                      <span className="flex-1 text-sm">{p.name}</span>
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                          on ? "border-emerald-500 bg-emerald-500 text-neutral-950" : "border-neutral-600"
                        }`}
                      >
                        {on && <CheckIcon className="h-3.5 w-3.5" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <p className="text-[11px] text-neutral-500">
              {members.length === 0
                ? "Elige una persona para un chat privado, o varias para un grupo."
                : isGroup
                  ? "Grupo: ponle un nombre."
                  : "Chat privado entre ustedes dos."}
            </p>
          </div>
        )}

        <label className="block space-y-1.5">
          <span className="text-xs text-neutral-400">
            Nombre{creating && !nameRequired ? " (opcional)" : ""}
          </span>
          <input
            value={name}
            maxLength={MAX_NAME_LENGTH}
            onChange={(e) => setName(e.target.value)}
            placeholder={creating && members.length === 1 ? ws.nameOf(members[0]) : "Ej. Proveedores, Equipo, Viaje"}
            className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-base outline-none focus:border-neutral-600"
          />
        </label>

        <div className="space-y-1.5">
          <span className="text-xs text-neutral-400">Proyecto</span>
          <input
            value={group}
            maxLength={MAX_NAME_LENGTH}
            onChange={(e) => setGroup(e.target.value)}
            placeholder="Ej. Trabajo"
            className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-base outline-none focus:border-neutral-600"
          />
          <div className="flex flex-wrap gap-1.5 pt-1">
            {suggestions.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGroup(g)}
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  g === group.trim()
                    ? "border-neutral-300 bg-neutral-100 text-neutral-900"
                    : "border-neutral-800 text-neutral-400 hover:bg-neutral-900"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        <p className="text-xs text-neutral-500">
          El nombre, el proyecto y los mensajes se guardan cifrados. Solo los miembros del chat tienen su llave.
        </p>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm text-neutral-400 hover:bg-neutral-900">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy || !canSubmit}
            className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-30"
          >
            {busy ? "Guardando…" : creating ? "Crear" : "Guardar"}
          </button>
        </div>
      </form>
    </div>
  );
}
