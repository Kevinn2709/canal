# Chat privado cifrado para dos personas

Chat en tiempo real con historial guardado y cifrado de extremo a extremo,
para dos cuentas. Usa:

- **Vercel** (plan Hobby, gratis) para la web.
- **Firebase** (plan Spark, gratis, sin tarjeta) para el inicio de sesión y
  para guardar los mensajes cifrados en Firestore.

No hace falta ningún servidor propio (ni Render).

## Cómo funciona

1. **Inicio de sesión:** cada uno entra con su correo y contraseña. Las dos
   cuentas se crean a mano en Firebase; nadie más puede registrarse desde la web.
2. **Frase de cifrado:** el primero que entra crea una frase. De ella sale la
   llave que cifra los mensajes. En Firebase solo se guarda una sal aleatoria y
   una prueba de verificación, nunca la frase ni la llave.
3. **Verificación:** el segundo escribe la frase y la web la comprueba contra
   esa prueba. Si no coincide, lo dice en vez de abrir una conversación vacía.
   No importan mayúsculas, acentos, signos ni espacios de más.
4. **Mensajes:** se cifran en el teléfono antes de enviarse (AES-GCM de 256
   bits, llave derivada con PBKDF2-SHA256 de 600 000 iteraciones). En Firestore
   solo hay texto cifrado. Aparecen al instante en el otro dispositivo, y quien
   no estaba conectado los ve al entrar.
5. **Historial:** las reglas de Firestore (`firestore.rules`) solo dejan leer y
   escribir a esas dos cuentas, y prohíben editar o borrar mensajes.
6. **Recordar en este dispositivo** (opcional): guarda la llave (no la frase)
   en el navegador para no escribir la frase cada vez. "Cerrar sesión" la borra.

## Qué protege y qué no

Protege contra:

- Google y cualquiera con acceso a la consola de Firebase: solo ven texto
  cifrado.
- Quien entre a la cuenta de Google del administrador: tampoco puede leer los
  mensajes sin la frase.
- Cambios en la base de datos: un mensaje alterado, o con el remitente
  cambiado, deja de descifrarse en lugar de mostrarse falsificado.

No protege contra:

- **Un teléfono desbloqueado** con la sesión iniciada y la llave recordada, o
  alguien que conozca la frase.
- **Metadatos:** en la consola se ve quién escribió, cuándo y más o menos qué
  tan largo es cada mensaje (no su contenido).
- **Cambios al código de la web:** quien controle tu cuenta de GitHub o de
  Vercel podría modificar la página para capturar la frase. Activa la
  verificación en dos pasos en GitHub, Vercel y Google.
- **Filtración de la frase:** la llave es la misma para todo el historial. Si
  la frase se filtra, se puede descifrar todo lo guardado.

## La frase de cifrado

- Usa 4 o 5 palabras sin relación entre sí. Mínimo 16 letras y 3 palabras.
- Compártela en persona o por llamada, nunca por escrito ni por este chat.
- **Si los dos la olvidan, nadie puede recuperar los mensajes.** Para empezar
  de cero: en Firebase → Firestore Database, borra el documento `meta/crypto`
  y la colección `messages`. El siguiente que entre creará una frase nueva.

## Límites del plan gratis

Firestore en el plan Spark incluye 50 000 lecturas y 20 000 escrituras al día.
Cada vez que se abre el chat se leen hasta 200 mensajes, y cada mensaje nuevo
cuenta como una escritura y una lectura por cada persona conectada. Para dos
personas sobra. Si algún día se superara, Firebase deja de responder hasta el
día siguiente; no cobra nada.

## Instalación

### Parte A: Firebase

1. Entra a <https://console.firebase.google.com> y crea un proyecto (por
   ejemplo `canal`). Google Analytics no hace falta.
2. **Authentication** → **Comenzar** → pestaña **Sign-in method** →
   **Correo electrónico/contraseña** → activa el primer interruptor → **Guardar**.
3. **Authentication** → pestaña **Users** → **Agregar usuario**: crea tu cuenta
   y la de tu socio. Copia el **UID de usuario** de cada uno.
   - Para que tu socio elija su propia contraseña: en su fila, menú ⋮ →
     **Restablecer contraseña** (le llega un correo).
   - Si en **Authentication → Settings → User actions** aparece la opción
     **Enable create (sign-up)**, desactívala para que nadie más pueda crear
     cuentas.
4. **Firestore Database** → **Crear base de datos** → edición **Standard** (si
   pregunta) → elige una ubicación (no se puede cambiar después) → **modo de
   producción** → **Crear**.
5. Pestaña **Reglas**: borra todo y pega el contenido de `firestore.rules`.
   Reemplaza `UID_TUYO` y `UID_DE_TU_SOCIO` por los UID del paso 3 →
   **Publicar**.
6. Engrane → **Configuración del proyecto** → **General** → **Tus apps** →
   ícono web `</>` → ponle un nombre → **Registrar app** (sin Firebase Hosting).
   Copia solo el bloque `const firebaseConfig = { ... };`.

### Parte B: el código

7. Abre `src/lib/firebase-config.ts`, borra el bloque de ejemplo y pega el que
   copiaste. Guarda. Estos valores no son secretos y pueden ir en un repo
   público.

### Parte C: GitHub

8. Borra lo de versiones anteriores: las carpetas `src` y `server` y el archivo
   `.env.example`, si existen (en cada uno: menú ⋯ → **Delete directory** o
   **Delete file** → **Commit changes**).
9. **Add file → Upload files**, arrastra el contenido de esta carpeta (no la
   carpeta en sí) → **Commit changes**.

### Parte D: Vercel

10. Vercel redespliega solo. En **Settings → Environment Variables** puedes
    borrar `NEXT_PUBLIC_RELAY_URL`, que ya no se usa.
11. Si usabas Render para el relay, ya puedes borrar ese servicio.

### Parte E: primera vez

12. Uno de los dos entra con su correo y contraseña y **crea la frase**.
13. Le dice la frase al otro en persona o por llamada.
14. El otro entra con su cuenta y **escribe la frase**. Si coincide, entra a la
    misma conversación.

## Si algo falla

- **"Falta la configuración de Firebase"**: no se guardó el paso 7.
- **"Correo o contraseña incorrectos"**: revisa la cuenta en Authentication →
  Users.
- **"Tu cuenta no tiene acceso a la conversación"**: el UID de esa cuenta no
  está bien escrito en las reglas (paso 5), o las reglas no se publicaron.
- **"La frase no coincide"**: es otra frase, no un problema de mayúsculas o
  acentos. Confírmenla palabra por palabra.
- **Mensajes marcados "sin cifrar"**: se escribieron con una versión anterior.
  Puedes borrarlos desde la consola de Firestore.
- **El build de Vercel falla por la versión de Node**: en Vercel → Settings →
  Build and Deployment → Node.js Version, elige 22.x.
