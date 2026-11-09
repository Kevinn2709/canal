"use client";

/**
 * Chat.tsx — Interfaz de conversación.
 *
 * - Indica el estado de cada mensaje propio: "pendiente" (en cola, el otro
 *   está offline) o entregado.
 * - "Cerrar sesión" hace wipe inmediato de la RAM y vuelve al bloqueo.
 */

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/hooks/useEphemeralSession";

interface Props {
  messages: ChatMessage[];
  status: string;
  disappearHours: number;
  onSend: (text: string) => void;
  onLock: () => void;
}

export function Chat({ messages, status, disappearHours, onSend, onLock }: Props) {
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  };

  return (
    <div className="min-h-screen flex flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center justify-between px-4 py-3 border-b border-neutral-900">
        <div className="min-w-0">
          <p className="text-sm font-medium">Canal cifrado</p>
          <p className="text-xs text-neutral-500 truncate">{status}</p>
        </div>
        <button
          onClick={onLock}
          className="shrink-0 rounded-md border border-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-900 transition-colors"
        >
          Cerrar sesión
        </button>
      </header>

      <div className="px-4 py-2 bg-neutral-900/40 border-b border-neutral-900">
        <p className="text-[11px] text-neutral-500 leading-tight">
          Los mensajes desaparecen de ambos lados ~{disappearHours} h después de
          que tu contacto los recibe. Nada se guarda en este dispositivo.
        </p>
      </div>

      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {messages.length === 0 && (
          <p className="text-sm text-neutral-600 text-center mt-8">
            Sin mensajes todavía.
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.mine ? "justify-end" : "justify-start"}`}
          >
            <div className={`max-w-[75%] ${m.mine ? "items-end" : "items-start"} flex flex-col`}>
              <div
                className={`rounded-2xl px-3.5 py-2 text-sm ${
                  m.mine
                    ? "bg-neutral-100 text-neutral-900"
                    : "bg-neutral-800 text-neutral-100"
                }`}
              >
                {m.text}
              </div>
              {m.mine && (
                <span className="text-[10px] text-neutral-600 mt-0.5 px-1">
                  {m.pending ? "pendiente de entrega" : "entregado"}
                </span>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </main>

      <form
        onSubmit={submit}
        className="flex gap-2 px-4 py-3 border-t border-neutral-900"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Mensaje…"
          autoComplete="off"
          className="flex-1 rounded-full bg-neutral-900 border border-neutral-800 px-4 py-2 text-sm outline-none focus:border-neutral-600 transition-colors"
        />
        <button
          type="submit"
          className="rounded-full bg-neutral-100 text-neutral-900 px-4 py-2 text-sm font-medium hover:bg-white transition-colors"
        >
          Enviar
        </button>
      </form>
    </div>
  );
}
