"use client";

/**
 * StarredPanel.tsx — Mensajes destacados de una conversación. Tocar uno
 * lleva a ese mensaje. Los destacados se conservan al vaciar el chat.
 */

import { useEffect, useRef, useState } from "react";
import { onSnapshot, query, where, type Timestamp } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase";
import { messagesCollection, previewOf, type ChatInfo } from "@/lib/chats";
import { decryptMessage, setStar, type StoredMessage } from "@/lib/messages";
import { dayLabel, formatTime } from "@/lib/format";
import type { Workspace } from "@/hooks/useWorkspace";
import { BackIcon, CloseIcon, StarIcon } from "./Icons";

export function StarredPanel({
  chat,
  ws,
  uid,
  cryptoKey,
  onJump,
  onClose,
}: {
  chat: ChatInfo;
  ws: Workspace;
  uid: string;
  cryptoKey: CryptoKey;
  onJump: (msgId: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<StoredMessage[] | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const { db } = getFirebase();
    return onSnapshot(
      query(messagesCollection(db, chat.id), where("star", "==", true)),
      (snap) => {
        const current = ++seq.current;
        void Promise.all(
          snap.docs.map(async (d): Promise<StoredMessage> => {
            const data = d.data({ serverTimestamps: "estimate" });
            const ts = data.createdAt as Timestamp | null | undefined;
            return {
              id: d.id,
              uid: typeof data.uid === "string" ? data.uid : "",
              createdAt: ts && typeof ts.toDate === "function" ? ts.toDate() : null,
              payload: await decryptMessage(cryptoKey, chat.id, data),
            };
          })
        ).then((list) => {
          if (current !== seq.current) return;
          list.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
          setItems(list);
        });
      },
      () => setItems([])
    );
  }, [chat.id, cryptoKey]);

  const jump = (id: string) => {
    onJump(id);
    if (window.matchMedia("(max-width: 1023px)").matches) onClose();
  };

  return (
    <aside className="fixed inset-0 z-30 flex flex-col bg-neutral-950 lg:static lg:z-auto lg:w-80 lg:shrink-0 lg:border-l lg:border-neutral-900">
      <div className="flex shrink-0 items-center gap-2 border-b border-neutral-900 px-3 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-2 text-neutral-300 hover:bg-neutral-900"
          aria-label="Cerrar destacados"
        >
          <span className="lg:hidden">
            <BackIcon />
          </span>
          <span className="hidden lg:block">
            <CloseIcon />
          </span>
        </button>
        <div className="min-w-0">
          <p className="text-[15px] font-medium">Destacados</p>
          <p className="truncate text-xs text-neutral-500">{chat.name}</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {items === null ? (
          <p className="px-3 py-6 text-center text-sm text-neutral-600">Cargando…</p>
        ) : items.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-neutral-500">
            No hay mensajes destacados. Mantén pulsado un mensaje (o clic derecho) y elige «Destacar».
          </p>
        ) : (
          <ul className="space-y-1">
            {items.map((m) => (
              <li key={m.id} className="flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-neutral-900">
                <button type="button" onClick={() => jump(m.id)} className="min-w-0 flex-1 text-left">
                  <span className="block text-[11px] text-neutral-500">
                    {m.uid === uid ? "Tú" : ws.nameOf(m.uid)}
                    {m.createdAt ? ` · ${dayLabel(m.createdAt)} ${formatTime(m.createdAt)}` : ""}
                  </span>
                  <span className="mt-0.5 line-clamp-3 block whitespace-pre-wrap break-words text-sm text-neutral-200">
                    {m.payload ? previewOf(m.payload) : "No se pudo descifrar este mensaje."}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void setStar(getFirebase().db, chat.id, m.id, false).catch(() => undefined)}
                  className="shrink-0 rounded-full p-1.5 text-amber-400 hover:bg-neutral-800"
                  aria-label="Quitar destacado"
                  title="Quitar destacado"
                >
                  <StarIcon filled className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
