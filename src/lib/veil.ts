/**
 * veil.ts — Velo de privacidad.
 *
 * Tapa la pantalla al salir de la app para que la vista previa del selector
 * de apps no muestre los chats. Se cambia un atributo del DOM (sin esperar a
 * React) para que se dibuje en el siguiente cuadro.
 *
 * Por qué no basta con los eventos de "salir" en el iPhone: iOS toma la foto
 * del selector de apps al empezar el gesto, y a una web le avisa (blur,
 * visibilitychange) un momento después o hasta que de verdad cambias de app.
 * Por eso también se tapa en cuanto un dedo toca la barra de inicio (el borde
 * de abajo), antes de que termine el gesto (ver VeloPrivacidad).
 *
 * No se activa al tocar dentro del ícono de chat (la cuenta vinculada va en un
 * iframe) ni al cambiar de campo. Se puede apagar en Configuración (por
 * dispositivo); el componente guarda si está encendido en data-enabled.
 *
 * Diagnóstico (proyecto de pruebas): los últimos eventos quedan en
 * localStorage ("canal:velo:diag") y se ven en Configuración.
 */

export const VEIL_ID = "velo-privacidad";
const DIAG_KEY = "canal:velo:diag";
const DIAG_MAX = 25;

export interface VeilEvent {
  t: number;
  e: string;
}

export function showVeil(reason?: string): void {
  const el = typeof document !== "undefined" ? document.getElementById(VEIL_ID) : null;
  if (el && el.dataset.enabled !== "0") el.dataset.on = "1";
  if (reason) logVeil(reason);
}

export function hideVeil(reason?: string): void {
  const el = typeof document !== "undefined" ? document.getElementById(VEIL_ID) : null;
  if (el) delete el.dataset.on;
  if (reason) logVeil(reason);
}

export function logVeil(e: string): void {
  try {
    const list = readVeilLog();
    list.unshift({ t: Date.now(), e });
    localStorage.setItem(DIAG_KEY, JSON.stringify(list.slice(0, DIAG_MAX)));
  } catch {
    // Sin almacenamiento: no hay diagnóstico.
  }
}

export function readVeilLog(): VeilEvent[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DIAG_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? (raw as VeilEvent[]).filter((x) => typeof x?.t === "number" && typeof x?.e === "string") : [];
  } catch {
    return [];
  }
}

export function clearVeilLog(): void {
  try {
    localStorage.removeItem(DIAG_KEY);
  } catch {
    // Nada.
  }
}

/** Alto de la zona de la barra de inicio (0 en teléfonos con botón de inicio). */
export function homeBarInset(): number {
  if (typeof document === "undefined") return 0;
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;bottom:0;height:0;visibility:hidden;padding-bottom:env(safe-area-inset-bottom)";
  document.body.appendChild(probe);
  const px = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
  probe.remove();
  return px;
}
