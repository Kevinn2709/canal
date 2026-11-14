"use client";

/**
 * MessageActions.tsx — Menú de un mensaje: reaccionar, responder, copiar,
 * pendiente, destacar y eliminar (con confirmación: se borra para todos).
 */

import { useState, type ReactNode } from "react";
import { REACTION_EMOJIS } from "@/lib/reactions";
import { CopyIcon, ReplyIcon, StarIcon, TasksIcon, TrashIcon } from "./Icons";

function Row({ icon, label, onClick, danger }: { icon: ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-neutral-800 ${
        danger ? "text-red-400" : "text-neutral-200"
      }`}
    >
      <span className={danger ? "text-red-400" : "text-neutral-400"}>{icon}</span>
      {label}
    </button>
  );
}

export function MessageActions({
  preview,
  myReaction,
  canCopy,
  starred,
  canDelete,
  onReact,
  onReply,
  onCopy,
  onTask,
  onStar,
  onDelete,
  onClose,
}: {
  preview: string;
  myReaction: string | null;
  canCopy: boolean;
  starred: boolean;
  canDelete: boolean;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onCopy: () => void;
  onTask: () => void;
  onStar: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [confirm, setConfirm] = useState(false);

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
        {confirm ? (
          <div className="space-y-3 px-1 pb-1">
            <p className="text-sm text-neutral-200">¿Eliminar este mensaje para todos?</p>
            <p className="text-xs text-neutral-500">
              Se borra de la base de datos, con sus reacciones y archivos. No se puede deshacer.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirm(false)}
                className="flex-1 rounded-xl border border-neutral-700 py-2.5 text-sm text-neutral-300 hover:bg-neutral-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-medium text-white hover:bg-red-500"
              >
                Eliminar para todos
              </button>
            </div>
          </div>
        ) : (
          <>
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
              <Row
                icon={<StarIcon filled={starred} className="h-4 w-4" />}
                label={starred ? "Quitar destacado" : "Destacar"}
                onClick={onStar}
              />
              <Row icon={<TasksIcon className="h-4 w-4" />} label="Marcar como pendiente" onClick={onTask} />
              {canDelete && (
                <Row icon={<TrashIcon className="h-4 w-4" />} label="Eliminar" onClick={() => setConfirm(true)} danger />
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 w-full rounded-xl py-2.5 text-sm text-neutral-400 hover:bg-neutral-800"
            >
              Cancelar
            </button>
          </>
        )}
      </div>
    </div>
  );
}
