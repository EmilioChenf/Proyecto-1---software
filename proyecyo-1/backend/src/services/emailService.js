const nodemailer = require("nodemailer");
const { env } = require("../config/env");

// Envio de correos del sistema. Usa SMTP (Gmail con clave de aplicacion) cuando
// SMTP_USER y SMTP_PASS estan configurados; si no, la API HTTP de EMAIL_API_URL.
// Sin ninguno de los dos, los correos no se envian y el sistema sigue funcionando.

const BRAND = { name: "NexusResidencial", color: "#2563EB" };

let transporter = null;
let transporterOverride = null;

function smtpConfigured() {
  return Boolean(env.SMTP_USER && env.SMTP_PASS);
}

function isEmailConfigured() {
  return Boolean(transporterOverride || smtpConfigured() || env.EMAIL_API_URL);
}

function getTransporter() {
  if (transporterOverride) return transporterOverride;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    });
  }
  return transporter;
}

/** Solo para pruebas: reemplaza el transporte SMTP (null restablece el real). */
function setEmailTransportForTests(next) {
  transporterOverride = next;
  transporter = null;
}

function fromAddress() {
  // Gmail solo permite enviar como la cuenta autenticada.
  const address = smtpConfigured() ? env.SMTP_USER : env.EMAIL_FROM;
  return env.EMAIL_FROM_NAME ? `"${env.EMAIL_FROM_NAME.replace(/"/g, "")}" <${address}>` : address;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

async function sendEmail({ to, subject, text, html }) {
  if (!to) return { delivered: false, reason: "SIN_CORREO" };

  if (transporterOverride || smtpConfigured()) {
    const info = await getTransporter().sendMail({ from: fromAddress(), to, subject, text, html });
    return { delivered: true, messageId: info && info.messageId };
  }

  if (!env.EMAIL_API_URL) {
    if (env.NODE_ENV !== "test") {
      console.warn("El correo no esta configurado (SMTP_USER/SMTP_PASS o EMAIL_API_URL); no se envio el mensaje.");
    }
    return { delivered: false, reason: "NO_CONFIGURADO" };
  }

  const response = await fetch(env.EMAIL_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.EMAIL_API_KEY ? { Authorization: `Bearer ${env.EMAIL_API_KEY}` } : {}),
    },
    body: JSON.stringify({ from: fromAddress(), to, subject, text, html }),
  });

  if (!response.ok) {
    const error = new Error("El proveedor de correo rechazo el mensaje.");
    error.status = 502;
    throw error;
  }

  return { delivered: true };
}

/** Plantilla HTML comun: encabezado con la marca, titulo, mensaje y boton. */
// Nombre del residencial de esta copia para el encabezado de los correos (cache 1 min).
let brandCache = { value: null, at: 0 };
async function currentBrand() {
  if (brandCache.value && Date.now() - brandCache.at < 60000) return brandCache.value;
  try {
    const brand = await require("./configurationService").getPublicBrand();
    brandCache = { value: brand, at: Date.now() };
    return brand;
  } catch {
    return { nombre: BRAND.name, color: BRAND.color };
  }
}

function renderEmailLayout({ heading, greeting, paragraphs = [], buttonText, buttonUrl, footnote, brand = null }) {
  const brandName = brand?.nombre || BRAND.name;
  const brandColor = /^#[0-9A-F]{6}$/i.test(brand?.color || "") ? brand.color : BRAND.color;
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#334155">${escapeHtml(p)}</p>`).join("");
  const button = buttonUrl
    ? `<p style="margin:24px 0 8px"><a href="${escapeHtml(buttonUrl)}" style="display:inline-block;background:${brandColor};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:10px">${escapeHtml(buttonText || "Abrir NexusResidencial")}</a></p>`
    : "";
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:'Segoe UI',Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #E2E8F0">
        <tr><td style="background:${brandColor};padding:20px 28px;color:#ffffff;font-size:18px;font-weight:800;letter-spacing:-0.01em">${escapeHtml(brandName)}${brandName !== BRAND.name ? `<div style="font-size:12px;font-weight:500;opacity:.85;margin-top:2px">${BRAND.name}</div>` : ""}</td></tr>
        <tr><td style="padding:28px">
          <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0F172A">${escapeHtml(heading)}</h1>
          ${greeting ? `<p style="margin:0 0 14px;font-size:15px;color:#334155">${escapeHtml(greeting)}</p>` : ""}
          ${body}
          ${button}
        </td></tr>
        <tr><td style="padding:16px 28px;background:#F8FAFC;border-top:1px solid #E2E8F0;font-size:12px;line-height:1.5;color:#64748B">
          ${escapeHtml(footnote || "Recibes este correo porque tienes una cuenta en NexusResidencial. Este buzón no recibe respuestas.")}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

async function sendPasswordResetEmail({ to, name, resetUrl }) {
  const greeting = `Hola${name ? ` ${name}` : ""},`;
  const paragraphs = ["Recibimos una solicitud para restablecer tu contraseña. Usa el botón para crear una nueva; el enlace expira pronto y solo puede usarse una vez.", "Si no fuiste tú, ignora este correo: tu contraseña actual sigue funcionando."];
  return sendEmail({
    to,
    subject: "Recupera tu acceso a NexusResidencial",
    text: `${greeting}\n\n${paragraphs[0]}\n\n${resetUrl}\n\n${paragraphs[1]}`,
    html: renderEmailLayout({ heading: "Restablece tu contraseña", greeting, paragraphs, buttonText: "Restablecer contraseña", buttonUrl: resetUrl, brand: await currentBrand() }),
  });
}

module.exports = { currentBrand, sendEmail, sendPasswordResetEmail, renderEmailLayout, escapeHtml, isEmailConfigured, setEmailTransportForTests };
