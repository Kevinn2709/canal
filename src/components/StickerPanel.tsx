"use client";

/**
 * StickerPanel.tsx — Biblioteca de stickers (compartida por todos los miembros).
 * Tocar uno lo envía. "+" convierte cualquier imagen en sticker. "Editar"
 * permite quitar stickers de la biblioteca.
 */

import { useEffect, useRef, useState } from "react";
import type { FileInfo } from "@/lib/chats";
import { getFileUrl, libraryFileStore } from "@/lib/files";
import { getFirebase } from "@/lib/firebase";
import { addSticker, hideSticker } from "@/lib/stickers";
import { useStickers } from "@/hooks/useStickers";
import { CloseIcon, PlusIcon } from "./Icons";

function StickerThumb({ file, ws }: { file: FileInfo; ws: CryptoKey }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getFileUrl(getFirebase().db, libraryFileStore(ws), file)
      .then((u) => !cancelled && setUrl(u))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [file, ws]);
  return url ? (
    <img src={url} alt="sticker" className="h-full w-full object-contain" />
  ) : (
    <span className="block h-full w-full animate-pulse rounded-lg bg-neutral-800" />
  );
}

export function StickerPanel({
  ws,
  uid,
  onPick,
}: {
  ws: CryptoKey;
  uid: string;
  onPick: (file: FileInfo) => void;
}) {
  const stickers = useStickers(ws);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const add = async (files: File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    for (const f of files.slice(0, 10)) {
      try {
        await addSticker(getFirebase().db, ws, uid, f);
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo agregar el sticker.");
      }
    }
    setBusy(false);
  };

  return (
    <div className="shrink-0 border-t border-neutral-900 px-3 pb-1 pt-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-neutral-500">Stickers</span>
        {stickers && stickers.length > 0 && (
          <button onClick={() => setEditing((v) => !v)} className="text-xs text-neutral-400 hover:underline">
            {editing ? "Listo" : "Editar"}
          </button>
        )}
      </div>
      <div className="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-neutral-700 text-neutral-400 hover:bg-neutral-900 disabled:opacity-50"
          aria-label="Agregar sticker"
        >
          {busy ? (
            <span className="block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <PlusIcon />
          )}
          <span className="text-[10px]">{busy ? "Subiendo" : "Agregar"}</span>
        </button>
        {(stickers ?? []).map((s) => (
          <div key={s.id} className="relative aspect-square">
            <button
              type="button"
              onClick={() => !editing && onPick(s.file)}
              className="h-full w-full rounded-lg p-1 hover:bg-neutral-900"
              aria-label="Enviar sticker"
            >
              <StickerThumb file={s.file} ws={ws} />
            </button>
            {editing && (
              <button
                type="button"
                onClick={() => void hideSticker(getFirebase().db, s.id).catch(() => undefined)}
                className="absolute -right-1 -top-1 rounded-full bg-neutral-700 p-0.5 text-white"
                aria-label="Quitar sticker"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      {stickers && stickers.length === 0 && !busy && (
        <p className="mt-2 text-xs text-neutral-500">
          Aún no hay stickers. Pulsa "Agregar" y elige cualquier imagen: se recorta a tamaño de
          sticker. Los PNG con fondo transparente quedan mejor.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          void add(files);
        }}
      />
    </div>
  );
}
