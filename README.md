# Canal — mensajería E2EE asíncrona y efímera

Chat uno-a-uno con cifrado de extremo a extremo. La llave se deriva de una
frase compartida en el navegador, el servidor solo retransmite (y guarda
cifrado hasta entregar), y los mensajes desaparecen 24 h después de recibidos.
No hace falta estar conectados al mismo tiempo.

## Estructura

```
src/
  app/
    page.tsx          Orquesta bloqueo -> relay -> chat
    layout.tsx        Metadatos (noindex)
    globals.css       Tailwind
  components/
    LockScreen.tsx    Acceso (passphrase + token)
    Chat.tsx          Conversación, estado de entrega, aviso de caducidad
  hooks/
    useEphemeralSession.ts   Estado solo-RAM + caducidad 24h + wipe()
    useRelay.ts              WebSocket + cifrado/descifrado + store-and-forward
  lib/
    crypto.ts         PBKDF2 (passphrase -> llave) + AES-GCM
    room.ts           Deriva la sala desde la passphrase (sin enviarla)
server/
  relay.js            Relay Socket.io con cola cifrada + token de acceso
next.config.js        Headers anti-caché + CSP
```

## Correr en local

```bash
npm install
cp .env.example .env            # rellena ACCESS_TOKEN
cp .env.example .env.local      # para el front
# genera un token:  openssl rand -hex 24
npm run relay                   # servidor relay en :4000
npm run dev                     # front en :3000
```

Los dos abren la web, meten la **misma frase compartida** y el **mismo token
de acceso**. La frase deriva (a) la sala donde se encuentran y (b) la llave de
cifrado. El token abre la puerta del relay.

## Cómo funciona de verdad

- **E2EE con llave derivada de la frase**: PBKDF2 convierte la passphrase en
  una llave AES-GCM de 256 bits. Ambos la derivan por separado, sin handshake.
  El servidor nunca ve la frase ni la llave: solo ciphertext.
- **Asíncrono (store-and-forward)**: si tu contacto está offline, el relay
  guarda el blob **cifrado** en una cola (en RAM, no en disco) y lo entrega en
  cuanto se conecta. Al confirmarse la entrega, lo borra.
- **Desaparición a 24 h**: cada mensaje se borra de la RAM de ambos 24 h
  después de que el destinatario lo recibe. Ajustable en `page.tsx`
  (`DISAPPEAR_HOURS`).
- **Respaldo para no entregados**: si el otro nunca se conecta, el mensaje en
  cola se descarta tras `UNDELIVERED_TTL_MS` (default 7 días).
- **Control de acceso**: el token del relay impide que un desconocido que
  encuentre la URL se conecte siquiera.

## El intercambio que hiciste (léelo)

Elegiste **asíncrono** (no coincidir en línea). Eso obligó a un cambio de
diseño con una consecuencia de seguridad:

- Pasamos de **ECDH efímero** a **llave derivada de la passphrase**.
- Con ello se **pierde forward secrecy**: la llave es estable mientras la frase
  no cambie. Si la frase se filtra algún día, el ciphertext que alguien hubiera
  grabado del pasado se vuelve descifrable. Con ECDH efímero eso no pasaba,
  pero ECDH no permite mensajería asíncrona sin guardar llaves en disco.
- **Mitigación**: usa una frase larga y difícil, y rótenla cada cierto tiempo.
  Al rotarla, los mensajes viejos cifrados con la anterior dejan de ser
  descifrables aunque se filtre la nueva.

Sigue siendo E2EE (el relay no puede leer nada). Es un intercambio consciente:
async a cambio de forward secrecy. No se puede tener ambas con estas
restricciones (async + nada en disco).

## Repositorio público: sí, está bien

La seguridad descansa en la **passphrase** y el **token**, no en ocultar el
código (principio de Kerckhoffs). Publica el código sin problema **siempre que
los secretos vivan en variables de entorno** (`.env`, en `.gitignore`) y nunca
en el repo. Antes de cada push, confirma que no subes `.env`.

## Despliegue

- **Front**: Vercel/Netlify. Define `NEXT_PUBLIC_RELAY_URL` y ajusta el
  `connect-src` del CSP en `next.config.js` a tu dominio de relay (`wss://…`).
- **Relay**: cualquier host de Node (Railway, Fly, un VPS). Define
  `ACCESS_TOKEN`, `CLIENT_ORIGIN` y, opcional, `UNDELIVERED_TTL_MS`. Usa
  HTTPS/WSS: sin TLS, el token viajaría en claro.

## Límites honestos (no es invisibilidad)

- **La cola del relay vive en RAM del proceso**: si el relay se reinicia, los
  mensajes aún no entregados se pierden. Menos rastro, pero sin garantía dura
  de entrega. Si quisieras garantía, habría que persistir cifrado en disco (y
  entonces hay una copia en reposo).
- **"Desaparece a las 24 h"** vale para la RAM de la app. El SO puede volcar
  esa RAM a swap, y la memoria liberada no se sobrescribe al instante. No es un
  borrado forense. Nada impide tampoco que el otro haga una captura de pantalla
  antes de que expire.
- **El endpoint es el eslabón débil**: un teclado espía, una extensión
  maliciosa o malware ven el texto *antes* de cifrarse. Eso es higiene del
  dispositivo, ninguna app lo evita.
- **Metadatos**: el relay sabe *que* dos partes hablan y *cuándo*, aunque no
  *qué* dicen.
```
