"use client";

/** MessageActions.tsx — Menú de un mensaje: reaccionar, responder, copiar, pendiente. */

import type { ReactNode } from "react";
import { REACTION_EMOJIS } from "@/lib/reactions";
import { CopyIcon, ReplyIcon, TasksIcon } from "./Icons";

function Row({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-neutral-200 hover:bg-neutral-800"
    >
      <span className="text-neutral-400">{icon}</span>
      {label}
    </button>
  );
}

export function MessageActions({
  preview,
  myReaction,
  canCopy,
  onReact,
  onReply,
  onCopy,
  onTask,
  onClose,
}: {
  preview: string;
  myReaction: string | null;
  canCopy: boolean;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onCopy: () => void;
  onTask: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Acciones del mensaje"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-t-2xl border border-neutral-800 bg-neutral-900 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:rounded-2xl"
      >
        <p className="mb-3 truncate px-1 text-xs text-neutral-500">{preview}</p>
        <div className="mb-3 flex justify-between px-1">
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => onReact(emoji)}
              className={`rounded-full p-2 text-2xl leading-none transition-colors ${
                myReaction === emoji ? "bg-neutral-700" : "hover:bg-neutral-800"
              }`}
              aria-label={`Reaccionar con ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
        <div className="divide-y divide-neutral-800 overflow-hidden rounded-xl bg-neutral-950/60">
          <Row icon={<ReplyIcon className="h-4 w-4" />} label="Responder" onClick={onReply} />
          {canCopy && <Row icon={<CopyIcon className="h-4 w-4" />} label="Copiar texto" onClick={onCopy} />}
          <Row icon={<TasksIcon className="h-4 w-4" />} label="Marcar como pendiente" onClick={onTask} />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 w-full rounded-xl py-2.5 text-sm text-neutral-400 hover:bg-neutral-800"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
