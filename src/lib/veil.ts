/**
 * veil.ts — Velo de privacidad.
 *
 * Cuando la consola del fundador se cierra porque la web pasó a segundo plano,
 * se cubre la pantalla con un desenfoque en ese mismo instante (cambiando un
 * atributo del DOM, sin esperar a React), para que la vista previa del
 * selector de apps no muestre los chats. Al volver, el velo se desvanece
 * sobre el monitor.
 *
 * Solo se activa con la app pasando a segundo plano (visibilitychange), no al
 * tocar dentro del ícono de chat ni al cambiar de campo.
 */

export const VEIL_ID = "velo-privacidad";

export function showVeil(): void {
  const el = typeof document !== "undefined" ? document.getElementById(VEIL_ID) : null;
  if (el) el.dataset.on = "1";
}

export function hideVeil(): void {
  const el = typeof document !== "undefined" ? document.getElementById(VEIL_ID) : null;
  if (el) delete el.dataset.on;
}
