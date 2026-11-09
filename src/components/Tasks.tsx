"use client";

/**
 * Tasks.tsx — Pendientes.
 *
 * - TasksPanel: pendientes de una conversación (agregar, marcar hecho, ver el
 *   mensaje del que salió, revisar los hechos).
 * - AllTasks: todos los pendientes abiertos, agrupados por proyecto y
 *   conversación.
 * Nada se borra: un pendiente hecho se puede reabrir.
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase";
import { MAX_TASK_LENGTH, createTask, decryptTask, setTaskDone, type Task } from "@/lib/tasks";
import type { ChatInfo } from "@/lib/chats";
import { listTime } from "@/lib/format";
import { BackIcon, CloseIcon } from "./Icons";

function TaskItem({
  task,
  uid,
  onJump,
}: {
  task: Task;
  uid: string;
  onJump?: (msgId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      await setTaskDone(getFirebase().db, task.id, uid, !task.done);
    } finally {
      setBusy(false);
    }
  };
  const who = (id: string | null) => (id === uid ? "tú" : "tu socio");
  const meta = task.done
    ? `Hecho por ${who(task.doneBy)}${task.doneAt ? ` · ${listTime(task.doneAt)}` : ""}`
    : `De ${who(task.createdBy)}${task.createdAt ? ` · ${listTime(task.createdAt)}` : ""}`;

  return (
    <li className="flex items-start gap-3 py-2.5">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        role="checkbox"
        aria-checked={task.done}
        aria-label={task.done ? `Reabrir: ${task.text}` : `Marcar como hecho: ${task.text}`}
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors disabled:opacity-50 ${
          task.done ? "border-emerald-500 bg-emerald-500 text-neutral-950" : "border-neutral-600 hover:border-neutral-300"
        }`}
      >
        {task.done && (
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={3}>
            <path d="M5 12l5 5 9-10" />
          </svg>
        )}
      </button>
      <div className="min-w-0 flex-1">
        <p
          className={`whitespace-pre-wrap break-words text-sm ${
            task.done ? "text-neutral-500 line-through" : "text-neutral-200"
          } ${task.ok ? "" : "italic"}`}
        >
          {task.ok ? task.text : "No se pudo descifrar"}
        </p>
        <p className="mt-0.5 text-[11px] text-neutral-500">
          {meta}
          {task.msgId && onJump && (
            <>
              {" · "}
              <button type="button" onClick={() => task.msgId && onJump(task.msgId)} className="underline">
                ver mensaje
              </button>
            </>
          )}
        </p>
      </div>
    </li>
  );
}

export function TasksPanel({
  chat,
  openTasks,
  uid,
  cryptoKey,
  onJump,
  onClose,
}: {
  chat: ChatInfo;
  openTasks: Task[];
  uid: string;
  cryptoKey: CryptoKey;
  onJump: (msgId: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [doneTasks, setDoneTasks] = useState<Task[] | null>(null);
  const seq = useRef(0);

  // Los hechos solo se cargan si los pides.
  useEffect(() => {
    if (!showDone) return;
    const { db } = getFirebase();
    return onSnapshot(
      query(collection(db, "tasks"), where("chatId", "==", chat.id), where("done", "==", true)),
      (snap) => {
        const current = ++seq.current;
        void Promise.all(
          snap.docs.map((d) => decryptTask(cryptoKey, d.id, d.data({ serverTimestamps: "estimate" })))
        ).then((list) => {
          if (current !== seq.current) return;
          list.sort((a, b) => (b.doneAt?.getTime() ?? 0) - (a.doneAt?.getTime() ?? 0));
          setDoneTasks(list);
        });
      },
      () => setDoneTasks([])
    );
  }, [showDone, chat.id, cryptoKey]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      await createTask(getFirebase().db, cryptoKey, uid, chat.id, value);
      setText("");
    } finally {
      setBusy(false);
    }
  };

  const jump = (msgId: string) => {
    onJump(msgId);
    if (window.matchMedia("(max-width: 1023px)").matches) onClose();
  };

  return (
    <aside className="fixed inset-0 z-30 flex flex-col bg-neutral-950 lg:static lg:z-auto lg:w-80 lg:shrink-0 lg:border-l lg:border-neutral-900">
      <div className="flex shrink-0 items-center gap-2 border-b border-neutral-900 px-3 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-2 text-neutral-300 hover:bg-neutral-900"
          aria-label="Cerrar pendientes"
        >
          <span className="lg:hidden">
            <BackIcon />
          </span>
          <span className="hidden lg:block">
            <CloseIcon />
          </span>
        </button>
        <div className="min-w-0">
          <p className="text-[15px] font-medium">Pendientes</p>
          <p className="truncate text-xs text-neutral-500">{chat.name}</p>
        </div>
      </div>

      <form onSubmit={add} className="flex shrink-0 gap-2 px-4 pt-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_TASK_LENGTH}
          placeholder="Nuevo pendiente"
          className="min-w-0 flex-1 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-base outline-none focus:border-neutral-600"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="shrink-0 rounded-md bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-900 disabled:opacity-30"
        >
          Agregar
        </button>
      </form>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-2">
        {openTasks.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-600">
            No hay pendientes. Agrega uno aquí o, en cualquier mensaje, elige "Marcar como pendiente".
          </p>
        ) : (
          <ul className="divide-y divide-neutral-900">
            {openTasks.map((t) => (
              <TaskItem key={t.id} task={t} uid={uid} onJump={jump} />
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={() => setShowDone((v) => !v)}
          className="mt-4 text-xs text-neutral-500 hover:text-neutral-300"
        >
          {showDone ? "Ocultar hechos" : "Ver hechos"}
        </button>
        {showDone && doneTasks && (
          doneTasks.length === 0 ? (
            <p className="py-3 text-xs text-neutral-600">Todavía no hay pendientes hechos.</p>
          ) : (
            <ul className="divide-y divide-neutral-900">
              {doneTasks.map((t) => (
                <TaskItem key={t.id} task={t} uid={uid} onJump={jump} />
              ))}
            </ul>
          )
        )}
      </div>
    </aside>
  );
}

export function AllTasks({
  tasks,
  chats,
  uid,
  onOpenChat,
  onBack,
}: {
  tasks: Task[];
  chats: ChatInfo[];
  uid: string;
  onOpenChat: (chatId: string) => void;
  onBack: () => void;
}) {
  // Proyecto -> conversación -> pendientes.
  const byChat = new Map<string, Task[]>();
  for (const t of tasks) {
    const list = byChat.get(t.chatId);
    if (list) list.push(t);
    else byChat.set(t.chatId, [t]);
  }
  const projects = new Map<string, { chat: ChatInfo; tasks: Task[] }[]>();
  for (const [chatId, list] of byChat) {
    const chat = chats.find((c) => c.id === chatId);
    if (!chat) continue;
    const entries = projects.get(chat.group) ?? [];
    entries.push({ chat, tasks: list });
    projects.set(chat.group, entries);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-neutral-900 px-2 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] md:px-4">
        <button
          type="button"
          onClick={onBack}
          className="rounded-full p-2 text-neutral-300 hover:bg-neutral-900 md:hidden"
          aria-label="Volver a la lista"
        >
          <BackIcon />
        </button>
        <div>
          <p className="text-[15px] font-medium">Todos los pendientes</p>
          <p className="text-xs text-neutral-500">
            {tasks.length === 1 ? "1 abierto" : `${tasks.length} abiertos`}
          </p>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
        {tasks.length === 0 && (
          <p className="mt-8 text-center text-sm text-neutral-600">No hay pendientes abiertos.</p>
        )}
        <div className="mx-auto max-w-2xl space-y-6">
          {[...projects.entries()].map(([project, entries]) => (
            <section key={project}>
              <h2 className="pb-1 text-[11px] font-medium uppercase tracking-wider text-neutral-500">{project}</h2>
              {entries.map(({ chat, tasks: list }) => (
                <div key={chat.id} className="mb-3 rounded-xl border border-neutral-900 px-4 py-2">
                  <button
                    type="button"
                    onClick={() => onOpenChat(chat.id)}
                    className="pt-1 text-sm font-medium text-neutral-200 hover:underline"
                  >
                    {chat.name}
                  </button>
                  <ul className="divide-y divide-neutral-900">
                    {list.map((t) => (
                      <TaskItem key={t.id} task={t} uid={uid} />
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
