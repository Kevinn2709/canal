/**
 * consoleGuard.ts — Momentos en que la consola NO debe cerrarse sola.
 *
 * La consola del fundador vuelve al monitor en cuanto la web pasa a segundo
 * plano. Hay dos casos en que eso cortaría algo que tú mismo iniciaste:
 * - Una llamada en curso (bloquear la pantalla la colgaría).
 * - Elegir una foto o archivo: en el teléfono, el selector o la cámara
 *   ponen la web en segundo plano por un momento.
 * Cada caso "sostiene" la consola mientras dura, con un tope de tiempo.
 */

const holds = new Map<string, number>(); // motivo -> vence (ms)

export function holdConsole(reason: string, ms = 120_000): void {
  holds.set(reason, Date.now() + ms);
}

export function releaseConsole(reason: string): void {
  holds.delete(reason);
}

export function releaseAll(): void {
  holds.clear();
}

export function consoleHeld(): boolean {
  const now = Date.now();
  let held = false;
  holds.forEach((until, reason) => {
    if (until < now) holds.delete(reason);
    else held = true;
  });
  return held;
}
