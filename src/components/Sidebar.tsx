"use client";

/**
 * Sidebar.tsx — Lista de chats al estilo WhatsApp.
 *
 * - Cada fila: foto, nombre, hora, vista previa del último mensaje (quién y
 *   qué) y el número de mensajes sin leer. "@" si te mencionaron.
 * - Fijados arriba; luego del más reciente al más antiguo.
 * - Filtros: Todos, No leídos, cada proyecto y Archivados.
 * - Pulsación larga, clic derecho o "⌄": fijar, silenciar, archivar.
 */

import { useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { setChatArchived, type ChatInfo } from "@/lib/chats";
import { getFirebase } from "@/lib/firebase";
import { listTime } from "@/lib/format";
import type { Workspace } from "@/hooks/useWorkspace";
import { ChatAvatar, PersonAvatar } from "./Avatar";
import { BellOffIcon, GearIcon, PinIcon, PlusIcon, TasksIcon } from "./Icons";

type Filter = { kind: "all" } | { kind: "unread" } | { kind: "archived" } | { kind: "group"; name: string };

const LONG_PRESS_MS = 450;

function ChatRow({
  chat,
  ws,
  myUid,
  selected,
  tasks,
  onSelect,
  onMenu,
}: {
  chat: ChatInfo;
  ws: Workspace;
  myUid: string;
  selected: boolean;
  tasks: number;
  onSelect: () => void;
  onMenu: () => void;
}) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const longPressed = useRef(false);

  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") return;
    longPressed.current = false;
    start.current = { x: e.clientX, y: e.clientY };
    timer.current = window.setTimeout(() => {
      longPressed.current = true;
      navigator.vibrate?.(15);
      onMenu();
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) clear();
  };
  const onClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    if (longPressed.current) {
      longPressed.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const onContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    clear();
    if (!longPressed.current) onMenu();
  };

  const unread = ws.unreadOf(chat);
  const mentioned = ws.mentionedIn(chat);
  const muted = ws.muted.has(chat.id);
  const pinned = ws.pinned.includes(chat.id);
  const group = chat.members.length > 2;

  let preview: string;
  if (!chat.key) preview = "Esperando la llave de este chat…";
  else if (chat.last) {
    const who = chat.last.by === myUid ? "Tú: " : group ? `${ws.nameOf(chat.last.by)}: ` : "";
    preview = who + chat.last.text;
  } else preview = chat.group;

  return (
    <div
      className="group relative"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={clear}
      onPointerCancel={clear}
      onPointerLeave={clear}
      onClickCapture={onClickCapture}
      onContextMenu={onContextMenu}
    >
      <button
        onClick={onSelect}
        className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors [-webkit-touch-callout:none] [@media(pointer:coarse)]:select-none ${
          selected ? "bg-neutral-800/80" : "hover:bg-neutral-900"
        }`}
        aria-label={`${chat.name}${unread ? `, ${unread} sin leer` : ""}`}
      >
        <ChatAvatar ws={ws} chat={chat} myUid={myUid} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span
              className={`min-w-0 flex-1 truncate text-[15px] ${unread ? "font-semibold text-neutral-50" : "text-neutral-200"} ${
                chat.metaOk ? "" : "italic text-neutral-500"
              }`}
            >
              {chat.name}
            </span>
            {chat.lastMessageAt && (
              <span className={`shrink-0 text-[11px] ${unread && !muted ? "text-emerald-400" : "text-neutral-500"}`}>
                {listTime(chat.lastMessageAt)}
              </span>
            )}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            <span className={`min-w-0 flex-1 truncate text-[13px] ${unread ? "text-neutral-300" : "text-neutral-500"}`}>
              {preview}
            </span>
            {tasks > 0 && (
              <span
                className="flex shrink-0 items-center gap-0.5 text-[11px] text-amber-400/90"
                aria-label={`${tasks} pendientes`}
                title={`${tasks} pendientes`}
              >
                <TasksIcon className="h-3.5 w-3.5" />
                {tasks}
              </span>
            )}
            {muted && <BellOffIcon className="h-3.5 w-3.5 shrink-0 text-neutral-500" />}
            {pinned && <PinIcon className="h-3.5 w-3.5 shrink-0 text-neutral-500" />}
            {mentioned && (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-500 text-[11px] font-bold text-neutral-950" aria-label="te mencionaron">
                @
              </span>
            )}
            {unread > 0 && (
              <span
                className={`min-w-[1.25rem] shrink-0 rounded-full px-1.5 text-center text-[11px] font-semibold leading-5 ${
                  muted ? "bg-neutral-600 text-neutral-100" : "bg-emerald-500 text-neutral-950"
                }`}
                aria-label="sin leer"
              >
                {unread > 99 ? "99+" : unread}
              </span>
            )}
            {/* Lugar para el botón ⌄ en computadora */}
            <span className="hidden w-5 shrink-0 [@media(pointer:fine)]:block" />
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={onMenu}
        className="absolute bottom-2 right-2 hidden h-5 w-5 items-center justify-center rounded text-sm leading-none text-neutral-400 opacity-0 transition-opacity hover:bg-neutral-800 hover:text-neutral-100 focus:opacity-100 group-hover:opacity-100 [@media(pointer:fine)]:flex"
        aria-label={`Opciones de ${chat.name}`}
      >
        ⌄
      </button>
    </div>
  );
}

function RowMenu({ chat, ws, onClose }: { chat: ChatInfo; ws: Workspace; onClose: () => void }) {
  const pinned = ws.pinned.includes(chat.id);
  const muted = ws.muted.has(chat.id);
  const item = (label: string, action: () => void) => (
    <button
      type="button"
      onClick={() => {
        action();
        onClose();
      }}
      className="block w-full px-4 py-3 text-left text-sm text-neutral-200 hover:bg-neutral-800"
    >
      {label}
    </button>
  );
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`Opciones de ${chat.name}`}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-t-2xl border border-neutral-800 bg-neutral-900 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:rounded-2xl"
      >
        <p className="mb-2 truncate px-1 text-xs text-neutral-500">{chat.name}</p>
        <div className="divide-y divide-neutral-800 overflow-hidden rounded-xl bg-neutral-950/60">
          {item(pinned ? "Desfijar" : "Fijar arriba", () => ws.togglePin(chat.id))}
          {item(muted ? "Quitar silencio" : "Silenciar", () => ws.toggleMute(chat.id))}
          {ws.unreadOf(chat) > 0 && item("Marcar como leído", () => ws.markRead(chat))}
          {item(chat.archived ? "Desarchivar" : "Archivar", () => {
            void setChatArchived(getFirebase().db, chat.id, !chat.archived).catch(() => undefined);
          })}
        </div>
        <button type="button" onClick={onClose} className="mt-2 w-full rounded-xl py-2.5 text-sm text-neutral-400 hover:bg-neutral-800">
          Cancelar
        </button>
      </div>
    </div>
  );
}

export function Sidebar({
  ws,
  myUid,
  selectedId,
  tasksSelected,
  settingsSelected,
  taskCounts,
  onSelect,
  onOpenTasks,
  onOpenSettings,
  onCreate,
}: {
  ws: Workspace;
  myUid: string;
  selectedId: string | null;
  tasksSelected: boolean;
  settingsSelected: boolean;
  taskCounts: Record<string, number>;
  onSelect: (id: string) => void;
  onOpenTasks: () => void;
  onOpenSettings: () => void;
  onCreate: () => void;
}) {
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const totalTasks = Object.values(taskCounts).reduce((a, b) => a + b, 0);

  const recent = (a: ChatInfo, b: ChatInfo) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0);
  const pinIndex = (c: ChatInfo) => {
    const i = ws.pinned.indexOf(c.id);
    return i === -1 ? Infinity : i;
  };
  const sorted = [...ws.chats].sort((a, b) => {
    const pa = pinIndex(a);
    const pb = pinIndex(b);
    if (pa !== pb) return pa - pb;
    return recent(a, b);
  });

  const active = sorted.filter((c) => !c.archived);
  const archived = sorted.filter((c) => c.archived);
  const projects = Array.from(new Set(active.map((c) => c.group)));
  const unreadChats = active.filter((c) => ws.unreadOf(c) > 0);

  const shown =
    filter.kind === "all"
      ? active
      : filter.kind === "unread"
        ? unreadChats
        : filter.kind === "archived"
          ? archived
          : active.filter((c) => c.group === filter.name);

  const chip = (label: string, f: Filter, count?: number) => {
    const on =
      filter.kind === f.kind && (f.kind !== "group" || (filter.kind === "group" && filter.name === f.name));
    return (
      <button
        key={`${f.kind}:${f.kind === "group" ? f.name : ""}`}
        type="button"
        onClick={() => setFilter(f)}
        className={`shrink-0 rounded-full px-3 py-1 text-xs transition-colors ${
          on ? "bg-emerald-500/15 text-emerald-300" : "bg-neutral-900 text-neutral-400 hover:text-neutral-200"
        }`}
        aria-pressed={on}
      >
        {label}
        {count ? ` ${count}` : ""}
      </button>
    );
  };

  const menuChat = menuFor ? ws.chats.find((c) => c.id === menuFor) : undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button onClick={onOpenSettings} className="rounded-full" aria-label="Tu perfil y configuración">
          <PersonAvatar ws={ws} uid={myUid} size={34} />
        </button>
        <h1 className="flex-1 pl-1 text-xl font-semibold tracking-tight">Chats</h1>
        <button
          onClick={onCreate}
          className="rounded-full p-2 text-neutral-300 transition-colors hover:bg-neutral-900"
          aria-label="Nuevo chat"
        >
          <PlusIcon />
        </button>
        <button
          onClick={onOpenSettings}
          className={`relative rounded-full p-2 transition-colors hover:bg-neutral-900 ${settingsSelected ? "text-neutral-100" : "text-neutral-300"}`}
          aria-label="Configuración"
        >
          <GearIcon />
          {ws.pending.length > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-400" />}
        </button>
      </div>

      {ws.pending.length > 0 && (
        <button
          onClick={onOpenSettings}
          className="mx-3 mb-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-xs text-amber-300"
        >
          {ws.pending.length === 1 ? "Una cuenta nueva espera" : `${ws.pending.length} cuentas nuevas esperan`} tu aprobación →
        </button>
      )}

      <div className="flex shrink-0 gap-1.5 overflow-x-auto px-3 pb-2 [scrollbar-width:none]">
        {chip("Todos", { kind: "all" })}
        {chip("No leídos", { kind: "unread" }, unreadChats.length)}
        {projects.map((p) => chip(p, { kind: "group", name: p }))}
        {archived.length > 0 && chip("Archivados", { kind: "archived" }, archived.length)}
      </div>

      <nav className="flex-1 overflow-y-auto px-1.5 pb-4">
        {filter.kind === "all" && (
          <button
            onClick={onOpenTasks}
            className={`mb-1 flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors ${
              tasksSelected ? "bg-neutral-800/80" : "hover:bg-neutral-900"
            }`}
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-400">
              <TasksIcon />
            </span>
            <span className="flex-1 text-[15px] text-neutral-200">Pendientes</span>
            {totalTasks > 0 && (
              <span className="rounded-full bg-amber-500 px-1.5 text-[11px] font-semibold text-neutral-950">{totalTasks}</span>
            )}
          </button>
        )}

        {shown.map((chat) => (
          <ChatRow
            key={chat.id}
            chat={chat}
            ws={ws}
            myUid={myUid}
            selected={chat.id === selectedId}
            tasks={taskCounts[chat.id] ?? 0}
            onSelect={() => onSelect(chat.id)}
            onMenu={() => setMenuFor(chat.id)}
          />
        ))}

        {shown.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-neutral-600">
            {filter.kind === "unread"
              ? "No tienes mensajes sin leer."
              : filter.kind === "all"
                ? "Aún no hay chats. Crea uno con el botón +."
                : "No hay chats aquí."}
          </p>
        )}
      </nav>

      {menuChat && <RowMenu chat={menuChat} ws={ws} onClose={() => setMenuFor(null)} />}
    </div>
  );
}
