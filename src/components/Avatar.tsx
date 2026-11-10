"use client";

/**
 * Avatar.tsx — Foto de perfil (o iniciales con su color) de una persona o de
 * una conversación.
 */

import { initials } from "@/lib/members";
import type { Workspace } from "@/hooks/useWorkspace";
import type { ChatInfo } from "@/lib/chats";
import { UsersIcon } from "./Icons";

export function Avatar({
  name,
  color,
  url,
  size = 40,
}: {
  name: string;
  color: string;
  url?: string | null;
  size?: number;
}) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  if (url) {
    return <img src={url} alt="" style={style} className="shrink-0 rounded-full object-cover" />;
  }
  return (
    <span
      style={{ ...style, backgroundColor: `${color}26`, color }}
      className="flex shrink-0 items-center justify-center rounded-full font-semibold"
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function PersonAvatar({ ws, uid, size = 40 }: { ws: Workspace; uid: string; size?: number }) {
  const p = ws.profiles.get(uid);
  return (
    <Avatar
      name={p?.valid ? p.name : "?"}
      color={p?.color ?? "#737373"}
      url={p && p.photo ? ws.avatars.get(uid) : null}
      size={size}
    />
  );
}

/** Chat privado: la foto del otro. Grupo: ícono de grupo. */
export function ChatAvatar({ ws, chat, myUid, size = 44 }: { ws: Workspace; chat: ChatInfo; myUid: string; size?: number }) {
  const others = chat.members.filter((m) => m !== myUid);
  if (others.length === 1 && !chat.rawName) return <PersonAvatar ws={ws} uid={others[0]} size={size} />;
  if (others.length === 1) {
    const p = ws.profiles.get(others[0]);
    if (p?.photo && ws.avatars.get(others[0])) return <PersonAvatar ws={ws} uid={others[0]} size={size} />;
  }
  if (others.length <= 1) {
    return <Avatar name={chat.name} color="#a3a3a3" size={size} />;
  }
  return (
    <span
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-full bg-neutral-800 text-neutral-300"
      aria-hidden="true"
    >
      <UsersIcon className="h-1/2 w-1/2" />
    </span>
  );
}
