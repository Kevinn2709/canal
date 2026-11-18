"use client";

/**
 * /vinculada — La cuenta de miembro vinculada, dentro del ícono de chat del
 * monitor del fundador (iframe del mismo sitio).
 *
 * Usa su propia instancia de Firebase (ver lib/scope.ts), así que su sesión,
 * sus llaves y sus chats no se mezclan con los del fundador. Nunca toca el
 * push del dispositivo.
 *
 * Mensajes con la página de arriba (solo del mismo sitio):
 *   ← { type: "canal-widget", open }   panel abierto o cerrado
 *   → { type: "canal-hello" }          ya cargó; pide el estado del panel
 *   → { type: "canal-unread", n }      no leídos (número del ícono)
 *   → { type: "canal-attention" }      llamada entrante: abrir el panel
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getFirebase, isConfigured } from "@/lib/firebase";
import { getLinked, onLinkedChange, type LinkedAccount } from "@/lib/linked";
import { logoutHere } from "@/lib/logout";
import { homeBarInset } from "@/lib/veil";
import type { Session } from "@/lib/session";
import { Login } from "@/components/Login";
import { Unlock } from "@/components/Unlock";
import { Waiting } from "@/components/Waiting";
import { AppReady } from "@/components/AppReady";

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh items-center justify-center bg-neutral-950 px-6 text-center text-sm text-neutral-400">
      <div className="max-w-sm space-y-3">{children}</div>
    </div>
  );
}

function post(msg: unknown): void {
  if (window.parent !== window) window.parent.postMessage(msg, window.location.origin);
}

export default function LinkedPage() {
  const [inFrame, setInFrame] = useState<boolean | null>(null);
  const [linked, setLinked] = useState<LinkedAccount | null | undefined>(undefined);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [active, setActive] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const parentInset = useRef(0);

  // Dentro del panel: las pantallas ocupan el iframe y no repiten el margen
  // de la muesca del teléfono (ya lo pone la barra "Mensajes" de arriba).
  useEffect(() => {
    document.documentElement.classList.add("in-panel");
    return () => document.documentElement.classList.remove("in-panel");
  }, []);

  useEffect(() => {
    setInFrame(window.parent !== window);
    setLinked(getLinked());
    return onLinkedChange(setLinked);
  }, []);

  useEffect(() => {
    if (!isConfigured()) {
      setReady(true);
      return;
    }
    const { auth } = getFirebase();
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setSession((s) => (s && u && s.uid === u.uid ? s : null));
      setReady(true);
    });
  }, []);

  // Estado del panel (abierto o cerrado) que manda la página de arriba.
  useEffect(() => {
    if (window.parent === window) return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== window.parent) return;
      const d = e.data as { type?: string; open?: unknown; inset?: unknown } | null;
      if (d?.type === "canal-widget") {
        setActive(d.open === true);
        if (typeof d.inset === "number") parentInset.current = d.inset;
      }
    };
    window.addEventListener("message", onMessage);
    post({ type: "canal-hello" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Velo de privacidad (lo pone la página de arriba):
  // - Al perder el foco se avisa: si arriba tampoco lo tienen, se salió de la
  //   app con este chat abierto.
  // - Un dedo en la barra de inicio del iPhone (franja de abajo) se avisa al
  //   momento: es el inicio del gesto para salir, antes de la foto del
  //   selector de apps.
  useEffect(() => {
    if (window.parent === window) return;
    // Dentro del iframe la zona segura vale 0: se usa la que manda la página
    // de arriba.
    const own = homeBarInset();
    const edgeNow = () => {
      const inset = Math.max(own, parentInset.current);
      return inset >= 12 ? inset - 4 : 0;
    };
    let armed = false;
    let startY = 0;
    const onBlur = () => post({ type: "canal-blur" });
    const onTouchStart = (e: TouchEvent) => {
      const edge = edgeNow();
      if (!edge || e.touches.length !== 1) return;
      const y = e.touches[0].clientY;
      if (y >= window.innerHeight - edge) {
        armed = true;
        startY = y;
        post({ type: "canal-edge", phase: "start" });
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!armed) return;
      armed = false;
      const y = e.changedTouches[0]?.clientY ?? startY;
      post({ type: "canal-edge", phase: "end", tap: e.type === "touchend" && Math.abs(y - startY) < 12 });
    };
    const capture = { capture: true, passive: true } as const;
    window.addEventListener("blur", onBlur);
    document.addEventListener("touchstart", onTouchStart, capture);
    document.addEventListener("touchend", onTouchEnd, capture);
    document.addEventListener("touchcancel", onTouchEnd, capture);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("touchstart", onTouchStart, capture);
      document.removeEventListener("touchend", onTouchEnd, capture);
      document.removeEventListener("touchcancel", onTouchEnd, capture);
    };
  }, []);

  // Si la sesión abierta no es la cuenta vinculada (se desvinculó o se
  // cambió), se cierra y se olvida su llave en este dispositivo.
  useEffect(() => {
    if (!ready || linked === undefined || !user) return;
    if (!linked || user.uid !== linked.uid) void logoutHere(user.uid);
  }, [ready, linked, user]);

  const onReady = useCallback((s: Session) => {
    if (s.admin) {
      setProblem("Solo se puede vincular una cuenta de miembro, no de fundador ni de admin. Elige otra en la consola.");
      void logoutHere(s.uid);
      return;
    }
    setProblem(null);
    setSession(s);
  }, []);

  const onUnread = useCallback((n: number) => post({ type: "canal-unread", n }), []);
  const onAttention = useCallback(() => post({ type: "canal-attention" }), []);

  if (!ready || inFrame === null || linked === undefined) return <div className="h-dvh bg-neutral-950" />;

  if (!inFrame) {
    return (
      <Note>
        <p>Esta página se abre desde el ícono de chat del monitor.</p>
      </Note>
    );
  }

  if (!isConfigured()) {
    return (
      <Note>
        <p>Falta la configuración de Firebase.</p>
      </Note>
    );
  }

  if (!linked) {
    return (
      <Note>
        <p>No hay una cuenta vinculada.</p>
        <p className="text-xs text-neutral-500">Vincúlala desde la consola: Configuración → Cuenta vinculada.</p>
      </Note>
    );
  }

  if (problem) {
    return (
      <Note>
        <p className="text-amber-300">{problem}</p>
      </Note>
    );
  }

  if (!user) return <Login title="Cuenta vinculada" note={`Entra con la cuenta de ${linked.name}.`} />;
  if (user.uid !== linked.uid) return <Note>Cambiando de cuenta…</Note>;
  if (!session) {
    return (
      <Unlock
        key={user.uid}
        user={user}
        onReady={onReady}
        defaultRemember
        note={`Cuenta vinculada: ${linked.name}. Se recordará en este dispositivo para abrirla directo desde el monitor.`}
      />
    );
  }
  if (!session.ws) return <Waiting session={session} email={user.email ?? ""} onSession={setSession} />;
  return (
    <AppReady
      user={user}
      session={session}
      onSession={setSession}
      embedded
      active={active}
      onUnread={onUnread}
      onAttention={onAttention}
    />
  );
}
