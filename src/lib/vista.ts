/**
 * vista.ts — Qué mostrar mientras arranca la web en este equipo.
 *
 * Si lo último que se vio aquí fue el monitor (un fundador con la sesión
 * recordada), el script de arranque de layout.tsx muestra el esqueleto del
 * monitor en lugar de la landing mientras Firebase responde. Se borra al
 * cerrar sesión o si la cuenta no es de fundador.
 */

const KEY = "canal:vista";

export function rememberMonitor(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "monitor");
    else localStorage.removeItem(KEY);
  } catch {
    // Sin almacenamiento: se arranca con la landing.
  }
  if (!on && typeof document !== "undefined") delete document.documentElement.dataset.vista;
}

export function monitorHint(): boolean {
  try {
    return localStorage.getItem(KEY) === "monitor";
  } catch {
    return false;
  }
}
