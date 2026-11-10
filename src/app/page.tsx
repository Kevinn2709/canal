"use client";

/**
 * page.tsx — Encadena las pantallas:
 *   sin sesión -> Login
 *   con sesión, sin desbloquear -> Unlock (frase personal)
 *   sin aprobación todavía -> Waiting (código de seguridad)
 *   sin perfil -> ProfileSetup (nombre y foto)
 *   todo listo -> Shell (chats)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getFirebase, isConfigured } from "@/lib/firebase";
import type { Session } from "@/lib/session";
import { useMyProfile } from "@/hooks/useMyProfile";
import { Login } from "@/components/Login";
import { Unlock } from "@/components/Unlock";
import { Waiting } from "@/components/Waiting";
import { ProfileSetup } from "@/components/ProfileEditor";
import { Shell } from "@/components/Shell";

export default function Page() {
  const [configured, setConfigured] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
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
      // Si cambia la cuenta (o se cierra sesión), se olvidan las llaves.
      const uid = u ? u.uid : null;
      if (uid !== currentUid.current) {
        currentUid.current = uid;
        setSession(null);
      }
      setUser(u);
      setReady(true);
    });
  }, []);

  const onReady = useCallback((s: Session) => setSession(s), []);

  if (!ready) return <div className="h-dvh bg-neutral-950" />;

  if (!configured) {
    return (
      <div className="flex h-dvh items-center justify-center bg-neutral-950 px-6 text-neutral-200">
        <div className="max-w-sm space-y-2 text-center">
          <p className="text-base font-medium">Falta la configuración de Firebase</p>
          <p className="text-sm text-neutral-500">
            Pega la configuración de tu proyecto en src/lib/firebase-config.ts y vuelve a subir el archivo.
          </p>
        </div>
      </div>
    );
  }

  if (!user) return <Login />;
  if (!session || session.uid !== user.uid) return <Unlock key={user.uid} user={user} onReady={onReady} />;
  if (!session.ws) return <Waiting session={session} email={user.email ?? ""} onSession={onReady} />;
  return <Ready user={user} session={session} onSession={onReady} />;
}

function Ready({ user, session, onSession }: { user: User; session: Session; onSession: (s: Session) => void }) {
  const profile = useMyProfile(session);
  if (profile.loading) {
    return <div className="flex h-dvh items-center justify-center bg-neutral-950 text-sm text-neutral-500">Cargando…</div>;
  }
  if (!profile.valid) return <ProfileSetup session={session} />;
  return <Shell user={user} session={session} onSession={onSession} />;
}
