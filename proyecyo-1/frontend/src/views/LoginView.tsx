import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "@/hooks/useAuth";
import { rolePaths } from "@/routes/rolePaths";
import "./loginView.css";

// Diseño "NexusResidencial — Login · Noche Residencial". El rol elegido solo
// personaliza la pantalla (torre, texto del botón): el panel al que se entra lo
// decide el backend según la cuenta, igual que antes.
const ACCENT = "#2563EB";

type RoleId = "administrador" | "guardia" | "residente" | "inquilino";
const ROLES: Array<{ id: RoleId; label: string; tower: number; hint: string }> = [
  { id: "administrador", label: "Administrador", tower: 2, hint: "Gestione usuarios, viviendas, pagos, sanciones y reportes de la comunidad." },
  { id: "guardia", label: "Guardia", tower: 0, hint: "Registre visitas, valide accesos y controle placas desde la garita." },
  { id: "residente", label: "Residente", tower: 1, hint: "Autorice visitas, reserve amenidades y consulte sus pagos." },
  { id: "inquilino", label: "Inquilino", tower: 4, hint: "Reciba comunicados, invite visitas y reserve amenidades." },
];

type ToastKind = "check" | "cal" | "bell" | "card";
const TOASTS: Array<{ title: string; sub: string; bg: string; fg: string; kind: ToastKind }> = [
  { title: "Acceso aprobado", sub: "Visitante · Unidad B-302", bg: "#ECFDF5", fg: "#059669", kind: "check" },
  { title: "Reserva confirmada", sub: "Cancha de tenis · 18:00", bg: "#EFF6FF", fg: "#2563EB", kind: "cal" },
  { title: "Nuevo comunicado", sub: "Mantenimiento de piscina", bg: "#FFFBEB", fg: "#D97706", kind: "bell" },
  { title: "Pago registrado", sub: "Cuota de mantenimiento", bg: "#F5F3FF", fg: "#7C3AED", kind: "card" },
];

// Skyline determinista (misma semilla y reglas que el diseño original).
function buildTowers() {
  let seed = 11;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const specs = [{ floors: 8, cols: 3 }, { floors: 13, cols: 4 }, { floors: 16, cols: 4 }, { floors: 10, cols: 3 }, { floors: 12, cols: 4 }];
  return specs.map((s) => {
    const wins: Array<{ cls: string; d: string }> = [];
    for (let i = 0; i < s.floors * s.cols; i++) {
      const r = rnd();
      const kind = r < 0.18 ? "on" : r < 0.55 ? "flick" : "off";
      wins.push({ cls: `nr-win ${kind}`, d: `-${(rnd() * 9).toFixed(2)}s` });
    }
    return { tpl: `repeat(${s.cols}, 14px)`, wins };
  });
}

function validate(email: string, pass: string) {
  const e = email.trim();
  let emailErr = "";
  let passErr = "";
  if (!e) emailErr = "Ingrese su correo electrónico.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) emailErr = "Revise el formato, por ejemplo nombre@dominio.com";
  if (!pass) passErr = "Ingrese su contraseña.";
  return { emailErr, passErr };
}

const pad = (n: number) => String(n).padStart(2, "0");

function ToastIcon({ kind }: { kind: ToastKind }) {
  const common = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (kind === "check") return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></svg>;
  if (kind === "cal") return <svg {...common}><rect x="3.5" y="5" width="17" height="15" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>;
  if (kind === "bell") return <svg {...common}><path d="M3 11l15-6v14L3 13z" /><path d="M7 12.5V17a2 2 0 0 0 4 0v-2.8" /></svg>;
  return <svg {...common}><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="M3 10h18M7 15h4" /></svg>;
}

function RoleIcon({ id }: { id: RoleId }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (id === "administrador") return <svg {...common}><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></svg>;
  if (id === "guardia") return <svg {...common}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /></svg>;
  if (id === "residente") return <svg {...common}><path d="M4 20V10l8-6 8 6v10z" /><path d="M10 20v-5h4v5" /></svg>;
  return <svg {...common}><circle cx="8" cy="15" r="4" /><path d="M11 12l8-8M16 7l2 2M14 9l2 2" /></svg>;
}

const ErrIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.01" /></svg>
);

export function LoginView() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [role, setRole] = useState<RoleId>("administrador");
  const [showPw, setShowPw] = useState(false);
  const [phase, setPhase] = useState<"idle" | "loading" | "done">("idle");
  const [now, setNow] = useState(() => new Date());
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [touchedEmail, setTouchedEmail] = useState(false);
  const [touchedPass, setTouchedPass] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [caps, setCaps] = useState(false);
  const [remember, setRemember] = useState(true);
  const [shake, setShake] = useState(0);
  const [toastIdx, setToastIdx] = useState(0);
  const [toastIn, setToastIn] = useState(true);
  const [serverError, setServerError] = useState("");
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 1000);
    const feed = window.setInterval(() => {
      setToastIn(false);
      timers.current.push(window.setTimeout(() => { setToastIdx((i) => (i + 1) % TOASTS.length); setToastIn(true); }, 360));
    }, 3400);
    return () => {
      window.clearInterval(clock);
      window.clearInterval(feed);
      timers.current.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  const towers = useMemo(buildTowers, []);
  const current = ROLES.find((r) => r.id === role) ?? ROLES[0];
  const toast = TOASTS[toastIdx];
  const timeLabel = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  let dateLabel = "";
  try { dateLabel = now.toLocaleDateString("es-GT", { weekday: "short", day: "numeric", month: "short" }); } catch { dateLabel = ""; }

  const v = validate(email, pass);
  const showEmailErr = Boolean(v.emailErr) && (touchedEmail || submitted);
  const showPassErr = Boolean(v.passErr) && (touchedPass || submitted);
  const emailOk = !v.emailErr && email.length > 0;

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (phase !== "idle") return;
    setServerError("");
    if (v.emailErr || v.passErr) {
      setSubmitted(true);
      setShake((s) => s + 1);
      return;
    }
    setSubmitted(true);
    setPhase("loading");
    try {
      const response = await login({ email: email.trim().toLowerCase(), password: pass });
      setPhase("done");
      timers.current.push(window.setTimeout(() => navigate(rolePaths[response.role], { replace: true }), 900));
    } catch (error) {
      setPhase("idle");
      setShake((s) => s + 1);
      setServerError(error instanceof Error ? error.message : "No fue posible iniciar sesión.");
    }
  };

  const onCaps = (event: KeyboardEvent<HTMLInputElement>) => {
    const on = Boolean(event.getModifierState?.("CapsLock"));
    if (on !== caps) setCaps(on);
  };

  return (
    <div className="nr-root" style={{ "--nr-accent": ACCENT } as CSSProperties}>
      {/* ESCENA */}
      <section aria-label="Comunidad NexusResidencial" style={{ flex: "999 1 560px", minWidth: 0, position: "relative", overflow: "hidden", display: "flex", flexDirection: "column", background: "#EEF3FF", borderRight: "1px solid #E2E8F0" }}>
        <div className="nr-dots" aria-hidden="true" />
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <span className="nr-cloud a" />
          <span className="nr-cloud b" />
          <div className="nr-sun" style={{ position: "absolute", top: 64, right: "12%", width: 72, height: 72, borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 0 0 14px rgba(255,255,255,.5), 0 0 0 30px rgba(255,255,255,.25)" }} />
        </div>

        <div className="nr-left" style={{ position: "relative", padding: "44px 56px 0", display: "flex", flexDirection: "column", gap: 52 }}>
          <div className="nr-rise" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 42, height: 42, borderRadius: 12, background: ACCENT, color: "#FFFFFF" }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 21V10l8-5 8 5v11" /><path d="M9 21v-6h6v6" /><circle cx="12" cy="11" r="1.4" fill="currentColor" /></svg>
              </span>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", color: `color-mix(in srgb, ${ACCENT} 85%, #000)` }}>NexusResidencial</div>
                <div style={{ fontSize: 13, color: "#526079" }}>Gestión inteligente residencial</div>
              </div>
            </div>
            <div className="nr-mono" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "#526079", padding: "8px 12px", background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 999 }}>
              <span className="nr-pulse" style={{ width: 7, height: 7, borderRadius: "50%", background: "#10B981" }} />
              <span style={{ color: "#047857", fontWeight: 500 }}>En vivo</span>
              <span style={{ textTransform: "capitalize" }}>{dateLabel}</span>
              <span style={{ color: "#0F172A" }}>{timeLabel}</span>
            </div>
          </div>

          <div style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 20 }}>
            <h1 className="nr-rise" style={{ margin: 0, fontSize: "clamp(38px, 4.6vw, 62px)", lineHeight: 1.02, fontWeight: 800, letterSpacing: "-0.04em", color: "#0F172A", animationDelay: ".1s" }}>
              Cada ventana,<br /><span style={{ color: ACCENT }}>un hogar conectado.</span>
            </h1>
            <p className="nr-rise" style={{ margin: 0, fontSize: 17, lineHeight: 1.6, color: "#475569", maxWidth: 440, animationDelay: ".2s" }}>
              Plataforma unificada para acceso, operación y experiencia de la comunidad residencial.
            </p>
            <div className="nr-rise" style={{ display: "flex", gap: 10, flexWrap: "wrap", animationDelay: ".3s" }}>
              <span style={{ fontSize: 13, padding: "8px 14px", borderRadius: 999, background: "#FFFFFF", border: "1px solid #E2E8F0", color: "#475569" }}><b style={{ color: "#0F172A" }}>24/7</b> · acceso continuo</span>
              <span style={{ fontSize: 13, padding: "8px 14px", borderRadius: 999, background: "#FFFFFF", border: "1px solid #E2E8F0", color: "#475569" }}><b style={{ color: "#0F172A" }}>1 sola app</b> · experiencia unificada</span>
            </div>
          </div>
        </div>

        {/* skyline */}
        <div className="nr-sky" style={{ position: "relative", marginTop: "auto", height: 440, display: "flex", flexDirection: "column", justifyContent: "flex-end", overflow: "hidden" }}>
          <div className="nr-toastwrap" aria-hidden="true" style={{ position: "absolute", top: 18, left: 56, zIndex: 2 }}>
            <div className="nr-bob">
              <div className={`nr-toast ${toastIn ? "in" : "out"}`} style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 260, padding: "12px 16px 12px 12px", background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 14, boxShadow: "0 18px 40px -20px rgba(15,23,42,.35)" }}>
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 38, height: 38, borderRadius: 10, background: toast.bg, color: toast.fg, flex: "none" }}>
                  <ToastIcon kind={toast.kind} />
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>{toast.title}</div>
                  <div style={{ fontSize: 12.5, color: "#64748B" }}>{toast.sub}</div>
                </div>
                <span className="nr-mono" style={{ fontSize: 11, color: "#64748B", alignSelf: "flex-start" }}>hace {toastIdx * 3 + 1} min</span>
              </div>
            </div>
          </div>

          <div aria-hidden="true" style={{ display: "flex", justifyContent: "center", alignItems: "flex-end", gap: 14, padding: "0 24px" }}>
            {towers.map((t, i) => {
              const active = i === current.tower;
              return (
                <div key={i} className={`nr-tower${active ? " is-active" : ""}`}>
                  {active ? <span className="nr-beacon" /> : null}
                  <div style={{ display: "grid", gridTemplateColumns: t.tpl, gap: 6 }}>
                    {t.wins.map((w, j) => <span key={j} className={w.cls} style={{ animationDelay: w.d }} />)}
                  </div>
                </div>
              );
            })}
          </div>
          <div aria-hidden="true" style={{ position: "relative", height: 26, background: "#DCE6FA", borderTop: "1px solid #C7D5F2" }}>
            <div style={{ position: "absolute", left: 0, right: 0, top: 12, height: 2, background: "repeating-linear-gradient(90deg, #FFFFFF 0 18px, transparent 18px 34px)" }} />
            <span className="nr-car a" />
            <span className="nr-car b" />
          </div>
        </div>
      </section>

      {/* FORMULARIO */}
      <section aria-label="Iniciar sesión" style={{ flex: "1 1 460px", minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 24px", background: "#F8FAFC" }}>
        <form noValidate onSubmit={(e) => void submit(e)} className="nr-card" style={{ width: "100%", maxWidth: 440, display: "flex", flexDirection: "column", gap: 26, padding: "36px 32px", background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 20, boxShadow: "0 24px 60px -36px rgba(15,23,42,.35)", animationDelay: ".1s" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="nr-mono" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11.5, letterSpacing: "0.12em", textTransform: "uppercase", color: `color-mix(in srgb, ${ACCENT} 85%, #000)` }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></svg>
              Acceso seguro
            </span>
            <h2 style={{ margin: 0, fontSize: 32, lineHeight: 1.1, fontWeight: 800, letterSpacing: "-0.035em", color: "#0F172A" }}>Iniciar sesión</h2>
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: "#64748B" }}>Ingrese sus credenciales para acceder al panel correspondiente.</p>
          </div>

          <fieldset style={{ margin: 0, padding: 0, border: 0, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            <legend style={{ padding: 0, marginBottom: 10, fontSize: 13, fontWeight: 700, color: "#334155" }}>Ingresar como</legend>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
              {ROLES.map((r) => (
                <button key={r.id} type="button" className={`nr-role${r.id === role ? " is-on" : ""}`} aria-pressed={r.id === role} onClick={() => setRole(r.id)}>
                  <span className="nr-role-ico"><RoleIcon id={r.id} /></span>
                  <span>{r.label}</span>
                </button>
              ))}
            </div>
            <p key={role} className="nr-hint" style={{ margin: 0, minHeight: 40, fontSize: 13, lineHeight: 1.5, color: "#64748B" }}>{current.hint}</p>
          </fieldset>

          <div className={shake === 0 ? "" : shake % 2 ? "nr-shake1" : "nr-shake2"} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {serverError ? (
              <div role="alert" className="nr-server-err nr-err">
                <ErrIcon />
                <span><strong>Acceso denegado.</strong> {serverError}</span>
              </div>
            ) : null}

            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <label htmlFor="nr-email" style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>Correo electrónico</label>
              <div className={`nr-field${showEmailErr ? " is-err" : emailOk ? " is-ok" : ""}`}>
                <svg width="44" height="20" viewBox="-12 0 44 20" fill="none" stroke="#94A3B8" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="1" y="3" width="18" height="14" rx="3" /><path d="M2 5l8 6 8-6" /></svg>
                <input
                  id="nr-email" className="nr-input" type="email" autoComplete="email" placeholder="correo@ejemplo.com"
                  value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => setTouchedEmail(true)}
                  aria-invalid={showEmailErr} aria-describedby={showEmailErr ? "nr-email-msg" : undefined}
                />
                {emailOk ? (
                  <svg className="nr-check-ok" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginRight: 14 }}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                ) : null}
              </div>
              {showEmailErr ? (
                <p id="nr-email-msg" className="nr-err" style={{ margin: 0, display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#B91C1C" }}><ErrIcon />{v.emailErr}</p>
              ) : null}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <label htmlFor="nr-pass" style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>Contraseña</label>
              <div className={`nr-field${showPassErr ? " is-err" : ""}`}>
                <svg width="44" height="20" viewBox="-12 0 44 20" fill="none" stroke="#94A3B8" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="9" width="14" height="10" rx="2.5" /><path d="M6 9V6a4 4 0 0 1 8 0v3" /></svg>
                <input
                  id="nr-pass" className="nr-input" type={showPw ? "text" : "password"} autoComplete="current-password" placeholder="Ingrese su contraseña"
                  value={pass} onChange={(e) => setPass(e.target.value)} onBlur={() => setTouchedPass(true)} onKeyUp={onCaps} onKeyDown={onCaps}
                  aria-invalid={showPassErr} aria-describedby={showPassErr ? "nr-pass-msg" : undefined}
                />
                <button type="button" className="nr-eye" aria-label={showPw ? "Ocultar contraseña" : "Mostrar contraseña"} onClick={() => setShowPw((s) => !s)}>
                  {showPw ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3l18 18" /><path d="M10.6 5.1A10 10 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-3 3.8M6.6 6.6C3.9 8.4 2.5 12 2.5 12S6 19 12 19a9.6 9.6 0 0 0 4.4-1.1" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" /><circle cx="12" cy="12" r="3" /></svg>
                  )}
                </button>
              </div>
              {showPassErr ? (
                <p id="nr-pass-msg" className="nr-err" style={{ margin: 0, display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#B91C1C" }}><ErrIcon />{v.passErr}</p>
              ) : null}
              {caps ? (
                <p className="nr-err" style={{ margin: 0, display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#B45309" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4l8 9h-4.5v6h-7v-6H4z" /></svg>
                  Bloq Mayús está activado
                </p>
              ) : null}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44, fontSize: 13.5, color: "#475569", cursor: "pointer" }}>
                <input type="checkbox" className="nr-cb" checked={remember} onChange={() => setRemember((r) => !r)} />
                Recordarme
              </label>
              <Link className="nr-link" to="/olvide-contrasena" style={{ fontSize: 13.5, color: `color-mix(in srgb, ${ACCENT} 85%, #000)` }}>¿Olvidó su contraseña?</Link>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <button type="submit" className={`nr-btn${phase === "done" ? " is-done" : ""}${phase === "loading" ? " is-busy" : ""}`} aria-live="polite" disabled={phase !== "idle"}>
              {phase === "idle" ? (
                <>
                  <span>Ingresar como {current.label.toLowerCase()}</span>
                  <svg className="nr-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </>
              ) : phase === "loading" ? (
                <>
                  <span className="nr-spin" />
                  <span>Verificando credenciales…</span>
                  <span className="nr-bar" />
                </>
              ) : (
                <>
                  <svg className="nr-pop" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5" /></svg>
                  <span className="nr-pop">Bienvenido · abriendo su panel</span>
                </>
              )}
            </button>
            <div style={{ height: 1, background: "#EEF2F7" }} />
            <p style={{ margin: 0, textAlign: "center", fontSize: 12, color: "#64748B" }}>© 2026 NexusResidencial. Todos los derechos reservados.</p>
          </div>
        </form>
      </section>
    </div>
  );
}
