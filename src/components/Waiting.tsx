"use client";

/**
 * Waiting.tsx — Cuenta nueva esperando aprobación.
 *
 * Muestra tu código de seguridad. Otro miembro lo compara contigo (en
 * persona o por llamada) y te aprueba desde Configuración → Miembros; en ese
 * momento esta pantalla avanza sola.
 */

import { useEffect, useState, type FormEvent } from "react";
import { signOut } from "firebase/auth";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase";
import { securityCode } from "@/lib/crypto";
import { acceptWrap, addLegacyKey, legacyRawFromPhrase, probeLegacy, type Session } from "@/lib/session";
import { clearKeys } from "@/lib/keystore";
import { ShieldIcon } from "./Icons";

export function Waiting({ session, email, onSession }: { session: Session; email: string; onSession: (s: Session) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [canUseOld, setCanUseOld] = useState(false);
  const [oldPhrase, setOldPhrase] = useState("");
  const [busy, setBusy] = useState(false);

  // ¿Ya me aprobaron?
  useEffect(() => {
    const { db } = getFirebase();
    let handled = "";
    return onSnapshot(
      doc(db, "wraps", session.uid),
      (snap) => {
        const d = snap.data();
        if (!d || d.fp !== session.identity.fp || typeof d.from !== "string") return;
        const sig = `${d.from}:${d.iv}`;
        if (handled === sig) return;
        handled = sig;
        void (async () => {
          try {
            const from = await getDoc(doc(db, "users", d.from as string));
            const pub = from.data()?.pub;
            if (typeof pub !== "string") throw new Error("sin llave");
            onSession(
              await acceptWrap(db, session, { from: d.from as string, fp: d.fp as string, iv: String(d.iv), ct: String(d.ct) }, pub)
            );
          } catch {
            setError("Llegó una aprobación, pero no se pudo abrir. Pide que te aprueben de nuevo.");
          }
        })();
      },
      () => undefined
    );
  }, [session, onSession]);

  // Un fundador puede entrar solo con la frase compartida de antes.
  useEffect(() => {
    if (!session.founder) return;
    void probeLegacy(getFirebase().db)
      .then((r) => setCanUseOld(!!r.meta))
      .catch(() => undefined);
  }, [session.founder]);

  const useOld = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !oldPhrase.trim()) return;
    setBusy(true);
    setError(null);
    const { db } = getFirebase();
    try {
      const { meta } = await probeLegacy(db);
      const raw = meta ? await legacyRawFromPhrase(meta, oldPhrase) : null;
      if (!raw) {
        setError("La frase compartida no coincide con la de antes.");
        setBusy(false);
        return;
      }
      onSession(await addLegacyKey(db, session, raw));
    } catch {
      setError("No se pudo guardar. Revisa tu conexión.");
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-neutral-950 px-4 py-8 text-neutral-200">
      <div className="w-full max-w-sm space-y-5">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400">
          <ShieldIcon className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-medium tracking-tight">Falta que te aprueben</h1>
        <p className="text-sm text-neutral-400">
          Pide a otro miembro que entre a <strong className="text-neutral-200">Configuración → Miembros</strong> y te
          apruebe. Antes, comparen este código en persona o por llamada: debe ver exactamente el mismo.
        </p>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-4 text-center">
          <p className="text-[11px] uppercase tracking-wider text-neutral-500">Tu código de seguridad</p>
          <p className="mt-1 font-mono text-xl tracking-wider text-neutral-100">{securityCode(session.identity.fp)}</p>
        </div>
        <p className="text-xs text-neutral-500">Esta pantalla avanza sola en cuanto te aprueben.</p>

        {canUseOld && (
          <form onSubmit={useOld} className="space-y-2 border-t border-neutral-900 pt-4">
            <p className="text-xs text-neutral-400">¿Recordaste la frase compartida de antes? Con ella entras sin esperar.</p>
            <input
              type="password"
              autoComplete="off"
              value={oldPhrase}
              onChange={(e) => setOldPhrase(e.target.value)}
              placeholder="frase compartida de antes"
              className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-base outline-none focus:border-neutral-600"
            />
            <button
              type="submit"
              disabled={busy || !oldPhrase.trim()}
              className="w-full rounded-md border border-neutral-700 py-2 text-sm text-neutral-200 disabled:opacity-30"
            >
              {busy ? "Comprobando…" : "Usar la frase de antes"}
            </button>
          </form>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          onClick={() => void clearKeys().then(() => signOut(getFirebase().auth))}
          className="w-full text-center text-xs text-neutral-500 underline-offset-2 hover:underline"
        >
          Cerrar sesión ({email})
        </button>
      </div>
    </div>
  );
}
