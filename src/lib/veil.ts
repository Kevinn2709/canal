/**
 * veil.ts — Velo de privacidad.
 *
 * Cuando la consola del fundador se cierra porque la web pasó a segundo plano,
 * se cubre la pantalla con un desenfoque en ese mismo instante (cambiando un
 * atributo del DOM, sin esperar a React), para que la vista previa del
 * selector de apps no muestre los chats. Al volver, el velo se desvanece
 * sobre el monitor.
 *
 * Se activa al salir de la app: la web pierde el foco (blur), pasa a segundo
 * plano (visibilitychange) o se cierra (pagehide). No se activa al tocar
 * dentro del ícono de chat (la cuenta vinculada va en un iframe) ni al
 * cambiar de campo. Se puede apagar en Configuración (por dispositivo); el
 * componente guarda si está encendido en data-enabled.
 */

export const VEIL_ID = "velo-privacidad";

export function showVeil(): void {
  const el = typeof document !== "undefined" ? document.getElementById(VEIL_ID) : null;
  if (el && el.dataset.enabled !== "0") el.dataset.on = "1";
}

export function hideVeil(): void {
  const el = typeof document !== "undefined" ? document.getElementById(VEIL_ID) : null;
  if (el) delete el.dataset.on;
}
