/**
 * useVoiceRecorder.ts — Grabar notas de voz con el micrófono.
 *
 * Usa el mejor formato que grabe el navegador, en este orden: AAC en MP4 (se
 * reproduce en cualquier navegador), luego Opus en WebM u Ogg. El micrófono
 * se libera en cuanto termina la grabación.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export const MAX_VOICE_SECONDS = 300;

const PREFERRED_TYPES = [
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
];

export interface Recording {
  blob: Blob;
  mime: string;
  seconds: number;
}

function pickType(): string {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }
  return PREFERRED_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

export function extensionFor(mime: string): string {
  if (mime.startsWith("audio/mp4")) return "m4a";
  if (mime.startsWith("audio/ogg")) return "ogg";
  return "webm";
}

export function useVoiceRecorder(onRecorded: (recording: Recording) => void) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const tick = useRef<number | null>(null);
  const keep = useRef(false);
  const callback = useRef(onRecorded);
  callback.current = onRecorded;

  const release = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (tick.current) window.clearInterval(tick.current);
    tick.current = null;
  };

  /** Termina la grabación. `send` = true la entrega; false la descarta. */
  const stop = useCallback((send: boolean) => {
    keep.current = send;
    const r = recorder.current;
    if (r && r.state !== "inactive") r.stop();
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Este navegador no permite grabar audio.");
      return;
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("No se pudo usar el micrófono. Revisa el permiso del navegador para este sitio.");
      return;
    }
    const type = pickType();
    let r: MediaRecorder;
    try {
      r = new MediaRecorder(stream.current, type ? { mimeType: type } : undefined);
    } catch {
      release();
      setError("Este navegador no puede grabar audio.");
      return;
    }
    chunks.current = [];
    keep.current = false;
    r.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data);
    };
    r.onstop = () => {
      const elapsed = (Date.now() - startedAt.current) / 1000;
      release();
      recorder.current = null;
      setRecording(false);
      setSeconds(0);
      const mime = r.mimeType || type || "audio/webm";
      const blob = new Blob(chunks.current, { type: mime });
      if (keep.current && blob.size > 0 && elapsed >= 0.5) {
        callback.current({ blob, mime, seconds: elapsed });
      }
    };
    recorder.current = r;
    r.start(250);
    startedAt.current = Date.now();
    setSeconds(0);
    setRecording(true);
    tick.current = window.setInterval(() => {
      const s = (Date.now() - startedAt.current) / 1000;
      setSeconds(s);
      if (s >= MAX_VOICE_SECONDS) stop(true);
    }, 250);
  }, [stop]);

  // Si se sale de la conversación mientras graba, se descarta y se libera el micrófono.
  useEffect(
    () => () => {
      keep.current = false;
      const r = recorder.current;
      if (r && r.state !== "inactive") r.stop();
      release();
    },
    []
  );

  return { recording, seconds, error, start, stop, clearError: () => setError(null) };
}
