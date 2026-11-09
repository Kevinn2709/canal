"use client";

/**
 * page.tsx — Encadena las pantallas:
 *   sin sesión -> Login
 *   con sesión, sin llave -> Unlock (frase de cifrado)
 *   con sesión y llave -> Shell (conversaciones)
 */

import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getFirebase, isConfigured } from "@/lib/firebase";
import { Login } from "@/components/Login";
import { Unlock } from "@/components/Unlock";
import { Shell } from "@/components/Shell";

export default function Page() {
  const [configured, setConfigured] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(null);
  const [ready, setReady] = useState(false);
  const currentUid = useRef<string | null>(null);

  useEffect(() => {
    if (!isConfigured()) {
      setConfigured(false);
      setReady(true);
      return;
    }
    const { auth } = getFirebase();
    return onAuthStateChanged(auth, (u) => {
      // Si cambia la cuenta (o se cierra sesión), se olvida la llave.
      const uid = u ? u.uid : null;
      if (uid !== currentUid.current) {
        currentUid.current = uid;
        setCryptoKey(null);
      }
      setUser(u);
      setReady(true);
    });
  }, []);

  if (!ready) {
    return <div className="h-dvh bg-neutral-950" />;
  }

  if (!configured) {
    return (
      <div className="flex h-dvh items-center justify-center bg-neutral-950 px-6 text-neutral-200">
        <div className="max-w-sm space-y-2 text-center">
          <p className="text-base font-medium">Falta la configuración de Firebase</p>
          <p className="text-sm text-neutral-500">
            Pega la configuración de tu proyecto en src/lib/firebase-config.ts y
            vuelve a subir el archivo.
          </p>
        </div>
      </div>
    );
  }

  if (!user) return <Login />;
  if (!cryptoKey) return <Unlock user={user} onUnlock={setCryptoKey} />;
  return <Shell user={user} cryptoKey={cryptoKey} />;
}
