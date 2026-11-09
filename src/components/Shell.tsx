"use client";

/**
 * Shell.tsx — Estructura de la app ya desbloqueada.
 *
 * - Computadora: lista de conversaciones a la izquierda y la conversación
 *   abierta a la derecha.
 * - Teléfono: primero la lista; al abrir una conversación ocupa la pantalla y
 *   el botón "atrás" (o el gesto del sistema) vuelve a la lista.
 * - La conversación abierta va en la URL (#c=id) para que "atrás" funcione.
 * - El título de la pestaña muestra cuántas conversaciones tienen mensajes
 *   sin leer.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { signOut, type User } from "firebase/auth";
import { getFirebase } from "@/lib/firebase";
import { createChat, renameChat, setChatArchived, type ChatInfo, type ChatMeta } from "@/lib/chats";
import { clearFileCache } from "@/lib/files";
import { clearKeys } from "@/lib/keystore";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Sidebar } from "./Sidebar";
import { ChatView } from "./ChatView";
import { ChatDialog } from "./ChatDialog";
import { LockIcon } from "./Icons";

type Dialog = { mode: "create" } | { mode: "edit"; chat: ChatInfo } | null;

function chatIdFromHash(): string | null {
  const match = window.location.hash.match(/^#c=([A-Za-z0-9_-]+)$/);
  return match ? match[1] : null;
}

export function Shell({ user, cryptoKey }: { user: User; cryptoKey: CryptoKey }) {
  const ws = useWorkspace(user.uid, cryptoKey);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const pushedHash = useRef(false);

  useEffect(() => {
    const read = () => setSelectedId(chatIdFromHash());
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  // Lista -> conversación: nueva entrada en el historial (para que "atrás"
  // vuelva a la lista). Conversación -> otra conversación: se reemplaza, así
  // "atrás" sigue llevando a la lista y no a la conversación anterior.
  const select = useCallback((id: string) => {
    const current = chatIdFromHash();
    if (current === id) return;
    if (current) {
      window.history.replaceState(null, "", `#c=${id}`);
      setSelectedId(id);
    } else {
      pushedHash.current = true;
      window.location.hash = `c=${id}`;
    }
  }, []);

  const back = useCallback(() => {
    if (pushedHash.current) {
      pushedHash.current = false;
      window.history.back();
    } else {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      setSelectedId(null);
    }
  }, []);

  // Título de la pestaña con el número de conversaciones sin leer.
  useEffect(() => {
    const unread = ws.chats ? ws.chats.filter((c) => ws.isUnread(c)).length : 0;
    document.title = unread > 0 ? `(${unread}) Chat` : "Chat";
  }, [ws.chats, ws.isUnread]);

  const logout = async () => {
    clearFileCache();
    await clearKeys();
    await signOut(getFirebase().auth);
  };

  const groups = Array.from(new Set((ws.chats ?? []).map((c) => c.group)));
  const selected = ws.chats?.find((c) => c.id === selectedId) ?? null;

  const submitDialog = async (meta: ChatMeta) => {
    const { db } = getFirebase();
    if (dialog?.mode === "edit") {
      await renameChat(db, cryptoKey, dialog.chat.id, meta);
    } else {
      const id = await createChat(db, cryptoKey, user.uid, meta);
      select(id);
    }
  };

  const toggleArchive = (chat: ChatInfo) => {
    void setChatArchived(getFirebase().db, chat.id, !chat.archived).catch(() => undefined);
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

  if (!ws.chats) {
    return (
      <div className="flex h-dvh items-center justify-center bg-neutral-950 text-sm text-neutral-500">
        Cargando conversaciones…
      </div>
    );
  }

  return (
    <div className="flex h-dvh bg-neutral-950 text-neutral-100">
      <aside
        className={`${selected ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col border-neutral-900 md:w-80 md:border-r`}
      >
        <Sidebar
          chats={ws.chats}
          selectedId={selected?.id ?? null}
          email={user.email ?? ""}
          isUnread={ws.isUnread}
          onSelect={select}
          onCreate={() => setDialog({ mode: "create" })}
          onLogout={() => void logout()}
        />
      </aside>

      <main className={`${selected ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col`}>
        {selected ? (
          <ChatView
            key={selected.id}
            chat={selected}
            user={user}
            cryptoKey={cryptoKey}
            otherRead={ws.otherReads[selected.id] ?? null}
            onMarkRead={ws.markRead}
            onBack={back}
            onEdit={() => setDialog({ mode: "edit", chat: selected })}
            onToggleArchive={() => toggleArchive(selected)}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-neutral-500">
            <LockIcon className="h-6 w-6" />
            <p>Elige una conversación o crea una nueva.</p>
            <p className="text-xs text-neutral-600">Todo está cifrado de extremo a extremo.</p>
          </div>
        )}
      </main>

      {dialog && (
        <ChatDialog
          title={dialog.mode === "edit" ? "Editar conversación" : "Nueva conversación"}
          submitLabel={dialog.mode === "edit" ? "Guardar" : "Crear"}
          initial={
            dialog.mode === "edit"
              ? { name: dialog.chat.name, group: dialog.chat.group }
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
