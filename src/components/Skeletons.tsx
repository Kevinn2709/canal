/**
 * Skeletons.tsx — Esqueletos de carga con la forma real de cada pantalla, para
 * que nunca se vea una pantalla vacía mientras llegan los datos.
 */

/** Lista de chats (consola, ícono de chat, cuenta vinculada). */
export function ChatListSkeleton() {
  return (
    <div className="flex h-dvh flex-col bg-neutral-950 text-neutral-50" aria-busy="true" aria-label="Cargando conversaciones">
      <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="skeleton h-[34px] w-[34px] rounded-full" />
        <h1 className="flex-1 pl-1 text-[28px] font-bold tracking-tight">Chats</h1>
        <div className="skeleton h-8 w-8 rounded-full" />
      </div>
      <div className="flex shrink-0 gap-2 px-4 pb-3">
        <div className="skeleton h-7 w-16 rounded-full" />
        <div className="skeleton h-7 w-24 rounded-full" />
        <div className="skeleton h-7 w-20 rounded-full" />
      </div>
      <div className="flex-1 overflow-hidden px-4">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-2.5">
            <div className="skeleton h-[52px] w-[52px] shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="skeleton h-4 rounded-md" style={{ width: `${55 - (i % 3) * 10}%` }} />
              <div className="skeleton h-3.5 rounded-md" style={{ width: `${80 - (i % 4) * 9}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Contenido de la ventana de inicio de sesión mientras carga. */
export function PanelSpinner() {
  return (
    <div className="flex h-full min-h-[18rem] items-center justify-center" aria-busy="true" aria-label="Cargando">
      <span className="block h-6 w-6 animate-spin rounded-full border-2 border-neutral-600 border-t-neutral-200" />
    </div>
  );
}
