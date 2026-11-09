/** format.ts — Fechas y horas en español. */

const timeFormat = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" });
const weekdayFormat = new Intl.DateTimeFormat("es-MX", { weekday: "short" });
const shortDateFormat = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" });
const longDayFormat = new Intl.DateTimeFormat("es-MX", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function isYesterday(d: Date): boolean {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  return dayKey(d) === dayKey(y);
}

export function formatTime(d: Date): string {
  return timeFormat.format(d);
}

/** Separador entre días dentro de una conversación. */
export function dayLabel(d: Date): string {
  if (dayKey(d) === dayKey(new Date())) return "Hoy";
  if (isYesterday(d)) return "Ayer";
  const label = longDayFormat.format(d);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Hora corta para la lista de conversaciones: "14:32", "ayer", "lun", "3 nov". */
export function listTime(d: Date): string {
  const now = new Date();
  if (dayKey(d) === dayKey(now)) return formatTime(d);
  if (isYesterday(d)) return "ayer";
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days < 7) return weekdayFormat.format(d).replace(".", "");
  return shortDateFormat.format(d).replace(".", "");
}
