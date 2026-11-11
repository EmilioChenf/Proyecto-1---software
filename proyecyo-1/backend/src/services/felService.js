const crypto = require("node:crypto");
const { query } = require("../database/mysql");

// Factura electrónica en línea (FEL, SAT Guatemala).
// Hoy el sistema funciona en modo SIMULADO: guarda los datos fiscales del emisor y genera un
// documento de prueba por pago (serie SIM, sin validez fiscal) para que el flujo y el comprobante
// estén listos. Al contratar un certificador autorizado (Infile, Digifact, etc.) se agrega su
// adaptador en certify() y se cambia el modo a CERTIFICADOR; el resto del sistema no cambia.
const KEYS = { modo: "fel_modo", nit: "fel_nit", nombre_emisor: "fel_nombre_emisor", nombre_comercial: "fel_nombre_comercial", direccion: "fel_direccion", regimen: "fel_regimen", certificador: "fel_certificador" };
const MODES = ["DESACTIVADO", "SIMULADO"];
const REGIMES = ["GENERAL", "PEQUENO_CONTRIBUYENTE"];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

/** Valida un NIT guatemalteco con su dígito verificador (módulo 11; 10 = K). */
function isValidNit(value) {
  const nit = String(value || "").toUpperCase().replace(/[\s-]/g, "");
  if (nit === "CF") return true;
  if (!/^\d{1,12}[0-9K]$/.test(nit)) return false;
  const body = nit.slice(0, -1);
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (body.length + 1 - index), 0);
  const check = (11 - (sum % 11)) % 11;
  return nit.slice(-1) === (check === 10 ? "K" : String(check));
}

async function ensureFelSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS FEL_DOCUMENTO (
      id_documento INT PRIMARY KEY AUTO_INCREMENT,
      id_pago INT NOT NULL UNIQUE,
      modo VARCHAR(20) NOT NULL,
      serie VARCHAR(20) NOT NULL,
      numero VARCHAR(20) NOT NULL,
      autorizacion CHAR(36) NOT NULL,
      nit_emisor VARCHAR(20) NOT NULL,
      nit_receptor VARCHAR(20) NOT NULL DEFAULT 'CF',
      monto DECIMAL(10,2) NOT NULL,
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
}

async function getFiscalSettings() {
  const rows = await query(`SELECT clave, valor FROM CONFIGURACION WHERE clave IN (${Object.values(KEYS).map(() => "?").join(",")})`, Object.values(KEYS));
  const map = Object.fromEntries(rows.map((row) => [row.clave, row.valor]));
  const settings = Object.fromEntries(Object.entries(KEYS).map(([field, key]) => [field, map[key] || ""]));
  settings.modo = MODES.includes(settings.modo) ? settings.modo : "DESACTIVADO";
  settings.regimen = REGIMES.includes(settings.regimen) ? settings.regimen : "GENERAL";
  settings.completos = Boolean(settings.nit && settings.nombre_emisor && settings.direccion);
  return settings;
}

async function updateFiscalSettings(payload = {}) {
  const data = {
    modo: String(payload.modo || "DESACTIVADO").toUpperCase(),
    nit: String(payload.nit || "").toUpperCase().replace(/[\s-]/g, ""),
    nombre_emisor: String(payload.nombre_emisor || "").trim(),
    nombre_comercial: String(payload.nombre_comercial || "").trim(),
    direccion: String(payload.direccion || "").trim(),
    regimen: String(payload.regimen || "GENERAL").toUpperCase(),
    certificador: String(payload.certificador || "").trim(),
  };
  if (!MODES.includes(data.modo)) throw fail("Por ahora el modo puede ser Desactivado o Simulado; el modo con certificador se activa al contratarlo.");
  if (!REGIMES.includes(data.regimen)) throw fail("Régimen inválido.");
  if (data.nit && (data.nit === "CF" || !isValidNit(data.nit))) throw fail("El NIT del emisor no es válido (revisa el dígito verificador).");
  if (data.nombre_emisor.length > 150 || data.nombre_comercial.length > 150 || data.direccion.length > 200 || data.certificador.length > 60) throw fail("Algún dato fiscal es demasiado largo.");
  if (data.modo !== "DESACTIVADO" && (!data.nit || !data.nombre_emisor || !data.direccion)) throw fail("Para activar la factura simulada llena NIT, razón social y dirección fiscal.");
  for (const [field, key] of Object.entries(KEYS)) {
    await query("INSERT INTO CONFIGURACION (clave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)", [key, data[field]]);
  }
  return getFiscalSettings();
}

/** Devuelve (o genera) el documento FEL del pago. null si FEL está desactivado. */
async function documentForPayment(payment) {
  const settings = await getFiscalSettings();
  if (settings.modo === "DESACTIVADO" || !settings.completos) return null;
  await ensureFelSchema();
  const [existing] = await query("SELECT * FROM FEL_DOCUMENTO WHERE id_pago = ?", [payment.id_pago]);
  if (existing) return { ...existing, simulado: existing.modo === "SIMULADO" };
  const numero = String(payment.id_pago).padStart(8, "0");
  const doc = { id_pago: payment.id_pago, modo: settings.modo, serie: `SIM${new Date().getFullYear()}`, numero, autorizacion: crypto.randomUUID().toUpperCase(), nit_emisor: settings.nit, nit_receptor: "CF", monto: Number(payment.monto_pagado || 0).toFixed(2) };
  await query("INSERT IGNORE INTO FEL_DOCUMENTO (id_pago, modo, serie, numero, autorizacion, nit_emisor, nit_receptor, monto) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [doc.id_pago, doc.modo, doc.serie, doc.numero, doc.autorizacion, doc.nit_emisor, doc.nit_receptor, doc.monto]);
  const [saved] = await query("SELECT * FROM FEL_DOCUMENTO WHERE id_pago = ?", [payment.id_pago]);
  return { ...saved, simulado: true, emisor: settings.nombre_emisor };
}

module.exports = { isValidNit, getFiscalSettings, updateFiscalSettings, documentForPayment, ensureFelSchema };
