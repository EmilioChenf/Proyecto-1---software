import { useFeedbackState } from "@/hooks/useFeedbackState";
import { notifySuccess, notifyWarning } from "@/utils/feedback";
import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { Link } from "react-router-dom";

import { createDemoRequest, type DemoRequestPayload } from "@/services/demoRequestsService";

import "./landingView.css";

// Diseño "NexusResidencial · Landing page": reveal al desplazar, palabras animadas,
// marquee, bento con iconos animados, roles con rotación automática, tarjetas con
// inclinación y formulario de demostración conectado al backend real.

const nav: Array<[string, string]> = [
  ["Inicio", "inicio"], ["Funcionalidades", "funcionalidades"], ["Beneficios", "beneficios"],
  ["Roles", "roles"], ["Demostración", "demostracion"],
];

const heroStats = [
  { label: "Accesos de hoy", value: 24, bg: "#EFF6FF", fg: "#2563EB", d: "M8 21a5 5 0 1 1 4.6-7L21 5.6M17 9.5l2.5 2.5M14.5 12l2 2" },
  { label: "Reservas activas", value: 8, bg: "#F5F3FF", fg: "#7C3AED", d: "M3.5 5h17v15h-17zM3.5 10h17M8 3v4M16 3v4M9 15l2 2 4-4" },
  { label: "Pagos al día", value: null, bg: "#ECFDF5", fg: "#059669", d: "M3 6h18v12H3zM3 10h18M7 15h4" },
  { label: "Avisos pendientes", value: 3, bg: "#FFFBEB", fg: "#D97706", d: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0" },
];

const heroBars = [38, 58, 44, 82, 52, 70, 48];

const marqueeItems: Array<[string, string]> = [
  ["Accesos", "M8 21a5 5 0 1 1 4.6-7L21 5.6M17 9.5l2.5 2.5M14.5 12l2 2"],
  ["Visitas", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1"],
  ["Pagos", "M3 6h18v12H3zM3 10h18M7 15h4"],
  ["Reservas", "M3.5 5h17v15h-17zM3.5 10h17M8 3v4M16 3v4"],
  ["Sanciones", "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"],
  ["Reportes", "M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h6"],
  ["Respaldos", "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"],
  ["Horarios", "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2"],
];

const problems = [
  { n: "01", text: "Registros manuales que dificultan el seguimiento de visitas, accesos y pagos.", sol: "Cada visita, acceso y pago queda registrado en el sistema.", d: "M8 3h8l4 4v14H8zM16 3v4h4M4 7v14h12M11 12l4 4M15 12l-4 4" },
  { n: "02", text: "Reservas duplicadas y reglas que no se aplican de forma consistente.", sol: "Las reglas y límites de reserva se aplican automáticamente.", d: "M3.5 5h17v15h-17zM3.5 10h17M8 3v4M16 3v4M10 13l4 4M14 13l-4 4" },
  { n: "03", text: "Reportes, sanciones y respaldos sin trazabilidad centralizada.", sol: "Historial centralizado, con reportes y respaldos trazables.", d: "M9 15l6-6M11 6l1.5-1.5a4.2 4.2 0 0 1 6 6L17 12M13 18l-1.5 1.5a4.2 4.2 0 0 1-6-6L7 12" },
];

type Feature = { title: string; text: string; d: string; bg: string; fg: string; a: string; span?: boolean; kind?: "qr" | "pay" | "rep" };
const features: Feature[] = [
  { title: "Accesos y visitas", text: "Autorizaciones, QR, horarios, tipos de visitante y observaciones desde un solo flujo.", d: "M8 21a5 5 0 1 1 4.6-7L21 5.6M17 9.5l2.5 2.5M14.5 12l2 2", bg: "#EFF6FF", fg: "#2563EB", a: "a-swing", span: true, kind: "qr" },
  { title: "Residentes e inquilinos", text: "Información de viviendas, usuarios y permisos vigentes con acceso según el rol.", d: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6", bg: "#F5F3FF", fg: "#7C3AED", a: "a-bounce" },
  { title: "Reservas de amenidades", text: "Disponibilidad, límites y prevención de reservas superpuestas.", d: "M3.5 5h17v15h-17zM3.5 10h17M8 3v4M16 3v4M9 15l2 2 4-4", bg: "#ECFEFF", fg: "#0E7490", a: "a-flip" },
  { title: "Pagos y morosidad", text: "Cuotas, fechas límite, recargos automáticos y seguimiento de saldos pendientes.", d: "M3 6h18v12H3zM3 10h18M7 15h4", bg: "#ECFDF5", fg: "#059669", a: "a-slide", span: true, kind: "pay" },
  { title: "Sanciones e historial", text: "Generación automática, trazabilidad, filtros y detalle de cada sanción.", d: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4", bg: "#FEF2F2", fg: "#DC2626", a: "a-pulse" },
  { title: "Reportes PDF y Excel", text: "Exportaciones seguras de accesos, reservas, morosos y sanciones.", d: "M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h6", bg: "#FFF7ED", fg: "#EA580C", a: "a-bounce", span: true, kind: "rep" },
  { title: "Respaldos y restauración", text: "Programación, historial, descarga y recuperación controlada de información.", d: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6", bg: "#F1F5F9", fg: "#334155", a: "a-flip" },
  { title: "Horarios configurables", text: "Reglas generales de visita aplicadas directamente desde el backend.", d: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2", bg: "#FFFBEB", fg: "#D97706", a: "a-spin" },
  { title: "Paneles por rol", text: "Experiencias enfocadas para administración, residentes, inquilinos y guardias.", d: "M4 20V11M10 20V5M16 20v-8M21 20H3", bg: "#EEF2FF", fg: "#4F46E5", a: "a-grow" },
];

const benefits = [
  "Centralización de información", "Menos trabajo manual", "Control y trazabilidad de accesos", "Prevención de reservas duplicadas",
  "Seguimiento de pagos y recargos", "Reportes disponibles rápidamente", "Respaldo de la información", "Experiencia diferenciada por rol",
];

const steps = [
  { n: "01", t: "Configura el residencial", d: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 14H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 10h0a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" },
  { n: "02", t: "Registra usuarios, viviendas y reglas", d: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 9-5.2M18 15v6M15 18h6" },
  { n: "03", t: "Gestiona pagos, accesos y reservas", d: "M3 6h18v12H3zM3 10h18M7 15h4" },
  { n: "04", t: "Consulta reportes y respaldos", d: "M4 20V11M10 20V5M16 20v-8M21 20H3" },
];

const roles = [
  { name: "Administrador", text: "Gestiona residentes, pagos, morosos, recargos, sanciones, reservas, reportes, horarios y respaldos.", chips: ["Residentes", "Pagos", "Morosos", "Recargos", "Sanciones", "Reservas", "Reportes", "Horarios", "Respaldos"], d: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" },
  { name: "Residente", text: "Autoriza visitas y consulta accesos, amenidades, reservas y su resumen mensual.", chips: ["Autorizar visitas", "Accesos", "Amenidades", "Reservas", "Resumen mensual"], d: "M4 20V10l8-6 8 6v10zM10 20v-5h4v5" },
  { name: "Inquilino", text: "Gestiona permisos, proveedores y autorizaciones vinculadas a su vivienda.", chips: ["Permisos", "Proveedores", "Autorizaciones", "Vivienda vinculada"], d: "M8 21a5 5 0 1 1 4.6-7L21 5.6M17 9.5l2.5 2.5" },
  { name: "Guardia", text: "Consulta autorizaciones, tipos de visitante, observaciones y registra ingresos.", chips: ["Autorizaciones", "Tipos de visitante", "Observaciones", "Registro de ingresos"], d: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" },
];

const platform = [
  { title: "Administración", text: "Pagos, sanciones, reportes y configuraciones con datos reales.", color: "#2563EB", kind: "admin" },
  { title: "Residentes", text: "Visitas, reservas, accesos y resumen mensual en un panel simple.", color: "#7C3AED", kind: "res" },
  { title: "Seguridad", text: "Autorizaciones claras para registrar ingresos con información relevante.", color: "#059669", kind: "sec" },
] as const;

// Escena determinista (mismo generador que el diseño): edificios del pie de la demo y patrón QR.
function buildScene() {
  let seed = 23;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const specs = [{ f: 6, c: 3 }, { f: 9, c: 3 }, { f: 5, c: 2 }, { f: 11, c: 4 }, { f: 7, c: 3 }, { f: 4, c: 2 }];
  const towers = specs.map((s) => {
    const wins: Array<{ cls: string; d: string }> = [];
    for (let i = 0; i < s.f * s.c; i++) {
      const r = rnd();
      wins.push({ cls: "nl-win " + (r < 0.2 ? "on" : r < 0.55 ? "flick" : ""), d: "-" + (rnd() * 8).toFixed(2) + "s" });
    }
    return { cols: s.c, wins };
  });
  const qr: string[] = [];
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
    const corner = (x < 2 && y < 2) || (x > 4 && y < 2) || (x < 2 && y > 4);
    qr.push(corner || rnd() < 0.45 ? "#0F172A" : "#EEF2F7");
  }
  return { towers, qr };
}

function prefersReducedMotion() {
  return typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function Icon({ d, size = 20, width = 2, className, stroke = "currentColor" }: { d: string; size?: number; width?: number; className?: string; stroke?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const ARROW = "M5 12h14M13 6l6 6-6 6";
const CHECK = "M5 12.5l4.5 4.5L19 7.5";

function BrandMark() {
  return (
    <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, borderRadius: 12, background: "var(--nl-accent)", color: "#FFFFFF", flex: "none" }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 21V10l8-5 8 5v11" /><path d="M9 21v-6h6v6" /><circle cx="12" cy="11" r="1.4" fill="currentColor" />
      </svg>
    </span>
  );
}

function QrGrid({ qr, gap, radius }: { qr: string[]; gap: number; radius: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap, height: "100%" }}>
      {qr.map((color, index) => <span key={index} style={{ borderRadius: radius, background: color }} />)}
    </div>
  );
}

// ---------------------------------------------------------------- formulario

const initialForm: DemoRequestPayload = {
  nombre: "", correo: "", telefono: "", residencial: "", cantidadViviendas: 0,
  mensaje: "", aceptaContacto: false, sitioWeb: "",
};

function validateDemo(form: DemoRequestPayload) {
  const next: Record<string, string> = {};
  if (form.nombre.trim().length < 2) next.nombre = "Ingresa tu nombre completo.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.correo.trim())) next.correo = "Ingresa un correo válido.";
  if (!/^[+\d][\d\s()-]{6,24}$/.test(form.telefono.trim())) next.telefono = "Ingresa un teléfono válido.";
  if (form.residencial.trim().length < 2) next.residencial = "Ingresa el nombre del residencial.";
  if (!Number.isInteger(Number(form.cantidadViviendas)) || Number(form.cantidadViviendas) < 1 || Number(form.cantidadViviendas) > 100000) next.cantidadViviendas = "Indica una cantidad entre 1 y 100000.";
  if (form.mensaje.length > 1000) next.mensaje = "El mensaje no puede superar 1000 caracteres.";
  if (!form.aceptaContacto) next.aceptaContacto = "Debes aceptar el contacto.";
  return next;
}

function DemoForm() {
  const [form, setForm] = useState(initialForm);
  const [tried, setTried] = useState(false);
  const [shake, setShake] = useState(0);
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [serverError, setServerError] = useFeedbackState("error", "");
  const [sent, setSent] = useState<{ nombre: string; correo: string; residencial: string } | null>(null);
  const errors = tried ? validateDemo(form) : {};
  const update = (field: keyof DemoRequestPayload, value: string | number | boolean) => setForm((current) => ({ ...current, [field]: value }));
  const inputClass = (field: string) => `nl-inp${errors[field] ? " is-err" : ""}`;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (status === "sending") return;
    setTried(true);
    if (Object.keys(validateDemo(form)).length) {
      void notifyWarning("Revisa los campos indicados antes de enviar la solicitud.");
      setShake((value) => value + 1);
      return;
    }
    setStatus("sending");
    setServerError("");
    try {
      await createDemoRequest({ ...form, cantidadViviendas: Number(form.cantidadViviendas) });
      void notifySuccess("Solicitud de demostración enviada correctamente.");
      setSent({ nombre: form.nombre.trim(), correo: form.correo.trim(), residencial: form.residencial.trim() });
      setStatus("success");
      setForm(initialForm);
      setTried(false);
    } catch (error) {
      setStatus("error");
      setServerError(error instanceof Error && error.message ? error.message : "No fue posible enviar la solicitud. Inténtalo nuevamente.");
      setShake((value) => value + 1);
    }
  };

  if (status === "success" && sent) {
    return (
      <div aria-live="polite" style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 16, padding: "40px 10px" }}>
        <span className="nl-pop" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 84, height: 84, borderRadius: "50%", background: "#DCFCE7", color: "#059669" }}>
          <Icon d={CHECK} size={40} width={2.6} />
        </span>
        <h3 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em" }}>¡Solicitud enviada!</h3>
        <p role="status" style={{ margin: 0, fontSize: 16, lineHeight: 1.6, color: "#475569", maxWidth: 380 }}>
          ¡Gracias por tu interés, {sent.nombre.split(" ")[0]}! Recibimos tu solicitud y le escribiremos a <b style={{ color: "#0F172A" }}>{sent.correo}</b> para coordinar la demostración de {sent.residencial}.
        </p>
        <button type="button" className="nl-ghost" onClick={() => { setStatus("idle"); setSent(null); }}>Enviar otra solicitud</button>
      </div>
    );
  }

  const fields: Array<[keyof DemoRequestPayload, string, string, string, string]> = [
    ["nombre", "Nombre completo", "text", "María López", "name"],
    ["correo", "Correo electrónico", "email", "maria@residencial.com", "email"],
    ["telefono", "Teléfono", "tel", "+502 5555 5555", "tel"],
    ["residencial", "Residencial o condominio", "text", "Condominio Las Flores", "organization"],
  ];

  return (
    <form onSubmit={submit} noValidate className={shake === 0 ? "" : shake % 2 ? "nl-shake1" : "nl-shake2"} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="nl-mono" style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", color: "color-mix(in srgb, var(--nl-accent) 85%, #000)" }}>Hablemos de tu comunidad</span>
        <h3 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em" }}>Solicita una demostración</h3>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        {fields.map(([name, label, type, placeholder, autoComplete]) => (
          <div key={name} className="nl-field">
            <label htmlFor={`demo-${name}`}>{label}</label>
            <input
              id={`demo-${name}`}
              className={inputClass(name)}
              type={type}
              placeholder={placeholder}
              autoComplete={autoComplete}
              value={String(form[name])}
              onChange={(event) => update(name, event.target.value)}
              aria-invalid={Boolean(errors[name])}
              aria-describedby={errors[name] ? `${name}-error` : undefined}
            />
            {errors[name] ? <span id={`${name}-error`} className="nl-err">{errors[name]}</span> : null}
          </div>
        ))}
      </div>
      <div className="nl-field">
        <label htmlFor="demo-viviendas">Cantidad aproximada de viviendas</label>
        <input id="demo-viviendas" className={inputClass("cantidadViviendas")} type="number" min="1" max="100000" inputMode="numeric" placeholder="Ej. 120" value={form.cantidadViviendas || ""} onChange={(event) => update("cantidadViviendas", Number(event.target.value))} aria-invalid={Boolean(errors.cantidadViviendas)} />
        {errors.cantidadViviendas ? <span className="nl-err">{errors.cantidadViviendas}</span> : null}
      </div>
      <div className="nl-field">
        <label htmlFor="demo-mensaje">Mensaje <span style={{ fontWeight: 500, color: "#64748B" }}>(opcional)</span></label>
        <textarea id="demo-mensaje" className={inputClass("mensaje")} placeholder="Cuéntenos qué necesita su comunidad" maxLength={1000} value={form.mensaje} onChange={(event) => update("mensaje", event.target.value.slice(0, 1000))} />
        <span className="nl-mono" style={{ alignSelf: "flex-end", fontSize: 11.5, color: form.mensaje.length > 950 ? "#B45309" : "#64748B" }}>{form.mensaje.length}/1000</span>
      </div>
      {/* Campo trampa anti-spam: invisible para personas. */}
      <label style={{ position: "absolute", left: -10000 }} aria-hidden="true">Sitio web<input tabIndex={-1} autoComplete="off" value={form.sitioWeb} onChange={(event) => update("sitioWeb", event.target.value)} /></label>
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14, lineHeight: 1.5, color: "#475569", cursor: "pointer" }}>
        <input type="checkbox" className="nl-cb" checked={form.aceptaContacto} onChange={(event) => update("aceptaContacto", event.target.checked)} />
        <span>Acepto que utilicen estos datos para responder mi solicitud. Consulta la <Link to="/privacidad" style={{ color: "color-mix(in srgb, var(--nl-accent) 85%, #000)", fontWeight: 600 }}>política de privacidad</Link>.</span>
      </label>
      {errors.aceptaContacto ? <span className="nl-err" style={{ marginTop: -10 }}>{errors.aceptaContacto}</span> : null}
      {serverError ? <div role="alert" className="nl-server-err">{serverError}</div> : null}
      <button type="submit" className="nl-btn" disabled={status === "sending"} style={{ width: "100%" }}>
        {status === "sending" ? <><span className="nl-spin" />Enviando solicitud…</> : <>Solicitar demostración <Icon className="nl-arrow" d={ARROW} size={18} width={2.3} /></>}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------- página

export function LandingView() {
  const rootRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLSpanElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [showTop, setShowTop] = useState(false);
  const [progress, setProgress] = useState(() => (prefersReducedMotion() ? 1 : 0));
  const [role, setRole] = useState(0);
  const [autoRole, setAutoRole] = useState(true);
  const [swaps, setSwaps] = useState(0);
  const scene = useMemo(buildScene, []);

  useEffect(() => { document.title = "NexusResidencial | Administración inteligente para residenciales"; }, []);

  // Contadores del héroe (1.2 s, ease-out cúbico).
  useEffect(() => {
    if (prefersReducedMotion() || typeof window.requestAnimationFrame !== "function") { setProgress(1); return; }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const value = Math.min(1, (now - start) / 1200);
      setProgress(value);
      if (value < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // Encabezado compacto, barra de progreso y botón "volver arriba".
  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      const run = () => {
        ticking = false;
        const y = window.scrollY || 0;
        const max = document.documentElement.scrollHeight - window.innerHeight || 1;
        if (progressRef.current) progressRef.current.style.transform = `scaleX(${Math.min(1, y / max).toFixed(4)})`;
        setScrolled(y > 10);
        setShowTop(y > 900);
      };
      if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(run); else run();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Revelado al desplazar.
  useEffect(() => {
    const elements = rootRef.current?.querySelectorAll(".nl-rv") ?? [];
    if (!("IntersectionObserver" in window)) {
      elements.forEach((element) => element.classList.add("is-in"));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) { entry.target.classList.add("is-in"); observer.unobserve(entry.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -60px 0px" });
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  // Rotación automática de roles hasta que la persona elige uno.
  useEffect(() => {
    if (!autoRole) return;
    const timer = window.setInterval(() => { setRole((current) => (current + 1) % roles.length); setSwaps((value) => value + 1); }, 5500);
    return () => window.clearInterval(timer);
  }, [autoRole]);

  const go = (id: string) => {
    setMenuOpen(false);
    const target = document.getElementById(id);
    if (target && typeof target.scrollIntoView === "function") target.scrollIntoView({ behavior: "smooth" });
  };

  const spot = (event: MouseEvent<HTMLElement>) => {
    const element = event.currentTarget; const rect = element.getBoundingClientRect();
    element.style.setProperty("--mx", `${event.clientX - rect.left}px`);
    element.style.setProperty("--my", `${event.clientY - rect.top}px`);
  };
  const tilt = (event: MouseEvent<HTMLElement>) => {
    const element = event.currentTarget; const rect = element.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5; const y = (event.clientY - rect.top) / rect.height - 0.5;
    element.style.setProperty("--ry", `${(x * 8).toFixed(2)}deg`);
    element.style.setProperty("--rx", `${(-y * 8).toFixed(2)}deg`);
  };
  const untilt = (event: MouseEvent<HTMLElement>) => {
    event.currentTarget.style.setProperty("--rx", "0deg");
    event.currentTarget.style.setProperty("--ry", "0deg");
  };

  const eased = 1 - Math.pow(1 - progress, 3);
  const current = roles[role];

  return (
    <div ref={rootRef} className="nl">
      {/* HEADER */}
      <header className={`nl-head${scrolled || menuOpen ? " is-scrolled" : ""}`}>
        <div className="nl-wrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, minHeight: 76 }}>
          <button type="button" onClick={() => go("inicio")} aria-label="Ir al inicio" style={{ all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}>
            <BrandMark />
            <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", color: "#0F172A" }}>NexusResidencial</span>
          </button>
          <nav className="nl-navlinks" aria-label="Navegación principal" style={{ display: "flex", alignItems: "center", gap: 22 }}>
            {nav.map(([label, id]) => <button key={id} type="button" className="nl-link" onClick={() => go(id)}>{label}</button>)}
          </nav>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Link className="nl-btn sm nl-navcta" to="/login">Iniciar sesión</Link>
            <button type="button" className="nl-burger" aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
              <Icon d={menuOpen ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16"} width={2.2} />
            </button>
          </div>
        </div>
        {menuOpen ? (
          <div className="nl-in" style={{ borderTop: "1px solid #E6EBF3", background: "#FFFFFF" }}>
            <nav className="nl-wrap" aria-label="Navegación móvil" style={{ display: "flex", flexDirection: "column", paddingTop: 10, paddingBottom: 18 }}>
              {nav.map(([label, id]) => <button key={id} type="button" className="nl-flink" onClick={() => go(id)} style={{ fontSize: 16, fontWeight: 600, minHeight: 48 }}>{label}</button>)}
              <Link className="nl-btn sm" to="/login" onClick={() => setMenuOpen(false)} style={{ marginTop: 8 }}>Iniciar sesión</Link>
            </nav>
          </div>
        ) : null}
        <span ref={progressRef} className="nl-prog" />
      </header>

      <main>
        {/* HERO */}
        <section id="inicio" style={{ position: "relative", overflow: "hidden", background: "#F6F8FC", padding: "72px 0 96px" }}>
          <div className="nl-dots" aria-hidden="true" />
          <div className="nl-wrap" style={{ position: "relative", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 56 }}>
            <div style={{ flex: "1 1 460px", minWidth: 0, display: "flex", flexDirection: "column", gap: 26 }}>
              <span className="nl-in" style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 10, padding: "8px 14px 8px 8px", borderRadius: 999, background: "#FFFFFF", border: "1px solid #DCE6FA", fontSize: 13.5, fontWeight: 700, color: "color-mix(in srgb, var(--nl-accent) 85%, #000)" }}>
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: "50%", background: "color-mix(in srgb, var(--nl-accent) 12%, #FFFFFF)" }}>
                  <Icon d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4" size={14} width={2.2} />
                </span>
                Operación residencial en una sola plataforma
              </span>
              <h1 style={{ margin: 0, fontSize: "clamp(42px, 5.6vw, 76px)", lineHeight: 1.02, fontWeight: 800, letterSpacing: "-0.045em", position: "relative", zIndex: 0 }}>
                {["Administra", "tu", "residencial", "desde"].map((word, index) => (
                  <span key={word}><span className="nl-word" style={{ animationDelay: `${(0.1 + index * 0.09).toFixed(2)}s` }}>{word}</span>{" "}</span>
                ))}
                <span className="nl-word" style={{ animationDelay: ".5s" }}><span className="nl-mark">una sola plataforma</span></span>
              </h1>
              <p className="nl-in" style={{ margin: 0, maxWidth: 540, fontSize: 18, lineHeight: 1.65, color: "#475569", animationDelay: ".7s" }}>
                Centraliza accesos, visitas, pagos, reservas, sanciones y reportes en una solución segura y fácil de utilizar.
              </p>
              <div className="nl-in" style={{ display: "flex", gap: 12, flexWrap: "wrap", animationDelay: ".85s" }}>
                <button type="button" className="nl-btn" onClick={() => go("demostracion")}>Solicitar demostración <Icon className="nl-arrow" d={ARROW} size={18} width={2.3} /></button>
                <Link className="nl-ghost" to="/login">Iniciar sesión</Link>
              </div>
              <div className="nl-in" style={{ display: "flex", gap: 22, flexWrap: "wrap", animationDelay: "1s", fontSize: 13.5, color: "#475569" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Icon d={CHECK} size={18} width={2.4} stroke="#10B981" />4 roles con su propio panel</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Icon d={CHECK} size={18} width={2.4} stroke="#10B981" />Reportes en PDF y Excel</span>
              </div>
            </div>

            {/* visual */}
            <div className="nl-in" style={{ flex: "1 1 460px", minWidth: 0, position: "relative", padding: "28px 10px", animationDelay: ".35s" }} aria-hidden="true">
              <div style={{ position: "relative", background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 26, padding: 22, boxShadow: "0 40px 80px -40px rgba(15,23,42,.35)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    {["#FCA5A5", "#FCD34D", "#86EFAC"].map((color) => <span key={color} style={{ width: 10, height: 10, borderRadius: "50%", background: color }} />)}
                  </div>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, padding: "6px 10px", borderRadius: 999, background: "#ECFDF5", color: "#047857" }}>
                    <span className="nl-pulse" style={{ width: 7, height: 7, borderRadius: "50%", background: "#10B981" }} />Sistema operativo
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                  {heroStats.map((stat) => (
                    <div key={stat.label} className="nl-tile" style={{ padding: 16, borderRadius: 16, background: "#F8FAFC", border: "1px solid #EEF2F7", display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 38, height: 38, borderRadius: 11, background: stat.bg, color: stat.fg, flex: "none" }}><Icon d={stat.d} size={19} /></span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: "#64748B", fontWeight: 600 }}>{stat.label}</div>
                        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em" }}>{stat.value === null ? "Control" : Math.round(stat.value * eased)}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 12, padding: 18, borderRadius: 18, background: "color-mix(in srgb, var(--nl-accent) 7%, #FFFFFF)", border: "1px solid color-mix(in srgb, var(--nl-accent) 16%, #FFFFFF)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>Actividad centralizada</span>
                    <span className="nl-mono" style={{ fontSize: 11, color: "#64748B" }}>Lun – Dom</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 120 }}>
                    {heroBars.map((height, index) => (
                      <span key={index} className="nl-hbar" style={{ height: `${height}%`, animationDelay: `${(0.6 + index * 0.08).toFixed(2)}s, -${(index * 0.5).toFixed(1)}s`, opacity: index === 3 ? 1 : 0.55 }} />
                    ))}
                  </div>
                </div>
              </div>
              <div className="nl-float nl-hide-sm" style={{ position: "absolute", top: -6, left: -34 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px 12px 12px", background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 16, boxShadow: "0 20px 40px -22px rgba(15,23,42,.4)" }}>
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 10, background: "#ECFDF5", color: "#059669" }}><Icon d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12.5l3 3 5-6" size={18} width={2.2} /></span>
                  <div><div style={{ fontSize: 13.5, fontWeight: 700 }}>Acceso aprobado</div><div style={{ fontSize: 12, color: "#64748B" }}>Visitante · B-302</div></div>
                </div>
              </div>
              <div className="nl-float b nl-hide-sm" style={{ position: "absolute", bottom: 8, right: -26 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px 12px 12px", background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 16, boxShadow: "0 20px 40px -22px rgba(15,23,42,.4)" }}>
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 10, background: "#EFF6FF", color: "#2563EB" }}><Icon d="M3.5 5h17v15h-17zM3.5 10h17M8 3v4M16 3v4" size={18} width={2.2} /></span>
                  <div><div style={{ fontSize: 13.5, fontWeight: 700 }}>Reserva confirmada</div><div style={{ fontSize: 12, color: "#64748B" }}>Cancha de tenis · 18:00</div></div>
                </div>
              </div>
              <div className="nl-float c nl-hide-sm" style={{ position: "absolute", top: "44%", right: -18 }}>
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 54, height: 54, borderRadius: 16, background: "#0F172A", color: "#FFFFFF", boxShadow: "0 20px 40px -18px rgba(15,23,42,.6)" }}>
                  <Icon d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2M14 18h6M18 14v2M20 14v.01" size={26} />
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* MARQUEE */}
        <div aria-hidden="true" style={{ overflow: "hidden", borderTop: "1px solid #E6EBF3", borderBottom: "1px solid #E6EBF3", background: "#FFFFFF", padding: "18px 0" }}>
          <div className="nl-marquee">
            {[...marqueeItems, ...marqueeItems].map(([text, d], index) => (
              <span key={index} style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "0 28px", fontSize: 16, fontWeight: 700, color: "#334155", whiteSpace: "nowrap" }}>
                <Icon d={d} stroke="var(--nl-accent)" />{text}<span style={{ marginLeft: 28, width: 6, height: 6, borderRadius: "50%", background: "#CBD5E1" }} />
              </span>
            ))}
          </div>
        </div>

        {/* PROBLEMAS */}
        <section style={{ padding: "110px 0 100px", background: "#FFFFFF" }}>
          <div className="nl-wrap" style={{ display: "flex", flexDirection: "column", gap: 48 }}>
            <div className="nl-rv" style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 760 }}>
              <span className="nl-eyebrow">Menos dispersión, más control</span>
              <h2 className="nl-h2">La operación residencial no debería depender de hojas sueltas y procesos manuales</h2>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18 }}>
              {problems.map((problem, index) => (
                <div key={problem.n} className="nl-rv" style={{ transitionDelay: `${(index * 0.12).toFixed(2)}s` }}>
                  <article className="nl-card nl-prob" tabIndex={0} style={{ height: "100%", padding: 28, display: "flex", flexDirection: "column", gap: 18 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span className="nl-x" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 48, height: 48, borderRadius: 14, background: "#FEF2F2", color: "#DC2626" }}><Icon d={problem.d} size={22} /></span>
                      <span className="nl-mono" style={{ fontSize: 13, fontWeight: 600, color: "#94A3B8" }}>{problem.n}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: 16.5, lineHeight: 1.6, color: "#334155", fontWeight: 500 }}>{problem.text}</p>
                    <div className="nl-sol" style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 14px", borderRadius: 12, background: "#ECFDF5", color: "#065F46", fontSize: 14, fontWeight: 600, lineHeight: 1.5 }}>
                      <Icon d={CHECK} size={18} width={2.4} />{problem.sol}
                    </div>
                    <span style={{ marginTop: "auto", fontSize: 12.5, color: "#64748B" }}>Pase el cursor para ver la solución</span>
                  </article>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FUNCIONALIDADES */}
        <section id="funcionalidades" style={{ padding: "100px 0 110px", background: "#F6F8FC" }}>
          <div className="nl-wrap" style={{ display: "flex", flexDirection: "column", gap: 48 }}>
            <div className="nl-rv" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 24, flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 680 }}>
                <span className="nl-eyebrow">Funcionalidades reales</span>
                <h2 className="nl-h2">Todo lo necesario para coordinar una comunidad residencial</h2>
              </div>
              <p style={{ margin: 0, maxWidth: 360, fontSize: 16, lineHeight: 1.6, color: "#64748B" }}>Nueve módulos conectados entre sí, para que cada dato se registre una sola vez.</p>
            </div>
            <div className="nl-bento">
              {features.map((feature, index) => (
                <div key={feature.title} className={`nl-rv${feature.span ? " nl-span2" : ""}`} style={{ transitionDelay: `${((index % 3) * 0.1).toFixed(2)}s` }}>
                  <article className="nl-card nl-spot" onMouseMove={spot} style={{ height: "100%", padding: 28, display: "flex", flexWrap: "wrap", gap: 22, alignItems: "center" }}>
                    <div style={{ flex: "1 1 240px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16, position: "relative" }}>
                      <span className={`nl-ico ${feature.a}`} style={{ background: feature.bg, color: feature.fg }}><Icon d={feature.d} size={24} /></span>
                      <h3 style={{ margin: 0, fontSize: 19, fontWeight: 800, letterSpacing: "-0.02em" }}>{feature.title}</h3>
                      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "#64748B" }}>{feature.text}</p>
                    </div>
                    {feature.kind === "qr" ? (
                      <div aria-hidden="true" style={{ flex: "0 1 200px", position: "relative", display: "flex", justifyContent: "center" }}>
                        <div style={{ position: "relative", width: 150, height: 150, padding: 14, borderRadius: 20, background: "#FFFFFF", border: "1px solid #E2E8F0", boxShadow: "0 20px 40px -26px rgba(15,23,42,.4)" }}>
                          <QrGrid qr={scene.qr} gap={4} radius={2} />
                          <span className="nl-scan" />
                        </div>
                      </div>
                    ) : null}
                    {feature.kind === "pay" ? (
                      <div aria-hidden="true" style={{ flex: "0 1 230px", display: "flex", flexDirection: "column", gap: 12, padding: 18, borderRadius: 18, background: "#F8FAFC", border: "1px solid #EEF2F7" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 700 }}><span>Cuota mensual</span><span style={{ color: "#047857" }}>Al día</span></div>
                        <div style={{ height: 10, borderRadius: 99, background: "#E2E8F0", overflow: "hidden" }}><div className="nl-payfill" /></div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {[["Pagado", "#ECFDF5", "#047857"], ["Recargo", "#FFFBEB", "#B45309"], ["Mora", "#FEF2F2", "#B91C1C"]].map(([label, bg, fg]) => (
                            <span key={label} style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 9px", borderRadius: 99, background: bg, color: fg }}>{label}</span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {feature.kind === "rep" ? (
                      <div aria-hidden="true" style={{ flex: "0 1 200px", display: "flex", justifyContent: "center", gap: 14, padding: "10px 0" }}>
                        <span className="nl-file" style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", width: 74, height: 92, padding: 10, borderRadius: 12, background: "#FEF2F2", border: "1px solid #FECACA", fontSize: 13, fontWeight: 800, color: "#B91C1C" }}>PDF</span>
                        <span className="nl-file b" style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", width: 74, height: 92, padding: 10, borderRadius: 12, background: "#ECFDF5", border: "1px solid #BBF7D0", fontSize: 13, fontWeight: 800, color: "#047857" }}>XLSX</span>
                      </div>
                    ) : null}
                  </article>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* BENEFICIOS */}
        <section id="beneficios" style={{ padding: "110px 0", background: "#FFFFFF" }}>
          <div className="nl-wrap" style={{ display: "flex", flexWrap: "wrap", gap: 56, alignItems: "center" }}>
            <div className="nl-rv l" style={{ flex: "1 1 380px", minWidth: 0, display: "flex", flexDirection: "column", gap: 18 }}>
              <span className="nl-eyebrow">Beneficios</span>
              <h2 className="nl-h2">Información clara para tomar mejores decisiones</h2>
              <p style={{ margin: 0, fontSize: 17, lineHeight: 1.65, color: "#475569", maxWidth: 480 }}>NexusResidencial conecta la administración diaria con la seguridad, las finanzas y la experiencia de quienes viven en la comunidad.</p>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
                <button type="button" className="nl-btn" onClick={() => go("demostracion")}>Ver una demostración <Icon className="nl-arrow" d={ARROW} size={18} width={2.3} /></button>
              </div>
            </div>
            <div className="nl-rv r" style={{ flex: "1 1 520px", minWidth: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
              {benefits.map((benefit, index) => (
                <div key={benefit} className="nl-ben" style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 18px", borderRadius: 16, background: "#F8FAFC", border: "1px solid #EEF2F7" }}>
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: "50%", background: "#DCFCE7", flex: "none" }}>
                    <svg className="nl-chk" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path pathLength={1} d={CHECK} style={{ transitionDelay: `${(0.3 + index * 0.09).toFixed(2)}s` }} />
                    </svg>
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 600, color: "#1E293B" }}>{benefit}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CÓMO FUNCIONA */}
        <section style={{ padding: "110px 0", background: "color-mix(in srgb, var(--nl-accent) 5%, #FFFFFF)" }}>
          <div className="nl-wrap" style={{ display: "flex", flexDirection: "column", gap: 56 }}>
            <div className="nl-rv" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center" }}>
              <span className="nl-eyebrow">Cómo funciona</span>
              <h2 className="nl-h2">De la configuración al control diario</h2>
            </div>
            <div className="nl-rv" style={{ position: "relative" }}>
              <div className="nl-line" aria-hidden="true"><i /></div>
              <ol style={{ listStyle: "none", margin: 0, padding: 0, position: "relative", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 22 }}>
                {steps.map((step) => (
                  <li key={step.n} className="nl-step" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, textAlign: "center" }}>
                    <span className="nl-num nl-mono" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 64, height: 64, borderRadius: 20, background: "#FFFFFF", border: "2px solid color-mix(in srgb, var(--nl-accent) 30%, #FFFFFF)", color: "var(--nl-accent)", fontSize: 20, fontWeight: 600, boxShadow: "0 12px 26px -18px rgba(15,23,42,.4)" }}>{step.n}</span>
                    <div className="nl-card" style={{ width: "100%", padding: 22, display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
                      <span style={{ color: "var(--nl-accent)" }}><Icon d={step.d} size={26} /></span>
                      <span style={{ fontSize: 16.5, fontWeight: 700, lineHeight: 1.35 }}>{step.t}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* ROLES */}
        <section id="roles" style={{ padding: "110px 0", background: "#FFFFFF" }}>
          <div className="nl-wrap" style={{ display: "flex", flexDirection: "column", gap: 44 }}>
            <div className="nl-rv" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <span className="nl-eyebrow">Roles del sistema</span>
              <h2 className="nl-h2">Cada persona ve lo que necesita</h2>
            </div>
            <div className="nl-rv" style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "stretch" }}>
              <div role="group" aria-label="Elegir rol" style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                {roles.map((item, index) => (
                  <button
                    key={item.name}
                    type="button"
                    className={`nl-tab${role === index ? " is-on" : ""}`}
                    aria-pressed={role === index}
                    onClick={() => { setRole(index); setAutoRole(false); setSwaps((value) => value + 1); }}
                  >
                    <span className="nl-tico"><Icon d={item.d} /></span>
                    <span style={{ flex: 1 }}>{item.name}</span>
                    <span className="nl-mono" style={{ fontSize: 12, color: "#94A3B8" }}>0{index + 1}</span>
                    {role === index && autoRole ? <span key={swaps} className="nl-tprog" /> : null}
                  </button>
                ))}
              </div>
              <div key={swaps} className={swaps % 2 ? "nl-swapA" : "nl-swapB"} aria-live="polite" style={{ flex: "999 1 460px", minWidth: 0, position: "relative", overflow: "hidden", padding: 36, borderRadius: 26, background: "#F6F8FC", border: "1px solid #E6EBF3", display: "flex", flexDirection: "column", gap: 22 }}>
                <div style={{ position: "absolute", right: -40, top: -40, width: 200, height: 200, borderRadius: "50%", background: "color-mix(in srgb, var(--nl-accent) 8%, transparent)" }} aria-hidden="true" />
                <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 16 }}>
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 64, height: 64, borderRadius: 20, background: "var(--nl-accent)", color: "#FFFFFF", boxShadow: "0 16px 30px -16px var(--nl-accent)" }}><Icon d={current.d} size={30} /></span>
                  <div>
                    <div className="nl-mono" style={{ fontSize: 12, color: "#64748B" }}>Rol 0{role + 1} de 04</div>
                    <h3 style={{ margin: 0, fontSize: 30, fontWeight: 800, letterSpacing: "-0.03em" }}>{current.name}</h3>
                  </div>
                </div>
                <p style={{ position: "relative", margin: 0, fontSize: 18, lineHeight: 1.6, color: "#334155", maxWidth: 560 }}>{current.text}</p>
                <div style={{ position: "relative", display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {current.chips.map((chip, index) => (
                    <span key={chip} className="nl-chip" style={{ animationDelay: `${(0.1 + index * 0.05).toFixed(2)}s` }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--nl-accent)" }} />{chip}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* PLATAFORMA */}
        <section style={{ padding: "100px 0 110px", background: "#F6F8FC" }}>
          <div className="nl-wrap" style={{ display: "flex", flexDirection: "column", gap: 48 }}>
            <div className="nl-rv" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center" }}>
              <span className="nl-eyebrow">Conoce la plataforma</span>
              <h2 className="nl-h2">Una operación conectada de principio a fin</h2>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 22 }}>
              {platform.map((card, index) => (
                <div key={card.title} className="nl-rv z" style={{ transitionDelay: `${(index * 0.12).toFixed(2)}s` }}>
                  <article className="nl-card nl-tilt" onMouseMove={tilt} onMouseLeave={untilt} style={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                    <div style={{ height: 5, background: card.color }} />
                    <div aria-hidden="true" style={{ margin: "20px 20px 0", padding: 16, borderRadius: 16, background: "#F8FAFC", border: "1px solid #EEF2F7", display: "flex", flexDirection: "column", gap: 10, minHeight: 150 }}>
                      {card.kind === "admin" ? (
                        <>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                            {[["24", card.color, "60%"], ["8", "#10B981", "70%"], ["3", "#F59E0B", "50%"]].map(([value, color, width]) => (
                              <div key={value} style={{ padding: 10, borderRadius: 10, background: "#FFFFFF", display: "flex", flexDirection: "column", gap: 6 }}>
                                <span className="nl-sk" style={{ height: 6, width }} /><span style={{ fontSize: 18, fontWeight: 800, color }}>{value}</span>
                              </div>
                            ))}
                          </div>
                          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 54, padding: "0 4px" }}>
                            {[["40%", "-.4s"], ["70%", "-1.2s"], ["55%", "-2s"], ["90%", "-.8s"], ["60%", "-2.6s"]].map(([height, delay]) => (
                              <span key={delay} className="nl-hbar" style={{ height, background: card.color, animationDelay: `0s, ${delay}` }} />
                            ))}
                          </div>
                        </>
                      ) : null}
                      {card.kind === "res" ? (
                        <>
                          {[
                            { label: "Visita", bg: "#ECFDF5", fg: "#047857", icon: <span style={{ width: 28, height: 28, borderRadius: "50%", background: "#F5F3FF", color: "#7C3AED", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>AL</span> },
                            { label: "Reserva", bg: "#EFF6FF", fg: "#1D4ED8", icon: <span style={{ width: 28, height: 28, borderRadius: "50%", background: "#EFF6FF", color: "#2563EB", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon d="M3.5 5h17v15h-17zM3.5 10h17" size={14} width={2.2} /></span> },
                            { label: "Resumen", bg: "#FFFBEB", fg: "#B45309", icon: <span style={{ width: 28, height: 28, borderRadius: "50%", background: "#FFFBEB", color: "#D97706", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon d="M4 20V11M10 20V5M16 20v-8" size={14} width={2.2} /></span> },
                          ].map((row) => (
                            <div key={row.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, background: "#FFFFFF" }}>
                              {row.icon}<span className="nl-sk" style={{ height: 8, flex: 1 }} />
                              <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 99, background: row.bg, color: row.fg }}>{row.label}</span>
                            </div>
                          ))}
                        </>
                      ) : null}
                      {card.kind === "sec" ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                          <div style={{ position: "relative", width: 84, height: 84, padding: 8, borderRadius: 14, background: "#FFFFFF", flex: "none" }}>
                            <QrGrid qr={scene.qr} gap={2} radius={1} />
                            <span className="nl-scan" style={{ background: "#10B981", boxShadow: "0 0 10px #10B981" }} />
                          </div>
                          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                            <span style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, padding: "5px 10px", borderRadius: 99, background: "#ECFDF5", color: "#047857" }}><Icon d={CHECK} size={13} width={3} />Autorizado</span>
                            <span className="nl-sk" style={{ height: 8, width: "90%" }} />
                            <span className="nl-sk" style={{ height: 8, width: "60%" }} />
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div style={{ padding: "22px 24px 26px", display: "flex", flexDirection: "column", gap: 10 }}>
                      <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em" }}>{card.title}</h3>
                      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "#64748B" }}>{card.text}</p>
                    </div>
                  </article>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* DEMO */}
        <section id="demostracion" style={{ position: "relative", overflow: "hidden", padding: "110px 0 0", background: "color-mix(in srgb, var(--nl-accent) 82%, #0B1530)" }}>
          <div className="nl-wrap" style={{ position: "relative", display: "flex", flexWrap: "wrap", gap: 48, alignItems: "flex-start" }}>
            <div className="nl-rv l" style={{ flex: "1 1 380px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20, color: "#FFFFFF", paddingTop: 10 }}>
              <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 56, height: 56, borderRadius: 16, background: "rgba(255,255,255,.14)", color: "#FFFFFF" }}><Icon d="M4 5h16v11H9l-5 4zM8 9h8M8 12.5h5" size={26} /></span>
              <h2 style={{ margin: 0, fontSize: "clamp(32px, 3.8vw, 48px)", lineHeight: 1.08, fontWeight: 800, letterSpacing: "-0.035em" }}>Digitaliza la administración de tu residencial</h2>
              <p style={{ margin: 0, fontSize: 17, lineHeight: 1.65, color: "rgba(255,255,255,.88)", maxWidth: 460 }}>Solicita una demostración y conoce cómo NexusResidencial puede centralizar la operación de tu comunidad.</p>
            </div>
            <div className="nl-rv r" style={{ flex: "1 1 520px", minWidth: 0, marginBottom: 110, position: "relative", zIndex: 1 }}>
              <div style={{ background: "#FFFFFF", borderRadius: 26, padding: 34, boxShadow: "0 40px 80px -40px rgba(0,0,0,.5)" }}>
                <DemoForm />
              </div>
            </div>
          </div>
          <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: 0, display: "flex", justifyContent: "flex-start", alignItems: "flex-end", gap: 10, padding: "0 28px", pointerEvents: "none", opacity: 0.9 }}>
            {scene.towers.map((tower, index) => (
              <div key={index} className="nl-tower">
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${tower.cols}, 10px)`, gap: 5 }}>
                  {tower.wins.map((win, winIndex) => <span key={winIndex} className={win.cls} style={{ animationDelay: win.d }} />)}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer style={{ background: "#FFFFFF", borderTop: "1px solid #E6EBF3" }}>
        <div className="nl-wrap" style={{ display: "flex", flexWrap: "wrap", gap: 40, paddingTop: 64, paddingBottom: 40 }}>
          <div style={{ flex: "2 1 300px", display: "flex", flexDirection: "column", gap: 16, maxWidth: 380 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <BrandMark />
              <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em" }}>NexusResidencial</span>
            </div>
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.65, color: "#64748B" }}>Administración residencial, seguridad y servicio a la comunidad desde una plataforma conectada.</p>
          </div>
          <nav aria-label="Navegación del pie" style={{ flex: "1 1 180px", display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>Navegación</span>
            {nav.slice(1).map(([label, id]) => <button key={id} type="button" className="nl-flink" onClick={() => go(id)}>{label}</button>)}
          </nav>
          <div style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>Contacto</span>
            <a className="nl-flink" href="mailto:contacto@nexusresidencial.com">contacto@nexusresidencial.com</a>
            <Link className="nl-flink" to="/privacidad">Privacidad</Link>
            <Link className="nl-flink" to="/login">Iniciar sesión</Link>
          </div>
        </div>
        <div style={{ borderTop: "1px solid #EEF2F7", padding: "22px 0", textAlign: "center", fontSize: 13, color: "#64748B" }}>
          © {new Date().getFullYear()} NexusResidencial. Todos los derechos reservados.
        </div>
      </footer>

      {showTop ? (
        <button type="button" className="nl-top nl-pop" aria-label="Volver arriba" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          <Icon d="M12 19V5M6 11l6-6 6 6" size={22} width={2.3} />
        </button>
      ) : null}
    </div>
  );
}
