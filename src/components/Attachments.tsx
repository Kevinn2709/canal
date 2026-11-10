"use client";

/**
 * Attachments.tsx — Cómo se ve cada adjunto dentro de un mensaje.
 *
 * - Foto: se descarga y descifra solo cuando aparece en pantalla. Al tocarla
 *   se abre a pantalla completa.
 * - Video y audio: se cargan al pulsar reproducir.
 * - Otros archivos: tarjeta con nombre, tamaño y botón de descarga.
 */

import { useEffect, useRef, useState } from "react";
import type { FileInfo } from "@/lib/chats";
import { isAudio, isVideo } from "@/lib/chats";
import { downloadFile, formatSize, getFileUrl, type FileStore } from "@/lib/files";
import { getFirebase } from "@/lib/firebase";
import { CloseIcon, DownloadIcon, FileIcon, PlayIcon } from "./Icons";

const MAX_IMAGE_WIDTH = 280;
const MAX_IMAGE_HEIGHT = 320;

function imageBox(file: FileInfo): { width: number; height: number } {
  const w = file.w ?? 1;
  const h = file.h ?? 1;
  const scale = Math.min(MAX_IMAGE_WIDTH / w, MAX_IMAGE_HEIGHT / h, 1);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

/** Descarga y descifra el archivo cuando el elemento aparece en pantalla. */
function useLazyFileUrl(ref: { readonly current: HTMLElement | null }, file: FileInfo, store: FileStore) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    const load = () => {
      getFileUrl(getFirebase().db, store, file)
        .then((u) => !cancelled && setUrl(u))
        .catch(() => !cancelled && setFailed(true));
    };
    if (typeof IntersectionObserver === "undefined") {
      load();
      return () => {
        cancelled = true;
      };
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          load();
        }
      },
      { rootMargin: "400px" }
    );
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [ref, file, store.key, store.base.join("/")]);

  return { url, failed };
}

export function ImageAttachment({
  file,
  store,
  onOpen,
}: {
  file: FileInfo;
  store: FileStore;
  onOpen: (file: FileInfo, url: string) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const { url, failed } = useLazyFileUrl(ref, file, store);
  const box = imageBox(file);

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => url && onOpen(file, url)}
      style={{ width: box.width, height: box.height }}
      className="block max-w-full overflow-hidden rounded-xl bg-neutral-700/40"
      aria-label={`Ver ${file.name}`}
    >
      {url ? (
        <img src={url} alt={file.name} className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-xs text-neutral-400">
          {failed ? "No se pudo cargar la foto" : "Cargando foto…"}
        </span>
      )}
    </button>
  );
}

const STICKER_MAX = 150;

export function StickerAttachment({ file, store }: { file: FileInfo; store: FileStore }) {
  const ref = useRef<HTMLDivElement>(null);
  const { url, failed } = useLazyFileUrl(ref, file, store);
  const w = file.w ?? 1;
  const h = file.h ?? 1;
  const scale = Math.min(STICKER_MAX / w, STICKER_MAX / h);
  return (
    <div ref={ref} style={{ width: Math.round(w * scale), height: Math.round(h * scale) }}>
      {url ? (
        <img src={url} alt="sticker" className="h-full w-full object-contain" />
      ) : (
        <span className="flex h-full w-full items-center justify-center rounded-xl bg-neutral-800/50 text-[10px] text-neutral-500">
          {failed ? "Sticker no disponible" : ""}
        </span>
      )}
    </div>
  );
}

export function FileAttachment({ file, store }: { file: FileInfo; store: FileStore }) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  const download = async () => {
    setState("loading");
    try {
      await downloadFile(getFirebase().db, store, file);
      setState("idle");
    } catch {
      setState("error");
    }
  };

  return (
    <div className="flex w-64 max-w-full items-center gap-3 rounded-xl bg-black/10 p-2.5">
      <FileIcon className="h-8 w-8 shrink-0 opacity-70" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{file.name}</p>
        <p className="text-[11px] opacity-60">
          {state === "error" ? "Error al descargar" : formatSize(file.size)}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void download()}
        disabled={state === "loading"}
        className="shrink-0 rounded-full p-2 transition-colors hover:bg-black/10 disabled:opacity-40"
        aria-label={`Descargar ${file.name}`}
      >
        {state === "loading" ? (
          <span className="block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <DownloadIcon />
        )}
      </button>
    </div>
  );
}

export function MediaAttachment({ file, store }: { file: FileInfo; store: FileStore }) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  const load = async () => {
    setState("loading");
    try {
      setUrl(await getFileUrl(getFirebase().db, store, file));
      setState("idle");
    } catch {
      setState("error");
    }
  };

  if (url && isVideo(file)) {
    return <video src={url} controls autoPlay playsInline className="max-h-80 w-72 max-w-full rounded-xl bg-black" />;
  }
  if (url && isAudio(file)) {
    return <audio src={url} controls autoPlay className="w-64 max-w-full" />;
  }

  return (
    <div className="flex w-64 max-w-full items-center gap-3 rounded-xl bg-black/10 p-2.5">
      <button
        type="button"
        onClick={() => void load()}
        disabled={state === "loading"}
        className="shrink-0 rounded-full bg-black/20 p-2.5 disabled:opacity-40"
        aria-label={`Reproducir ${file.name}`}
      >
        {state === "loading" ? (
          <span className="block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <PlayIcon />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{file.name}</p>
        <p className="text-[11px] opacity-60">
          {state === "error" ? "Error al cargar" : `${isVideo(file) ? "Video" : "Audio"} · ${formatSize(file.size)}`}
        </p>
      </div>
    </div>
  );
}

export function Lightbox({
  file,
  url,
  store,
  onClose,
}: {
  file: FileInfo;
  url: string;
  store: FileStore;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95" onClick={onClose}>
      <div
        className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] text-neutral-200"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="min-w-0 truncate text-sm">{file.name}</span>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => void downloadFile(getFirebase().db, store, file)}
            className="rounded-full p-2 hover:bg-white/10"
            aria-label="Descargar"
          >
            <DownloadIcon />
          </button>
          <button type="button" onClick={onClose} className="rounded-full p-2 hover:bg-white/10" aria-label="Cerrar">
            <CloseIcon />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-2">
        <img
          src={url}
          alt={file.name}
          onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    </div>
  );
}
