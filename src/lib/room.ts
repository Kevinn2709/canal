/**
 * room.ts — Deriva un identificador de sala a partir de la passphrase
 * compartida, SIN enviar la passphrase al servidor.
 *
 * Ambos peers escriben la misma frase secreta -> obtienen la misma room id.
 * El relay solo ve el hash (la room), nunca la frase. La frase tampoco se
 * guarda en ningún lado: se usa, se deriva, y se descarta.
 *
 * Importante: la room id NO es la llave de cifrado. El cifrado real lo da
 * ECDH entre las llaves públicas. La room solo sirve para que los dos
 * correctos se encuentren en el relay.
 */

export async function deriveRoomId(passphrase: string): Promise<string> {
  const salt = "stealth-chat/room/v1"; // público, fijo
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(salt + "|" + passphrase)
  );
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex; // 64 chars, suficiente para no colisionar
}
