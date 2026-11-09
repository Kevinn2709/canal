/**
 * useRelay.ts — Conexión al relay y envío/recepción de blobs cifrados.
 *
 * Con llave derivada de la passphrase, no hay handshake: ciframos y
 * desciframos con la misma llave en ambos lados.
 *
 * Store-and-forward:
 *  - Al recibir un "cipher", desciframos y CONFIRMAMOS con ack({ok:true}).
 *    Esa confirmación es la señal para que el relay lo borre de su cola.
 *  - "delivered" -> un mensaje nuestro llegó al destinatario (arranca su 24h).
 *  - "queued"    -> el destinatario estaba offline; el relay lo guardó cifrado.
 */

import { useCallback, useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import {
  encryptMessage,
  decryptMessage,
  type EncryptedPayload,
} from "@/lib/crypto";

interface UseRelayArgs {
  url: string;
  room: string;
  token: string;
  messageKey: CryptoKey | null;
  onIncoming: (id: string, text: string) => void;
  onDelivered: (id: string) => void;
  onQueued: (id: string) => void;
  onStatus: (status: string) => void;
}

export function useRelay({
  url,
  room,
  token,
  messageKey,
  onIncoming,
  onDelivered,
  onQueued,
  onStatus,
}: UseRelayArgs) {
  const socketRef = useRef<Socket | null>(null);
  const keyRef = useRef<CryptoKey | null>(null);
  keyRef.current = messageKey;

  useEffect(() => {
    if (!messageKey || !room) return;

    const socket = io(url, {
      transports: ["websocket"],
      auth: { token },
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      onStatus("conectado");
      socket.emit("join", room);
    });

    socket.on("connect_error", (err) => {
      onStatus(
        err.message === "no autorizado"
          ? "acceso rechazado (token incorrecto)"
          : "no se pudo conectar"
      );
    });

    socket.on("joined", () => onStatus("en línea"));
    socket.on("peer-joined", () => onStatus("tu contacto está en línea"));
    socket.on("peer-left", () => onStatus("tu contacto se desconectó"));
    socket.on("room-full", () => onStatus("sala llena (ya hay dos)"));
    socket.on("disconnect", () => onStatus("desconectado"));

    // Mensaje entrante cifrado. Desciframos y confirmamos entrega con el ack.
    socket.on(
      "cipher",
      async (data: { id: string } & EncryptedPayload, ack: (r: unknown) => void) => {
        if (!keyRef.current) {
          ack({ ok: false });
          return;
        }
        try {
          const text = await decryptMessage(keyRef.current, {
            iv: data.iv,
            ct: data.ct,
          });
          onIncoming(data.id, text);
          ack({ ok: true }); // el relay borra el mensaje de su cola
        } catch {
          onStatus("mensaje descartado (no verificó)");
          ack({ ok: false }); // no confirmamos; el relay lo conserva
        }
      }
    );

    socket.on("delivered", ({ id }: { id: string }) => onDelivered(id));
    socket.on("queued", ({ id }: { id: string }) => onQueued(id));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageKey, room, url, token]);

  const send = useCallback(async (id: string, text: string) => {
    if (!socketRef.current || !keyRef.current) return false;
    const payload = await encryptMessage(keyRef.current, text);
    socketRef.current.emit("cipher", { id, ...payload });
    return true;
  }, []);

  return { send };
}
