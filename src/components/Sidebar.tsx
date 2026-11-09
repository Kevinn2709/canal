"use client";

/**
 * Sidebar.tsx — Lista de conversaciones agrupadas por proyecto.
 *
 * - Cada proyecto es una sección; dentro, las conversaciones van de la más
 *   reciente a la más antigua.
 * - Un punto marca las que tienen mensajes sin leer.
 * - Las archivadas quedan aparte, al final.
 */

import { useState } from "react";
import type { ChatInfo } from "@/lib/chats";
import { listTime } from "@/lib/format";
import { PlusIcon } from "./Icons";

function byRecent(a: ChatInfo, b: ChatInfo): number {
  return (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0);
}

export function Sidebar({
  chats,
  selectedId,
  email,
  isUnread,
  onSelect,
  onCreate,
  onLogout,
}: {
  chats: ChatInfo[];
  selectedId: string | null;
  email: string;
  isUnread: (chat: ChatInfo) => boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onLogout: () => void;
}) {
  const [showArchived, setShowArchived] = useState(false);

  const active = chats.filter((c) => !c.archived).sort(byRecent);
  const archived = chats.filter((c) => c.archived).sort(byRecent);

  // Proyectos ordenados por su actividad más reciente.
  const groups: { name: string; chats: ChatInfo[] }[] = [];
  for (const chat of active) {
    let g = groups.find((x) => x.name === chat.group);
    if (!g) {
      g = { name: chat.group, chats: [] };
      groups.push(g);
    }
    g.chats.push(chat);
  }

  const row = (chat: ChatInfo) => {
    const unread = isUnread(chat);
    const selected = chat.id === selectedId;
    return (
      <button
        key={chat.id}
        onClick={() => onSelect(chat.id)}
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
          selected ? "bg-neutral-800/80" : "hover:bg-neutral-900"
        }`}
      >
        <span
          className={`min-w-0 flex-1 truncate text-[15px] ${
            unread ? "font-semibold text-neutral-50" : "text-neutral-300"
          } ${chat.metaOk ? "" : "italic text-neutral-500"}`}
        >
          {chat.name}
        </span>
        {chat.lastMessageAt && (
          <span className={`shrink-0 text-[11px] ${unread ? "text-neutral-200" : "text-neutral-500"}`}>
            {listTime(chat.lastMessageAt)}
          </span>
        )}
        {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-sky-400" aria-label="sin leer" />}
      </button>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <h1 className="text-lg font-semibold tracking-tight">Chats</h1>
        <button
          onClick={onCreate}
          className="flex items-center gap-1.5 rounded-md border border-neutral-800 px-2.5 py-1.5 text-xs text-neutral-200 transition-colors hover:bg-neutral-900"
        >
          <PlusIcon className="h-4 w-4" />
          Nueva
        </button>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-2 pb-4">
        {groups.map((g) => (
          <section key={g.name}>
            <h2 className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-neutral-500">
              {g.name}
            </h2>
            <div className="space-y-0.5">{g.chats.map(row)}</div>
          </section>
        ))}

        {archived.length > 0 && (
          <section>
            <button
              onClick={() => setShowArchived((v) => !v)}
              className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-neutral-500 hover:text-neutral-300"
            >
              {showArchived ? "Ocultar archivadas" : `Archivadas (${archived.length})`}
            </button>
            {showArchived && <div className="space-y-0.5 opacity-70">{archived.map(row)}</div>}
          </section>
        )}
      </nav>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-neutral-900 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <span className="min-w-0 truncate text-xs text-neutral-500">{email}</span>
        <button
          onClick={onLogout}
          className="shrink-0 text-xs text-neutral-400 underline-offset-2 hover:underline"
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
