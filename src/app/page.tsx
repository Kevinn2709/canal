"use client";

/**
 * page.tsx — Qué se ve en la raíz (/), según la sesión y el papel.
 *
 * Sin sesión:
 *   Landing de mantenimiento + "Iniciar sesión" arriba (o tres toques en el
 *   pie). El ícono de chat se ve, pero al tocarlo solo avisa que hay que
 *   iniciar sesión.
 *
 * Miembros y admins (los papeles salen de las listas de firestore.rules, como
 * siempre):
 *   Se quedan en la landing y el ícono de chat abre sus chats, con sus
 *   permisos de siempre.
 *
 * Fundadores (lista founders() de las reglas):
 *   Monitor de dominios. Escribiendo `root` en "Filtrar dominio…" se abre la
 *   consola (sus chats). Si vincularon una cuenta de miembro, el ícono de chat
 *   del monitor abre esa cuenta. Si la web pasa a segundo plano, la consola
 *   vuelve sola al monitor.
 *
 * Con sesión (cualquier papel), al salir de la app se tapa la pantalla con un
 * desenfoque (VeloPrivacidad); no aparece al tocar dentro del ícono de chat.
 *
 * Tocar una notificación abre la web en "/#c=<chat>": en el monitor se guarda
 * ese chat y se abre directo al escribir `root`; en la landing se abre el
 * ícono de chat en ese chat.
 *
 * Rendimiento (0.8):
 * - Lo primero que se pinta (también desde el servidor) es la landing, o el
 *   esqueleto del monitor si este equipo es de un fundador: nunca una
 *   pantalla vacía.
 * - La consola, la app de chats, el inicio de sesión y la espera de
 *   aprobación se cargan aparte (next/dynamic) y se precargan en segundo
 *   plano cuando el teléfono está libre, para que `root` abra al instante.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getFirebase, isConfigured } from "@/lib/firebase";
import type { Session } from "@/lib/session";
import { restoreSession } from "@/lib/restore";
import { getLinked, onLinkedChange, type LinkedAccount } from "@/lib/linked";
import { monitorHint, rememberMonitor } from "@/lib/vista";
import { ChatWidget } from "@/components/ChatWidget";
import { LandingMantenimiento } from "@/components/LandingMantenimiento";
import { MonitorDominios, MonitorSkeleton } from "@/components/MonitorDominios";
import { VeloPrivacidad } from "@/components/VeloPrivacidad";
import { ChatListSkeleton, PanelSpinner } from "@/components/Skeletons";

// ---------- Módulos pesados: aparte y precargados ----------
const loadConsola = () => import("@/components/ConsolaFundador");
const loadApp = () => import("@/components/AppReady");
const loadLogin = () => import("@/components/Login");
const loadUnlock = () => import("@/components/Unlock");
const loadWaiting = () => import("@/components/Waiting");

const ConsolaFundador = dynamic(() => loadConsola().then((m) => m.ConsolaFundador), {
  ssr: false,
  loading: () => <ChatListSkeleton />,
});
const AppReady = dynamic(() => loadApp().then((m) => m.AppReady), { ssr: false, loading: () => <ChatListSkeleton /> });
const Login = dynamic(() => loadLogin().then((m) => m.Login), { ssr: false, loading: () => <PanelSpinner /> });
const Unlock = dynamic(() => loadUnlock().then((m) => m.Unlock), { ssr: false, loading: () => <PanelSpinner /> });
const Waiting = dynamic(() => loadWaiting().then((m) => m.Waiting), { ssr: false, loading: () => <ChatListSkeleton /> });

/** Corre `fn` cuando el navegador está libre (o en ~0.6 s si no lo soporta). */
function whenIdle(fn: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(fn, { timeout: 2500 });
    return () => window.cancelIdleCallback(id);
  }
  const t = window.setTimeout(fn, 600);
  return () => window.clearTimeout(t);
}

const CHAT_HASH = /^#c=([A-Za-z0-9_-]+)$/;
const AUTH_CLOSE_MS = 220;

/** Primer cuadro: landing o, si este equipo es de un fundador, el monitor. */
function Boot() {
  return (
    <>
      <div className="boot-landing">
        <LandingMantenimiento authLabel={null} onAuth={() => undefined} />
      </div>
      <div className="boot-monitor">
        <MonitorSkeleton />
      </div>
    </>
  );
}

export default function Page() {
  const [configured, setConfigured] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authClosing, setAuthClosing] = useState(false);
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [view, setView] = useState<"monitor" | "consola">("monitor");
  const [linked, setLinked] = useState<LinkedAccount | null>(null);
  const [unread, setUnread] = useState(0);
  const [hint, setHint] = useState(false);
  const pendingChat = useRef<string | null>(null);
  const currentUid = useRef<string | null>(null);

  // Al abrir: si viene de tocar una notificación (#c=…), se recuerda el chat.
  // La URL queda limpia (sin chat abierto ni marcas de una visita anterior).
  useEffect(() => {
    setHint(monitorHint());
    const m = window.location.hash.match(CHAT_HASH);
    if (m) pendingChat.current = m[1];
    if (window.location.hash || window.location.search) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    setLinked(getLinked());
    return onLinkedChange(setLinked);
  }, []);

  useEffect(() => {
    if (!isConfigured()) {
      setConfigured(false);
      setReady(true);
      return;
    }
    const { auth } = getFirebase();
    return onAuthStateChanged(auth, (u) => {
      // Si cambia la cuenta (o se cierra sesión), se olvidan las llaves y se
      // vuelve al inicio.
      const uid = u ? u.uid : null;
      if (uid !== currentUid.current) {
        currentUid.current = uid;
        setSession(null);
        setView("monitor");
        setWidgetOpen(false);
        setUnread(0);
      }
      if (!u) {
        rememberMonitor(false);
        setHint(false);
      }
      setUser(u);
      setReady(true);
    });
  }, []);

  // Con "Recordar en este dispositivo", la sesión se abre sola.
  useEffect(() => {
    if (!user || session) return;
    let cancelled = false;
    setRestoring(true);
    void restoreSession(user)
      .then((s) => {
        if (!cancelled && s) setSession(s);
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, session]);

  // ---------- Ventana de inicio de sesión (con animación de salida) ----------
  const closeAuth = useCallback(() => {
    setAuthClosing(true);
    window.setTimeout(() => {
      setAuthOpen(false);
      setAuthClosing(false);
    }, AUTH_CLOSE_MS);
  }, []);

  const openAuth = useCallback(() => {
    setAuthClosing(false);
    setAuthOpen(true);
  }, []);

  useEffect(() => {
    if (session && authOpen) closeAuth();
  }, [session, authOpen, closeAuth]);

  // Tocar una notificación con la web ya abierta (y sin chats montados).
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; chatId?: string } | null;
      if (d?.type === "open-chat" && d.chatId) pendingChat.current = d.chatId;
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, []);

  const founderView = !!session && session.founder && !!session.ws;

  // Recordar (en este equipo) si arrancar con el esqueleto del monitor.
  useEffect(() => {
    if (!session) return;
    rememberMonitor(founderView);
    setHint(founderView);
  }, [session, founderView]);

  // Precarga en segundo plano de lo que se va a usar después.
  useEffect(() => {
    if (!ready) return;
    if (founderView) return whenIdle(() => void loadConsola());
    if (session) return whenIdle(() => void loadApp());
    if (!user) return whenIdle(() => void loadLogin());
    return whenIdle(() => void Promise.all([loadUnlock(), loadWaiting()]));
  }, [ready, founderView, session, user]);

  // Miembros y admins: si venía de una notificación, se abre ese chat.
  useEffect(() => {
    if (!session || founderView) return;
    const id = pendingChat.current;
    if (!id) return;
    pendingChat.current = null;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#c=${id}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    setWidgetOpen(true);
  }, [session, founderView]);

  const enterConsole = useCallback(() => {
    const id = pendingChat.current;
    pendingChat.current = null;
    window.history.replaceState(null, "", `${window.location.pathname}${id ? `#c=${id}` : ""}`);
    setWidgetOpen(false);
    setView("consola");
  }, []);

  const exitConsole = useCallback(() => setView("monitor"), []);
  const openWidget = useCallback(() => setWidgetOpen(true), []);

  if (!ready) return <Boot />;

  if (!configured) {
    return (
      <div className="flex h-dvh items-center justify-center bg-neutral-950 px-6 text-neutral-200">
        <div className="max-w-sm space-y-2 text-center">
          <p className="text-base font-medium">Falta la configuración de Firebase</p>
          <p className="text-sm text-neutral-500">
            Agrega las variables NEXT_PUBLIC_FIREBASE_… en Vercel (Settings → Environment Variables) y vuelve a
            desplegar.
          </p>
        </div>
      </div>
    );
  }

  // ---------- Fundador: monitor o consola ----------
  if (founderView && user && session) {
    return (
      <>
        {view === "consola" ? (
          <ConsolaFundador user={user} session={session} onSession={setSession} onExit={exitConsole} />
        ) : (
          <MonitorDominios user={user} onRoot={enterConsole} />
        )}
        {view === "monitor" && linked && (
          <ChatWidget mode="linked" raised open={widgetOpen} onOpenChange={setWidgetOpen} linkedName={linked.name} />
        )}
        <VeloPrivacidad />
      </>
    );
  }

  // Un fundador con la sesión recordada: el esqueleto del monitor mientras
  // se abre su sesión (en lugar de la landing).
  if (user && !session && restoring && hint) return <MonitorSkeleton />;

  // ---------- Landing: visitantes, miembros y admins ----------
  const widgetMode = !user ? "inactive" : !session ? "locked" : "own";
  const authLabel = !user ? "Iniciar sesión" : !session && !restoring ? "Continuar" : null;

  return (
    <>
      <div>
        <LandingMantenimiento authLabel={authLabel} onAuth={openAuth} />
      </div>

      <ChatWidget
        mode={widgetMode}
        open={widgetOpen && widgetMode === "own"}
        onOpenChange={setWidgetOpen}
        onLockedTap={openAuth}
        unread={unread}
      >
        {user && session ? (
          session.ws ? (
            <AppReady
              user={user}
              session={session}
              onSession={setSession}
              embedded
              active={widgetOpen}
              onUnread={setUnread}
              onAttention={openWidget}
            />
          ) : (
            <Waiting session={session} email={user.email ?? ""} onSession={setSession} />
          )
        ) : null}
      </ChatWidget>

      {authOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Iniciar sesión">
          <div
            className={`absolute inset-0 bg-black/50 backdrop-blur-xl ${authClosing ? "anim-fade-out" : "anim-fade-in"}`}
            onClick={closeAuth}
            aria-hidden="true"
          />
          <div
            className={`in-panel relative h-full w-full overflow-y-auto bg-neutral-950 sm:h-[min(46rem,90dvh)] sm:max-w-md sm:rounded-[28px] sm:shadow-[0_30px_80px_rgba(0,0,0,0.7)] sm:ring-1 sm:ring-white/10 ${
              authClosing ? "anim-sheet-down sm:anim-fade-out" : "anim-sheet-up sm:anim-pop-in"
            }`}
          >
            <button
              type="button"
              onClick={closeAuth}
              className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-neutral-300 transition-colors hover:bg-white/15 sm:top-3"
              aria-label="Cerrar"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
            </button>
            {user ? <Unlock key={user.uid} user={user} onReady={setSession} /> : <Login />}
          </div>
        </div>
      )}

      {session && <VeloPrivacidad />}
    </>
  );
}
