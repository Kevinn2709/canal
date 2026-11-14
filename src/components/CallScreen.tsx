"use client";

/**
 * CallScreen.tsx — Pantalla de una llamada 1 a 1: entrante (contestar o
 * rechazar), llamando, en curso (silenciar, cámara, colgar) y terminada.
 *
 * En curso muestra si la llamada va directo o por relevo, y un código de
 * ocho cifras: si los dos ven el mismo, nadie está en medio.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CallView } from "@/lib/callEngine";
import type { Calls } from "@/hooks/useCalls";
import type { Workspace } from "@/hooks/useWorkspace";
import { PersonAvatar } from "./Avatar";
import {
  CameraSwitchIcon,
  HangUpIcon,
  LockIcon,
  MicIcon,
  MicOffIcon,
  PhoneIcon,
  VideoIcon,
  VideoOffIcon,
} from "./Icons";

function useStream(stream: MediaStream | null) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || el.srcObject === stream) return;
    el.srcObject = stream;
    if (stream) void el.play().catch(() => undefined);
  }, [stream]);
  return ref;
}

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function RoundButton({
  label,
  onClick,
  tone = "neutral",
  active = false,
  children,
}: {
  label: string;
  onClick: () => void;
  tone?: "neutral" | "red" | "green";
  active?: boolean;
  children: ReactNode;
}) {
  const color =
    tone === "red"
      ? "bg-red-600 text-white hover:bg-red-500"
      : tone === "green"
        ? "bg-emerald-600 text-white hover:bg-emerald-500"
        : active
          ? "bg-white text-neutral-900"
          : "bg-white/15 text-white hover:bg-white/25";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-14 w-14 items-center justify-center rounded-full transition-colors ${color}`}
    >
      {children}
    </button>
  );
}

function Panel({ v, calls, ws }: { v: CallView; calls: Calls; ws: Workspace }) {
  const remoteVideo = useStream(v.remoteStream);
  const remoteAudio = useStream(v.remoteStream);
  const localVideo = useStream(v.cam ? v.localStream : null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (v.phase !== "active") return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [v.phase]);

  const name = ws.nameOf(v.peer);
  const live = v.phase !== "ended";
  const showRemoteVideo = v.remoteCam && (v.phase === "active" || v.phase === "reconnecting");
  const status =
    v.phase === "incoming"
      ? v.offeredVideo
        ? "Videollamada entrante"
        : "Llamada entrante"
      : v.phase === "outgoing"
        ? "Llamando…"
        : v.phase === "connecting"
          ? "Conectando…"
          : v.phase === "reconnecting"
            ? "Reconectando…"
            : v.phase === "active"
              ? clock(now - (v.startedAt ?? now))
              : v.endReason ?? "Llamada terminada";

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col overflow-hidden bg-neutral-950 text-white"
      role="dialog"
      aria-label={`Llamada con ${name}`}
    >
      {/* Audio del otro (siempre) y su video (si lo encendió). */}
      <audio ref={remoteAudio} autoPlay />
      <video
        ref={remoteVideo}
        autoPlay
        playsInline
        muted
        className={showRemoteVideo ? "absolute inset-0 h-full w-full bg-black object-cover" : "hidden"}
      />
      {showRemoteVideo && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-[5] h-56 bg-gradient-to-b from-black/70 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-48 bg-gradient-to-t from-black/70 to-transparent" />
        </>
      )}

      <div
        className={`relative z-10 flex flex-1 flex-col items-center px-6 pt-[max(3rem,env(safe-area-inset-top))] text-center ${
          showRemoteVideo ? "justify-start" : "justify-center"
        }`}
      >
        {!showRemoteVideo && (
          <div className={v.phase === "incoming" ? "animate-pulse" : ""}>
            <PersonAvatar ws={ws} uid={v.peer} size={112} />
          </div>
        )}
        <p className={`mt-4 text-xl font-medium ${showRemoteVideo ? "drop-shadow" : ""}`}>{name}</p>
        <p className="mt-1 text-sm tabular-nums text-neutral-300" aria-live="polite" data-testid="call-status">
          {status}
        </p>
        {v.phase === "active" && !v.remoteMic && <p className="mt-1 text-xs text-amber-300">Silenció su micrófono</p>}
        {(v.phase === "active" || v.phase === "reconnecting") && (
          <div className="mt-3 space-y-0.5 text-[11px] text-neutral-400">
            <p className="flex items-center justify-center gap-1">
              <LockIcon className="h-3 w-3" />
              Cifrada de extremo a extremo{v.route === "relay" ? " · por relevo" : v.route === "direct" ? " · directa" : ""}
            </p>
            {v.code && (
              <p>
                Código <span className="font-mono tracking-wider text-neutral-200" data-testid="call-code">{v.code}</span>
              </p>
            )}
          </div>
        )}
      </div>

      {v.cam && v.localStream && live && (
        <video
          ref={localVideo}
          autoPlay
          playsInline
          muted
          className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-20 h-40 w-28 rounded-xl border border-white/20 bg-black object-cover shadow-xl"
        />
      )}

      <div className="relative z-10 flex shrink-0 items-center justify-center gap-5 px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-6">
        {v.phase === "incoming" ? (
          <>
            <RoundButton label="Rechazar" tone="red" onClick={calls.decline}>
              <HangUpIcon className="h-7 w-7" />
            </RoundButton>
            <RoundButton label="Contestar" tone="green" onClick={() => calls.accept(false)}>
              <PhoneIcon className="h-6 w-6" />
            </RoundButton>
            {v.offeredVideo && (
              <RoundButton label="Contestar con video" tone="green" onClick={() => calls.accept(true)}>
                <VideoIcon className="h-6 w-6" />
              </RoundButton>
            )}
          </>
        ) : live ? (
          <>
            <RoundButton label={v.mic ? "Silenciar micrófono" : "Activar micrófono"} active={!v.mic} onClick={calls.toggleMic}>
              {v.mic ? <MicIcon className="h-6 w-6" /> : <MicOffIcon className="h-6 w-6" />}
            </RoundButton>
            <RoundButton label={v.cam ? "Apagar cámara" : "Encender cámara"} active={v.cam} onClick={calls.toggleCam}>
              {v.cam ? <VideoIcon className="h-6 w-6" /> : <VideoOffIcon className="h-6 w-6" />}
            </RoundButton>
            {v.cam && (
              <RoundButton label="Cambiar de cámara" onClick={calls.switchCamera}>
                <CameraSwitchIcon className="h-6 w-6" />
              </RoundButton>
            )}
            <RoundButton label="Colgar" tone="red" onClick={calls.hangup}>
              <HangUpIcon className="h-7 w-7" />
            </RoundButton>
          </>
        ) : (
          <button type="button" onClick={calls.dismiss} className="rounded-full bg-white/15 px-5 py-2.5 text-sm hover:bg-white/25">
            Cerrar
          </button>
        )}
      </div>
    </div>
  );
}

export function CallScreen({ calls, ws }: { calls: Calls; ws: Workspace }) {
  if (!calls.view) return null;
  return <Panel v={calls.view} calls={calls} ws={ws} />;
}
