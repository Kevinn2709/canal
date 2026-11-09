"use client";

/**
 * ChatDialog.tsx — Crear una conversación o cambiarle el nombre y el
 * proyecto.
 */

import { useState, type FormEvent } from "react";
import { MAX_NAME_LENGTH, type ChatMeta } from "@/lib/chats";

const DEFAULT_GROUPS = ["Trabajo", "Personal"];

export function ChatDialog({
  title,
  submitLabel,
  initial,
  groups,
  onSubmit,
  onClose,
}: {
  title: string;
  submitLabel: string;
  initial: ChatMeta;
  groups: string[];
  onSubmit: (meta: ChatMeta) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [group, setGroup] = useState(initial.group);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestions = Array.from(new Set([...DEFAULT_GROUPS, ...groups])).filter(Boolean);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ name: name.trim(), group: group.trim() || "General" });
      onClose();
    } catch {
      setError("No se pudo guardar. Revisa tu conexión.");
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm space-y-4 rounded-xl border border-neutral-800 bg-neutral-950 p-5 text-neutral-200 shadow-2xl"
      >
        <h2 className="text-base font-medium">{title}</h2>

        <label className="block space-y-1.5">
          <span className="text-xs text-neutral-400">Nombre</span>
          <input
            autoFocus
            value={name}
            maxLength={MAX_NAME_LENGTH}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej. Proveedores, Pendientes, Viaje"
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
          El nombre y el proyecto se guardan cifrados, igual que los mensajes.
        </p>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-2 text-sm text-neutral-400 hover:bg-neutral-900"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-30"
          >
            {busy ? "Guardando…" : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
