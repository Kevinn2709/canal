/**
 * useCalls.ts — Llamadas 1 a 1 de toda la app.
 *
 * - Escucha chats/{id}/calls en tus chats de dos personas: si alguien te
 *   llama, suena aquí (y en tus otros dispositivos con la web abierta).
 * - Una sola llamada a la vez en este dispositivo; si ya estás en una, la
 *   otra persona recibe "Está en otra llamada".
 * - Limpia restos de llamadas que quedaron a medias (por ejemplo, si se
 *   cerraron las dos webs a la vez): sin contestar después de 2 min, o sin
 *   actividad después de 10 min.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { collection, doc, getDocs, onSnapshot, type DocumentData, type Timestamp } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase";
import { Call, deleteCallDocs, writeSignal, type CallView } from "@/lib/callEngine";
import { RING_MS, STALE_IDLE_MS, STALE_UNANSWERED_MS, openOffer, type Offer } from "@/lib/calls";
import type { ChatInfo } from "@/lib/chats";
import { closeCallNotifications, loadSettings } from "@/lib/push";
import type { Session } from "@/lib/session";
import { startRing } from "@/lib/sound";
import { useKeyedListeners, type Workspace } from "./useWorkspace";

export interface Calls {
  view: CallView | null;
  canCall: (chat: ChatInfo) => boolean;
  start: (chat: ChatInfo, video: boolean) => void;
  accept: (video: boolean) => void;
  decline: () => void;
  hangup: () => void;
  toggleMic: () => void;
  toggleCam: () => void;
  switchCamera: () => void;
  dismiss: () => void;
}

function ms(v: unknown): number | null {
  const ts = v as Timestamp | null | undefined;
  return ts && typeof ts.toDate === "function" ? ts.toDate().getTime() : null;
}

export function callsSupported(): boolean {
  return typeof window !== "undefined" && "RTCPeerConnection" in window && !!navigator.mediaDevices?.getUserMedia;
}

export function useCalls(session: Session, user: User, ws: Workspace): Calls {
  const me = session.uid;
  const [view, setView] = useState<CallView | null>(null);
  const current = useRef<Call | null>(null);
  const dev = useMemo(() => crypto.randomUUID().replace(/-/g, "").slice(0, 12), []);
  const handled = useRef(new Set<string>());
  const cleaning = useRef(new Set<string>());
  const chatsRef = useRef(ws.chats);
  chatsRef.current = ws.chats;

  const busy = () => !!current.current?.live;

  const make = (chatId: string, callId: string, key: CryptoKey, peer: string, role: "caller" | "callee", offer?: Offer) =>
    new Call({
      db: getFirebase().db,
      chatId,
      callId,
      key,
      me,
      peer,
      dev,
      role,
      offer,
      relayOnly: loadSettings().relayCalls,
      getToken: () => user.getIdToken(),
      onChange: setView,
    });

  // Restos de llamadas que nadie colgó bien.
  const maybeClean = async (chatId: string, callId: string, data: DocumentData) => {
    if (cleaning.current.has(callId)) return;
    cleaning.current.add(callId);
    const { db } = getFirebase();
    const created = ms(data.at) ?? Date.now();
    try {
      const snap = await getDocs(collection(db, "chats", chatId, "calls", callId, "sig"));
      let last = created;
      let answered = false;
      for (const d of snap.docs) {
        const x = d.data();
        last = Math.max(last, ms(x.at) ?? 0);
        if (x.from === data.to) answered = true;
      }
      const now = Date.now();
      if (now - last > STALE_IDLE_MS || (!answered && now - created > STALE_UNANSWERED_MS)) {
        await deleteCallDocs(db, chatId, callId, snap.docs.map((d) => d.id));
      } else {
        cleaning.current.delete(callId); // se vuelve a revisar con el próximo cambio
      }
    } catch {
      cleaning.current.delete(callId);
    }
  };

  const onCalls = async (chatId: string, docs: { id: string; data: DocumentData }[]) => {
    for (const { id, data } of docs) {
      if (current.current?.isFor(id) && current.current.live) continue;
      const created = ms(data.at) ?? Date.now();
      const age = Date.now() - created;
      const forMe = data.to === me && data.from !== me;
      if (!forMe || age > RING_MS + 5_000) {
        if (age > STALE_UNANSWERED_MS) void maybeClean(chatId, id, data);
        continue;
      }
      if (handled.current.has(id)) continue;
      handled.current.add(id);
      const chat = chatsRef.current.find((c) => c.id === chatId);
      if (!chat?.key || typeof data.from !== "string" || typeof data.iv !== "string" || typeof data.ct !== "string") continue;
      const offer = await openOffer(chat.key, chatId, id, data.from, me, { iv: data.iv, ct: data.ct });
      if (!offer) continue; // no viene de alguien con la llave del chat
      if (busy()) {
        void writeSignal(getFirebase().db, chat.key, chatId, id, me, { t: "busy", n: 1, dev }).catch(() => undefined);
        continue;
      }
      const call = make(chatId, id, chat.key, data.from, "callee", offer);
      current.current = call;
      setView(call.view);
      call.ring();
    }
  };
  const handler = useRef(onCalls);
  handler.current = onCalls;

  const callableIds = ws.chats
    .filter((c) => c.key && c.members.length === 2 && c.members.includes(me))
    .map((c) => c.id)
    .sort();
  useKeyedListeners(
    callableIds,
    (chatId) =>
      onSnapshot(
        collection(getFirebase().db, "chats", chatId, "calls"),
        (snap) =>
          void handler.current(
            chatId,
            snap.docs.map((d) => ({ id: d.id, data: d.data({ serverTimestamps: "estimate" }) }))
          ),
        () => undefined
      ),
    () => undefined
  );

  // Tonos y vibración.
  const phase = view?.phase;
  const viewChat = view?.chatId;
  useEffect(() => {
    if (phase === "incoming") {
      const stop = startRing("in");
      const buzz = () => navigator.vibrate?.([400, 200, 400]);
      buzz();
      const t = window.setInterval(buzz, 2500);
      return () => {
        stop();
        window.clearInterval(t);
        navigator.vibrate?.(0);
      };
    }
    if (phase === "outgoing") return startRing("out");
    return undefined;
  }, [phase]);

  // Al contestar o terminar, se quita el aviso de "Llamada entrante".
  useEffect(() => {
    if (viewChat && phase !== "incoming") void closeCallNotifications(viewChat);
  }, [viewChat, phase]);

  // La pantalla de "llamada terminada" se va sola.
  useEffect(() => {
    if (phase !== "ended") return;
    const t = window.setTimeout(() => {
      setView(null);
      current.current = null;
    }, 2500);
    return () => window.clearTimeout(t);
  }, [phase]);

  // Al cerrar la web (o la sesión), se cuelga.
  useEffect(() => {
    const bye = () => {
      if (current.current?.live) current.current.hangup();
    };
    window.addEventListener("pagehide", bye);
    return () => {
      window.removeEventListener("pagehide", bye);
      bye();
    };
  }, []);

  const start = useCallback(
    (chat: ChatInfo, video: boolean) => {
      if (busy() || !chat.key) return;
      const peer = chat.members.find((m) => m !== me);
      if (!peer) return;
      const { db } = getFirebase();
      const callId = doc(collection(db, "chats", chat.id, "calls")).id;
      handled.current.add(callId);
      const call = make(chat.id, callId, chat.key, peer, "caller");
      current.current = call;
      setView(call.view);
      void call.start(video);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [me, dev, user]
  );

  const canCall = useCallback(
    (chat: ChatInfo) => callsSupported() && !!chat.key && chat.members.length === 2 && chat.members.includes(me),
    [me]
  );

  return {
    view,
    canCall,
    start,
    accept: (video) => void current.current?.accept(video),
    decline: () => current.current?.decline(),
    hangup: () => current.current?.hangup(),
    toggleMic: () => current.current?.toggleMic(),
    toggleCam: () => void current.current?.toggleCam(),
    switchCamera: () => void current.current?.switchCamera(),
    dismiss: () => {
      if (current.current?.live) return;
      setView(null);
      current.current = null;
    },
  };
}
