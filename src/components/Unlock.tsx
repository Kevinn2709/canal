"use client";

/**
 * Unlock.tsx — Pantalla de la frase de cifrado.
 *
 * - Si la conversación aún no tiene frase: la crea (con confirmación) y guarda
 *   en Firestore solo la sal y una prueba de verificación.
 * - Si ya tiene: comprueba la frase contra esa prueba. Si no coincide, lo dice
 *   claramente en vez de abrir una conversación vacía.
 * - Si los dos crean una frase a la vez, gana la primera que se guarda y el
 *   otro pasa a escribir esa.
 */

import { useEffect, useState, type FormEvent } from "react";
import { signOut, type User } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase";
import {
  DEFAULT_ITERATIONS,
  deriveKey,
  makeCheck,
  normalizePhrase,
  phraseProblem,
  randomSalt,
  verifyKey,
} from "@/lib/crypto";
import { clearKeys, deleteKey, keyId, loadKey, saveKey } from "@/lib/keystore";

interface Meta {
  salt: string;
  iterations: number;
  checkIv: string;
  checkCt: string;
  createdBy: string;
}

type Mode = "loading" | "create" | "verify" | "blocked";

async function loadMeta(): Promise<Meta | null> {
  const snap = await getDoc(doc(getFirebase().db, "meta", "crypto"));
  if (!snap.exists()) return null;
  const d = snap.data() ?? {};
  if (
    typeof d.salt !== "string" ||
    typeof d.iterations !== "number" ||
    typeof d.checkIv !== "string" ||
    typeof d.checkCt !== "string"
  ) {
    throw new Error("meta/crypto tiene un formato inesperado");
  }
  return {
    salt: d.salt,
    iterations: d.iterations,
    checkIv: d.checkIv,
    checkCt: d.checkCt,
    createdBy: typeof d.createdBy === "string" ? d.createdBy : "",
  };
}

async function keyFor(meta: Meta, phrase: string): Promise<CryptoKey | null> {
  const key = await deriveKey(phrase, meta.salt, meta.iterations);
  const ok = await verifyKey(key, { iv: meta.checkIv, ct: meta.checkCt });
  return ok ? key : null;
}

function errorCode(err: unknown): string {
  return (err as { code?: string }).code ?? "";
}

const inputClass =
  "w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-base outline-none transition-colors focus:border-neutral-600";

export function Unlock({
  user,
  onUnlock,
}: {
  user: User;
  onUnlock: (key: CryptoKey) => void;
}) {
  const [mode, setMode] = useState<Mode>("loading");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [phrase, setPhrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Al entrar: ¿ya existe la frase? ¿Hay una llave recordada que sirva?
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await loadMeta();
        if (cancelled) return;
        if (!m) {
          setMode("create");
          return;
        }
        setMeta(m);
        const saved = await loadKey(keyId(user.uid, m.salt));
        if (saved && (await verifyKey(saved, { iv: m.checkIv, ct: m.checkCt }))) {
          if (!cancelled) onUnlock(saved);
          return;
        }
        if (!cancelled) setMode("verify");
      } catch (err) {
        if (cancelled) return;
        setMode("blocked");
        setError(
          errorCode(err) === "permission-denied"
            ? "Tu cuenta no tiene acceso a la conversación. Revisa que tu UID esté en las reglas de Firestore."
            : "No se pudo conectar. Revisa tu internet y recarga la página."
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user.uid, onUnlock]);

  const finish = async (key: CryptoKey, salt: string) => {
    const id = keyId(user.uid, salt);
    if (remember) await saveKey(id, key);
    else await deleteKey(id);
    onUnlock(key);
  };

  const submitVerify = async (e: FormEvent) => {
    e.preventDefault();
    if (!meta || busy || !phrase.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const key = await keyFor(meta, phrase);
      if (key) {
        await finish(key, meta.salt);
        return;
      }
      setError(
        meta.createdBy === user.uid
          ? "La frase no coincide con la que creaste."
          : "La frase no coincide con la que creó tu socio. Pídele que te la confirme palabra por palabra."
      );
    } catch {
      setError("No se pudo comprobar la frase. Intenta de nuevo.");
    }
    setBusy(false);
  };

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const problem = phraseProblem(phrase);
    if (problem) {
      setError(problem);
      return;
    }
    if (normalizePhrase(phrase) !== normalizePhrase(confirm)) {
      setError("Las dos frases no coinciden.");
      return;
    }
    setBusy(true);
    setError(null);
    const { db } = getFirebase();
    try {
      const salt = randomSalt();
      const key = await deriveKey(phrase, salt, DEFAULT_ITERATIONS);
      const check = await makeCheck(key);
      await setDoc(doc(db, "meta", "crypto"), {
        salt,
        iterations: DEFAULT_ITERATIONS,
        checkIv: check.iv,
        checkCt: check.ct,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });
      await finish(key, salt);
      return;
    } catch (err) {
      // Lo más probable: tu socio creó la frase justo antes. Se comprueba si
      // la tuya coincide con la suya.
      try {
        const m = await loadMeta();
        if (m) {
          setMeta(m);
          const key = await keyFor(m, phrase);
          if (key) {
            await finish(key, m.salt);
            return;
          }
          setMode("verify");
          setConfirm("");
          setError(
            "Tu socio ya había creado una frase y no coincide con la tuya. Escribe la que él creó."
          );
          setBusy(false);
          return;
        }
      } catch {
        // Sigue abajo con el error original.
      }
      setError(
        errorCode(err) === "permission-denied"
          ? "Tu cuenta no tiene permiso para crear la frase. Revisa las reglas de Firestore."
          : "No se pudo guardar. Revisa tu conexión e intenta de nuevo."
      );
      setBusy(false);
    }
  };

  const logout = async () => {
    await clearKeys();
    await signOut(getFirebase().auth);
  };

  if (mode === "loading") {
    return (
      <div className="flex h-dvh items-center justify-center bg-neutral-950 text-sm text-neutral-500">
        Cargando…
      </div>
    );
  }

  const phraseInputProps = {
    type: show ? "text" : "password",
    autoComplete: "off",
    autoCapitalize: "none",
    autoCorrect: "off",
    spellCheck: false,
    className: inputClass,
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-neutral-950 px-4 py-8 text-neutral-200">
      <div className="w-full max-w-sm space-y-4">
        {mode === "blocked" && (
          <>
            <h1 className="text-lg font-medium tracking-tight">No se pudo abrir el chat</h1>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              onClick={() => window.location.reload()}
              className="w-full rounded-md bg-neutral-100 py-2.5 text-sm font-medium text-neutral-900"
            >
              Reintentar
            </button>
          </>
        )}

        {mode === "create" && (
          <form onSubmit={submitCreate} className="space-y-4">
            <h1 className="text-lg font-medium tracking-tight">Crea la frase de cifrado</h1>
            <p className="text-sm text-neutral-400">
              Con ella se cifran todos los mensajes. Tu socio tendrá que escribir
              esta misma frase para leerlos. Compártela en persona o por llamada,
              nunca por escrito.
            </p>
            <p className="text-xs text-neutral-500">
              No importan mayúsculas, acentos, signos ni espacios de más. Usa
              cuatro o cinco palabras sin relación entre sí.
            </p>
            <input
              {...phraseInputProps}
              autoFocus
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder="frase de cifrado"
            />
            <input
              {...phraseInputProps}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="repite la frase"
            />
            <Options show={show} setShow={setShow} remember={remember} setRemember={setRemember} />
            <p className="text-xs text-amber-400/80">
              Si los dos olvidan la frase, nadie podrá recuperar los mensajes, ni
              siquiera desde Firebase.
            </p>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={busy || !phrase || !confirm}
              className="w-full rounded-md bg-neutral-100 py-2.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-30"
            >
              {busy ? "Cifrando…" : "Crear y entrar"}
            </button>
          </form>
        )}

        {mode === "verify" && (
          <form onSubmit={submitVerify} className="space-y-4">
            <h1 className="text-lg font-medium tracking-tight">Escribe la frase de cifrado</h1>
            <p className="text-sm text-neutral-400">
              {meta?.createdBy === user.uid
                ? "Es la frase que creaste para esta conversación."
                : "Es la frase que creó tu socio. Si no la tienes, pídesela en persona o por llamada."}
            </p>
            <p className="text-xs text-neutral-500">
              No importan mayúsculas, acentos, signos ni espacios de más.
            </p>
            <input
              {...phraseInputProps}
              autoFocus
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder="frase de cifrado"
            />
            <Options show={show} setShow={setShow} remember={remember} setRemember={setRemember} />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={busy || !phrase.trim()}
              className="w-full rounded-md bg-neutral-100 py-2.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-30"
            >
              {busy ? "Comprobando…" : "Entrar"}
            </button>
          </form>
        )}

        <button
          onClick={() => void logout()}
          className="w-full text-center text-xs text-neutral-500 underline-offset-2 hover:underline"
        >
          Cerrar sesión ({user.email})
        </button>
      </div>
    </div>
  );
}

function Options({
  show,
  setShow,
  remember,
  setRemember,
}: {
  show: boolean;
  setShow: (v: boolean) => void;
  remember: boolean;
  setRemember: (v: boolean) => void;
}) {
  return (
    <div className="space-y-2 text-sm text-neutral-300">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
        Mostrar frase
      </label>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-1"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
        />
        <span>
          Recordar en este dispositivo
          <span className="block text-xs text-neutral-500">
            No tendrás que escribirla cada vez, pero quien tenga este teléfono
            desbloqueado podrá leer el chat.
          </span>
        </span>
      </label>
    </div>
  );
}
