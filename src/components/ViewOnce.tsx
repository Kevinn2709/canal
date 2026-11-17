"use client";

/**
 * ViewOnce.tsx — Fotos y videos de una sola vista.
 *
 * - En el chat se ve una tarjeta, nunca la foto. Quien la recibe la abre una
 *   vez en pantalla completa; quien la envió ve "Abierta" cuando la vieron.
 * - El archivo se descifra sin caché. Al cerrar el visor se revoca la URL
 *   (URL.revokeObjectURL), se suelta el Blob y la tarjeta pasa a "Abierta".
 * - Sin botón de descarga, sin menú contextual ni arrastrar. Una web no puede
 *   impedir capturas de pantalla.
 */

import { useEffect, useRef, useState } from "react";
import { isVideo, type FileInfo } from "@/lib/chats";
import { getFileBlobNoCache, type FileStore } from "@/lib/files";
import { getFirebase } from "@/lib/firebase";
import { CloseIcon, OnceIcon } from "./Icons";

export function ViewOnceCard({
  file,
  mine,
  opened,
  openedByAll,
  onOpen,
}: {
  file: FileInfo;
  mine: boolean;
  opened: boolean; // ya la abrí (o la abrieron todos, si es mía)
  openedByAll: boolean;
  onOpen: () => void;
}) {
  const kind = isVideo(file) ? "Video" : "Foto";
  const label = mine ? (openedByAll ? "Abierta" : `${kind} · ver una vez`) : opened ? "Abierta" : `${kind} · ver una vez`;
  const canOpen = !mine && !opened;
  return (
    <button
      type="button"
      onClick={canOpen ? onOpen : undefined}
      disabled={!canOpen}
      className="flex w-56 max-w-full items-center gap-3 rounded-xl bg-black/10 px-3 py-2.5 text-left disabled:cursor-default"
      aria-label={canOpen ? `Abrir ${kind.toLowerCase()} de una vista` : label}
    >
      <OnceIcon className={`h-7 w-7 shrink-0 ${opened || openedByAll ? "opacity-40" : "text-sky-500"}`} />
      <span className="min-w-0">
        <span className={`block text-sm font-medium ${opened || openedByAll ? "opacity-60" : ""}`}>{label}</span>
        <span className="block text-[11px] opacity-60">
          {mine ? "Se borra cuando la vean" : opened ? "Ya no está disponible" : "Toca para verla una sola vez"}
        </span>
      </span>
    </button>
  );
}

export function ViewOnceViewer({
  file,
  store,
  onShown,
  onClose,
}: {
  file: FileInfo;
  store: FileStore;
  onShown: () => void; // se pudo mostrar: marcar como abierta
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const urlRef = useRef<string | null>(null);
  const shown = useRef(false);
  const onShownRef = useRef(onShown);
  onShownRef.current = onShown;

  useEffect(() => {
    let cancelled = false;
    let blob: Blob | null = null;
    getFileBlobNoCache(getFirebase().db, store, file)
      .then((b) => {
        if (cancelled) return;
        blob = b;
        const u = URL.createObjectURL(b);
        urlRef.current = u;
        setUrl(u);
        if (!shown.current) {
          shown.current = true;
          onShownRef.current();
        }
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      // Al cerrar: se revoca la URL y se suelta el archivo descifrado.
      cancelled = true;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
      blob = null;
      void blob;
    };
  }, [file, store]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const block = (e: { preventDefault(): void }) => e.preventDefault();

  return (
    <div className="fixed inset-0 z-50 flex select-none flex-col bg-black" onContextMenu={block}>
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] text-neutral-200">
        <span className="flex items-center gap-2 text-sm">
          <OnceIcon className="h-5 w-5 text-sky-500" />
          Se ve una sola vez
        </span>
        <button type="button" onClick={onClose} className="rounded-full p-2 hover:bg-white/10" aria-label="Cerrar">
          <CloseIcon />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-2">
        {failed ? (
          <p className="text-sm text-neutral-400">Ya no está disponible.</p>
        ) : !url ? (
          <span className="block h-6 w-6 animate-spin rounded-full border-2 border-neutral-500 border-t-transparent" />
        ) : isVideo(file) ? (
          <video
            src={url}
            autoPlay
            playsInline
            controls
            controlsList="nodownload noremoteplayback"
            disablePictureInPicture
            onContextMenu={block}
            className="max-h-full max-w-full"
          />
        ) : (
          <img src={url} alt="" draggable={false} onContextMenu={block} className="pointer-events-none max-h-full max-w-full object-contain" />
        )}
      </div>
    </div>
  );
}
