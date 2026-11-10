"use client";

/**
 * Unlock.tsx — La frase personal.
 *
 * - Primera vez: creas tu frase personal (solo tú la sabes). Si eres uno de
 *   los dos fundadores y ya existía el chat, escribes también una última vez
 *   la frase compartida de antes, para traer el historial.
 * - Las siguientes veces: escribes tu frase (o entra sola si elegiste
 *   recordarla en este dispositivo).
 * - Si la olvidas: se crea una nueva y otro miembro te vuelve a dar acceso
 *   (los fundadores recuperan solos el historial con la frase compartida).
 */

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { signOut, type User } from "firebase/auth";
import { getFirebase } from "@/lib/firebase";
import { normalizePhrase, phraseProblem } from "@/lib/crypto";
import {
  NotAuthorizedError,
  buildSession,
  createAccount,
  legacyRawFromPhrase,
  loadKeysDoc,
  openBundle,
  personalKeyFor,
  probeLegacy,
  type KeysDoc,
  type LegacyMeta,
  type Session,
} from "@/lib/session";
import { clearKeys, forgetKeys, keyId, loadKey, saveKey } from "@/lib/keystore";
import { clearFileCache } from "@/lib/files";

type Mode = "loading" | "unauthorized" | "offline" | "unlock" | "setup" | "reset";

const inputClass =
  "w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-base outline-none transition-colors focus:border-neutral-600";
const buttonClass =
  "w-full rounded-md bg-neutral-100 py-2.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-30";

export async function rememberOnDevice(session: Session, remember: boolean): Promise<void> {
  if (remember) await saveKey(session.uid, keyId(session.uid, session.salt), session.personalKey);
  else await forgetKeys(session.uid);
}

export function Unlock({ user, onReady }: { user: User; onReady: (s: Session) => void }) {
  const [mode, setMode] = useState<Mode>("loading");
  const [founder, setFounder] = useState(false);
  const [legacyMeta, setLegacyMeta] = useState<LegacyMeta | null>(null);
  const [kd, setKd] = useState<KeysDoc | null>(null);
  const [phrase, setPhrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [oldPhrase, setOldPhrase] = useState("");
  const [skipOld, setSkipOld] = useState(false);
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setMode("loading");
    setError(null);
    const { db } = getFirebase();
    try {
      const keys = await loadKeysDoc(db, user.uid);
      const legacy = await probeLegacy(db);
      setFounder(legacy.founder);
      setLegacyMeta(legacy.meta);
      setKd(keys);
      if (!keys) {
        setMode("setup");
        return;
      }
      const saved = await loadKey(keyId(user.uid, keys.salt));
      if (saved) {
        const bundle = await openBundle(saved, user.uid, keys);
        if (bundle) {
          onReady(await buildSession(user.uid, legacy.founder, saved, keys, bundle));
          return;
        }
      }
      setMode("unlock");
    } catch (err) {
      setMode(err instanceof NotAuthorizedError ? "unauthorized" : "offline");
    }
  }, [user.uid, onReady]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitUnlock = async (e: FormEvent) => {
    e.preventDefault();
    if (!kd || busy || !phrase.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const key = await personalKeyFor(phrase, kd);
      const bundle = await openBundle(key, user.uid, kd);
      if (!bundle) {
        setError("La frase no coincide. Es tu frase personal (la que creaste tú), no la de otra persona.");
        setBusy(false);
        return;
      }
      const session = await buildSession(user.uid, founder, key, kd, bundle);
      await rememberOnDevice(session, remember);
      onReady(session);
    } catch {
      setError("No se pudo comprobar la frase. Intenta de nuevo.");
      setBusy(false);
    }
  };

  const submitSetup = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const problem = phraseProblem(phrase);
    if (problem) return setError(problem);
    if (normalizePhrase(phrase) !== normalizePhrase(confirm)) return setError("Las dos frases no coinciden.");
    const usesOld = founder && !!legacyMeta && !skipOld;
    if (usesOld && !oldPhrase.trim()) return setError("Escribe la frase compartida de antes, o marca que no la recuerdas.");
    if (usesOld && normalizePhrase(oldPhrase) === normalizePhrase(phrase)) {
      return setError(
        "Tu frase personal debe ser distinta a la compartida: la compartida la conoce tu socio, la personal solo tú."
      );
    }
    setBusy(true);
    setError(null);
    const { db } = getFirebase();
    try {
      let legacyRaw: Uint8Array | null = null;
      if (usesOld && legacyMeta) {
        legacyRaw = await legacyRawFromPhrase(legacyMeta, oldPhrase);
        if (!legacyRaw) {
          setError("La frase compartida no coincide con la de antes. Revísala palabra por palabra.");
          setBusy(false);
          return;
        }
      }
      const session = await createAccount(db, {
        uid: user.uid,
        founder,
        phrase,
        legacyRaw,
        freshInstall: founder && !legacyMeta,
      });
      await rememberOnDevice(session, remember);
      onReady(session);
    } catch (err) {
      setError(
        (err as { code?: string }).code === "permission-denied"
          ? "Tu cuenta no tiene permiso para guardar. Revisa las reglas de Firestore."
          : "No se pudo guardar. Revisa tu conexión e intenta de nuevo."
      );
      setBusy(false);
    }
  };

  const logout = async () => {
    clearFileCache();
    await clearKeys();
    await signOut(getFirebase().auth);
  };

  const copyUid = () => {
    void navigator.clipboard
      ?.writeText(user.uid)
      .then(() => setCopied(true))
      .catch(() => undefined);
  };

  if (mode === "loading") {
    return <div className="flex h-dvh items-center justify-center bg-neutral-950 text-sm text-neutral-500">Cargando…</div>;
  }

  const phraseProps = {
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
        {mode === "unauthorized" && (
          <>
            <h1 className="text-lg font-medium tracking-tight">Tu cuenta aún no tiene acceso</h1>
            <p className="text-sm text-neutral-400">
              Pide a quien administra el chat que agregue este UID a las reglas de Firestore y las publique. Luego
              vuelve a entrar.
            </p>
            <div className="flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2">
              <code className="min-w-0 flex-1 break-all text-sm text-neutral-200">{user.uid}</code>
              <button onClick={copyUid} className="shrink-0 text-xs text-neutral-400 underline">
                {copied ? "Copiado" : "Copiar"}
              </button>
            </div>
            <button onClick={() => void load()} className={buttonClass}>
              Reintentar
            </button>
          </>
        )}

        {mode === "offline" && (
          <>
            <h1 className="text-lg font-medium tracking-tight">No se pudo conectar</h1>
            <p className="text-sm text-neutral-400">Revisa tu internet e intenta de nuevo.</p>
            <button onClick={() => void load()} className={buttonClass}>
              Reintentar
            </button>
          </>
        )}

        {mode === "unlock" && (
          <form onSubmit={submitUnlock} className="space-y-4">
            <h1 className="text-lg font-medium tracking-tight">Escribe tu frase personal</h1>
            <p className="text-sm text-neutral-400">
              Es la frase que creaste tú. No importan mayúsculas, acentos, signos ni espacios de más.
            </p>
            <input {...phraseProps} autoFocus value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="tu frase personal" />
            <Options show={show} setShow={setShow} remember={remember} setRemember={setRemember} />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button type="submit" disabled={busy || !phrase.trim()} className={buttonClass}>
              {busy ? "Comprobando…" : "Entrar"}
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setPhrase("");
                setMode("reset");
              }}
              className="w-full text-center text-xs text-neutral-500 underline-offset-2 hover:underline"
            >
              ¿Olvidaste tu frase?
            </button>
          </form>
        )}

        {mode === "reset" && (
          <div className="space-y-4">
            <h1 className="text-lg font-medium tracking-tight">Crear una frase nueva</h1>
            <p className="text-sm text-neutral-400">
              Tu frase anterior no se puede recuperar (nadie la conoce, ni siquiera Firebase). Si creas una nueva:
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-neutral-400">
              <li>Otro miembro tendrá que volver a aprobarte desde Configuración → Miembros.</li>
              <li>En cuanto alguien de cada chat abra la web, recuperarás ese chat con todo su historial.</li>
              {founder && legacyMeta && (
                <li>Con la frase compartida de antes recuperas al momento las conversaciones de antes.</li>
              )}
            </ul>
            <button onClick={() => setMode("setup")} className={buttonClass}>
              Crear frase nueva
            </button>
            <button
              onClick={() => setMode("unlock")}
              className="w-full text-center text-xs text-neutral-500 underline-offset-2 hover:underline"
            >
              Volver
            </button>
          </div>
        )}

        {mode === "setup" && (
          <form onSubmit={submitSetup} className="space-y-4">
            {founder && legacyMeta ? (
              <>
                <h1 className="text-lg font-medium tracking-tight">Ahora cada quien tiene su frase</h1>
                <p className="text-sm text-neutral-400">
                  Para poder sumar más miembros, cada persona tiene su propia frase personal y nadie más necesita
                  saberla. Escribe una última vez la frase compartida de antes para traer el historial.
                </p>
                {!skipOld && (
                  <input
                    {...phraseProps}
                    autoFocus
                    value={oldPhrase}
                    onChange={(e) => setOldPhrase(e.target.value)}
                    placeholder="frase compartida de antes"
                  />
                )}
                <label className="flex items-start gap-2 text-xs text-neutral-500">
                  <input type="checkbox" className="mt-0.5" checked={skipOld} onChange={(e) => setSkipOld(e.target.checked)} />
                  <span>No la recuerdo: mi socio me dará acceso desde su cuenta.</span>
                </label>
              </>
            ) : (
              <>
                <h1 className="text-lg font-medium tracking-tight">Crea tu frase personal</h1>
                <p className="text-sm text-neutral-400">
                  Con ella se protege tu llave para leer los chats. Es solo tuya: no se la digas a nadie.
                </p>
              </>
            )}
            <p className="text-xs text-neutral-500">
              Cuatro o cinco palabras sin relación entre sí. No importan mayúsculas, acentos, signos ni espacios de más.
            </p>
            <input
              {...phraseProps}
              autoFocus={!(founder && legacyMeta) || skipOld}
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder="nueva frase personal"
            />
            <input {...phraseProps} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="repite la frase personal" />
            <Options show={show} setShow={setShow} remember={remember} setRemember={setRemember} />
            <p className="text-xs text-amber-400/80">
              Si la olvidas, otro miembro tendrá que volver a darte acceso.
            </p>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button type="submit" disabled={busy || !phrase || !confirm} className={buttonClass}>
              {busy ? "Cifrando…" : "Guardar y entrar"}
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
        <input type="checkbox" className="mt-1" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <span>
          Recordar en este dispositivo
          <span className="block text-xs text-neutral-500">
            No tendrás que escribirla cada vez, pero quien tenga este teléfono desbloqueado podrá leer el chat.
          </span>
        </span>
      </label>
    </div>
  );
}
