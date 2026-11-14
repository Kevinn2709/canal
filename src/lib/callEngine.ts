/**
 * callEngine.ts — Una llamada 1 a 1 en curso (WebRTC + señales cifradas).
 *
 * Documentos (todos se borran al colgar):
 *   chats/{chat}/calls/{call}          la oferta cifrada, de quién y para quién
 *   chats/{chat}/calls/{call}/sig/{id} respuesta, direcciones de red y avisos
 *                                      (rechazo, ocupado, "seguimos aquí"), cifrados
 *
 * - Quien llama crea la oferta y espera; si nadie contesta en 45 s, cuelga.
 * - Quien recibe la ve en todos sus dispositivos abiertos; el primero que
 *   contesta se queda con la llamada y los demás dejan de sonar.
 * - Si la red cambia (Wi-Fi -> datos), quien llamó renegocia la conexión.
 * - Silenciar el micrófono o apagar la cámara no renegocia nada: se avisa al
 *   otro por un canal de datos de la propia llamada (también cifrado).
 */

import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch,
  type DocumentData,
  type Firestore,
  type Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import {
  CONNECT_MS,
  KEEPALIVE_MS,
  LOST_MS,
  RING_MS,
  callCode,
  getIceConfig,
  openSignal,
  sdpFingerprint,
  sealOffer,
  sealSignal,
  type Offer,
  type Signal,
} from "./calls";
import { notifyCall } from "./push";

export type CallPhase = "outgoing" | "incoming" | "connecting" | "active" | "reconnecting" | "ended";

export interface CallView {
  callId: string;
  chatId: string;
  peer: string;
  role: "caller" | "callee";
  phase: CallPhase;
  offeredVideo: boolean; // la llamada se hizo con video
  mic: boolean;
  cam: boolean;
  remoteMic: boolean;
  remoteCam: boolean;
  startedAt: number | null;
  endReason: string | null;
  code: string | null;
  route: "direct" | "relay" | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
}

export interface CallOptions {
  db: Firestore;
  chatId: string;
  callId: string;
  key: CryptoKey;
  me: string;
  peer: string;
  dev: string; // este dispositivo
  role: "caller" | "callee";
  offer?: Offer; // quien recibe: la oferta ya descifrada
  relayOnly: boolean;
  getToken: () => Promise<string>;
  onChange: (view: CallView) => void;
}

const AUDIO: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

function videoConstraints(facing: "user" | "environment"): MediaTrackConstraints {
  return { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } };
}

function millis(v: unknown): number {
  const ts = v as Timestamp | null | undefined;
  return ts && typeof ts.toDate === "function" ? ts.toDate().getTime() : Date.now();
}

function mediaError(err: unknown, video: boolean): string {
  const name = (err as { name?: string }).name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return video ? "Sin permiso para el micrófono o la cámara." : "Sin permiso para el micrófono.";
  }
  return video ? "No se pudo usar el micrófono o la cámara." : "No se pudo usar el micrófono.";
}

/** Escribe una señal cifrada (también la usa quien solo responde "ocupado"). */
export async function writeSignal(
  db: Firestore,
  key: CryptoKey,
  chatId: string,
  callId: string,
  me: string,
  sig: Signal
): Promise<string> {
  const ref = doc(collection(db, "chats", chatId, "calls", callId, "sig"));
  const sealed = await sealSignal(key, chatId, callId, ref.id, me, sig);
  await setDoc(ref, { from: me, iv: sealed.iv, ct: sealed.ct, at: serverTimestamp() });
  return ref.id;
}

/** Borra una llamada y todas sus señales. */
export async function deleteCallDocs(db: Firestore, chatId: string, callId: string, known: string[] = []): Promise<void> {
  const ids = new Set(known);
  try {
    const snap = await getDocs(collection(db, "chats", chatId, "calls", callId, "sig"));
    for (const d of snap.docs) ids.add(d.id);
  } catch {
    // Se borran al menos las que conocemos.
  }
  const list = [...ids];
  for (let i = 0; i < list.length || i === 0; i += 100) {
    const batch = writeBatch(db);
    for (const id of list.slice(i, i + 100)) batch.delete(doc(db, "chats", chatId, "calls", callId, "sig", id));
    if (i + 100 >= list.length) batch.delete(doc(db, "chats", chatId, "calls", callId));
    await batch.commit();
  }
}

export class Call {
  view: CallView;
  private readonly o: CallOptions;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private audioSender: RTCRtpSender | null = null;
  private videoSender: RTCRtpSender | null = null;
  private tracks: { audio: MediaStreamTrack | null; video: MediaStreamTrack | null } = { audio: null, video: null };
  private facing: "user" | "environment" = "user";
  private remote: MediaStream | null = null;
  private unsubs: Unsubscribe[] = [];
  private seen = new Set<string>();
  private sigIds = new Set<string>();
  private mine = new Set<string>();
  private queue: Promise<void> = Promise.resolve();
  private seq = 0;
  private canSend = false;
  private outCands: RTCIceCandidateInit[] = [];
  private flushTimer: number | null = null;
  private remoteCands = new Map<string, RTCIceCandidateInit[]>(); // por dispositivo, antes de poder usarlas
  private peerDev: string | null = null;
  private haveRemote = false;
  private callDocSeen = false;
  private ended = false;
  private timers = new Map<string, number>();
  private wake: { release: () => Promise<void> } | null = null;
  private onVisible = () => {
    if (document.visibilityState === "visible" && this.view.phase === "active") void this.keepAwake();
  };

  constructor(o: CallOptions) {
    this.o = o;
    if (o.offer) this.peerDev = o.offer.dev;
    this.view = {
      callId: o.callId,
      chatId: o.chatId,
      peer: o.peer,
      role: o.role,
      phase: o.role === "caller" ? "outgoing" : "incoming",
      offeredVideo: !!o.offer?.video,
      mic: true,
      cam: false,
      remoteMic: true,
      remoteCam: !!o.offer?.video,
      startedAt: null,
      endReason: null,
      code: null,
      route: null,
      localStream: null,
      remoteStream: null,
    };
  }

  // ---------------------------------------------------------------- público

  /** Quien llama: pide el micrófono (y la cámara), crea la oferta y espera. */
  async start(video: boolean): Promise<void> {
    this.view.offeredVideo = video;
    this.emit({});
    if (!(await this.openMedia(video))) return;
    const ice = await getIceConfig(this.o.getToken);
    if (this.ended) return;
    const pc = this.makePc(ice.servers, ice.relay);
    const stream = new MediaStream([this.tracks.audio, this.tracks.video].filter((t): t is MediaStreamTrack => !!t));
    this.audioSender = pc.addTransceiver(this.tracks.audio ?? "audio", { direction: "sendrecv", streams: [stream] }).sender;
    this.videoSender = pc.addTransceiver(this.tracks.video ?? "video", { direction: "sendrecv", streams: [stream] }).sender;
    this.useChannel(pc.createDataChannel("ctl", { ordered: true }));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (this.ended) return;

    const { db, chatId, callId, me, peer, key } = this.o;
    this.listen();
    try {
      const sealed = await sealOffer(key, chatId, callId, me, peer, { t: "offer", sdp: offer.sdp ?? "", video, dev: this.o.dev });
      await setDoc(doc(db, "chats", chatId, "calls", callId), { from: me, to: peer, iv: sealed.iv, ct: sealed.ct, at: serverTimestamp() });
    } catch {
      this.finish("No se pudo iniciar la llamada. Revisa tu conexión.", false);
      return;
    }
    this.canSend = true;
    this.scheduleFlush();
    notifyCall(this.o.getToken, chatId);
    this.timer("ring", RING_MS, () => this.finish("No contestó"));
  }

  /** Quien recibe: escucha mientras suena (por si cuelgan o contestas en otro dispositivo). */
  ring(): void {
    this.listen();
    this.timer("ring", RING_MS + 5_000, () => this.finish("Llamada perdida", false));
  }

  /** Quien recibe: contesta. */
  async accept(video: boolean): Promise<void> {
    if (this.view.phase !== "incoming" || !this.o.offer) return;
    this.clear("ring");
    this.emit({ phase: "connecting" });
    if (!(await this.openMedia(video))) {
      void this.send({ t: "decline", n: 0, dev: this.o.dev });
      return;
    }
    const ice = await getIceConfig(this.o.getToken);
    if (this.ended) return;
    const pc = this.makePc(ice.servers, ice.relay);
    try {
      await pc.setRemoteDescription({ type: "offer", sdp: this.o.offer.sdp });
      this.haveRemote = true;
      for (const t of pc.getTransceivers()) {
        const kind = t.receiver.track.kind;
        t.direction = "sendrecv";
        if (kind === "audio") {
          this.audioSender = t.sender;
          if (this.tracks.audio) await t.sender.replaceTrack(this.tracks.audio);
        } else if (kind === "video") {
          this.videoSender = t.sender;
          if (this.tracks.video) await t.sender.replaceTrack(this.tracks.video);
        }
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.canSend = true;
      await this.send({ t: "answer", n: 0, dev: this.o.dev, sdp: answer.sdp ?? "", video: !!this.tracks.video });
      await this.useRemoteCandidates(this.peerDev);
      this.scheduleFlush();
      this.timer("connect", CONNECT_MS, () => this.finish("No se pudo conectar la llamada."));
    } catch {
      this.finish("No se pudo conectar la llamada.");
    }
  }

  /** Quien recibe: rechaza. Quien llamó borra la llamada. */
  decline(): void {
    if (this.view.phase !== "incoming") return;
    void this.send({ t: "decline", n: 0, dev: this.o.dev }).catch(() => undefined);
    this.finish("Rechazaste la llamada", false);
  }

  hangup(): void {
    this.finish(this.view.phase === "outgoing" ? "Llamada cancelada" : "Llamada terminada");
  }

  toggleMic(): void {
    const t = this.tracks.audio;
    if (!t) return;
    t.enabled = !t.enabled;
    this.emit({ mic: t.enabled });
    this.sendState();
  }

  async toggleCam(): Promise<void> {
    if (this.ended) return;
    if (this.tracks.video) {
      const t = this.tracks.video;
      this.tracks.video = null;
      await this.videoSender?.replaceTrack(null).catch(() => undefined);
      t.stop();
      this.emit({ cam: false, localStream: this.localStream() });
    } else {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(this.facing) });
        const t = s.getVideoTracks()[0];
        if (this.ended) {
          t.stop();
          return;
        }
        this.tracks.video = t;
        await this.videoSender?.replaceTrack(t).catch(() => undefined);
        this.emit({ cam: true, localStream: this.localStream() });
      } catch {
        return;
      }
    }
    this.sendState();
  }

  async switchCamera(): Promise<void> {
    if (!this.tracks.video || this.ended) return;
    const next = this.facing === "user" ? "environment" : "user";
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(next) });
      const t = s.getVideoTracks()[0];
      const old = this.tracks.video;
      this.tracks.video = t;
      this.facing = next;
      await this.videoSender?.replaceTrack(t).catch(() => undefined);
      old?.stop();
      this.emit({ localStream: this.localStream() });
    } catch {
      // Solo hay una cámara.
    }
  }

  /** Señales que llegan por la colección de llamadas (desde useCalls). */
  isFor(callId: string): boolean {
    return this.o.callId === callId;
  }

  get live(): boolean {
    return !this.ended;
  }

  // ---------------------------------------------------------------- interno

  private emit(patch: Partial<CallView>): void {
    this.view = { ...this.view, ...patch };
    this.o.onChange(this.view);
  }

  private timer(name: string, ms: number, fn: () => void): void {
    this.clear(name);
    this.timers.set(name, window.setTimeout(() => {
      this.timers.delete(name);
      fn();
    }, ms));
  }

  private clear(name: string): void {
    const t = this.timers.get(name);
    if (t !== undefined) window.clearTimeout(t);
    this.timers.delete(name);
  }

  private localStream(): MediaStream {
    return new MediaStream([this.tracks.video, this.tracks.audio].filter((t): t is MediaStreamTrack => !!t));
  }

  private async openMedia(video: boolean): Promise<boolean> {
    try {
      let s: MediaStream;
      try {
        s = await navigator.mediaDevices.getUserMedia({ audio: AUDIO, video: video ? videoConstraints(this.facing) : false });
      } catch (err) {
        if (!video) throw err;
        s = await navigator.mediaDevices.getUserMedia({ audio: AUDIO, video: false }); // sin cámara: solo voz
      }
      if (this.ended) {
        s.getTracks().forEach((t) => t.stop());
        return false;
      }
      this.tracks.audio = s.getAudioTracks()[0] ?? null;
      this.tracks.video = s.getVideoTracks()[0] ?? null;
      this.emit({ cam: !!this.tracks.video, mic: true, localStream: this.localStream() });
      return true;
    } catch (err) {
      this.finish(mediaError(err, video), false);
      return false;
    }
  }

  private makePc(servers: RTCIceServer[], relayAvailable: boolean): RTCPeerConnection {
    const pc = new RTCPeerConnection({
      iceServers: servers,
      // "Ocultar mi IP": solo por el relevo (si hay uno configurado).
      iceTransportPolicy: this.o.relayOnly && relayAvailable ? "relay" : "all",
    });
    this.pc = pc;
    pc.onicecandidate = (e) => {
      if (!e.candidate || !e.candidate.candidate) return;
      this.outCands.push(e.candidate.toJSON());
      this.scheduleFlush();
    };
    pc.ontrack = (e) => {
      if (!this.remote) this.remote = new MediaStream();
      if (!this.remote.getTracks().includes(e.track)) this.remote.addTrack(e.track);
      this.emit({ remoteStream: this.remote });
    };
    pc.ondatachannel = (e) => this.useChannel(e.channel);
    pc.onconnectionstatechange = () => this.onConnection();
    return pc;
  }

  private useChannel(ch: RTCDataChannel): void {
    this.dc = ch;
    ch.onopen = () => this.sendState();
    ch.onmessage = (e) => {
      try {
        const m = JSON.parse(String(e.data)) as { t?: string; mic?: unknown; cam?: unknown };
        if (m.t === "state") this.emit({ remoteMic: m.mic !== false, remoteCam: m.cam === true });
        else if (m.t === "bye") this.finish("Llamada terminada");
      } catch {
        // Mensaje inválido.
      }
    };
  }

  private sendState(): void {
    if (this.dc?.readyState !== "open") return;
    try {
      this.dc.send(JSON.stringify({ t: "state", mic: this.tracks.audio?.enabled !== false, cam: !!this.tracks.video }));
    } catch {
      // Canal cerrado.
    }
  }

  private async onConnection(): Promise<void> {
    const pc = this.pc;
    if (!pc || this.ended) return;
    const s = pc.connectionState;
    if (s === "connected") {
      this.clear("connect");
      this.clear("lost");
      this.clear("restart");
      const first = this.view.startedAt === null;
      this.emit({ phase: "active", startedAt: this.view.startedAt ?? Date.now() });
      if (first) {
        void this.keepAwake();
        document.addEventListener("visibilitychange", this.onVisible);
        this.keepalive();
        const a = sdpFingerprint(pc.localDescription?.sdp);
        const b = sdpFingerprint(pc.remoteDescription?.sdp);
        if (a && b) this.emit({ code: await callCode(a, b) });
      }
      this.emit({ route: await this.routeOf(pc) });
    } else if (s === "disconnected" || s === "failed") {
      if (this.view.phase === "active") this.emit({ phase: "reconnecting" });
      if (this.o.role === "caller" && !this.timers.has("restart")) {
        this.timer("restart", s === "failed" ? 0 : 3_000, () => void this.restartIce());
      }
      if (!this.timers.has("lost")) this.timer("lost", LOST_MS, () => this.finish("Se perdió la conexión"));
    }
  }

  private keepalive(): void {
    this.timer("ka", KEEPALIVE_MS, () => {
      void this.send({ t: "ka", n: 0, dev: this.o.dev }).catch(() => undefined);
      this.keepalive();
    });
  }

  private async routeOf(pc: RTCPeerConnection): Promise<"direct" | "relay" | null> {
    try {
      const stats = await pc.getStats();
      let pairId: string | undefined;
      stats.forEach((r: { type?: string; selectedCandidatePairId?: string }) => {
        if (r.type === "transport" && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId;
      });
      let pair: { localCandidateId?: string; remoteCandidateId?: string } | undefined;
      stats.forEach((r: { type?: string; id?: string; nominated?: boolean; state?: string }) => {
        if (r.type !== "candidate-pair") return;
        if (pairId ? r.id === pairId : r.nominated && r.state === "succeeded") pair = r as typeof pair;
      });
      if (!pair) return null;
      const local = pair.localCandidateId ? stats.get(pair.localCandidateId) : undefined;
      const remote = pair.remoteCandidateId ? stats.get(pair.remoteCandidateId) : undefined;
      return local?.candidateType === "relay" || remote?.candidateType === "relay" ? "relay" : "direct";
    } catch {
      return null;
    }
  }

  private async restartIce(): Promise<void> {
    const pc = this.pc;
    if (!pc || this.ended || this.o.role !== "caller" || pc.connectionState === "connected") return;
    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      await this.send({ t: "reoffer", n: 0, dev: this.o.dev, sdp: offer.sdp ?? "" });
    } catch {
      // Se reintenta con el próximo cambio de estado.
    }
  }

  private async keepAwake(): Promise<void> {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
      this.wake = (await nav.wakeLock?.request("screen")) ?? null;
    } catch {
      // Sin bloqueo de pantalla en este navegador.
    }
  }

  private async send(sig: Signal): Promise<void> {
    const n = ++this.seq;
    const { db, key, chatId, callId, me } = this.o;
    const id = await writeSignal(db, key, chatId, callId, me, { ...sig, n });
    this.mine.add(id);
    this.sigIds.add(id);
  }

  private scheduleFlush(): void {
    if (!this.canSend || this.flushTimer !== null || this.outCands.length === 0) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      const list = this.outCands.splice(0, 50);
      if (list.length === 0 || this.ended) return;
      void this.send({ t: "cands", n: 0, dev: this.o.dev, list }).catch(() => undefined);
      this.scheduleFlush();
    }, 250);
  }

  private listen(): void {
    const { db, chatId, callId } = this.o;
    this.unsubs.push(
      onSnapshot(
        doc(db, "chats", chatId, "calls", callId),
        (snap) => {
          if (snap.exists()) {
            this.callDocSeen = true;
            return;
          }
          if (!this.callDocSeen || this.ended) return;
          // Del otro lado colgaron (o se canceló antes de contestar).
          const p = this.view.phase;
          this.finish(p === "incoming" ? "Llamada perdida" : p === "outgoing" ? "No disponible" : "Llamada terminada", false);
        },
        () => undefined
      )
    );
    this.unsubs.push(
      onSnapshot(
        collection(db, "chats", chatId, "calls", callId, "sig"),
        (snap) => {
          const fresh: { id: string; data: DocumentData }[] = [];
          for (const d of snap.docs) {
            this.sigIds.add(d.id);
            if (this.seen.has(d.id) || this.mine.has(d.id)) continue;
            this.seen.add(d.id);
            fresh.push({ id: d.id, data: d.data({ serverTimestamps: "estimate" }) });
          }
          fresh.sort((a, b) => millis(a.data.at) - millis(b.data.at));
          for (const f of fresh) this.queue = this.queue.then(() => this.onSignalDoc(f.id, f.data)).catch(() => undefined);
        },
        () => undefined
      )
    );
  }

  private async onSignalDoc(id: string, data: DocumentData): Promise<void> {
    if (this.ended) return;
    const { key, chatId, callId, me, peer } = this.o;
    const from = typeof data.from === "string" ? data.from : "";
    if (from !== me && from !== peer) return;
    if (typeof data.iv !== "string" || typeof data.ct !== "string") return;
    const sig = await openSignal(key, chatId, callId, id, from, { iv: data.iv, ct: data.ct });
    if (!sig || this.ended) return;

    if (from === me) {
      // Otro dispositivo mío contestó o rechazó esta llamada.
      if (this.o.role === "callee" && this.view.phase === "incoming" && sig.dev !== this.o.dev) {
        if (sig.t === "answer") this.finish("Contestaste en otro dispositivo", false);
        else if (sig.t === "decline") this.finish("Rechazaste la llamada", false);
      }
      return;
    }

    const pc = this.pc;
    if (this.o.role === "caller") {
      switch (sig.t) {
        case "answer":
          if (this.peerDev || !pc) return;
          this.peerDev = sig.dev;
          this.clear("ring");
          this.emit({ phase: "connecting", remoteCam: sig.video });
          await pc.setRemoteDescription({ type: "answer", sdp: sig.sdp });
          this.haveRemote = true;
          await this.useRemoteCandidates(sig.dev);
          this.timer("connect", CONNECT_MS, () => this.finish("No se pudo conectar la llamada."));
          return;
        case "reanswer":
          if (pc && sig.dev === this.peerDev) await pc.setRemoteDescription({ type: "answer", sdp: sig.sdp });
          return;
        case "cands":
          await this.addRemoteCandidates(sig.dev, sig.list);
          return;
        case "decline":
          if (!this.peerDev) this.finish("Rechazó la llamada");
          return;
        case "busy":
          if (!this.peerDev) this.finish("Está en otra llamada");
          return;
        default:
          return;
      }
    }
    // Quien recibe: solo escucha al dispositivo que llamó.
    if (sig.dev !== this.peerDev) return;
    switch (sig.t) {
      case "cands":
        await this.addRemoteCandidates(sig.dev, sig.list);
        return;
      case "reoffer":
        if (!pc || !this.haveRemote) return;
        await pc.setRemoteDescription({ type: "offer", sdp: sig.sdp });
        {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await this.send({ t: "reanswer", n: 0, dev: this.o.dev, sdp: answer.sdp ?? "" });
        }
        return;
      default:
        return;
    }
  }

  private async addRemoteCandidates(dev: string, list: RTCIceCandidateInit[]): Promise<void> {
    if (this.pc && this.haveRemote && dev === this.peerDev) {
      for (const c of list) await this.pc.addIceCandidate(c).catch(() => undefined);
      return;
    }
    this.remoteCands.set(dev, [...(this.remoteCands.get(dev) ?? []), ...list]);
  }

  private async useRemoteCandidates(dev: string | null): Promise<void> {
    if (!dev || !this.pc) return;
    const list = this.remoteCands.get(dev) ?? [];
    this.remoteCands.clear();
    for (const c of list) await this.pc.addIceCandidate(c).catch(() => undefined);
  }

  /** Termina la llamada. `cleanup`: borrar los documentos de la llamada. */
  private finish(reason: string, cleanup = true): void {
    if (this.ended) return;
    this.ended = true;
    if (this.dc?.readyState === "open") {
      try {
        this.dc.send(JSON.stringify({ t: "bye" }));
      } catch {
        // Canal cerrado.
      }
    }
    for (const t of this.timers.values()) window.clearTimeout(t);
    this.timers.clear();
    if (this.flushTimer !== null) window.clearTimeout(this.flushTimer);
    for (const un of this.unsubs) un();
    this.unsubs = [];
    document.removeEventListener("visibilitychange", this.onVisible);
    // Un momento para que el "adiós" salga antes de cerrar la conexión.
    const pc = this.pc;
    window.setTimeout(() => pc?.close(), 150);
    this.tracks.audio?.stop();
    this.tracks.video?.stop();
    void this.wake?.release().catch(() => undefined);
    this.emit({ phase: "ended", endReason: reason, localStream: null, remoteStream: null });
    if (cleanup) {
      void deleteCallDocs(this.o.db, this.o.chatId, this.o.callId, [...this.sigIds]).catch(() => undefined);
    }
  }
}
