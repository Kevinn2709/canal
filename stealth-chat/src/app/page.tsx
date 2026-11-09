"use client";

/**
 * page.tsx — Orquesta: LockScreen -> deriva llave + sala -> relay -> Chat.
 *
 * Mensajería asíncrona: no hace falta coincidir en línea. Los mensajes se
 * entregan cuando el otro se conecta y desaparecen 24 h después de recibidos.
 */

import { useCallback, useState } from "react";
import { LockScreen } from "@/components/LockScreen";
import { Chat } from "@/components/Chat";
import { useEphemeralSession } from "@/hooks/useEphemeralSession";
import { useRelay } from "@/hooks/useRelay";
import { deriveMessageKey } from "@/lib/crypto";
import { deriveRoomId } from "@/lib/room";

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL || "http://localhost:4000";
const DISAPPEAR_HOURS = 24;
const DISAPPEAR_MS = DISAPPEAR_HOURS * 60 * 60 * 1000;

export default function Page() {
  const session = useEphemeralSession();
  const [room, setRoom] = useState("");
  const [token, setToken] = useState("");
  const [messageKey, setMessageKey] = useState<CryptoKey | null>(null);
  const [status, setStatus] = useState("");

  const onIncoming = useCallback(
    (id: string, text: string) => {
      session.addMessage({
        id,
        mine: false,
        text,
        ts: Date.now(),
        expiresAt: Date.now() + DISAPPEAR_MS, // 24 h desde que lo recibo
        pending: false,
      });
    },
    [session]
  );

  const onDelivered = useCallback(
    (id: string) => {
      // Mi mensaje llegó al otro: arranca su reloj de 24 h.
      session.markDelivered(id, Date.now() + DISAPPEAR_MS);
    },
    [session]
  );

  const onQueued = useCallback(() => {
    setStatus("tu contacto está offline; se entregará al conectarse");
  }, []);

  const { send } = useRelay({
    url: RELAY_URL,
    room,
    token,
    messageKey,
    onIncoming,
    onDelivered,
    onQueued,
    onStatus: setStatus,
  });

  const handleUnlock = useCallback(
    async (passphrase: string, accessToken: string) => {
      const key = await deriveMessageKey(passphrase);
      const r = await deriveRoomId(passphrase);
      setMessageKey(key);
      setRoom(r);
      setToken(accessToken);
      setStatus("conectando…");
      session.unlock();
    },
    [session]
  );

  const handleSend = useCallback(
    async (text: string) => {
      const id = crypto.randomUUID();
      // Se muestra como "pendiente" hasta que el relay confirme la entrega.
      session.addMessage({
        id,
        mine: true,
        text,
        ts: Date.now(),
        expiresAt: null,
        pending: true,
      });
      const ok = await send(id, text);
      if (!ok) setStatus("sin conexión; no se pudo enviar");
    },
    [send, session]
  );

  const handleLock = useCallback(() => {
    session.wipe();
    setRoom("");
    setToken("");
    setMessageKey(null);
    setStatus("");
  }, [session]);

  if (!session.state.unlocked) {
    return <LockScreen onUnlock={handleUnlock} />;
  }

  return (
    <Chat
      messages={session.state.messages}
      status={status}
      disappearHours={DISAPPEAR_HOURS}
      onSend={handleSend}
      onLock={handleLock}
    />
  );
}
