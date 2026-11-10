"use client";

/**
 * VoiceNote.tsx — Reproductor de notas de voz.
 *
 * El audio se descarga y descifra al pulsar reproducir. Si este navegador no
 * reproduce el formato con que se grabó (pasa entre algunos navegadores), se
 * ofrece descargarlo.
 */

import { useEffect, useRef, useState } from "react";
import { formatDuration, type FileInfo } from "@/lib/chats";
import { downloadFile, getFileUrl, type FileStore } from "@/lib/files";
import { getFirebase } from "@/lib/firebase";
import { DownloadIcon, PauseIcon, PlayIcon } from "./Icons";

export function VoiceNote({
  file,
  duration,
  store,
  mine,
}: {
  file: FileInfo;
  duration: number;
  store: FileStore;
  mine: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [playable, setPlayable] = useState(true);
  const wantPlay = useRef(false);

  useEffect(() => {
    setPlayable(document.createElement("audio").canPlayType(file.mime) !== "");
  }, [file.mime]);

  // Cuando la URL está lista, reproduce si se pidió.
  useEffect(() => {
    const audio = audioRef.current;
    if (url && audio && wantPlay.current) {
      wantPlay.current = false;
      audio.play().catch(() => setState("error"));
    }
  }, [url]);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      return;
    }
    if (url) {
      audio.play().catch(() => setState("error"));
      return;
    }
    setState("loading");
    wantPlay.current = true;
    try {
      setUrl(await getFileUrl(getFirebase().db, store, file));
      setState("idle");
    } catch {
      wantPlay.current = false;
      setState("error");
    }
  };

  const total = duration > 0 ? duration : 0;
  const progress = total > 0 ? Math.min(1, current / total) : 0;

  if (!playable) {
    return (
      <div className="flex w-60 max-w-full items-center gap-3 px-1 py-0.5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Nota de voz · {formatDuration(total)}</p>
          <p className="text-[11px] opacity-60">Este navegador no la reproduce aquí</p>
        </div>
        <button
          type="button"
          onClick={() => void downloadFile(getFirebase().db, store, file)}
          className="shrink-0 rounded-full p-2 hover:bg-black/10"
          aria-label="Descargar nota de voz"
        >
          <DownloadIcon />
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-60 max-w-full items-center gap-2.5 px-0.5 py-0.5">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={state === "loading"}
        className={`shrink-0 rounded-full p-2 ${mine ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-900"} disabled:opacity-50`}
        aria-label={playing ? "Pausar nota de voz" : "Reproducir nota de voz"}
      >
        {state === "loading" ? (
          <span className="block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : playing ? (
          <PauseIcon className="h-4 w-4" />
        ) : (
          <PlayIcon className="h-4 w-4" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div
          className={`h-1.5 w-full overflow-hidden rounded-full ${mine ? "bg-neutral-900/20" : "bg-white/20"}`}
        >
          <div
            className={`h-full rounded-full ${mine ? "bg-neutral-900" : "bg-white"}`}
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <p className="mt-1 text-[11px] opacity-70">
          {state === "error"
            ? "No se pudo reproducir"
            : `${playing || current > 0 ? formatDuration(current) + " / " : ""}${formatDuration(total)}`}
        </p>
      </div>
      <audio
        ref={audioRef}
        src={url ?? undefined}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        className="hidden"
      />
    </div>
  );
}
