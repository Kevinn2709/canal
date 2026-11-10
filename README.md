# Chat privado cifrado para varios miembros

Chat en tiempo real con historial guardado y cifrado de extremo a extremo.
Hay chats privados entre dos personas y grupos, ordenados por proyecto.
Usa:

- **Vercel** (plan Hobby, gratis) para la web y para la pequeña función que
  envía las notificaciones push.
- **Firebase** (plan Spark, gratis, sin tarjeta) para el inicio de sesión y
  para guardar todo cifrado en Firestore.

## Cómo funciona

1. **Inicio de sesión:** cada uno entra con su correo y contraseña. Las
   cuentas se crean a mano en Firebase y su UID se agrega a las reglas; nadie
   más puede entrar.
   **Papeles** (los decide la lista de las reglas en la que está su UID):
   - `founders()`, **fundadores originales** (los dos de siempre): crean
     chats, aprueban cuentas nuevas, ven a todos los miembros y tienen las
     conversaciones de antes.
   - `admins()`, **fundadores adicionales**: igual que los anteriores, pero
     sin las conversaciones de antes.
   - `others()`, **miembros**: solo usan los chats a los que un fundador los
     agrega. No crean chats, no aprueban a nadie y no ven quién más está en
     la web: solo a quienes comparten un chat con ellos.
2. **Frase personal:** cada persona crea su propia frase, que solo ella sabe.
   Con ella se cifra su "paquete" de llaves (en `keys/{uid}`). Nadie necesita
   la frase de nadie más.
3. **Aprobación:** una cuenta nueva muestra un código de seguridad de 20
   cifras. Un fundador lo compara con ella (en persona o por llamada) y la
   aprueba en Configuración → Miembros. Desde ese momento puede ser agregada
   a chats.
4. **Una llave por chat:** cada chat nuevo tiene su propia llave AES-256,
   entregada cifrada solo a sus miembros (ECDH P-256 + HKDF entre quien la
   entrega y quien la recibe). Quien no es miembro no tiene la llave, y las
   reglas de Firestore tampoco le dejan leer nada de ese chat.
5. **Mensajes:** se cifran en el teléfono antes de enviarse (AES-GCM, IV
   aleatorio; el chat y el remitente van autenticados). En Firestore solo hay
   texto cifrado. Nada se edita ni se borra.
6. **Conversaciones de antes:** las que existían antes de los perfiles son
   solo de los dos fundadores y siguen con la llave de la frase compartida.
   Cada fundador la escribe una única vez al actualizar.
7. **Lista de chats:** foto, nombre, vista previa cifrada del último mensaje,
   número de mensajes sin leer y "@" si te mencionaron. Fijar arriba,
   silenciar y archivar (pulsación larga, clic derecho o "⌄"). Filtros: Todos,
   No leídos, cada proyecto y Archivados.
8. **Perfiles:** nombre y foto, cifrados con la llave del espacio. Un
   fundador lee el directorio completo (`users/`, `avatars/`). Un miembro
   solo puede leer el suyo: a los demás los ve por la copia que cada chat
   guarda de sus miembros (`chats/{id}/people` y `chats/{id}/avatars`). Las
   reglas solo aceptan copias idénticas al original, y las mantienen al día
   cada persona (la suya) y los fundadores (las de todos los miembros de sus
   chats).
9. **Grupos:** nombre y foto de quien escribe, menciones con "@" (con lista
   para elegir), "Ana está escribiendo…", "visto por todos" / "visto por Ana".
   Desde "Información del chat" un fundador agrega miembros (ven todo el
   historial), los quita, renombra o archiva; cualquiera puede salir del
   grupo.
10. **Fotos, archivos, notas de voz, stickers, reacciones, responder citando
    y pendientes:** igual que antes. Los stickers son una biblioteca compartida
    por todos los miembros.
11. **Avisos con la web abierta** (Configuración, por dispositivo): aviso
    dentro de la web con sonido cuando llega un mensaje de otro chat, y aviso
    del sistema cuando la web está en segundo plano.
12. **Notificaciones con la web cerrada (push):** en Android y computadora
    desde el navegador; en iPhone, con la web agregada a la pantalla de inicio
    (iOS 16.4 o posterior). El aviso nunca lleva el texto del mensaje: dice
    "Nuevo mensaje" o, si lo activas en ese dispositivo, de qué chat y de quién.
    Los chats silenciados no avisan, salvo que te mencionen.
13. **Recordar en este dispositivo** (opcional): guarda la llave personal (no
    la frase) en el navegador. "Cerrar sesión" la borra.

## Qué protege y qué no

Protege contra:

- Google, cualquiera con acceso a la consola de Firebase o a la cuenta de
  Google del administrador: solo ven texto cifrado (mensajes, archivos,
  nombres de chats y proyectos, perfiles, fotos, stickers, pendientes,
  reacciones, vista previa).
- Un miembro que no está en un chat: no tiene su llave ni permiso de lectura.
- Un miembro que quiere saber quién más está en la web: las reglas no le
  dejan leer el directorio de miembros ni la lista de chats; solo ve a
  quienes comparten un chat con él.
- Cambios en la base de datos: un mensaje alterado deja de descifrarse; una
  llave pública cambiada a escondidas no valida su perfil y la app no le
  entrega llaves.

No protege contra:

- **Un teléfono desbloqueado** con la sesión iniciada y la llave recordada, o
  alguien que conozca tu frase personal.
- **Metadatos:** en la consola se ve quién escribió y cuándo, quién está en
  cada chat, cuántos mensajes tiene cada chat, cuándo leyó cada quien, quién
  silenció qué chat, y más o menos qué tan largo es cada mensaje o archivo.
  Los dos fundadores originales pueden ver que existe cualquier chat (no su
  nombre ni su contenido). Un miembro ve la biblioteca de stickers
  compartida.
- **Quitar a alguien de un chat** le cierra el acceso por las reglas, pero la
  llave de ese chat no cambia: lo que ya pudo leer, ya lo leyó.
- **Notificaciones:** la función de Vercel ve el id del chat y quién lo
  envió (nunca el texto). Apple o Google ven cuándo llega un aviso.
- **Cambios al código de la web:** quien controle tu cuenta de GitHub o de
  Vercel podría modificar la página. Activa la verificación en dos pasos en
  GitHub, Vercel y Google.

## Si alguien olvida su frase

En la pantalla de la frase: "¿Olvidaste tu frase?" → crea una nueva. Un
fundador la vuelve a aprobar (con el nuevo código) y, en cuanto alguien de
cada chat abre la web, recupera esos chats con todo su historial. Un fundador
recupera además las conversaciones de antes escribiendo la frase compartida.

Si todos los miembros de un chat olvidan su frase a la vez, ese chat no se
puede recuperar (nadie, ni Firebase, tiene la llave).

## Límites del plan gratis

Firestore en el plan Spark incluye 1 GiB guardado, 10 GiB de descarga al mes,
50 000 lecturas y 20 000 escrituras al día. Si se supera un límite, Firebase
deja de responder hasta el día (o mes) siguiente; no cobra nada. Para 3 o 4
personas sobra; lo que más gasta son los archivos grandes y los videos
(máximo 10 MB cada uno).

Vercel Hobby incluye de sobra las llamadas de la función de notificaciones.
Ojo: el plan Hobby es para uso personal no comercial.

## Actualizar desde la versión anterior (de dos personas)

Nada del historial se pierde.

1. **Reglas:** Firebase → Firestore Database → Reglas. Pega el nuevo
   `firestore.rules`. En `founders()` pon los mismos dos UID de antes (tú y tu
   socio). En `others()` deja los textos de ejemplo por ahora. **Publicar.**
2. **Código:** sube el contenido de esta carpeta a GitHub (Add file → Upload
   files, el contenido, no la carpeta). Incluye las carpetas nuevas `public`
   y `src/app/api`. No hay que borrar nada. Este paquete no trae
   `firebase-config.ts`, así que tu configuración se conserva.
3. Espera a que Vercel diga **Ready** y recarga la web.
4. **Cada fundador**, al entrar: escribe una última vez la frase compartida de
   antes, crea su frase personal (distinta) y su perfil. No hace falta
   aprobarse entre ustedes.

Mientras uno ya actualizó y el otro no, el que sigue en la versión vieja no
puede crear chats nuevos; con recargar la página se arregla.

## Activar las notificaciones push (una sola vez)

1. En la web: Configuración → Notificaciones → **Generar llaves**. Se crean
   en tu dispositivo.
2. Vercel → tu proyecto → Settings → Environment Variables. Agrega:
   - `VAPID_PUBLIC_KEY` = la pública
   - `VAPID_PRIVATE_KEY` = la privada (es secreta: solo aquí)
   - (opcional) `VAPID_SUBJECT` = `mailto:tu-correo` (si no, se usa la URL del sitio)
3. Deployments → los tres puntos del último → **Redeploy**.
4. En cada dispositivo: Configuración → **Activar en este dispositivo** →
   **Enviar prueba**.

**En iPhone:** borra el ícono viejo de la pantalla de inicio. Abre la web en
Safari → Compartir → **Agregar a pantalla de inicio**. Ábrela desde ese ícono
(tendrás que iniciar sesión y escribir tu frase ahí una vez: el ícono tiene su
propio almacenamiento) y activa las notificaciones desde Configuración.

## Sumar a alguien

1. Firebase → Authentication → Users → **Agregar usuario** con su correo.
   Copia su **UID**. (Si entra antes de este paso, la web le muestra su UID.)
2. En `firestore.rules`, agrega su UID en `others()` si será miembro, o en
   `admins()` si será fundador (crea chats, aprueba, ve a todos) →
   **Publicar**.
3. Esa persona entra a la web, crea su frase personal y ve su código.
4. Un fundador: Configuración → Miembros → **Aprobar**. Comparen el código;
   si coincide, apruébala. Ella crea su perfil.
5. Un fundador la agrega a los chats que quiera (Información del chat →
   Agregar miembros) o crea un chat o grupo nuevo con ella. No verá los chats
   donde no esté, ni a nadie fuera de sus chats, ni las conversaciones de
   antes.

Para cambiar a alguien de papel, mueve su UID de una lista a otra y publica:
no hace falta aprobarlo de nuevo. Al recargar la web, ya tiene su papel
nuevo.

## Actualizar desde la versión 6 (papeles)

1. **Reglas:** abre el `firestore.rules` nuevo. Copia en `founders()` y
   `others()` los mismos UID que tienes publicados ahora. En `admins()` pon
   el UID de cada fundador adicional (y quítalo de `others()`). Pega el
   archivo en Firebase → Reglas → **Publicar**.
2. **Código:** sube el contenido del paquete a GitHub y espera a que Vercel
   diga **Ready**.
3. **Un fundador abre la web una vez:** así se crean las copias de perfil y
   foto en cada chat. Hasta entonces, un miembro puede ver "Miembro" en lugar
   de un nombre.
4. Si alguien fue aprobado pero aún no había entrado, puede volver a
   aparecer en "Esperando aprobación": compara su código y apruébalo otra
   vez.

## Instalación desde cero

### Firebase

1. <https://console.firebase.google.com> → crea un proyecto (Analytics no
   hace falta).
2. **Authentication** → Comenzar → Sign-in method → **Correo
   electrónico/contraseña** → activar → Guardar.
3. **Authentication → Users → Agregar usuario** para cada persona. Copia los
   UID. Si en Settings → User actions aparece **Enable create (sign-up)**,
   desactívalo.
4. **Firestore Database → Crear base de datos** → Standard → ubicación →
   modo de producción.
5. Pestaña **Reglas**: pega `firestore.rules` con los UID (dos en
   `founders()`, los fundadores adicionales en `admins()` y los miembros en
   `others()`) → **Publicar**.
6. Engrane → Configuración del proyecto → Tus apps → ícono web `</>` →
   registra la app (sin Firebase Hosting) y copia el bloque
   `const firebaseConfig = { ... };`.

### Código, GitHub y Vercel

7. Pega ese bloque en `src/lib/firebase-config.ts`. Estos valores no son
   secretos.
8. Sube el contenido de la carpeta a un repositorio de GitHub.
9. En Vercel, importa el repositorio y despliega.
10. Configura las notificaciones push (sección de arriba).

### Primera vez

11. El primer fundador entra, crea su frase personal y su perfil.
12. Los demás entran y crean su frase; un fundador los aprueba comparando el
    código.

## Si algo falla

- **"Falta la configuración de Firebase"**: no se guardó el paso 7.
- **"Correo o contraseña incorrectos"**: revisa la cuenta en Authentication →
  Users.
- **"Tu cuenta aún no tiene acceso"**: ese UID no está en las reglas o no se
  publicaron.
- **"Sin permiso para leer…"**: faltan las reglas de esta versión.
- **"La frase no coincide"**: es tu frase personal (la tuya), no la de otro.
- **"Esperando la llave de este chat"**: otro miembro del chat debe abrir la
  web una vez (pasa tras agregarte o tras cambiar tu frase).
- **No llegan las notificaciones**: revisa que las variables estén en Vercel
  y que hiciste Redeploy; en iPhone, que abriste la web desde el ícono de la
  pantalla de inicio; usa "Enviar prueba".
- **Una foto del iPhone llega como archivo**: el navegador no pudo leer el
  formato (HEIC); se envía como archivo descargable.
- **El build de Vercel falla por la versión de Node**: Settings → Build and
  Deployment → Node.js Version → 22.x.
