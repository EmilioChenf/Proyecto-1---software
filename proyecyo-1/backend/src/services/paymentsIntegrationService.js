const { env } = require("../config/env");

const mask = (value) => (value ? `${String(value).slice(0, 8)}…${String(value).slice(-4)}` : null);

/** Estado de los pagos en línea (Recurrente) y de la factura electrónica, sin exponer llaves. */
async function getIntegrationStatus({ test = false } = {}) {
  const key = String(env.RECURRENTE_SECRET_KEY || process.env.RECURRENTE_SECRET_KEY || "");
  const sandboxId = String(process.env.RECURRENTE_SANDBOX_ID || "");
  const webhook = Boolean(process.env.RECURRENTE_WEBHOOK_SECRET);
  let configured = false;
  try { require("../config/recurrenteCheckout").getCheckoutConfig(); configured = true; } catch { configured = false; }
  let conexion = null;
  if (test && configured) {
    try {
      const config = require("../config/recurrenteCheckout").getCheckoutConfig();
      const response = await fetch(`${config.apiBase}/test`, { headers: { "X-SECRET-KEY": config.secretKey, Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
      const data = response.ok ? await response.json().catch(() => ({})) : {};
      conexion = response.ok && data.environment === "sandbox" && data.sandbox_id === sandboxId
        ? { ok: true, mensaje: "Conexión correcta con el ambiente de pruebas de Recurrente." }
        : { ok: false, mensaje: response.status === 401 || response.status === 403 ? "Recurrente rechazó la llave secreta." : "La llave no corresponde al sandbox configurado." };
    } catch {
      conexion = { ok: false, mensaje: "No fue posible contactar a Recurrente." };
    }
  }
  const fel = await require("./felService").getFiscalSettings();
  return {
    recurrente: {
      modo: "SANDBOX",
      configurado: configured,
      llave: key ? mask(key) : null,
      sandbox_id: sandboxId ? mask(sandboxId) : null,
      webhook_configurado: webhook,
      url_webhook: `${String(process.env.PUBLIC_API_URL || "https://api.tu-residencial.com").replace(/\/$/, "")}/webhooks/recurrente`,
      conexion,
    },
    fel: { modo: fel.modo, datos_completos: fel.completos, certificador: fel.certificador || null },
    produccion: [
      { paso: "Cuenta de Recurrente a nombre del residencial (o de la administradora) verificada", responsable: "Cliente" },
      { paso: "RTU actualizado en SAT con la actividad del residencial y cuenta bancaria para liquidaciones", responsable: "Cliente" },
      { paso: "Llaves de producción de Recurrente cargadas en las variables del servidor (nunca en el código)", responsable: "Nexus" },
      { paso: "Contrato con un certificador FEL autorizado por SAT y sus credenciales", responsable: "Cliente" },
      { paso: "Prueba de un pago real de Q1.00 y su reembolso antes de abrir a residentes", responsable: "Nexus + Cliente" },
    ],
  };
}

module.exports = { getIntegrationStatus };
