"use client";

/**
 * Login.tsx — Inicio de sesión con correo y contraseña.
 *
 * No hay registro desde la web: las dos cuentas se crean a mano en la consola
 * de Firebase, así nadie más puede darse de alta.
 */

import { useState, type FormEvent } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { getFirebase } from "@/lib/firebase";

function loginErrorMessage(code: string): string {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-email":
      return "Correo o contraseña incorrectos.";
    case "auth/user-disabled":
      return "Esta cuenta está desactivada.";
    case "auth/too-many-requests":
      return "Demasiados intentos. Espera unos minutos y vuelve a probar.";
    case "auth/network-request-failed":
      return "Sin conexión. Revisa tu internet.";
    default:
      return "No se pudo iniciar sesión.";
  }
}

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(getFirebase().auth, email.trim(), password);
      // onAuthStateChanged en page.tsx cambia a la vista del chat.
    } catch (err) {
      setError(loginErrorMessage((err as { code?: string }).code ?? ""));
      setBusy(false);
    }
  };

  return (
    <div className="flex h-dvh items-center justify-center bg-neutral-950 px-4 text-neutral-200">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <h1 className="text-lg font-medium tracking-tight">Iniciar sesión</h1>

        <input
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="correo"
          className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-base outline-none transition-colors focus:border-neutral-600"
        />

        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="contraseña"
          className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-base outline-none transition-colors focus:border-neutral-600"
        />

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={busy || !email.trim() || !password}
          className="w-full rounded-md bg-neutral-100 py-2.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-30"
        >
          {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
