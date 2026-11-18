"use client";

/**
 * ConsolaFundador.tsx — Los chats del fundador, a pantalla completa.
 *
 * Se abre desde el monitor escribiendo `root` en "Filtrar dominio…". Tiene
 * todo lo de la app: presencia, "escribiendo…", palomitas, gestos, fotos de
 * una sola vista, texto oculto, alias y ajustes del grupo. En Configuración
 * está además "Cuenta vinculada".
 *
 * Retorno automático: si la web pasa a segundo plano o se bloquea la pantalla
 * (visibilityState = "hidden"), la consola se cierra y se vuelve al monitor.
 * Al cerrarse:
 * - Un velo con desenfoque cubre la pantalla en ese mismo instante y se
 *   desvanece al volver, ya sobre el monitor.
 * - Se quitan de la pantalla y de la memoria los mensajes ya descifrados (en
 *   Firestore no se borra nada).
 * - Se corta la conexión con Realtime Database: tu presencia pasa al momento
 *   a "desconectado".
 * - Las notificaciones push siguen llegando: son del servidor y van a tu
 *   cuenta de fundador.
 * No se cierra sola durante una llamada ni mientras eliges una foto o archivo
 * (el selector del teléfono pone la web en segundo plano un momento).
 */

import { useEffect } from "react";
import type { User } from "firebase/auth";
import type { Session } from "@/lib/session";
import { setRtdbConnected } from "@/lib/firebase";
import { consoleHeld, holdConsole, releaseAll, releaseConsole } from "@/lib/consoleGuard";
import { showVeil } from "@/lib/veil";
import { AppReady } from "./AppReady";
import { VincularMiembro } from "./VincularMiembro";

const PICKER_HOLD_MS = 2 * 60_000;
const PICKER_RELEASE_DELAY_MS = 2_000;

export function ConsolaFundador({
  user,
  session,
  onSession,
  onExit,
}: {
  user: User;
  session: Session;
  onSession: (s: Session) => void;
  onExit: () => void;
}) {
  // Realtime Database: conectada solo mientras la consola está abierta.
  useEffect(() => {
    setRtdbConnected(true);
    return () => {
      releaseAll();
      // Sin chat abierto ni marcas en la URL al volver al monitor.
      window.history.replaceState(null, "", window.location.pathname);
      setRtdbConnected(false);
    };
  }, []);

  useEffect(() => {
    let releaseTimer: number | undefined;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (!consoleHeld()) {
          // El velo va primero y sin esperar a React: cubre los chats en el
          // mismo instante en que la web pasa a segundo plano.
          showVeil();
          onExit();
        }
      } else {
        window.clearTimeout(releaseTimer);
        releaseTimer = window.setTimeout(() => releaseConsole("archivo"), PICKER_RELEASE_DELAY_MS);
      }
    };
    // Abrir el selector de fotos o archivos (o la cámara).
    const onClick = (e: MouseEvent) => {
      const t = e.target;
      if (t instanceof HTMLInputElement && t.type === "file") holdConsole("archivo", PICKER_HOLD_MS);
    };
    const onFocus = () => {
      window.clearTimeout(releaseTimer);
      releaseTimer = window.setTimeout(() => releaseConsole("archivo"), PICKER_RELEASE_DELAY_MS);
    };

    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("click", onClick, true);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(releaseTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("focus", onFocus);
    };
  }, [onExit]);

  return (
    <div className="vista-in h-dvh">
      <AppReady
        user={user}
        session={session}
        onSession={onSession}
        manageTitle={false}
        onExitConsole={onExit}
        extraSettings={(ws) => <VincularMiembro ws={ws} myUid={session.uid} />}
      />
    </div>
  );
}
