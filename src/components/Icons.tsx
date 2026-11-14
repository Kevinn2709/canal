/** Icons.tsx — Íconos SVG en línea (sin dependencias). */

import type { ReactNode } from "react";

interface IconProps {
  className?: string;
}

function Svg({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ?? "h-5 w-5"}
    >
      {children}
    </svg>
  );
}

export function PaperclipIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M21 11.5l-8.6 8.6a5.5 5.5 0 01-7.8-7.8l8.6-8.6a3.7 3.7 0 015.2 5.2l-8.6 8.6a1.8 1.8 0 01-2.6-2.6l7.9-7.9" />
    </Svg>
  );
}

export function SendIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 12h13M12 5l7 7-7 7" />
    </Svg>
  );
}

export function BackIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M15 18l-6-6 6-6" />
    </Svg>
  );
}

export function PlusIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function MoreIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </Svg>
  );
}

export function CloseIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M18 6L6 18M6 6l12 12" />
    </Svg>
  );
}

export function DownloadIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </Svg>
  );
}

export function FileIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
      <path d="M14 3v5h5" />
    </Svg>
  );
}

export function PlayIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 5l11 7-11 7z" />
    </Svg>
  );
}

export function MicIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0014 0M12 18v3" />
    </Svg>
  );
}

export function PauseIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 5v14M16 5v14" />
    </Svg>
  );
}

export function TrashIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </Svg>
  );
}

export function SmileIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5a4.5 4.5 0 007 0M9 9.5h.01M15 9.5h.01" />
    </Svg>
  );
}

export function ReplyIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 14l-5-5 5-5" />
      <path d="M4 9h10a6 6 0 016 6v4" />
    </Svg>
  );
}

export function TasksIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M3.5 6l1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2" />
    </Svg>
  );
}

export function CopyIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 012-2h8" />
    </Svg>
  );
}

export function LockIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 018 0v4" />
    </Svg>
  );
}

export function GearIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </Svg>
  );
}

export function PinIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6zM12 15v6" />
    </Svg>
  );
}

export function BellOffIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M13.7 21a2 2 0 01-3.4 0M18.6 13A17.9 17.9 0 0118 8M6.3 6.3A6 6 0 006 8c0 7-3 9-3 9h14M18 8a6 6 0 00-9.3-5M3 3l18 18" />
    </Svg>
  );
}

export function BellIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" />
    </Svg>
  );
}

export function UsersIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 7M18 14a6.5 6.5 0 013.5 6" />
    </Svg>
  );
}

export function CheckIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 12l5 5 9-10" />
    </Svg>
  );
}

export function ShieldIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </Svg>
  );
}

export function EditIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />
    </Svg>
  );
}

export function PhoneIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 4h3.5l1.7 4.3-2.2 1.4a11 11 0 006.3 6.3l1.4-2.2L20 15.5V19a1.5 1.5 0 01-1.6 1.5A16 16 0 013.5 5.6 1.5 1.5 0 015 4z" />
    </Svg>
  );
}

/** Colgar: el teléfono de lado. */
export function HangUpIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.6 13.8l-.8-2.3c-.2-.6 0-1.2.5-1.5A15.5 15.5 0 0112 8a15.5 15.5 0 018.7 2c.5.3.7.9.5 1.5l-.8 2.3a1 1 0 01-1.3.6l-3.3-1.3.2-2.4a10 10 0 00-8 0l.2 2.4-3.3 1.3a1 1 0 01-1.3-.6z" />
    </Svg>
  );
}

export function VideoIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="6.5" width="12" height="11" rx="2" />
      <path d="M15 10.5l5.5-3v9l-5.5-3z" />
    </Svg>
  );
}

export function VideoOffIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M15 10.5l5.5-3v9l-5.5-3M3 6.5h10a2 2 0 012 2v7M15 17.5H5a2 2 0 01-2-2v-9M3 3l18 18" />
    </Svg>
  );
}

export function MicOffIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 9v2a3 3 0 005 2.2M15 10V6a3 3 0 00-5.7-1.3M5.5 11a6.5 6.5 0 0010.8 4.8M18.5 11a6.5 6.5 0 01-.4 2.2M12 17.5V21M3 3l18 18" />
    </Svg>
  );
}

export function CameraSwitchIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 8h3l1.5-2h7L17 8h3v11H4zM9.5 13.5a2.5 2.5 0 004.8.8M14.5 12.5a2.5 2.5 0 00-4.8-.8M14.5 10.5v2h-2M9.5 15.5v-2h2" />
    </Svg>
  );
}

export function StarIcon({ className, filled }: IconProps & { filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ?? "h-5 w-5"}
    >
      <path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8L3.6 9.6l5.8-.8z" />
    </svg>
  );
}
