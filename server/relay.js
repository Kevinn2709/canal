/**
 * relay.js — Relay Socket.io con store-and-forward (estilo Signal).
 *
 * Qué hace:
 *  - Empareja a dos clientes por "room" (derivada de la passphrase).
 *  - Si el destinatario está en línea, entrega el blob cifrado al instante.
 *  - Si NO está, lo guarda EN COLA (cifrado; el relay no puede leerlo) y lo
 *    entrega en cuanto se conecta. Tras entregarlo, lo BORRA de la cola.
 *  - Respaldo: un barredor elimina los no entregados tras UNDELIVERED_TTL_MS.
 *
 * Qué NO hace:
 *  - No descifra nada (no tiene la llave).
 *  - No persiste en disco: la cola vive en RAM del proceso. Si el relay se
 *    reinicia, los mensajes aún no entregados se pierden (menos rastro, pero
 *    menos garantía de entrega — intercambio consciente).
 *  - No registra el contenido.
 */

const http = require("http");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 4000;
const ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:3000";

// Control de acceso: token compartido, SOLO en variable de entorno, nunca en
// el repo. Si falta, el relay no arranca (preferimos fallar cerrado).
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
if (!ACCESS_TOKEN || ACCESS_TOKEN.length < 16) {
  console.error(
    "ERROR: define ACCESS_TOKEN (>=16 chars) como variable de entorno. " +
      "Nunca lo subas al repo."
  );
  process.exit(1);
}

// TTL de respaldo para mensajes NO entregados (no es el borrado de 24h tras
// recibir; ese ocurre en el cliente). Default: 7 días.
const UNDELIVERED_TTL_MS = Number(
  process.env.UNDELIVERED_TTL_MS || 7 * 24 * 60 * 60 * 1000
);
const MAX_QUEUE = Number(process.env.MAX_QUEUE || 500);
const ACK_TIMEOUT_MS = 10_000;

const httpServer = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(404);
  res.end();
});

const io = new Server(httpServer, {
  cors: { origin: ORIGIN, methods: ["GET", "POST"] },
});

// Puerta de acceso: rechaza conexiones sin el token correcto.
io.use((socket, next) => {
  const provided = socket.handshake.auth && socket.handshake.auth.token;
  if (typeof provided !== "string" || !timingSafeEqual(provided, ACCESS_TOKEN)) {
    return next(new Error("no autorizado"));
  }
  next();
});

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Estado por sala: sockets conectados + cola de mensajes no entregados.
// rooms: Map<room, { sockets: Map<socketId, socket>, queue: Entry[] }>
// Entry: { id, payload: {iv, ct}, senderId, ts }
const rooms = new Map();

function getRoom(r) {
  if (!rooms.has(r)) rooms.set(r, { sockets: new Map(), queue: [] });
  return rooms.get(r);
}

function otherSocket(rs, selfId) {
  for (const [id, s] of rs.sockets) if (id !== selfId) return s;
  return null;
}

/**
 * Intenta entregar cada mensaje en cola al destinatario (el socket que NO es
 * el emisor). Entrega confirmada (ack ok) -> se quita de la cola y se avisa al
 * emisor ("delivered"). Si falla, se conserva para un intento posterior.
 */
async function flushRoom(rs) {
  const remaining = [];
  for (const e of rs.queue) {
    const target = otherSocket(rs, e.senderId);
    if (!target) {
      remaining.push(e);
      continue;
    }
    try {
      const resp = await target
        .timeout(ACK_TIMEOUT_MS)
        .emitWithAck("cipher", { id: e.id, iv: e.payload.iv, ct: e.payload.ct });
      if (resp && resp.ok) {
        const sender = rs.sockets.get(e.senderId);
        if (sender) sender.emit("delivered", { id: e.id });
        // entregado y confirmado -> NO se vuelve a guardar (se borra)
      } else {
        remaining.push(e); // el cliente no pudo verificarlo; reintentar luego
      }
    } catch {
      remaining.push(e); // sin ack a tiempo; reintentar luego
    }
  }
  rs.queue = remaining;
}

io.on("connection", (socket) => {
  let joinedRoom = null;
  let rs = null;

  socket.on("join", async (room) => {
    if (typeof room !== "string" || room.length < 8) {
      socket.emit("error-msg", "room inválida");
      return;
    }
    const state = getRoom(room);
    if (state.sockets.size >= 2) {
      socket.emit("room-full");
      return;
    }
    socket.join(room);
    joinedRoom = room;
    rs = state;
    state.sockets.set(socket.id, socket);
    socket.to(room).emit("peer-joined");
    socket.emit("joined");
    // Entregar lo que estuviera esperando a este recién llegado.
    await flushRoom(state);
  });

  socket.on("cipher", async (data) => {
    if (!rs || !data || typeof data.id !== "string") return;
    rs.queue.push({
      id: data.id,
      payload: { iv: data.iv, ct: data.ct },
      senderId: socket.id,
      ts: Date.now(),
    });
    if (rs.queue.length > MAX_QUEUE) rs.queue.shift();
    await flushRoom(rs);
    // Si sigue en cola, el destinatario no estaba: avisar "en cola".
    const stillQueued = rs.queue.some((e) => e.id === data.id);
    if (stillQueued) socket.emit("queued", { id: data.id });
  });

  socket.on("disconnect", () => {
    if (rs) {
      rs.sockets.delete(socket.id);
      socket.to(joinedRoom).emit("peer-left");
    }
  });
});

// Barredor de respaldo: borra no entregados vencidos y limpia salas vacías.
setInterval(() => {
  const now = Date.now();
  for (const [room, rs] of rooms) {
    rs.queue = rs.queue.filter((e) => now - e.ts < UNDELIVERED_TTL_MS);
    if (rs.sockets.size === 0 && rs.queue.length === 0) rooms.delete(room);
  }
}, 60_000);

httpServer.listen(PORT, () => {
  console.log(
    `relay en :${PORT} | origin: ${ORIGIN} | TTL no entregados: ${Math.round(
      UNDELIVERED_TTL_MS / 3600000
    )}h`
  );
});
