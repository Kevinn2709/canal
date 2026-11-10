/**
 * sound.ts — Sonido corto para los mensajes nuevos (generado, sin archivos).
 *
 * Los navegadores solo dejan sonar audio después de que tocas la página una
 * vez; unlockAudio() se llama en el primer toque.
 */

let ctx: AudioContext | null = null;

export function unlockAudio(): void {
  try {
    if (!ctx) {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    ctx = null;
  }
}

export function playMessageSound(): void {
  if (!ctx || ctx.state !== "running") return;
  try {
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.setValueAtTime(1320, t + 0.1);
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + 0.34);
  } catch {
    // Sin audio disponible.
  }
}
