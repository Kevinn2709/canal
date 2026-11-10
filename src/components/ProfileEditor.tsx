"use client";

/**
 * ProfileEditor.tsx — Tu nombre y tu foto (cifrados con la llave del espacio).
 * Se usa al entrar por primera vez y en Configuración.
 */

import { useRef, useState, type FormEvent } from "react";
import { getFirebase } from "@/lib/firebase";
import { MAX_PROFILE_NAME, colorFor, prepareAvatar, saveProfile } from "@/lib/members";
import type { Session } from "@/lib/session";
import { Avatar } from "./Avatar";

export function ProfileEditor({
  session,
  initialName,
  currentPhoto,
  currentPhotoUrl,
  submitLabel,
  onSaved,
}: {
  session: Session;
  initialName: string;
  currentPhoto: number;
  currentPhotoUrl: string | null;
  submitLabel: string;
  onSaved?: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [photo, setPhoto] = useState<Blob | null | undefined>(undefined); // undefined = sin cambios
  const [preview, setPreview] = useState<string | null>(currentPhotoUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const blob = await prepareAvatar(file);
      setPhoto(blob);
      setPreview(URL.createObjectURL(blob));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo usar esa foto.");
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await saveProfile(getFirebase().db, session, name, photo, currentPhoto);
      setPhoto(undefined);
      setSaved(true);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error && err.message.startsWith("Escribe") ? err.message : "No se pudo guardar. Revisa tu conexión.");
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded-full ring-offset-2 ring-offset-neutral-950 focus:ring-2 focus:ring-neutral-500"
          aria-label="Cambiar foto"
        >
          <Avatar name={name || "?"} color={colorFor(session.uid)} url={photo === null ? null : preview} size={72} />
        </button>
        <div className="space-y-1 text-sm">
          <button type="button" onClick={() => inputRef.current?.click()} className="block text-neutral-200 underline-offset-2 hover:underline">
            {preview && photo !== null ? "Cambiar foto" : "Agregar foto"}
          </button>
          {preview && photo !== null && (
            <button
              type="button"
              onClick={() => {
                setPhoto(null);
                setPreview(null);
              }}
              className="block text-xs text-neutral-500 underline-offset-2 hover:underline"
            >
              Quitar foto
            </button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            void pick(f);
          }}
        />
      </div>
      <label className="block space-y-1.5">
        <span className="text-xs text-neutral-400">Tu nombre</span>
        <input
          value={name}
          maxLength={MAX_PROFILE_NAME}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          placeholder="Cómo te verán los demás"
          className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-base outline-none focus:border-neutral-600"
        />
      </label>
      <p className="text-xs text-neutral-500">Tu nombre y tu foto se guardan cifrados; solo los ven los miembros.</p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy || !name.trim()}
        className="w-full rounded-md bg-neutral-100 py-2.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-30"
      >
        {busy ? "Guardando…" : saved ? "Guardado" : submitLabel}
      </button>
    </form>
  );
}

export function ProfileSetup({ session }: { session: Session }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-neutral-950 px-4 py-8 text-neutral-200">
      <div className="w-full max-w-sm space-y-5">
        <div>
          <h1 className="text-lg font-medium tracking-tight">Tu perfil</h1>
          <p className="mt-1 text-sm text-neutral-400">Así te verán los demás en los chats.</p>
        </div>
        <ProfileEditor session={session} initialName="" currentPhoto={0} currentPhotoUrl={null} submitLabel="Continuar" />
      </div>
    </div>
  );
}
