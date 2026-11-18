"use client";

/**
 * AppReady.tsx — La app ya desbloqueada: si falta el perfil (nombre y foto),
 * primero se crea; después, los chats (Shell). Se usa en la consola del
 * fundador, en el ícono de chat de miembros y admins, y en la cuenta
 * vinculada.
 */

import { useMyProfile } from "@/hooks/useMyProfile";
import { ProfileSetup } from "./ProfileEditor";
import { Shell, type ShellProps } from "./Shell";
import { ChatListSkeleton } from "./Skeletons";

export function AppReady(props: ShellProps) {
  const profile = useMyProfile(props.session);
  if (profile.loading) {
    return <ChatListSkeleton />;
  }
  if (!profile.valid) return <ProfileSetup session={props.session} />;
  return <Shell {...props} />;
}
