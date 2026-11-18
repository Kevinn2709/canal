"use client";

/**
 * LandingMantenimiento.tsx — Lo que ve cualquiera al entrar a la raíz (/):
 * sitio en mantenimiento, al estilo de una página de producto.
 *
 * - Barra superior (vidrio) con "Iniciar sesión" discreto a la derecha.
 * - Tocar tres veces seguidas el pie de página también abre el inicio de
 *   sesión.
 * - Avance de la actualización, novedades, preguntas frecuentes (acordeón) y
 *   "Contactar soporte" (formulario en una hoja). Si en Vercel está
 *   NEXT_PUBLIC_SUPPORT_EMAIL, el formulario abre el correo con el mensaje
 *   listo; si no, solo confirma en pantalla (no se envía nada).
 *
 * Se puede pintar en el servidor (no lee window al dibujarse): así aparece
 * al instante mientras carga lo demás.
 *
 * Miembros y admins se quedan aquí después de iniciar sesión y usan el ícono
 * de chat. Los fundadores pasan al monitor de dominios.
 */

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Sheet } from "./ui/Sheet";
import {
  Bag,
  CheckmarkCircleFill,
  ChevronDown,
  ChevronRight,
  Envelope,
  GearWrench,
  ShieldCheck,
  Speedometer,
} from "./ui/symbols";

export const LANDING_TITLE = "Sitio en mantenimiento";
const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "";
const TRIPLE_TAP_MS = 650;

const PHASES: { title: string; detail: string; state: "done" | "now" | "next" }[] = [
  { title: "Infraestructura", detail: "Servidores y seguridad actualizados.", state: "done" },
  { title: "Catálogo y pedidos", detail: "Estamos terminando esta fase.", state: "now" },
  { title: "Reapertura", detail: "Te avisaremos cuando el sitio esté listo.", state: "next" },
];

const FEATURES: { icon: ReactNode; title: string; text: string; tint: string }[] = [
  { icon: <ShieldCheck className="h-7 w-7" />, title: "Más seguridad", text: "Reforzamos la protección de tus datos y de cada pago.", tint: "text-emerald-400" },
  { icon: <Speedometer className="h-7 w-7" />, title: "Más rapidez", text: "Páginas más ligeras que cargan al momento en cualquier equipo.", tint: "text-sky-400" },
  { icon: <Bag className="h-7 w-7" />, title: "Mejor experiencia", text: "Un catálogo más fácil de recorrer y pedidos más simples.", tint: "text-amber-400" },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "¿Mis datos están seguros?",
    a: "Sí. El mantenimiento no afecta tu información: tus datos y tus pedidos anteriores se conservan y siguen protegidos.",
  },
  {
    q: "¿Cuándo vuelve a estar disponible el sitio?",
    a: "Es un mantenimiento sin fecha fija mientras terminamos las mejoras. Lo reabriremos en cuanto esté listo.",
  },
  {
    q: "¿Puedo hacer pedidos mientras tanto?",
    a: "Por ahora la tienda en línea está en pausa. Si necesitas algo urgente, escríbenos desde «Contactar soporte».",
  },
  {
    q: "¿Cómo contacto a soporte?",
    a: "Toca «Contactar soporte», déjanos tu mensaje y te responderemos lo antes posible.",
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="hairline last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-[56px] w-full items-center justify-between gap-4 px-5 text-left text-[17px] text-neutral-50"
      >
        {q}
        <ChevronDown className={`h-4 w-4 shrink-0 text-neutral-500 transition-transform duration-300 ease-ios ${open ? "rotate-180" : ""}`} />
      </button>
      <div className="accordion-body" data-open={open}>
        <div>
          <p className="px-5 pb-4 text-[15px] leading-relaxed text-neutral-400">{a}</p>
        </div>
      </div>
    </div>
  );
}

function ContactForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const valid = name.trim().length > 1 && /\S+@\S+\.\S+/.test(email) && message.trim().length > 4;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    if (SUPPORT_EMAIL) {
      const subject = encodeURIComponent(`Soporte · ${name.trim()}`);
      const body = encodeURIComponent(`${message.trim()}\n\n${name.trim()} · ${email.trim()}`);
      window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
    }
    setSent(true);
  };

  if (sent) {
    return (
      <div className="anim-pop-in flex flex-col items-center px-4 pb-4 pt-8 text-center">
        <CheckmarkCircleFill className="h-14 w-14 text-emerald-400" />
        <p className="mt-4 text-[22px] font-semibold tracking-tight">{SUPPORT_EMAIL ? "Mensaje listo" : "Gracias"}</p>
        <p className="mt-2 max-w-xs text-[15px] text-neutral-400">
          {SUPPORT_EMAIL
            ? "Se abrió tu aplicación de correo con el mensaje. Envíalo desde ahí."
            : "Recibimos tus datos. Te contactaremos cuando el sitio esté listo."}
        </p>
        <button type="button" onClick={onDone} className="mt-6 min-h-[50px] w-full rounded-[14px] bg-white/[0.08] text-[17px] font-semibold text-sky-400">
          Cerrar
        </button>
      </div>
    );
  }

  const field = "w-full bg-transparent px-4 text-[17px] text-neutral-50 outline-none placeholder:text-neutral-500";
  return (
    <form onSubmit={submit} className="space-y-5 pt-3">
      <div className="overflow-hidden rounded-[14px] bg-white/[0.06]">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre"
          autoComplete="name"
          className={`${field} hairline h-12`}
          aria-label="Nombre"
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Correo electrónico"
          autoComplete="email"
          inputMode="email"
          className={`${field} h-12`}
          aria-label="Correo electrónico"
        />
      </div>
      <div className="overflow-hidden rounded-[14px] bg-white/[0.06]">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="¿En qué te ayudamos?"
          rows={5}
          className={`${field} resize-none py-3 leading-snug`}
          aria-label="Mensaje"
        />
      </div>
      <button
        type="submit"
        disabled={!valid}
        className="min-h-[50px] w-full rounded-[14px] bg-sky-500 text-[17px] font-semibold text-white transition-opacity active:bg-sky-600 disabled:opacity-40"
      >
        Enviar mensaje
      </button>
      <p className="px-1 text-center text-[13px] text-neutral-500">Respondemos en horario laboral.</p>
    </form>
  );
}

export function LandingMantenimiento({
  authLabel,
  onAuth,
}: {
  /** Texto del botón de arriba ("Iniciar sesión", "Continuar") o null para ocultarlo. */
  authLabel: string | null;
  onAuth: () => void;
}) {
  const [contact, setContact] = useState(false);
  const [contactKey, setContactKey] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const taps = useRef<number[]>([]);

  useEffect(() => {
    document.title = LANDING_TITLE;
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Tres toques seguidos en el pie = iniciar sesión.
  const onFooterTap = () => {
    if (!authLabel) return;
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < TRIPLE_TAP_MS * 2), now];
    if (taps.current.length >= 3) {
      taps.current = [];
      onAuth();
    }
  };

  const openContact = () => {
    setContactKey((k) => k + 1);
    setContact(true);
  };

  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-neutral-950 text-neutral-50">
      {/* Luz de fondo con los colores del ícono de la tienda. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[560px] opacity-60"
        style={{
          background:
            "radial-gradient(60% 50% at 30% 10%, rgba(255,140,60,0.22) 0%, transparent 70%), radial-gradient(55% 45% at 75% 20%, rgba(200,40,180,0.20) 0%, transparent 70%)",
        }}
        aria-hidden="true"
      />

      <header className="sticky top-0 z-30 isolate pt-[env(safe-area-inset-top)]">
        <div
          className={`glass glass-edge-top absolute inset-0 -z-10 transition-opacity duration-300 ${scrolled ? "opacity-100" : "opacity-0"}`}
          aria-hidden="true"
        />
        <div className="mx-auto flex h-12 max-w-5xl items-center justify-between px-5">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon-192.png" alt="" width={26} height={26} className="h-[26px] w-[26px] rounded-[7px]" />
            <span className="text-[17px] font-semibold tracking-tight">Tienda en línea</span>
          </div>
          {authLabel && (
            <button
              type="button"
              onClick={onAuth}
              className="min-h-[44px] rounded-full px-2 text-[15px] text-neutral-300 transition-colors hover:text-white"
            >
              {authLabel}
            </button>
          )}
        </div>
      </header>

      <main className="relative">
        {/* Portada */}
        <section className="mx-auto flex max-w-3xl flex-col items-center px-6 pb-14 pt-12 text-center sm:pt-20">
          <div className="anim-pop-in flex h-[88px] w-[88px] items-center justify-center rounded-[24px] bg-neutral-900 shadow-[0_20px_60px_rgba(0,0,0,0.6)] ring-1 ring-white/10">
            <GearWrench className="h-14 w-14" />
          </div>
          <p className="mt-8 text-[17px] font-semibold text-amber-500">Mantenimiento programado</p>
          <h1 className="mt-2 text-[40px] font-semibold leading-[1.05] tracking-[-0.025em] sm:text-[64px]">
            Estamos mejorando
            <br />
            la tienda.
          </h1>
          <p className="mt-5 max-w-xl text-[19px] leading-snug text-neutral-400 sm:text-[21px]">
            Trabajamos para brindarte un mejor servicio. Mientras tanto el sitio está en mantenimiento.{" "}
            <span className="text-neutral-200">Tus datos están seguros.</span>
          </p>

          <div className="mt-7 inline-flex items-center gap-2 rounded-full bg-white/[0.07] px-4 py-2 text-[15px] text-neutral-300 ring-1 ring-white/10">
            <span className="dot-live inline-block h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
            Mantenimiento en curso
          </div>

          <div className="mt-9 flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
            <button
              type="button"
              onClick={openContact}
              className="min-h-[50px] rounded-full bg-sky-500 px-7 text-[17px] font-semibold text-white transition-colors active:bg-sky-600"
            >
              Contactar soporte
            </button>
            <a href="#avance" className="flex min-h-[44px] items-center gap-1 text-[17px] text-sky-400">
              Ver el avance
              <ChevronRight className="h-3.5 w-3.5" />
            </a>
          </div>
        </section>

        {/* Avance */}
        <section id="avance" className="mx-auto max-w-3xl scroll-mt-16 px-5">
          <div className="rounded-[28px] bg-neutral-900 p-6 sm:p-8">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-[24px] font-semibold tracking-tight">Avance de la actualización</h2>
              <span className="text-[15px] text-neutral-500">Fase 2 de 3</span>
            </div>
            <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-neutral-800" aria-hidden="true">
              <div className="relative h-full w-[62%] overflow-hidden rounded-full bg-gradient-to-r from-amber-500 to-pink-500">
                <div className="absolute inset-y-0 w-1/3 animate-[landing-progress_2.4s_ease-in-out_infinite] bg-white/30" />
              </div>
            </div>
            <ol className="mt-6 space-y-4">
              {PHASES.map((p) => (
                <li key={p.title} className="flex items-start gap-3">
                  {p.state === "done" ? (
                    <CheckmarkCircleFill className="mt-0.5 h-6 w-6 shrink-0 text-emerald-400" />
                  ) : p.state === "now" ? (
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center">
                      <span className="dot-live inline-block h-2.5 w-2.5 rounded-full bg-amber-500" />
                    </span>
                  ) : (
                    <span className="mt-0.5 h-6 w-6 shrink-0 rounded-full border-2 border-neutral-700" aria-hidden="true" />
                  )}
                  <div>
                    <p className={`text-[17px] font-semibold ${p.state === "next" ? "text-neutral-400" : "text-neutral-50"}`}>{p.title}</p>
                    <p className="text-[15px] text-neutral-500">{p.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Novedades */}
        <section className="mx-auto mt-14 max-w-5xl px-5">
          <h2 className="text-center text-[28px] font-semibold tracking-tight sm:text-[34px]">Lo que viene.</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-[28px] bg-neutral-900 p-6">
                <span className={f.tint}>{f.icon}</span>
                <p className="mt-4 text-[19px] font-semibold tracking-tight">{f.title}</p>
                <p className="mt-1.5 text-[15px] leading-relaxed text-neutral-400">{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Preguntas */}
        <section className="mx-auto mt-14 max-w-3xl px-5">
          <h2 className="text-center text-[28px] font-semibold tracking-tight sm:text-[34px]">Preguntas frecuentes</h2>
          <div className="mt-8 overflow-hidden rounded-[28px] bg-neutral-900">
            {FAQ.map((f) => (
              <FaqItem key={f.q} q={f.q} a={f.a} />
            ))}
          </div>
        </section>

        {/* Ayuda */}
        <section className="mx-auto mt-14 max-w-3xl px-5">
          <div className="flex flex-col items-center rounded-[28px] bg-neutral-900 px-6 py-10 text-center">
            <Envelope className="h-8 w-8 text-sky-400" />
            <p className="mt-4 text-[24px] font-semibold tracking-tight">¿Necesitas ayuda?</p>
            <p className="mt-2 max-w-sm text-[15px] text-neutral-400">Nuestro equipo de soporte sigue disponible durante el mantenimiento.</p>
            <button type="button" onClick={openContact} className="mt-6 flex min-h-[44px] items-center gap-1 text-[17px] text-sky-400">
              Contactar soporte
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </section>
      </main>

      <footer
        onClick={onFooterTap}
        className="mx-auto mt-14 max-w-5xl select-none px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-6 text-center text-[12px] text-neutral-500 [-webkit-touch-callout:none]"
      >
        <div className="border-t border-neutral-800 pt-6">
          Copyright © <span suppressHydrationWarning>{new Date().getFullYear()}</span> Tienda en línea. Todos los derechos reservados.
        </div>
      </footer>

      <Sheet open={contact} onClose={() => setContact(false)} title="Contactar soporte">
        <ContactForm key={contactKey} onDone={() => setContact(false)} />
      </Sheet>
    </div>
  );
}
