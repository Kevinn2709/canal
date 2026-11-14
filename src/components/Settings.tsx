"use client";

/**
 * Settings.tsx — Configuración.
 *
 * - Perfil: nombre, foto y tu código de seguridad.
 * - Notificaciones de este dispositivo: avisos dentro de la web, sonido,
 *   avisos del sistema con la web abierta y push con la web cerrada.
 * - Miembros (solo fundadores): aprobar cuentas nuevas (comparando su código)
 *   y ver a todos.
 * - Seguridad: recordar en este dispositivo, cambiar tu frase, recuperar las
 *   conversaciones de antes y cerrar sesión.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { User } from "firebase/auth";
import { getFirebase } from "@/lib/firebase";
import { normalizePhrase, phraseProblem } from "@/lib/crypto";
import {
  addLegacyKey,
  approveMember,
  changePhrase,
  legacyRawFromPhrase,
  loadKeysDoc,
  openBundle,
  personalKeyFor,
  probeLegacy,
  type Session,
} from "@/lib/session";
import { keyId, loadKey } from "@/lib/keystore";
import {
  disablePush,
  enablePush,
  getVapidKey,
  isIOS,
  isStandalone,
  notificationPermission,
  notificationsSupported,
  pushSupported,
  saveSettings,
  sendTestPush,
  type DeviceSettings,
} from "@/lib/push";
import { generateVapidKeys } from "@/lib/webpush";
import type { Profile } from "@/lib/members";
import type { Workspace } from "@/hooks/useWorkspace";
import { PersonAvatar } from "./Avatar";
import { ProfileEditor } from "./ProfileEditor";
import { rememberOnDevice } from "./Unlock";
import { BackIcon } from "./Icons";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">{title}</h2>
      <div className="space-y-4 rounded-xl border border-neutral-900 p-4">{children}</div>
    </section>
  );
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 text-left disabled:opacity-40"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-neutral-200">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-neutral-500">{hint}</span>}
      </span>
      <span
        className={`mt-0.5 flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors ${
          checked ? "bg-emerald-500" : "bg-neutral-700"
        }`}
      >
        <span className={`h-5 w-5 rounded-full bg-white transition-transform ${checked ? "translate-x-4" : ""}`} />
      </span>
    </button>
  );
}

const smallButton =
  "rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-900 disabled:opacity-40";
const inputClass =
  "w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-base outline-none focus:border-neutral-600";

// ---------------------------------------------------------------------------

function PushControls({
  session,
  user,
  pushOn,
  onPushChange,
}: {
  session: Session;
  user: User;
  pushOn: boolean;
  onPushChange: (on: boolean) => void;
}) {
  const [vapid, setVapid] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keys, setKeys] = useState<{ publicKey: string; privateKey: string } | null>(null);

  useEffect(() => {
    void getVapidKey().then(setVapid);
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo completar.");
    }
    setBusy(false);
  };

  const ios = isIOS();
  const needsInstall = ios && !isStandalone();
  const supported = pushSupported();
  const denied = notificationPermission() === "denied";

  let status: string;
  if (needsInstall) status = "En iPhone necesitas abrir la web desde su ícono en la pantalla de inicio.";
  else if (!supported) status = "Este navegador no permite notificaciones con la web cerrada.";
  else if (vapid === undefined) status = "Comprobando…";
  else if (!vapid) status = "Falta configurarlas una vez en Vercel (abajo).";
  else if (denied) status = "Bloqueaste las notificaciones para este sitio. Actívalas en los ajustes del navegador.";
  else status = pushOn ? "Activadas en este dispositivo." : "Desactivadas en este dispositivo.";

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm text-neutral-200">Notificaciones con la web cerrada</p>
        <p className={`mt-0.5 text-xs ${pushOn ? "text-emerald-400" : "text-neutral-500"}`}>{status}</p>
      </div>

      {needsInstall && (
        <ol className="list-decimal space-y-1 pl-5 text-xs text-neutral-400">
          <li>Abre esta web en Safari.</li>
          <li>Toca Compartir (el cuadro con la flecha) → «Agregar a pantalla de inicio».</li>
          <li>Ábrela desde ese ícono, entra y vuelve aquí a activarlas.</li>
        </ol>
      )}

      {supported && vapid && !denied && (
        <div className="flex flex-wrap gap-2">
          {pushOn ? (
            <>
              <button
                type="button"
                disabled={busy}
                className={smallButton}
                onClick={() =>
                  void run(async () => {
                    const r = await sendTestPush(() => user.getIdToken());
                    setMessage(
                      r.sent > 0
                        ? `Prueba enviada a ${r.sent} dispositivo${r.sent === 1 ? "" : "s"}. Debería llegar en unos segundos.`
                        : "No se encontró ningún dispositivo activo. Desactiva y vuelve a activar."
                    );
                  })
                }
              >
                Enviar prueba
              </button>
              <button
                type="button"
                disabled={busy}
                className={smallButton}
                onClick={() =>
                  void run(async () => {
                    await disablePush(getFirebase().db, session.uid);
                    onPushChange(false);
                  })
                }
              >
                Desactivar aquí
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={busy}
              className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-medium text-neutral-950 disabled:opacity-40"
              onClick={() =>
                void run(async () => {
                  await enablePush(getFirebase().db, session.uid);
                  onPushChange(true);
                  setMessage("Listo. Usa «Enviar prueba» para comprobarlo.");
                })
              }
            >
              {busy ? "Activando…" : "Activar en este dispositivo"}
            </button>
          )}
        </div>
      )}

      {message && <p className="text-xs text-emerald-400">{message}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}

      {vapid === null && (
        <div className="space-y-2 rounded-lg bg-neutral-900/60 p-3 text-xs text-neutral-400">
          <p className="text-neutral-300">Configuración única (la hace quien administra Vercel):</p>
          <ol className="list-decimal space-y-1 pl-4">
            <li>Pulsa «Generar llaves». Se crean aquí, en tu dispositivo; no se envían a ningún lado.</li>
            <li>
              En Vercel → tu proyecto → Settings → Environment Variables, agrega <code>VAPID_PUBLIC_KEY</code> y{" "}
              <code>VAPID_PRIVATE_KEY</code> con estos valores.
            </li>
            <li>Deployments → los tres puntos del último → Redeploy. Luego recarga esta página.</li>
          </ol>
          {!keys ? (
            <button type="button" className={smallButton} onClick={() => void generateVapidKeys().then(setKeys)}>
              Generar llaves
            </button>
          ) : (
            <div className="space-y-2">
              {(
                [
                  ["VAPID_PUBLIC_KEY", keys.publicKey],
                  ["VAPID_PRIVATE_KEY", keys.privateKey],
                ] as const
              ).map(([name, value]) => (
                <div key={name}>
                  <p className="font-mono text-[11px] text-neutral-300">{name}</p>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 break-all rounded bg-neutral-950 px-2 py-1 text-[11px] text-neutral-200">
                      {value}
                    </code>
                    <button
                      type="button"
                      className="shrink-0 underline"
                      onClick={() => void navigator.clipboard?.writeText(value).catch(() => undefined)}
                    >
                      Copiar
                    </button>
                  </div>
                </div>
              ))}
              <p className="text-amber-400/80">
                La llave privada es secreta: pégala solo en Vercel. Si cierras esta pantalla antes de guardarlas, genera
                unas nuevas.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function MemberRow({ ws, p, myUid, children }: { ws: Workspace; p: Profile; myUid: string; children?: ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <PersonAvatar ws={ws} uid={p.uid} size={36} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-neutral-200">
          {p.valid ? p.name : "Cuenta nueva"}
          {p.uid === myUid ? " (tú)" : ""}
        </p>
        <p className="font-mono text-[11px] text-neutral-500">{p.code}</p>
      </div>
      {children}
    </li>
  );
}

function Members({ session, ws }: { session: Session; ws: Workspace }) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const members = [...ws.profiles.values()].filter((p) => p.valid).sort((a, b) => a.name.localeCompare(b.name));

  const approve = async (p: Profile) => {
    setBusy(true);
    setError(null);
    try {
      await approveMember(getFirebase().db, session, p);
      setConfirming(null);
    } catch {
      setError("No se pudo aprobar. Revisa tu conexión.");
    }
    setBusy(false);
  };

  return (
    <>
      {ws.pending.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-amber-300">Esperando aprobación</p>
          <ul className="divide-y divide-neutral-900">
            {ws.pending.map((p) => (
              <MemberRow key={p.uid} ws={ws} p={p} myUid={session.uid}>
                {confirming === p.uid ? null : (
                  <button type="button" className={smallButton} onClick={() => setConfirming(p.uid)}>
                    Aprobar
                  </button>
                )}
              </MemberRow>
            ))}
          </ul>
          {ws.pending
            .filter((p) => p.uid === confirming)
            .map((p) => (
              <div key={p.uid} className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <p className="text-xs text-neutral-300">
                  Pídele a esa persona (en persona o por llamada) que te lea el código que ve en su pantalla. Debe ser
                  exactamente:
                </p>
                <p className="text-center font-mono text-lg tracking-wider text-neutral-100">{p.code}</p>
                <p className="text-xs text-neutral-500">
                  Si no coincide, no la apruebes: podría ser otra persona.
                  {p.founder ? " Es una cuenta de fundador: también recibirá las conversaciones de antes." : ""}
                </p>
                <div className="flex justify-end gap-2">
                  <button type="button" className="px-2 text-xs text-neutral-400" onClick={() => setConfirming(null)}>
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void approve(p)}
                    className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-medium text-neutral-950 disabled:opacity-40"
                  >
                    El código coincide: aprobar
                  </button>
                </div>
              </div>
            ))}
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      )}
      <ul className="divide-y divide-neutral-900">
        {members.map((p) => (
          <MemberRow key={p.uid} ws={ws} p={p} myUid={session.uid} />
        ))}
      </ul>
      <details className="text-xs text-neutral-500">
        <summary className="cursor-pointer text-neutral-400">Cómo sumar a alguien</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-4">
          <li>Firebase → Authentication → Users → Agregar usuario (su correo).</li>
          <li>
            Copia su UID y agrégalo en firestore.rules: en others() si será miembro, en admins() si será fundador →
            Publicar.
          </li>
          <li>Esa persona entra a la web y crea su frase personal.</li>
          <li>Aquí aparece «Esperando aprobación»: compara su código y apruébala.</li>
          <li>Después agrégala a los chats que quieras desde «Información del chat».</li>
          <li>Un miembro solo ve a quienes están en sus chats y no puede crear chats.</li>
        </ol>
      </details>
    </>
  );
}

// ---------------------------------------------------------------------------

function Security({ session, onSession }: { session: Session; onSession: (s: Session) => void }) {
  const [remembered, setRemembered] = useState<boolean | null>(null);
  const [changing, setChanging] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [canRecover, setCanRecover] = useState(false);
  const [oldPhrase, setOldPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    void loadKey(keyId(session.uid, session.salt)).then((k) => setRemembered(!!k));
  }, [session.uid, session.salt]);

  useEffect(() => {
    if (!session.founder || session.legacy) return;
    void probeLegacy(getFirebase().db)
      .then((r) => setCanRecover(!!r.meta))
      .catch(() => undefined);
  }, [session.founder, session.legacy]);

  const submitChange = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const problem = phraseProblem(next);
    if (problem) return setError(problem);
    if (normalizePhrase(next) !== normalizePhrase(confirm)) return setError("Las dos frases nuevas no coinciden.");
    setBusy(true);
    setError(null);
    try {
      const { db } = getFirebase();
      const kd = await loadKeysDoc(db, session.uid);
      const ok = kd ? await openBundle(await personalKeyFor(current, kd), session.uid, kd) : null;
      if (!ok) {
        setError("Tu frase actual no coincide.");
        setBusy(false);
        return;
      }
      const updated = await changePhrase(db, session, next);
      await rememberOnDevice(updated, !!remembered);
      onSession(updated);
      setChanging(false);
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone("Frase cambiada.");
    } catch {
      setError("No se pudo cambiar. Revisa tu conexión.");
    }
    setBusy(false);
  };

  const submitRecover = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !oldPhrase.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { db } = getFirebase();
      const { meta } = await probeLegacy(db);
      const raw = meta ? await legacyRawFromPhrase(meta, oldPhrase) : null;
      if (!raw) {
        setError("La frase compartida no coincide con la de antes.");
        setBusy(false);
        return;
      }
      onSession(await addLegacyKey(db, session, raw));
      setOldPhrase("");
      setDone("Listo: ya puedes leer las conversaciones de antes.");
    } catch {
      setError("No se pudo guardar. Revisa tu conexión.");
    }
    setBusy(false);
  };

  return (
    <>
      <Toggle
        label="Recordar en este dispositivo"
        hint="No pedirá tu frase al abrir la web aquí. Quien tenga este dispositivo desbloqueado podrá leer los chats."
        checked={!!remembered}
        disabled={remembered === null}
        onChange={(v) => {
          setRemembered(v);
          void rememberOnDevice(session, v);
        }}
      />

      {!changing ? (
        <button type="button" className={smallButton} onClick={() => setChanging(true)}>
          Cambiar mi frase personal
        </button>
      ) : (
        <form onSubmit={submitChange} className="space-y-2">
          <input type="password" autoComplete="off" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="frase actual" className={inputClass} />
          <input type="password" autoComplete="off" value={next} onChange={(e) => setNext(e.target.value)} placeholder="frase nueva" className={inputClass} />
          <input type="password" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="repite la frase nueva" className={inputClass} />
          <div className="flex justify-end gap-2">
            <button type="button" className="px-2 text-xs text-neutral-400" onClick={() => setChanging(false)}>
              Cancelar
            </button>
            <button type="submit" disabled={busy || !current || !next || !confirm} className={smallButton}>
              {busy ? "Guardando…" : "Cambiar"}
            </button>
          </div>
        </form>
      )}

      {canRecover && (
        <form onSubmit={submitRecover} className="space-y-2 border-t border-neutral-900 pt-3">
          <p className="text-xs text-neutral-400">Para leer las conversaciones de antes, escribe la frase compartida de antes.</p>
          <input type="password" autoComplete="off" value={oldPhrase} onChange={(e) => setOldPhrase(e.target.value)} placeholder="frase compartida de antes" className={inputClass} />
          <button type="submit" disabled={busy || !oldPhrase.trim()} className={smallButton}>
            Recuperar conversaciones de antes
          </button>
        </form>
      )}

      {done && <p className="text-xs text-emerald-400">{done}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </>
  );
}

// ---------------------------------------------------------------------------

export function Settings({
  user,
  session,
  ws,
  settings,
  pushOn,
  onPushChange,
  onSession,
  onBack,
  onLogout,
}: {
  user: User;
  session: Session;
  ws: Workspace;
  settings: DeviceSettings;
  pushOn: boolean;
  onPushChange: (on: boolean) => void;
  onSession: (s: Session) => void;
  onBack: () => void;
  onLogout: () => void;
}) {
  const [permError, setPermError] = useState<string | null>(null);
  const me = ws.me;
  const set = (patch: Partial<DeviceSettings>) => saveSettings({ ...settings, ...patch });

  const toggleSystem = async (on: boolean) => {
    setPermError(null);
    if (!on) return set({ system: false });
    if (!notificationsSupported()) return setPermError("Este navegador no permite avisos del sistema.");
    const result = await Notification.requestPermission();
    if (result === "granted") set({ system: true });
    else setPermError("No diste permiso para avisos. Puedes activarlo en los ajustes del navegador.");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-neutral-900 px-2 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] md:px-4">
        <button onClick={onBack} className="rounded-full p-2 text-neutral-300 hover:bg-neutral-900 md:hidden" aria-label="Volver a la lista">
          <BackIcon />
        </button>
        <p className="text-[15px] font-medium">Configuración</p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
        <div className="mx-auto max-w-xl space-y-7 pb-10">
          <Section title="Perfil">
            {me && (
              <ProfileEditor
                key={`${me.name}:${me.photo}`}
                session={session}
                initialName={me.name}
                currentPhoto={me.photo}
                currentPhotoUrl={me.photo ? ws.avatars.get(session.uid) ?? null : null}
                submitLabel="Guardar perfil"
              />
            )}
            <div className="rounded-lg bg-neutral-900/60 px-3 py-2">
              <p className="text-[11px] text-neutral-500">Tu código de seguridad</p>
              <p className="font-mono text-sm tracking-wider text-neutral-200">{me?.code}</p>
              <p className="mt-1 text-[11px] text-neutral-500">
                Si alguien te aprueba o te agrega, puede comparar este código contigo para estar seguro de que eres tú.
              </p>
            </div>
          </Section>

          <Section title="Notificaciones de este dispositivo">
            <Toggle
              label="Avisos dentro de la web"
              hint="Un aviso arriba cuando llega un mensaje de otro chat."
              checked={settings.inApp}
              onChange={(v) => set({ inApp: v })}
            />
            <Toggle
              label="Sonido"
              hint="Suena con cada aviso dentro de la web."
              checked={settings.sound}
              disabled={!settings.inApp}
              onChange={(v) => set({ sound: v })}
            />
            <Toggle
              label="Avisos del sistema con la web abierta"
              hint="Cuando la web está abierta pero en otra pestaña o minimizada."
              checked={settings.system}
              onChange={(v) => void toggleSystem(v)}
            />
            {permError && <p className="text-xs text-red-400">{permError}</p>}
            <div className="border-t border-neutral-900 pt-4">
              <PushControls session={session} user={user} pushOn={pushOn} onPushChange={onPushChange} />
            </div>
            <Toggle
              label="Mostrar de qué chat y de quién es"
              hint="Si está apagado, las notificaciones dicen solo «Nuevo mensaje». Si lo enciendes, los nombres se guardan en este dispositivo para poder mostrarlos."
              checked={settings.names}
              onChange={(v) => set({ names: v })}
            />
            <p className="text-xs text-neutral-500">
              Las notificaciones nunca incluyen el texto del mensaje. Los chats silenciados no avisan, salvo que te
              mencionen.
            </p>
          </Section>

          <Section title="Chats y llamadas (este dispositivo)">
            <Toggle
              label="Mantener el teclado abierto al enviar"
              hint="Después de enviar, puedes escribir el siguiente mensaje sin volver a tocar la caja de texto."
              checked={settings.keepKeyboard}
              onChange={(v) => set({ keepKeyboard: v })}
            />
            <Toggle
              label="Mostrar cuando estoy en línea"
              hint="Solo lo ven quienes comparten un chat contigo. Si lo apagas, tampoco se guarda la hora."
              checked={settings.showOnline}
              onChange={(v) => set({ showOnline: v })}
            />
            <Toggle
              label="Llamadas solo por relevo (ocultar mi IP)"
              hint="La otra persona no ve tu dirección IP. Solo funciona si configuraste el relevo TURN en Vercel; si no, se ignora."
              checked={settings.relayCalls}
              onChange={(v) => set({ relayCalls: v })}
            />
            <p className="text-xs text-neutral-500">
              Las llamadas van cifradas de extremo a extremo y, al colgar, no queda registro de ellas en la base de datos.
              En iPhone, la llamada se corta si bloqueas la pantalla o cambias de app: es un límite de Safari.
            </p>
          </Section>

          {ws.admin && (
            <Section title="Miembros">
              <Members session={session} ws={ws} />
            </Section>
          )}

          <Section title="Seguridad">
            <Security session={session} onSession={onSession} />
          </Section>

          <button
            type="button"
            onClick={onLogout}
            className="w-full rounded-xl border border-neutral-900 py-3 text-sm text-red-400 hover:bg-neutral-900"
          >
            Cerrar sesión ({user.email})
          </button>
        </div>
      </div>
    </div>
  );
}
