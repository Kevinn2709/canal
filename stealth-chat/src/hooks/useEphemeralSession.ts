/**
 * useEphemeralSession.ts — Estado de la conversación en RAM, con caducidad.
 *
 * Volatilidad:
 *  - Nada toca localStorage / sessionStorage / IndexedDB / cookies.
 *  - Los mensajes caducan 24 h DESPUÉS de ser recibidos por el destinatario
 *    (modo "desaparecen", estilo Signal) y se podan de la RAM solos.
 *  - Al recargar, cerrar pestaña o "Cerrar sesión" se pierde todo igualmente.
 *
 * Reloj de caducidad:
 *  - Mensaje recibido  -> expiresAt = momento de recepción + 24 h.
 *  - Mensaje propio    -> pendiente (expiresAt null) hasta que el relay
 *                         confirma la entrega; entonces expiresAt = ahora + 24 h.
 *
 * Límite honesto: JavaScript no puede borrar RAM a prueba de forense, y el SO
 * puede volcar memoria a swap. Esto reduce la ventana de exposición; no la
 * elimina.
 */

import { useCallback, useEffect, useState } from "react";

export interface ChatMessage {
  id: string;
  mine: boolean;
  text: string;
  ts: number;
  expiresAt: number | null; // null = aún sin contar (pendiente de entrega)
  pending: boolean; // true = enviado, aún no confirmado por el relay
}

export interface SessionState {
  unlocked: boolean;
  messages: ChatMessage[];
}

const PRUNE_INTERVAL_MS = 15_000;

export function useEphemeralSession() {
  const [state, setState] = useState<SessionState>({
    unlocked: false,
    messages: [],
  });

  const unlock = useCallback(() => {
    setState((s) => ({ ...s, unlocked: true }));
  }, []);

  const addMessage = useCallback((m: ChatMessage) => {
    setState((s) => ({ ...s, messages: [...s.messages, m] }));
  }, []);

  // Marca un mensaje propio como entregado e inicia su reloj de 24 h.
  const markDelivered = useCallback((id: string, expiresAt: number) => {
    setState((s) => ({
      ...s,
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, pending: false, expiresAt } : m
      ),
    }));
  }, []);

  const wipe = useCallback(() => {
    setState({ unlocked: false, messages: [] });
  }, []);

  // Poda periódica: elimina de la RAM los mensajes ya caducados.
  useEffect(() => {
    if (!state.unlocked) return;
    const t = setInterval(() => {
      const now = Date.now();
      setState((s) => {
        const kept = s.messages.filter(
          (m) => m.expiresAt === null || m.expiresAt > now
        );
        return kept.length === s.messages.length ? s : { ...s, messages: kept };
      });
    }, PRUNE_INTERVAL_MS);
    return () => clearInterval(t);
  }, [state.unlocked]);

  return { state, unlock, addMessage, markDelivered, wipe };
}
