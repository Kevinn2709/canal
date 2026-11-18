/**
 * symbols.tsx — Íconos vectoriales al estilo de SF Symbols (trazo redondeado,
 * mismo peso que el texto). Sin dependencias. Siempre decorativos
 * (aria-hidden): el botón que los contiene lleva su propia etiqueta.
 */

import type { ReactNode } from "react";

interface P {
  className?: string;
}

function Sym({ className, children, fill = false, w = 1.8 }: P & { children: ReactNode; fill?: boolean; w?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={fill ? "currentColor" : "none"}
      stroke={fill ? "none" : "currentColor"}
      strokeWidth={w}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ?? "h-5 w-5"}
    >
      {children}
    </svg>
  );
}

export function Magnifier(p: P) {
  return (
    <Sym {...p} w={2.2}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
    </Sym>
  );
}

export function XCircleFill(p: P) {
  return (
    <Sym {...p} fill>
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm3.5 5.1a1 1 0 0 1 1.4 1.4L13.4 12l3.5 3.5a1 1 0 0 1-1.4 1.4L12 13.4l-3.5 3.5a1 1 0 0 1-1.4-1.4l3.5-3.5-3.5-3.5a1 1 0 0 1 1.4-1.4l3.5 3.5 3.5-3.5Z" />
    </Sym>
  );
}

export function ChevronRight(p: P) {
  return (
    <Sym {...p} w={2.4}>
      <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
    </Sym>
  );
}

export function ChevronDown(p: P) {
  return (
    <Sym {...p} w={2.4}>
      <path d="m5.5 9.5 6.5 6.5 6.5-6.5" />
    </Sym>
  );
}

export function ArrowClockwise(p: P) {
  return (
    <Sym {...p} w={2}>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.8 4.2v3.6h-3.6" />
    </Sym>
  );
}

export function PersonCircle(p: P) {
  return (
    <Sym {...p}>
      <circle cx="12" cy="12" r="9.2" />
      <circle cx="12" cy="10" r="3.2" />
      <path d="M6.2 18.4c1.4-2 3.4-3 5.8-3s4.4 1 5.8 3" />
    </Sym>
  );
}

export function CheckmarkCircleFill(p: P) {
  return (
    <Sym {...p} fill>
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.7 7.2-5.4 6.3a1 1 0 0 1-1.5.1l-2.6-2.6a1 1 0 1 1 1.4-1.4l1.8 1.8 4.8-5.5a1 1 0 0 1 1.5 1.3Z" />
    </Sym>
  );
}

export function ExclamationTriangleFill(p: P) {
  return (
    <Sym {...p} fill>
      <path d="M10.3 3.4a2 2 0 0 1 3.4 0l8 13.9A2 2 0 0 1 20 20.3H4a2 2 0 0 1-1.7-3l8-13.9ZM12 8.3a1.1 1.1 0 0 0-1.1 1.2l.3 4.4a.8.8 0 0 0 1.6 0l.3-4.4A1.1 1.1 0 0 0 12 8.3Zm0 7.5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z" />
    </Sym>
  );
}

export function XmarkOctagonFill(p: P) {
  return (
    <Sym {...p} fill>
      <path d="M8.2 2.5h7.6a1.5 1.5 0 0 1 1 .4l4.3 4.3a1.5 1.5 0 0 1 .4 1v7.6a1.5 1.5 0 0 1-.4 1l-4.3 4.3a1.5 1.5 0 0 1-1 .4H8.2a1.5 1.5 0 0 1-1-.4l-4.3-4.3a1.5 1.5 0 0 1-.4-1V8.2a1.5 1.5 0 0 1 .4-1l4.3-4.3a1.5 1.5 0 0 1 1-.4Zm1.2 5.5a1 1 0 0 0-1.4 1.4l2.6 2.6L8 14.6A1 1 0 0 0 9.4 16l2.6-2.6 2.6 2.6a1 1 0 0 0 1.4-1.4L13.4 12 16 9.4A1 1 0 0 0 14.6 8L12 10.6 9.4 8Z" />
    </Sym>
  );
}

export function InfoCircleFill(p: P) {
  return (
    <Sym {...p} fill>
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 5a1.3 1.3 0 1 1 0 2.6A1.3 1.3 0 0 1 12 7Zm1.3 10h-2.6a.8.8 0 0 1 0-1.6h.5v-3.8h-.5a.8.8 0 0 1 0-1.6h1.6c.4 0 .8.4.8.8v4.6h.2a.8.8 0 0 1 0 1.6Z" />
    </Sym>
  );
}

export function Globe(p: P & { filled?: boolean }) {
  return (
    <Sym className={p.className}>
      <circle cx="12" cy="12" r="9" fill={p.filled ? "currentColor" : "none"} fillOpacity={p.filled ? 0.18 : 0} />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
    </Sym>
  );
}

export function GaugeGrid(p: P & { filled?: boolean }) {
  const f = p.filled ? "currentColor" : "none";
  return (
    <Sym className={p.className}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" fill={f} />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" fill={f} />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" fill={f} />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" fill={f} />
    </Sym>
  );
}

export function ClockHistory(p: P & { filled?: boolean }) {
  return (
    <Sym className={p.className}>
      <path d="M3.8 12a8.2 8.2 0 1 0 2.4-5.8" />
      <path d="M3.5 4.5v3.7h3.7" />
      <path d="M12 7.8V12l3 2" />
      {p.filled ? <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /> : null}
    </Sym>
  );
}

export function LockShield(p: P) {
  return (
    <Sym {...p}>
      <path d="M12 3 5 5.8v5.4c0 4.4 3 8.3 7 9.8 4-1.5 7-5.4 7-9.8V5.8L12 3Z" />
      <rect x="9" y="10.5" width="6" height="5" rx="1.2" />
      <path d="M10.3 10.5V9.3a1.7 1.7 0 0 1 3.4 0v1.2" />
    </Sym>
  );
}

export function Bolt(p: P) {
  return (
    <Sym {...p}>
      <path d="M13.2 2.8 5.5 13.2h6l-1 8 7.8-10.6h-6l.9-7.8Z" />
    </Sym>
  );
}

export function Pulse(p: P) {
  return (
    <Sym {...p}>
      <path d="M2.5 12.5h4l2.5-6 4 12 2.6-6h5.9" />
    </Sym>
  );
}

export function Server(p: P) {
  return (
    <Sym {...p}>
      <rect x="3.5" y="4" width="17" height="7" rx="2" />
      <rect x="3.5" y="13" width="17" height="7" rx="2" />
      <path d="M7 7.5h.01M7 16.5h.01" strokeWidth={2.6} />
    </Sym>
  );
}

export function ArrowUpRight(p: P) {
  return (
    <Sym {...p} w={2}>
      <path d="M7.5 16.5 16.5 7.5M9 7.5h7.5V15" />
    </Sym>
  );
}

export function DocOnDoc(p: P) {
  return (
    <Sym {...p}>
      <rect x="8.5" y="8.5" width="11" height="12" rx="2.2" />
      <path d="M15.5 8.5V6a2.2 2.2 0 0 0-2.2-2.2H6.7A2.2 2.2 0 0 0 4.5 6v8.3a2.2 2.2 0 0 0 2.2 2.2h1.8" />
    </Sym>
  );
}

export function ArrowUpArrowDown(p: P) {
  return (
    <Sym {...p} w={2}>
      <path d="M8 19V5M4.5 8.5 8 5l3.5 3.5M16 5v14M12.5 15.5 16 19l3.5-3.5" />
    </Sym>
  );
}

export function Checkmark(p: P) {
  return (
    <Sym {...p} w={2.4}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </Sym>
  );
}

export function Trash(p: P) {
  return (
    <Sym {...p}>
      <path d="M4.5 6.5h15M9.5 6.5V4.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3v1.7M6.5 6.5l.9 12.2c.1 1 .9 1.8 1.9 1.8h5.4c1 0 1.8-.8 1.9-1.8l.9-12.2" />
    </Sym>
  );
}

/** Engrane con llave (mantenimiento). */
export function GearWrench(p: P) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={p.className ?? "h-12 w-12"}>
      <defs>
        <linearGradient id="gw-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f2f2f7" />
          <stop offset="1" stopColor="#8e8e93" />
        </linearGradient>
      </defs>
      <path
        fill="url(#gw-a)"
        d="M21.2 4h5.6l.9 4.6c1.3.4 2.5.9 3.6 1.6l3.9-2.6 4 4-2.6 3.9c.7 1.1 1.2 2.3 1.6 3.6l4.6.9v5.6l-4.6.9c-.4 1.3-.9 2.5-1.6 3.6l2.6 3.9-4 4-3.9-2.6c-1.1.7-2.3 1.2-3.6 1.6l-.9 4.6h-5.6l-.9-4.6c-1.3-.4-2.5-.9-3.6-1.6l-3.9 2.6-4-4 2.6-3.9c-.7-1.1-1.2-2.3-1.6-3.6L4 26.8v-5.6l4.6-.9c.4-1.3.9-2.5 1.6-3.6l-2.6-3.9 4-4 3.9 2.6c1.1-.7 2.3-1.2 3.6-1.6L21.2 4ZM24 15.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Z"
      />
      <path
        fill="#1c1c1e"
        stroke="#d1d1d6"
        strokeWidth="1.6"
        strokeLinejoin="round"
        d="M31.6 13.4a6 6 0 0 0-7.6 7.6L13 32a2.6 2.6 0 0 0 3.7 3.7l11-11a6 6 0 0 0 7.6-7.6l-3.4 3.4-3.1-.6-.6-3.1 3.4-3.4Z"
      />
    </svg>
  );
}

export function ShieldCheck(p: P) {
  return (
    <Sym {...p}>
      <path d="M12 3 5 5.8v5.4c0 4.4 3 8.3 7 9.8 4-1.5 7-5.4 7-9.8V5.8L12 3Z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </Sym>
  );
}

export function Speedometer(p: P) {
  return (
    <Sym {...p}>
      <path d="M4 17a8.5 8.5 0 1 1 16 0" />
      <path d="m12 14 4-5" />
      <circle cx="12" cy="14.5" r="1.2" fill="currentColor" stroke="none" />
    </Sym>
  );
}

export function Bag(p: P) {
  return (
    <Sym {...p}>
      <path d="M5.5 8h13l-.9 11.2a1.8 1.8 0 0 1-1.8 1.6H8.2a1.8 1.8 0 0 1-1.8-1.6L5.5 8Z" />
      <path d="M9 10.5V7a3 3 0 0 1 6 0v3.5" />
    </Sym>
  );
}

export function Envelope(p: P) {
  return (
    <Sym {...p}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
      <path d="m4.5 7 7.5 6 7.5-6" />
    </Sym>
  );
}

export function Plus(p: P) {
  return (
    <Sym {...p} w={2.2}>
      <path d="M12 5v14M5 12h14" />
    </Sym>
  );
}
