"use client";

/**
 * LockScreen.tsx — Pantalla de bloqueo honesta.
 *
 * No finge ser otra cosa. Es, abiertamente, una cerradura: sin la passphrase
 * compartida no se entra, no se conecta al relay, no se deriva ninguna sala.
 * Esto da privacidad real (quien no tenga la frase no pasa) sin simular ser
 * una app distinta.
 */

import { useState } from "react";

interface Props {
  onUnlock: (passphrase: string, token: string) => void;
}

export function LockScreen({ onUnlock }: Props) {
  const [value, setValue] = useState("");
  const [token, setToken] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const phrase = value.trim();
    if (phrase.length < 8 || token.trim().length < 16) return;
    onUnlock(phrase, token.trim());
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-200 px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5">
        <div className="space-y-1">
          <h1 className="text-lg font-medium tracking-tight">Canal cerrado</h1>
          <p className="text-sm text-neutral-500">
            Introduce la frase compartida para abrir la conversación. No se
            guarda en este dispositivo.
          </p>
        </div>

        <input
          type="password"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="frase compartida"
          className="w-full rounded-md bg-neutral-900 border border-neutral-800 px-3 py-2.5 text-sm outline-none focus:border-neutral-600 transition-colors"
        />

        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="token de acceso"
          className="w-full rounded-md bg-neutral-900 border border-neutral-800 px-3 py-2.5 text-sm outline-none focus:border-neutral-600 transition-colors"
        />

        <button
          type="submit"
          disabled={value.trim().length < 8 || token.trim().length < 16}
          className="w-full rounded-md bg-neutral-100 text-neutral-900 py-2.5 text-sm font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white transition-colors"
        >
          Abrir
        </button>

        <p className="text-xs text-neutral-600 leading-relaxed">
          Cifrado de extremo a extremo: la llave se deriva de la frase en este
          dispositivo; el servidor solo retransmite datos cifrados que no puede
          leer. Si tu contacto está offline, los guarda cifrados hasta
          entregarlos. Los mensajes desaparecen ~24 h después de recibidos.
        </p>
      </form>
    </div>
  );
}
