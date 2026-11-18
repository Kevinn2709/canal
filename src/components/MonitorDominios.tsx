"use client";

/**
 * MonitorDominios.tsx — Lo que ve un fundador al iniciar sesión.
 *
 * Estado de los dominios configurados en Vercel (MONITOR_DOMAINS): respuesta
 * HTTP, certificado SSL (días que le quedan) y latencia. Lo mide la función
 * /api/monitor desde el servidor de Vercel, cada minuto mientras la pantalla
 * está a la vista.
 *
 * Pestañas:
 * - Resumen: estado general, métricas, alertas, latencia y los dominios.
 * - Dominios: lista con filtro por estado (segmentos) y orden (nombre,
 *   latencia, vencimiento del SSL). Tocar uno abre su detalle.
 * - Historial: uptime por dominio y cambios de estado (caído, con avisos,
 *   recuperado). Se guarda en este equipo (localStorage), con las revisiones
 *   hechas mientras el monitor estuvo abierto.
 *
 * Si en "Filtrar dominio…" se escribe exactamente `root`, el campo se limpia
 * y se abre la consola del fundador (los chats).
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { User } from "firebase/auth";
import { logoutHere } from "@/lib/logout";
import { Sheet } from "./ui/Sheet";
import { SearchField } from "./ui/SearchField";
import { Segmented } from "./ui/Segmented";
import {
  ArrowClockwise,
  ArrowUpArrowDown,
  ArrowUpRight,
  Bolt,
  Checkmark,
  CheckmarkCircleFill,
  ChevronRight,
  ClockHistory,
  DocOnDoc,
  ExclamationTriangleFill,
  GaugeGrid,
  Globe,
  InfoCircleFill,
  LockShield,
  PersonCircle,
  Pulse,
  Server,
  Trash,
  XmarkOctagonFill,
} from "./ui/symbols";

export const MONITOR_TITLE = "Monitor de dominios";
const REFRESH_MS = 60_000;
const SLOW_MS = 1500;
const SSL_WARN_DAYS = 14;
const SSL_NOTICE_DAYS = 30;
const MAX_SAMPLES = 240;
const MAX_EVENTS = 150;
const SAMPLES_KEY = "monitor:muestras:v1";
const EVENTS_KEY = "monitor:eventos:v1";

// ---------------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------------

interface DomainResult {
  domain: string;
  http: { status: number | null; ms: number | null; error: string | null; finalUrl: string | null };
  ssl: { valid: boolean; daysLeft: number | null; validTo: string | null; issuer: string | null; error: string | null };
}

interface MonitorData {
  checkedAt: string;
  region: string | null;
  results: DomainResult[];
}

type Health = "ok" | "warn" | "down";

/** Una revisión de un dominio (guardada en este equipo). */
interface Sample {
  t: number;
  h: Health;
  s: number | null;
  ms: number | null;
}

/** Cambio de estado de un dominio. */
interface MonitorEvent {
  id: string;
  t: number;
  d: string;
  k: Health;
  msg: string;
}

type Samples = Record<string, Sample[]>;
type Tab = "resumen" | "dominios" | "historial";
type Filter = "todos" | Health;
type Sort = "nombre" | "lat-asc" | "lat-desc" | "ssl";

function healthOf(r: DomainResult): Health {
  const s = r.http.status;
  if (s === null || s >= 500 || !r.ssl.valid) return "down";
  if (s >= 400 || (r.ssl.daysLeft !== null && r.ssl.daysLeft < SSL_WARN_DAYS) || (r.http.ms ?? 0) > SLOW_MS) return "warn";
  return "ok";
}

/** Motivo principal del estado, en pocas palabras. */
function reasonOf(r: DomainResult): string {
  const s = r.http.status;
  if (s === null) return r.http.error ?? "Sin respuesta";
  if (s >= 500) return `Error del servidor (HTTP ${s})`;
  if (!r.ssl.valid) return r.ssl.error ?? "Certificado no válido";
  if (s >= 400) return `HTTP ${s}`;
  if (r.ssl.daysLeft !== null && r.ssl.daysLeft < SSL_WARN_DAYS) return `SSL vence en ${r.ssl.daysLeft} días`;
  if ((r.http.ms ?? 0) > SLOW_MS) return `Respuesta lenta (${r.http.ms} ms)`;
  return "Funciona con normalidad";
}

const HEALTH: Record<Health, { label: string; dot: string; text: string; tint: string }> = {
  ok: { label: "Operativo", dot: "bg-emerald-500", text: "text-emerald-400", tint: "bg-emerald-500/15" },
  warn: { label: "Con avisos", dot: "bg-amber-500", text: "text-amber-400", tint: "bg-amber-500/15" },
  down: { label: "Caído", dot: "bg-red-500", text: "text-red-400", tint: "bg-red-500/15" },
};

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sin espacio o sin almacenamiento: el historial se queda en memoria.
  }
}

function uptimeOf(list: Sample[] | undefined): number | null {
  if (!list || list.length === 0) return null;
  const up = list.filter((x) => x.h !== "down").length;
  return (up / list.length) * 100;
}

function pct(v: number | null): string {
  if (v === null) return "—";
  return `${v >= 99.95 ? "100" : v.toFixed(1)} %`;
}

function hhmm(t: number | string): string {
  return new Date(t).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}

function dayLabel(t: number): string {
  const d = new Date(t);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Hoy";
  if (d.toDateString() === yest.toDateString()) return "Ayer";
  return d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
}

function eventText(now: Health, before: Health, r: DomainResult): string {
  if (now === "down") return `Caído · ${reasonOf(r)}`;
  if (now === "warn") return `Con avisos · ${reasonOf(r)}`;
  return before === "down" ? "Recuperado · vuelve a responder" : "Sin avisos · funciona con normalidad";
}

interface Alert {
  level: "down" | "warn" | "info";
  domain: string;
  text: string;
}

function alertsOf(results: DomainResult[]): Alert[] {
  const out: Alert[] = [];
  for (const r of results) {
    const h = healthOf(r);
    if (h === "down") out.push({ level: "down", domain: r.domain, text: reasonOf(r) });
    else if (h === "warn") out.push({ level: "warn", domain: r.domain, text: reasonOf(r) });
    else if (r.ssl.daysLeft !== null && r.ssl.daysLeft < SSL_NOTICE_DAYS)
      out.push({ level: "info", domain: r.domain, text: `SSL vence en ${r.ssl.daysLeft} días` });
  }
  const rank = { down: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

// ---------------------------------------------------------------------------
// Piezas pequeñas
// ---------------------------------------------------------------------------

function StatusDot({ h, live = true, className = "h-2.5 w-2.5" }: { h: Health; live?: boolean; className?: string }) {
  return <span className={`inline-block shrink-0 rounded-full ${HEALTH[h].dot} ${live ? "dot-live" : ""} ${className}`} aria-hidden="true" />;
}

/** Línea de tendencia pequeña (latencia). */
const Sparkline = memo(function Sparkline({ values, h }: { values: (number | null)[]; h: Health }) {
  const pts = values.slice(-24);
  const nums = pts.filter((v): v is number => v !== null);
  if (nums.length < 2) return <span className="block h-5 w-12" aria-hidden="true" />;
  const max = Math.max(...nums);
  const min = Math.min(...nums);
  const span = Math.max(1, max - min);
  const step = 48 / Math.max(1, pts.length - 1);
  let d = "";
  let pen = false;
  pts.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    const x = (i * step).toFixed(1);
    const y = (18 - ((v - min) / span) * 16).toFixed(1);
    d += `${pen ? "L" : "M"}${x} ${y}`;
    pen = true;
  });
  const color = h === "down" ? "#ff453a" : h === "warn" ? "#ff9f0a" : "#30d158";
  return (
    <svg viewBox="0 0 48 20" className="h-5 w-12 shrink-0" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
});

/** Gráfica de área (latencia en el tiempo). */
const AreaChart = memo(function AreaChart({ values, height = 120 }: { values: (number | null)[]; height?: number }) {
  const W = 320;
  const H = height;
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) {
    return (
      <div className="flex items-center justify-center text-[13px] text-neutral-500" style={{ height }}>
        Se dibuja con las próximas revisiones.
      </div>
    );
  }
  const max = Math.max(...nums) * 1.1;
  const step = W / Math.max(1, values.length - 1);
  const segments: string[] = [];
  let cur = "";
  values.forEach((v, i) => {
    if (v === null) {
      if (cur) segments.push(cur);
      cur = "";
      return;
    }
    const x = i * step;
    const y = H - 6 - (v / max) * (H - 16);
    cur += `${cur ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  if (cur) segments.push(cur);
  const line = segments.join("");
  const lastSeg = segments[segments.length - 1] ?? "";
  const firstX = lastSeg.match(/^M([\d.]+)/)?.[1] ?? "0";
  const lastX = lastSeg.match(/([\d.]+) [\d.]+$/)?.[1] ?? String(W);
  const area = `${lastSeg}L${lastX} ${H}L${firstX} ${H}Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height }} aria-hidden="true">
      <defs>
        <linearGradient id="lat-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0a84ff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#0a84ff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="rgba(84,84,88,0.45)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
      ))}
      <path d={area} fill="url(#lat-fill)" />
      <path d={line} fill="none" stroke="#0a84ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
});

/** Barras de uptime: una por revisión (verde, naranja, rojo). */
const UptimeBars = memo(function UptimeBars({ list, count = 40 }: { list: Sample[] | undefined; count?: number }) {
  const recent = (list ?? []).slice(-count);
  const pad = count - recent.length;
  return (
    <div className="flex h-7 items-stretch gap-[2px]" aria-hidden="true">
      {Array.from({ length: pad }).map((_, i) => (
        <span key={`p${i}`} className="flex-1 rounded-[2px] bg-neutral-800" />
      ))}
      {recent.map((s) => (
        <span key={s.t} className={`flex-1 rounded-[2px] ${HEALTH[s.h].dot}`} title={`${hhmm(s.t)} · ${HEALTH[s.h].label}`} />
      ))}
    </div>
  );
});

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-7">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h2 className="text-[20px] font-semibold tracking-tight text-neutral-50">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`overflow-hidden rounded-[22px] bg-neutral-900 ${className}`}>{children}</div>;
}

const DomainRow = memo(function DomainRow({
  r,
  list,
  onOpen,
  last,
}: {
  r: DomainResult;
  list: Sample[] | undefined;
  onOpen: (domain: string) => void;
  last: boolean;
}) {
  const h = healthOf(r);
  const lat = useMemo(() => (list ?? []).map((s) => s.ms), [list]);
  return (
    <button
      type="button"
      onClick={() => onOpen(r.domain)}
      className="flex w-full items-center gap-3 pl-4 text-left transition-colors active:bg-white/[0.06]"
      aria-label={`${r.domain}: ${HEALTH[h].label}`}
    >
      <StatusDot h={h} />
      <span className={`flex min-h-[64px] min-w-0 flex-1 items-center gap-3 py-2.5 pr-3 ${last ? "" : "hairline"}`}>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px] text-neutral-50">{r.domain}</span>
          <span className="mt-0.5 block truncate text-[13px] text-neutral-500">
            <span className={HEALTH[h].text}>{HEALTH[h].label}</span>
            {h === "ok" ? (r.ssl.daysLeft !== null ? ` · SSL ${r.ssl.daysLeft} d` : "") : ` · ${reasonOf(r)}`}
          </span>
        </span>
        <Sparkline values={lat} h={h} />
        <span className="w-[4.5rem] shrink-0 text-right text-[15px] tabular-nums text-neutral-300">
          {r.http.ms !== null ? `${r.http.ms} ms` : "—"}
        </span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-600" />
      </span>
    </button>
  );
});

function DomainList({
  rows,
  samples,
  onOpen,
  empty,
}: {
  rows: DomainResult[];
  samples: Samples;
  onOpen: (domain: string) => void;
  empty: string;
}) {
  if (rows.length === 0) {
    return (
      <Card>
        <p className="px-4 py-8 text-center text-[15px] text-neutral-500">{empty}</p>
      </Card>
    );
  }
  return (
    <Card>
      {rows.map((r, i) => (
        <DomainRow key={r.domain} r={r} list={samples[r.domain]} onOpen={onOpen} last={i === rows.length - 1} />
      ))}
    </Card>
  );
}

/** Barra superior: título pequeño al desplazarse, actualizar y cuenta. */
function TopBar({
  title,
  compact,
  loading,
  onRefresh,
  onAccount,
}: {
  title: string;
  compact: boolean;
  loading: boolean;
  onRefresh?: () => void;
  onAccount?: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 isolate pt-[env(safe-area-inset-top)]">
      <div
        className={`glass glass-edge-top absolute inset-0 -z-10 transition-opacity duration-200 ${compact ? "opacity-100" : "opacity-0"}`}
        aria-hidden="true"
      />
      <div className="mx-auto grid h-11 max-w-3xl grid-cols-[1fr_auto_1fr] items-center px-2 sm:px-4">
        <span />
        <span
          className={`truncate text-[17px] font-semibold text-neutral-50 transition-opacity duration-200 ${compact ? "opacity-100" : "opacity-0"}`}
          aria-hidden={!compact}
        >
          {title}
        </span>
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={onRefresh}
            disabled={!onRefresh || loading}
            className="flex h-11 w-11 items-center justify-center rounded-full text-sky-500 disabled:text-neutral-600"
            aria-label={loading ? "Revisando" : "Revisar ahora"}
          >
            <ArrowClockwise className={`h-[21px] w-[21px] ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={onAccount}
            disabled={!onAccount}
            className="flex h-11 w-11 items-center justify-center rounded-full text-sky-500 disabled:text-neutral-600"
            aria-label="Cuenta"
          >
            <PersonCircle className="h-[25px] w-[25px]" />
          </button>
        </div>
      </div>
    </header>
  );
}

const TABS: { id: Tab; label: string }[] = [
  { id: "resumen", label: "Resumen" },
  { id: "dominios", label: "Dominios" },
  { id: "historial", label: "Historial" },
];

function TabIcon({ id, on }: { id: Tab; on: boolean }) {
  const c = "h-[24px] w-[24px]";
  if (id === "resumen") return <GaugeGrid className={c} filled={on} />;
  if (id === "dominios") return <Globe className={c} filled={on} />;
  return <ClockHistory className={c} filled={on} />;
}

/** Barra de pestañas flotante (vidrio), abajo al centro. */
function TabBar({ tab, onTab, badge }: { tab: Tab; onTab?: (t: Tab) => void; badge?: number }) {
  const index = TABS.findIndex((t) => t.id === tab);
  return (
    <nav
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      aria-label="Secciones"
    >
      <div className="pointer-events-auto relative isolate flex rounded-full p-1">
        <div className="glass glass-ring absolute inset-0 -z-10 rounded-full" aria-hidden="true" />
        <span
          className="absolute bottom-1 left-1 top-1 w-[92px] rounded-full bg-white/[0.12] transition-transform duration-300 ease-ios"
          style={{ transform: `translateX(${index * 100}%)` }}
          aria-hidden="true"
        />
        {TABS.map((t) => {
          const on = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTab?.(t.id)}
              className={`relative flex h-[54px] w-[92px] flex-col items-center justify-center gap-0.5 rounded-full transition-colors ${
                on ? "text-sky-500" : "text-neutral-300"
              }`}
              aria-current={on ? "page" : undefined}
            >
              <TabIcon id={t.id} on={on} />
              <span className="text-[10px] font-medium">{t.label}</span>
              {t.id === "resumen" && !!badge && (
                <span className="absolute right-5 top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-semibold text-white">
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/** Esqueleto del monitor: mismo armazón, sin datos (arranque y espera). */
export function MonitorSkeleton() {
  return (
    <div className="min-h-dvh bg-neutral-950 text-neutral-50" aria-busy="true" aria-label="Cargando monitor">
      <TopBar title="Monitor" compact={false} loading />
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <h1 className="pt-1 text-[34px] font-bold leading-tight tracking-tight">Monitor</h1>
        <div className="skeleton mt-1 h-4 w-48 rounded-md" />
        <div className="mt-4 h-9 rounded-[10px] bg-[rgba(118,118,128,0.24)]" />
        <div className="skeleton mt-6 h-[132px] rounded-[22px]" />
        <div className="mt-3 flex gap-3">
          <div className="skeleton h-[96px] flex-1 rounded-[22px]" />
          <div className="skeleton h-[96px] flex-1 rounded-[22px]" />
        </div>
        <div className="skeleton mt-7 h-[180px] rounded-[22px]" />
      </div>
      <TabBar tab="resumen" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Monitor
// ---------------------------------------------------------------------------

export function MonitorDominios({ user, onRoot }: { user: User; onRoot: () => void }) {
  const [data, setData] = useState<MonitorData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("resumen");
  const [filter, setFilter] = useState<Filter>("todos");
  const [sort, setSort] = useState<Sort>("nombre");
  const [sortOpen, setSortOpen] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [account, setAccount] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [compact, setCompact] = useState(false);
  const [copied, setCopied] = useState(false);
  const [samples, setSamples] = useState<Samples>(() => (typeof window === "undefined" ? {} : loadJson<Samples>(SAMPLES_KEY, {})));
  const [events, setEvents] = useState<MonitorEvent[]>(() =>
    typeof window === "undefined" ? [] : loadJson<MonitorEvent[]>(EVENTS_KEY, [])
  );
  const samplesRef = useRef(samples);
  const eventsRef = useRef(events);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const busy = useRef(false);

  useEffect(() => {
    document.title = MONITOR_TITLE;
  }, []);

  // Título grande → título pequeño en la barra al desplazarse (como iOS).
  useEffect(() => {
    const el = titleRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setCompact(!e.isIntersecting), { rootMargin: "-56px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const record = useCallback((d: MonitorData) => {
    const t = Date.parse(d.checkedAt) || Date.now();
    const prev = samplesRef.current;
    const next: Samples = {};
    const fresh: MonitorEvent[] = [];
    for (const r of d.results) {
      const h = healthOf(r);
      const list = prev[r.domain] ?? [];
      const last = list[list.length - 1];
      if (last && last.h !== h) fresh.push({ id: `${t}-${r.domain}`, t, d: r.domain, k: h, msg: eventText(h, last.h, r) });
      next[r.domain] = [...list, { t, h, s: r.http.status, ms: r.http.ms }].slice(-MAX_SAMPLES);
    }
    samplesRef.current = next;
    setSamples(next);
    saveJson(SAMPLES_KEY, next);
    if (fresh.length) {
      const ev = [...fresh, ...eventsRef.current].slice(0, MAX_EVENTS);
      eventsRef.current = ev;
      setEvents(ev);
      saveJson(EVENTS_KEY, ev);
    }
  }, []);

  const check = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/monitor", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 403 ? "Sin permiso para ver el monitor." : "No se pudo consultar el estado.");
      const d = (await res.json()) as MonitorData;
      setData(d);
      setError(null);
      record(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo consultar el estado.");
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [user, record]);

  // Cada minuto, solo con la pantalla a la vista.
  useEffect(() => {
    void check();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check]);

  const onFilterText = (value: string) => {
    if (value === "root") {
      setQ("");
      inputRef.current?.blur();
      onRoot();
      return;
    }
    setQ(value);
  };

  const openDetail = useCallback((domain: string) => {
    setCopied(false);
    setDetail(domain);
    setDetailOpen(true);
  }, []);

  const switchTab = (t: Tab) => {
    setTab(t);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // ---------- Derivados ----------
  const results = useMemo(() => data?.results ?? [], [data]);
  const counts = useMemo(() => {
    const c = { ok: 0, warn: 0, down: 0 };
    for (const r of results) c[healthOf(r)] += 1;
    return c;
  }, [results]);
  const overall: Health = counts.down > 0 ? "down" : counts.warn > 0 ? "warn" : "ok";
  const alerts = useMemo(() => alertsOf(results), [results]);
  const uptimeAll = useMemo(() => {
    const all = Object.values(samples).flat();
    return uptimeOf(all);
  }, [samples]);
  const avgLatency = useMemo(() => {
    const ms = results.map((r) => r.http.ms).filter((v): v is number => v !== null);
    return ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null;
  }, [results]);
  const nextSsl = useMemo(() => {
    const days = results.map((r) => r.ssl.daysLeft).filter((v): v is number => v !== null);
    return days.length ? Math.min(...days) : null;
  }, [results]);
  // Latencia promedio por revisión (para la gráfica del resumen).
  const latencySeries = useMemo(() => {
    const byT = new Map<number, number[]>();
    for (const list of Object.values(samples)) {
      for (const s of list) {
        if (s.ms === null) continue;
        const arr = byT.get(s.t) ?? [];
        arr.push(s.ms);
        byT.set(s.t, arr);
      }
    }
    return Array.from(byT.entries())
      .sort((a, b) => a[0] - b[0])
      .slice(-60)
      .map(([, arr]) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length));
  }, [samples]);

  const term = q.trim().toLowerCase();
  const sorted = useMemo(() => {
    const list = [...results];
    const lat = (r: DomainResult) => r.http.ms ?? Number.POSITIVE_INFINITY;
    if (sort === "nombre") list.sort((a, b) => a.domain.localeCompare(b.domain));
    else if (sort === "lat-asc") list.sort((a, b) => lat(a) - lat(b));
    else if (sort === "lat-desc") list.sort((a, b) => (b.http.ms ?? -1) - (a.http.ms ?? -1));
    else list.sort((a, b) => (a.ssl.daysLeft ?? -1) - (b.ssl.daysLeft ?? -1));
    return list;
  }, [results, sort]);
  const filtered = useMemo(() => (filter === "todos" ? sorted : sorted.filter((r) => healthOf(r) === filter)), [sorted, filter]);
  const searched = useMemo(() => (term ? sorted.filter((r) => r.domain.includes(term)) : []), [sorted, term]);

  const detailResult = detail ? results.find((r) => r.domain === detail) ?? null : null;
  const largeTitle = tab === "resumen" ? "Monitor" : tab === "dominios" ? "Dominios" : "Historial";
  const subtitle = data
    ? `${counts.ok + counts.warn} de ${results.length} en línea · ${hhmm(data.checkedAt)}${data.region ? ` · ${data.region}` : ""}`
    : loading
      ? "Consultando…"
      : "Sin datos todavía";

  // ---------- Contenido de cada pestaña ----------
  const summary = (
    <>
      {/* Estado del sistema */}
      <Card className="mt-6 p-4">
        <div className="flex items-center gap-4">
          <span
            className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${HEALTH[data ? overall : "ok"].tint} ${
              data ? HEALTH[overall].text : "text-neutral-600"
            }`}
          >
            {!data ? (
              <Server className="h-7 w-7" />
            ) : overall === "ok" ? (
              <CheckmarkCircleFill className="h-8 w-8" />
            ) : overall === "warn" ? (
              <ExclamationTriangleFill className="h-7 w-7" />
            ) : (
              <XmarkOctagonFill className="h-8 w-8" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-[15px] text-neutral-400">Estado del sistema</p>
            <p className={`text-[22px] font-semibold leading-tight tracking-tight ${data ? HEALTH[overall].text : "text-neutral-500"}`}>
              {!data
                ? loading
                  ? "Revisando…"
                  : "Sin datos"
                : overall === "ok"
                  ? "Todo correcto"
                  : overall === "warn"
                    ? `${counts.warn} ${counts.warn === 1 ? "dominio con avisos" : "dominios con avisos"}`
                    : `${counts.down} ${counts.down === 1 ? "dominio caído" : "dominios caídos"}`}
            </p>
            <p className="mt-0.5 text-[13px] text-neutral-500">
              Uptime {pct(uptimeAll)} · {results.length} {results.length === 1 ? "dominio monitoreado" : "dominios monitoreados"}
            </p>
          </div>
        </div>
      </Card>

      {/* Métricas */}
      <div className="no-scrollbar -mx-4 mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-4 sm:px-0">
        {[
          {
            icon: <Globe className="h-5 w-5" />,
            tint: "text-sky-500",
            title: `Dominios (${results.length})`,
            value: `${counts.ok} activos`,
            sub: counts.warn + counts.down ? `${counts.warn} con avisos · ${counts.down} caídos` : "Ninguno con problemas",
          },
          {
            icon: <Bolt className="h-5 w-5" />,
            tint: "text-amber-400",
            title: "Latencia media",
            value: avgLatency !== null ? `${avgLatency} ms` : "—",
            sub: data?.region ? `Medida desde ${data.region}` : "Desde Vercel",
          },
          {
            icon: <LockShield className="h-5 w-5" />,
            tint: "text-emerald-400",
            title: "Certificados",
            value: nextSsl !== null ? `${nextSsl} d` : "—",
            sub: "Próximo vencimiento",
          },
          {
            icon: <Pulse className="h-5 w-5" />,
            tint: "text-pink-400",
            title: "Uptime",
            value: pct(uptimeAll),
            sub: `${Object.values(samples)[0]?.length ?? 0} revisiones en este equipo`,
          },
        ].map((m) => (
          <div key={m.title} className="w-[44%] min-w-[9.5rem] shrink-0 snap-start rounded-[22px] bg-neutral-900 p-4 sm:w-auto">
            <div className={`flex items-center gap-2 ${m.tint}`}>
              {m.icon}
              <span className="truncate text-[13px] font-semibold text-neutral-300">{m.title}</span>
            </div>
            <p className="mt-2 text-[24px] font-semibold tabular-nums tracking-tight text-neutral-50">{m.value}</p>
            <p className="mt-0.5 truncate text-[12px] text-neutral-500">{m.sub}</p>
          </div>
        ))}
      </div>

      <Section title="Alertas" action={alerts.length ? <span className="text-[15px] text-neutral-500">{alerts.length}</span> : null}>
        <Card>
          {alerts.length === 0 ? (
            <div className="flex items-center gap-3 px-4 py-4">
              <CheckmarkCircleFill className="h-6 w-6 shrink-0 text-emerald-400" />
              <p className="text-[15px] text-neutral-300">{data ? "Sin alertas. Todo funciona con normalidad." : "Las alertas aparecen aquí."}</p>
            </div>
          ) : (
            alerts.map((a, i) => (
              <button
                key={`${a.domain}-${a.level}`}
                type="button"
                onClick={() => openDetail(a.domain)}
                className="flex w-full items-center gap-3 pl-4 text-left active:bg-white/[0.06]"
              >
                {a.level === "down" ? (
                  <XmarkOctagonFill className="h-6 w-6 shrink-0 text-red-500" />
                ) : a.level === "warn" ? (
                  <ExclamationTriangleFill className="h-6 w-6 shrink-0 text-amber-500" />
                ) : (
                  <InfoCircleFill className="h-6 w-6 shrink-0 text-sky-500" />
                )}
                <span className={`flex min-h-[56px] min-w-0 flex-1 items-center gap-2 py-2.5 pr-3 ${i === alerts.length - 1 ? "" : "hairline"}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium text-neutral-50">{a.domain}</span>
                    <span className="block truncate text-[13px] text-neutral-400">{a.text}</span>
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-600" />
                </span>
              </button>
            ))
          )}
        </Card>
      </Section>

      <Section
        title="Latencia"
        action={avgLatency !== null ? <span className="text-[15px] tabular-nums text-neutral-500">{avgLatency} ms ahora</span> : null}
      >
        <Card className="px-3 pb-3 pt-4">
          <AreaChart values={latencySeries} />
          <p className="mt-2 px-1 text-[12px] text-neutral-500">Promedio de todos los dominios en las últimas {latencySeries.length || "—"} revisiones.</p>
        </Card>
      </Section>

      <Section
        title="Dominios"
        action={
          <button type="button" onClick={() => switchTab("dominios")} className="text-[15px] text-sky-500">
            Ver todos
          </button>
        }
      >
        <DomainList
          rows={sorted.slice(0, 4)}
          samples={samples}
          onOpen={openDetail}
          empty={data ? "No hay dominios configurados." : "Cargando dominios…"}
        />
      </Section>
    </>
  );

  const SORTS: { id: Sort; label: string }[] = [
    { id: "nombre", label: "Nombre" },
    { id: "lat-asc", label: "Latencia (menor primero)" },
    { id: "lat-desc", label: "Latencia (mayor primero)" },
    { id: "ssl", label: "SSL por vencer" },
  ];

  const domainsTab = (
    <>
      <div className="mt-5 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Segmented
            label="Filtrar por estado"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "todos", label: `Todos ${results.length}` },
              { value: "ok", label: `OK ${counts.ok}` },
              { value: "warn", label: `Avisos ${counts.warn}` },
              { value: "down", label: `Caídos ${counts.down}` },
            ]}
          />
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setSortOpen((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(118,118,128,0.24)] text-sky-500"
            aria-label="Ordenar"
            aria-expanded={sortOpen}
          >
            <ArrowUpArrowDown className="h-[17px] w-[17px]" />
          </button>
          {sortOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setSortOpen(false)} aria-hidden="true" />
              <div className="anim-pop-in absolute right-0 top-10 z-50 w-64 overflow-hidden rounded-[14px]" role="menu">
                <div className="glass-thick glass-ring absolute inset-0 -z-10" aria-hidden="true" />
                <p className="px-4 pb-1 pt-2.5 text-[13px] text-neutral-500">Ordenar por</p>
                {SORTS.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={sort === s.id}
                    onClick={() => {
                      setSort(s.id);
                      setSortOpen(false);
                    }}
                    className={`flex min-h-[44px] w-full items-center gap-2 px-4 text-left text-[17px] text-neutral-50 active:bg-white/10 ${
                      i < SORTS.length - 1 ? "hairline" : ""
                    }`}
                  >
                    <span className="w-5 shrink-0 text-sky-500">{sort === s.id && <Checkmark className="h-4 w-4" />}</span>
                    {s.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="mt-4">
        <DomainList
          rows={filtered}
          samples={samples}
          onOpen={openDetail}
          empty={!data ? "Cargando dominios…" : results.length === 0 ? "No hay dominios configurados." : "Ningún dominio con este estado."}
        />
      </div>
      <p className="mt-3 px-1 text-[13px] text-neutral-500">
        Se mide desde el servidor de Vercel{data?.region ? ` (${data.region})` : ""} cada minuto mientras el monitor está abierto.
      </p>
    </>
  );

  const groupedEvents = useMemo(() => {
    const out: { day: string; items: MonitorEvent[] }[] = [];
    for (const e of events) {
      const day = dayLabel(e.t);
      const g = out[out.length - 1];
      if (g && g.day === day) g.items.push(e);
      else out.push({ day, items: [e] });
    }
    return out;
  }, [events]);

  const historyTab = (
    <>
      <Section title="Uptime por dominio">
        <Card>
          {results.length === 0 ? (
            <p className="px-4 py-8 text-center text-[15px] text-neutral-500">{data ? "No hay dominios configurados." : "Cargando…"}</p>
          ) : (
            results.map((r, i) => (
              <button
                key={r.domain}
                type="button"
                onClick={() => openDetail(r.domain)}
                className={`block w-full px-4 py-3 text-left active:bg-white/[0.06] ${i === results.length - 1 ? "" : "hairline"}`}
              >
                <span className="mb-2 flex items-baseline justify-between gap-2">
                  <span className="truncate text-[15px] text-neutral-50">{r.domain}</span>
                  <span className="shrink-0 text-[15px] tabular-nums text-neutral-400">{pct(uptimeOf(samples[r.domain]))}</span>
                </span>
                <UptimeBars list={samples[r.domain]} />
              </button>
            ))
          )}
        </Card>
        <p className="mt-2 px-1 text-[13px] text-neutral-500">Cada barra es una revisión hecha desde este equipo.</p>
      </Section>

      <Section title="Eventos">
        {groupedEvents.length === 0 ? (
          <Card>
            <p className="px-4 py-8 text-center text-[15px] text-neutral-500">
              Sin cambios de estado todavía. Aquí aparece cuando un dominio cae, tiene avisos o se recupera.
            </p>
          </Card>
        ) : (
          groupedEvents.map((g) => (
            <div key={g.day} className="mb-4">
              <p className="mb-1.5 px-1 text-[13px] font-semibold uppercase tracking-wide text-neutral-500">{g.day}</p>
              <Card>
                {g.items.map((e, i) => (
                  <div key={e.id} className="flex items-center gap-3 pl-4">
                    {e.k === "down" ? (
                      <XmarkOctagonFill className="h-6 w-6 shrink-0 text-red-500" />
                    ) : e.k === "warn" ? (
                      <ExclamationTriangleFill className="h-6 w-6 shrink-0 text-amber-500" />
                    ) : (
                      <CheckmarkCircleFill className="h-6 w-6 shrink-0 text-emerald-400" />
                    )}
                    <div className={`flex min-h-[56px] min-w-0 flex-1 items-center gap-2 py-2.5 pr-4 ${i === g.items.length - 1 ? "" : "hairline"}`}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-medium text-neutral-50">{e.d}</p>
                        <p className="truncate text-[13px] text-neutral-400">{e.msg}</p>
                      </div>
                      <span className="shrink-0 text-[13px] tabular-nums text-neutral-500">{hhmm(e.t)}</span>
                    </div>
                  </div>
                ))}
              </Card>
            </div>
          ))
        )}
        {(groupedEvents.length > 0 || Object.keys(samples).length > 0) && (
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            className="mt-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[14px] bg-neutral-900 text-[17px] text-red-500 active:bg-neutral-800"
          >
            <Trash className="h-5 w-5" />
            Borrar historial de este equipo
          </button>
        )}
      </Section>
    </>
  );

  const searching = term.length > 0;

  return (
    <div className="vista-in min-h-dvh bg-neutral-950 text-neutral-50">
      <TopBar
        title={searching ? "Buscar" : largeTitle}
        compact={compact}
        loading={loading}
        onRefresh={() => void check()}
        onAccount={() => setAccount(true)}
      />

      <main className="mx-auto max-w-3xl px-4 pb-[calc(env(safe-area-inset-bottom)+7.5rem)] sm:px-6">
        <h1 ref={titleRef} className="pt-1 text-[34px] font-bold leading-tight tracking-tight">
          {largeTitle}
        </h1>
        <p className="mt-0.5 flex items-center gap-1.5 text-[15px] text-neutral-500">
          {data && <StatusDot h={overall} className="h-2 w-2" />}
          <span className="truncate">{subtitle}</span>
        </p>

        <div className="mt-4">
          <SearchField ref={inputRef} value={q} onChange={onFilterText} placeholder="Filtrar dominio..." label="Filtrar dominio" />
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-3 rounded-[14px] bg-red-500/15 px-4 py-3 text-[15px] text-red-300" role="alert">
            <ExclamationTriangleFill className="mt-0.5 h-5 w-5 shrink-0" />
            <span className="min-w-0 flex-1">{error}</span>
            <button type="button" onClick={() => void check()} className="shrink-0 font-semibold text-red-200">
              Reintentar
            </button>
          </div>
        )}

        {searching ? (
          <Section title="Resultados" action={<span className="text-[15px] text-neutral-500">{searched.length}</span>}>
            <DomainList rows={searched} samples={samples} onOpen={openDetail} empty={`Ningún dominio coincide con «${q.trim()}».`} />
          </Section>
        ) : tab === "resumen" ? (
          summary
        ) : tab === "dominios" ? (
          domainsTab
        ) : (
          historyTab
        )}
      </main>

      <TabBar tab={tab} onTab={switchTab} badge={counts.down || undefined} />

      {/* Detalle de un dominio */}
      <Sheet open={detailOpen && !!detailResult} onClose={() => setDetailOpen(false)} title={detailResult?.domain ?? ""} tall>
        {detailResult && (
          <DomainDetail
            r={detailResult}
            list={samples[detailResult.domain]}
            copied={copied}
            onCopy={() => {
              void navigator.clipboard?.writeText(detailResult.domain).then(
                () => setCopied(true),
                () => undefined
              );
            }}
          />
        )}
      </Sheet>

      {/* Cuenta */}
      <Sheet open={account} onClose={() => setAccount(false)} title="Cuenta">
        <div className="space-y-6 pt-3">
          <Card>
            <div className="flex items-center gap-3 px-4 py-3">
              <PersonCircle className="h-11 w-11 shrink-0 text-neutral-500" />
              <div className="min-w-0">
                <p className="truncate text-[17px] text-neutral-50">{user.email ?? "Sin correo"}</p>
                <p className="text-[13px] text-neutral-500">Administrador del monitor</p>
              </div>
            </div>
          </Card>
          <Card>
            <button
              type="button"
              onClick={() => {
                setAccount(false);
                void check();
              }}
              className="hairline flex min-h-[48px] w-full items-center gap-3 px-4 text-left text-[17px] text-sky-500 active:bg-white/[0.06]"
            >
              <ArrowClockwise className="h-5 w-5" />
              Revisar ahora
            </button>
            <div className="flex min-h-[48px] items-center justify-between px-4 text-[17px]">
              <span className="text-neutral-50">Frecuencia</span>
              <span className="text-neutral-500">Cada minuto</span>
            </div>
          </Card>
          <Card>
            <button
              type="button"
              onClick={() => void logoutHere(user.uid)}
              className="flex min-h-[48px] w-full items-center justify-center text-[17px] text-red-500 active:bg-white/[0.06]"
            >
              Cerrar sesión
            </button>
          </Card>
        </div>
      </Sheet>

      {/* Confirmar borrado del historial */}
      <Sheet
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Borrar historial"
        trailing={
          <button type="button" onClick={() => setConfirmClear(false)} className="min-h-[44px] px-1 text-[17px] text-sky-500">
            Cancelar
          </button>
        }
      >
        <p className="px-1 pt-2 text-[15px] text-neutral-400">
          Se borran las revisiones y los eventos guardados en este equipo. Los dominios se siguen revisando. No se puede deshacer.
        </p>
        <button
          type="button"
          onClick={() => {
            samplesRef.current = {};
            eventsRef.current = [];
            setSamples({});
            setEvents([]);
            saveJson(SAMPLES_KEY, {});
            saveJson(EVENTS_KEY, []);
            setConfirmClear(false);
          }}
          className="mt-5 flex min-h-[50px] w-full items-center justify-center rounded-[14px] bg-red-500 text-[17px] font-semibold text-white active:bg-red-600"
        >
          Borrar historial
        </button>
      </Sheet>
    </div>
  );
}

function DomainDetail({
  r,
  list,
  copied,
  onCopy,
}: {
  r: DomainResult;
  list: Sample[] | undefined;
  copied: boolean;
  onCopy: () => void;
}) {
  const h = healthOf(r);
  const lat = useMemo(() => (list ?? []).slice(-60).map((s) => s.ms), [list]);
  const metrics: { label: string; value: string; tone: string }[] = [
    {
      label: "HTTP",
      value: r.http.status !== null ? String(r.http.status) : "Sin respuesta",
      tone: r.http.status !== null && r.http.status < 400 ? "text-emerald-400" : "text-red-400",
    },
    {
      label: "Latencia",
      value: r.http.ms !== null ? `${r.http.ms} ms` : "—",
      tone: (r.http.ms ?? 0) > SLOW_MS ? "text-amber-400" : "text-neutral-50",
    },
    {
      label: "SSL",
      value: r.ssl.valid ? `${r.ssl.daysLeft} días` : "No válido",
      tone: !r.ssl.valid ? "text-red-400" : (r.ssl.daysLeft ?? 99) < SSL_WARN_DAYS ? "text-amber-400" : "text-emerald-400",
    },
    { label: "Uptime", value: pct(uptimeOf(list)), tone: "text-neutral-50" },
  ];

  return (
    <div className="space-y-6 pt-3">
      <div className="flex items-center gap-3">
        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[13px] font-semibold ${HEALTH[h].tint} ${HEALTH[h].text}`}>
          <StatusDot h={h} className="h-2 w-2" />
          {HEALTH[h].label}
        </span>
        <span className="min-w-0 truncate text-[15px] text-neutral-400">{reasonOf(r)}</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-[18px] bg-white/[0.06] px-4 py-3">
            <p className="text-[13px] text-neutral-400">{m.label}</p>
            <p className={`mt-0.5 text-[22px] font-semibold tabular-nums tracking-tight ${m.tone}`}>{m.value}</p>
          </div>
        ))}
      </div>

      <div>
        <p className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-neutral-500">Latencia</p>
        <div className="rounded-[18px] bg-white/[0.06] px-3 pb-3 pt-4">
          <AreaChart values={lat} height={110} />
        </div>
      </div>

      <div>
        <p className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-neutral-500">Últimas revisiones</p>
        <div className="rounded-[18px] bg-white/[0.06] p-3">
          <UptimeBars list={list} count={48} />
        </div>
      </div>

      <div>
        <p className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-neutral-500">Certificado</p>
        <div className="overflow-hidden rounded-[18px] bg-white/[0.06]">
          {[
            ["Emisor", r.ssl.issuer ?? "—"],
            ["Vence", r.ssl.validTo ? longDate(r.ssl.validTo) : "—"],
            ["Destino final", r.http.finalUrl ?? "—"],
          ].map(([k, v], i, arr) => (
            <div key={k} className={`flex min-h-[44px] items-center justify-between gap-4 px-4 text-[15px] ${i < arr.length - 1 ? "hairline" : ""}`}>
              <span className="shrink-0 text-neutral-50">{k}</span>
              <span className="min-w-0 truncate text-right text-neutral-400">{v}</span>
            </div>
          ))}
        </div>
        {(r.http.error || r.ssl.error) && (
          <p className="mt-2 px-1 text-[13px] text-red-400">{[r.http.error, r.ssl.error].filter(Boolean).join(" · ")}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <a
          href={`https://${r.domain}`}
          target="_blank"
          rel="noreferrer noopener"
          className="flex min-h-[50px] items-center justify-center gap-2 rounded-[14px] bg-sky-500 text-[17px] font-semibold text-white active:bg-sky-600"
        >
          <ArrowUpRight className="h-5 w-5" />
          Abrir sitio
        </a>
        <button
          type="button"
          onClick={onCopy}
          className="flex min-h-[50px] items-center justify-center gap-2 rounded-[14px] bg-white/[0.08] text-[17px] font-semibold text-sky-400 active:bg-white/[0.12]"
        >
          {copied ? <Checkmark className="h-5 w-5" /> : <DocOnDoc className="h-5 w-5" />}
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
    </div>
  );
}
