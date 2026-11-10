"use client";

/**
 * Shell.tsx — Estructura de la app ya desbloqueada.
 *
 * - Computadora: lista de chats a la izquierda y, a la derecha, el chat
 *   abierto, todos los pendientes o la configuración.
 * - Teléfono: primero la lista; lo que se abre ocupa la pantalla y "atrás"
 *   (botón o gesto del sistema) vuelve a la lista.
 * - Lo abierto va en la URL (#c=id, #pendientes, #ajustes).
 * - Avisos de mensajes nuevos, contador en el título de la pestaña y en el
 *   ícono de la pantalla de inicio.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { signOut, type User } from "firebase/auth";
import { collection, getDocs } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase";
import { createChat, renameChat, type ChatInfo, type ChatMeta, type KeyTarget } from "@/lib/chats";
import { clearFileCache } from "@/lib/files";
import { clearKeys, saveNotificationNames } from "@/lib/keystore";
import { loadSettings, onSettingsChange, refreshPush, registerServiceWorker, type DeviceSettings } from "@/lib/push";
import { migrateLegacyStickers } from "@/lib/stickers";
import { unlockAudio } from "@/lib/sound";
import type { Session } from "@/lib/session";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useNotifier } from "@/hooks/useNotifier";
import { Sidebar } from "./Sidebar";
import { ChatView } from "./ChatView";
import { ChatDialog } from "./ChatDialog";
import { AllTasks } from "./Tasks";
import { Settings } from "./Settings";
import { ChatAvatar } from "./Avatar";
import { LockIcon } from "./Icons";

type Dialog = { mode: "create" } | { mode: "edit"; chat: ChatInfo } | null;
type View = { type: "chat"; id: string } | { type: "tasks" } | { type: "settings" } | null;

function viewFromHash(): View {
  const hash = window.location.hash;
  if (hash === "#pendientes") return { type: "tasks" };
  if (hash === "#ajustes") return { type: "settings" };
  const match = hash.match(/^#c=([A-Za-z0-9_-]+)$/);
  return match ? { type: "chat", id: match[1] } : null;
}

export function Shell({ user, session, onSession }: { user: User; session: Session; onSession: (s: Session) => void }) {
  const ws = useWorkspace(session);
  const [view, setView] = useState<View>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [settings, setSettings] = useState<DeviceSettings>(() => loadSettings());
  const [pushOn, setPushOn] = useState(false);
  const pushedHash = useRef(false);

  useEffect(() => onSettingsChange(setSettings), []);

  useEffect(() => {
    const read = () => setView(viewFromHash());
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  // Desde la lista: nueva entrada en el historial (para que "atrás" vuelva a
  // la lista). Desde otra vista: se reemplaza.
  const go = useCallback((hash: string) => {
    if (window.location.hash === hash) return;
    if (viewFromHash()) {
      window.history.replaceState(null, "", hash);
      setView(viewFromHash());
    } else {
      pushedHash.current = true;
      window.location.hash = hash;
    }
  }, []);

  const select = useCallback((id: string) => go(`#c=${id}`), [go]);

  const back = useCallback(() => {
    if (pushedHash.current) {
      pushedHash.current = false;
      window.history.back();
    } else {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      setView(null);
    }
  }, []);

  // Service worker (avisos) y push de este dispositivo.
  useEffect(() => {
    void registerServiceWorker();
    void refreshPush(getFirebase().db, session.uid).then(setPushOn).catch(() => undefined);
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; chatId?: string } | null;
      if (d?.type === "open-chat" && d.chatId) select(d.chatId);
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, [session.uid, select]);

  // El navegador solo deja sonar audio después del primer toque.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // Los stickers de antes pasan (una vez) a la biblioteca compartida.
  useEffect(() => {
    if (!session.founder || !session.legacy || !session.ws) return;
    const flag = `canal:stickers-copiados:${session.uid}`;
    try {
      if (localStorage.getItem(flag)) return;
    } catch {
      // Sin almacenamiento: se revisa cada vez (los ya copiados se saltan).
    }
    const { db } = getFirebase();
    const legacy = session.legacy;
    const wsKey = session.ws;
    void getDocs(collection(db, "stickers"))
      .then((snap) =>
        migrateLegacyStickers(
          db,
          legacy,
          wsKey,
          session.uid,
          snap.docs.map((d) => ({ id: d.id, data: d.data() }))
        )
      )
      .then(() => {
        try {
          localStorage.setItem(flag, "1");
        } catch {
          // Nada.
        }
      })
      .catch(() => undefined);
  }, [session]);

  const viewingId = view?.type === "chat" ? view.id : null;
  const notifier = useNotifier({ ws, uid: session.uid, viewing: viewingId, settings, pushOn });

  // Título de la pestaña y número en el ícono de la pantalla de inicio.
  const totalUnread = ws.chats.reduce((n, c) => n + (ws.muted.has(c.id) ? 0 : ws.unreadOf(c)), 0);
  useEffect(() => {
    document.title = totalUnread > 0 ? `(${totalUnread}) Chat` : "Chat";
    const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    try {
      if (totalUnread > 0) void nav.setAppBadge?.(totalUnread).catch(() => undefined);
      else void nav.clearAppBadge?.().catch(() => undefined);
    } catch {
      // Sin insignia en este navegador.
    }
  }, [totalUnread]);

  // Nombres para las notificaciones push (solo si lo activaste).
  const namesKey = settings.names
    ? JSON.stringify([ws.chats.map((c) => [c.id, c.name]), [...ws.profiles.values()].map((p) => [p.uid, p.name])])
    : "";
  useEffect(() => {
    if (!namesKey) {
      void saveNotificationNames(null);
      return;
    }
    const [chats, people] = JSON.parse(namesKey) as [[string, string][], [string, string][]];
    void saveNotificationNames({ chats: Object.fromEntries(chats), people: Object.fromEntries(people) });
  }, [namesKey]);

  const logout = async () => {
    clearFileCache();
    await saveNotificationNames(null);
    await clearKeys();
    await signOut(getFirebase().auth);
  };

  const groups = Array.from(new Set(ws.chats.map((c) => c.group)));
  const selected = view?.type === "chat" ? ws.chats.find((c) => c.id === view.id) ?? null : null;
  const showingTasks = view?.type === "tasks";
  const showingSettings = view?.type === "settings";
  const somethingOpen = !!selected || showingTasks || showingSettings;

  const taskCounts: Record<string, number> = {};
  for (const t of ws.openTasks) taskCounts[t.chatId] = (taskCounts[t.chatId] ?? 0) + 1;

  const submitDialog = async (meta: ChatMeta, memberUids: string[]) => {
    const { db } = getFirebase();
    if (dialog?.mode === "edit") {
      if (!dialog.chat.key) throw new Error("Sin llave");
      await renameChat(db, dialog.chat.key, dialog.chat.id, meta);
      return;
    }
    const me: KeyTarget = { uid: session.uid, pub: session.identity.pub, fp: session.identity.fp };
    const targets: KeyTarget[] = [me];
    for (const id of memberUids) {
      const p = ws.profiles.get(id);
      if (p && p.valid) targets.push({ uid: p.uid, pub: p.pub, fp: p.fp });
    }
    const created = await createChat(db, session, targets, meta);
    ws.rememberChatKey(created.id, created.raw, created.key);
    select(created.id);
  };

  if (ws.error) {
    return (
      <div className="flex h-dvh items-center justify-center bg-neutral-950 px-6 text-neutral-200">
        <div className="max-w-sm space-y-4 text-center">
          <p className="text-sm text-red-400">{ws.error}</p>
          <button onClick={() => void logout()} className="text-xs text-neutral-400 underline">
            Cerrar sesión
          </button>
        </div>
      </div>
    );
  }

  if (ws.loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-neutral-950 text-sm text-neutral-500">
        Cargando conversaciones…
      </div>
    );
  }

  const toast = notifier.toast;
  const toastChat = toast ? ws.chats.find((c) => c.id === toast.chatId) : undefined;

  return (
    <div className="flex h-dvh bg-neutral-950 text-neutral-100">
      <aside
        className={`${somethingOpen ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col border-neutral-900 md:w-[22rem] md:border-r`}
      >
        <Sidebar
          ws={ws}
          myUid={session.uid}
          selectedId={selected?.id ?? null}
          tasksSelected={showingTasks}
          settingsSelected={showingSettings}
          taskCounts={taskCounts}
          onSelect={select}
          onOpenTasks={() => go("#pendientes")}
          onOpenSettings={() => go("#ajustes")}
          onCreate={() => setDialog({ mode: "create" })}
        />
      </aside>

      <main className={`${somethingOpen ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col`}>
        {selected ? (
          <ChatView
            key={selected.id}
            chat={selected}
            user={user}
            session={session}
            ws={ws}
            openTasks={ws.openTasks.filter((t) => t.chatId === selected.id)}
            onBack={back}
            onEdit={() => setDialog({ mode: "edit", chat: selected })}
            onLeft={back}
          />
        ) : showingTasks ? (
          <AllTasks ws={ws} tasks={ws.openTasks} uid={session.uid} onOpenChat={select} onBack={back} />
        ) : showingSettings ? (
          <Settings
            user={user}
            session={session}
            ws={ws}
            settings={settings}
            pushOn={pushOn}
            onPushChange={setPushOn}
            onSession={onSession}
            onBack={back}
            onLogout={() => void logout()}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-neutral-500">
            <LockIcon className="h-6 w-6" />
            <p>Elige una conversación o crea una nueva.</p>
            <p className="text-xs text-neutral-600">Todo está cifrado de extremo a extremo.</p>
          </div>
        )}
      </main>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border border-neutral-800 bg-neutral-900/95 p-3 shadow-2xl backdrop-blur">
            <button
              type="button"
              onClick={() => {
                notifier.dismiss();
                select(toast.chatId);
              }}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
              role="status"
              aria-label={`Mensaje nuevo en ${toast.title}`}
            >
              {toastChat ? <ChatAvatar ws={ws} chat={toastChat} myUid={session.uid} size={36} /> : null}
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-neutral-100">{toast.title}</span>
                <span className={`block truncate text-xs ${toast.mention ? "text-sky-400" : "text-neutral-400"}`}>{toast.body}</span>
              </span>
            </button>
            <button type="button" onClick={notifier.dismiss} className="shrink-0 px-1 text-xs text-neutral-500" aria-label="Cerrar aviso">
              ✕
            </button>
          </div>
        </div>
      )}

      {dialog && (
        <ChatDialog
          mode={dialog.mode}
          ws={ws}
          myUid={session.uid}
          initial={
            dialog.mode === "edit"
              ? { name: dialog.chat.rawName, group: dialog.chat.group }
              : { name: "", group: groups.find((g) => g !== "General") ?? "Trabajo" }
          }
          groups={groups}
          onSubmit={submitDialog}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
