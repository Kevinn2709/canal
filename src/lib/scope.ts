/**
 * scope.ts — ¿En qué sesión corre este código?
 *
 * - "principal": la página normal (landing, monitor, consola del fundador o
 *   el chat de un miembro o admin).
 * - "vinculada": la página /vinculada, que el monitor del fundador abre dentro
 *   del ícono de chat (un iframe del mismo sitio). Usa una instancia de
 *   Firebase con nombre propio, así su inicio de sesión, sus llaves y sus
 *   chats no se mezclan con los del fundador.
 *
 * En la sesión vinculada no se toca nada del push: la suscripción push es una
 * sola por dispositivo y pertenece al fundador.
 */

export const LINKED_PATH = "/vinculada";
export const LINKED_APP_NAME = "vinculada";

export function isLinkedScope(): boolean {
  return typeof window !== "undefined" && window.location.pathname.startsWith(LINKED_PATH);
}
