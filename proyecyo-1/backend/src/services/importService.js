const crypto = require("node:crypto");
const ExcelJS = require("exceljs");
const { query } = require("../database/mysql");

// Importación inicial desde Excel: viviendas, residentes, inquilinos y saldos iniciales.
// 1) La vista previa valida todo sin guardar nada. 2) Al aplicar, cada fila usa las mismas
// reglas que las pantallas del sistema (crear vivienda, crear usuario) y se reporta fila por fila.
const SHEETS = {
  viviendas: { name: "Viviendas", columns: [["torre", "Torre o manzana"], ["numero", "Número *"], ["modelo", "Modelo"], ["modalidad", "Modalidad (VENTA/RENTA/AMBAS)"], ["precio", "Precio de venta"], ["precio_renta", "Renta mensual"], ["habitaciones", "Habitaciones"], ["banos", "Baños"]] },
  residentes: { name: "Residentes", columns: [["nombre", "Nombre completo *"], ["correo", "Correo *"], ["telefono", "Teléfono"], ["torre", "Torre o manzana"], ["numero", "Número de vivienda *"]] },
  inquilinos: { name: "Inquilinos", columns: [["nombre", "Nombre completo *"], ["correo", "Correo *"], ["telefono", "Teléfono"], ["torre", "Torre o manzana"], ["numero", "Número de vivienda *"]] },
  saldos: { name: "Saldos iniciales", columns: [["torre", "Torre o manzana"], ["numero", "Número de vivienda *"], ["monto", "Saldo pendiente (Q) *"], ["fecha_limite", "Fecha límite (AAAA-MM-DD)"], ["descripcion", "Descripción"]] },
};
const EXAMPLES = {
  viviendas: [["A", "1", "Modelo Ceiba", "VENTA", 850000, "", 3, 2.5], ["A", "2", "Modelo Ceiba", "RENTA", "", 6500, 3, 2]],
  residentes: [["Ana López", "ana.lopez@correo.com", "5555-1111", "A", "1"]],
  inquilinos: [["Carlos Pérez", "carlos.perez@correo.com", "5555-2222", "A", "1"]],
  saldos: [["A", "1", 1250.5, "2026-11-30", "Mantenimiento atrasado"]],
};
const MAX_ROWS = 2000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

async function buildTemplate() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "NexusResidencial";
  const help = workbook.addWorksheet("Instrucciones");
  help.getColumn(1).width = 110;
  [
    "Plantilla de importación de NexusResidencial",
    "",
    "1. Llena las hojas en este orden: Viviendas, Residentes, Inquilinos y Saldos iniciales. Puedes dejar hojas vacías.",
    "2. Las columnas con * son obligatorias. Borra las filas de ejemplo antes de importar.",
    "3. Una vivienda se identifica por Torre/manzana + Número (escríbelos igual en todas las hojas).",
    "4. Cada residente queda como responsable de su vivienda. Un inquilino solo se agrega a una vivienda con residente.",
    "5. El saldo inicial es lo que cada vivienda debe al pasar al sistema; se registra como un cargo histórico.",
    "6. Las personas reciben un correo para crear su contraseña (si el envío de correos está configurado).",
    "7. Primero verás una vista previa con los errores por fila; nada se guarda hasta que confirmes.",
  ].forEach((line, index) => { const row = help.addRow([line]); if (index === 0) row.font = { bold: true, size: 15 }; });
  for (const [key, sheet] of Object.entries(SHEETS)) {
    const ws = workbook.addWorksheet(sheet.name);
    const header = ws.addRow(sheet.columns.map(([, label]) => label));
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    sheet.columns.forEach((_, index) => { ws.getColumn(index + 1).width = 26; });
    EXAMPLES[key].forEach((example) => { const row = ws.addRow(example); row.font = { italic: true, color: { argb: "FF64748B" } }; });
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function cellText(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if (value.text) return String(value.text).trim();
    if (value.result != null) return String(value.result).trim();
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("").trim();
    if (value.hyperlink) return String(value.hyperlink).replace(/^mailto:/i, "").trim();
  }
  return String(value).trim();
}

async function readWorkbook(base64) {
  const match = String(base64 || "").match(/^(?:data:[\w.+/-]+;base64,)?([A-Za-z0-9+/=]+)$/);
  if (!match) throw fail("Adjunta el archivo de Excel (.xlsx) de la plantilla.");
  const buffer = Buffer.from(match[1], "base64");
  if (buffer.length > 4 * 1024 * 1024) throw fail("El archivo supera 4 MB.");
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer); } catch { throw fail("No se pudo leer el archivo. Usa la plantilla en formato .xlsx."); }
  const data = { ejemplos_ignorados: 0 };
  for (const [key, sheet] of Object.entries(SHEETS)) {
    const ws = workbook.getWorksheet(sheet.name);
    data[key] = [];
    if (!ws) continue;
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const record = { fila: rowNumber };
      sheet.columns.forEach(([field], index) => { record[field] = cellText(row.getCell(index + 1).value); });
      const isExample = EXAMPLES[key].some((example) => example.every((value, index) => String(value) === record[sheet.columns[index][0]]));
      if (isExample) data.ejemplos_ignorados = (data.ejemplos_ignorados || 0) + 1;
      else if (sheet.columns.some(([field]) => record[field] !== "")) data[key].push(record);
    });
    if (data[key].length > MAX_ROWS) throw fail(`La hoja ${sheet.name} tiene más de ${MAX_ROWS} filas.`);
  }
  return data;
}

const houseKey = (torre, numero) => `${String(torre || "").trim().toUpperCase()}|${String(numero || "").trim().toUpperCase()}`;
const houseLabel = (torre, numero) => (torre ? `${torre}-${numero}` : String(numero));

async function loadExisting() {
  const houses = await query("SELECT id_casa, torre, numero, id_residente FROM CASA");
  const emails = await query("SELECT LOWER(correo) correo FROM USUARIO");
  return {
    houses: new Map(houses.map((h) => [houseKey(h.torre, h.numero), { id_casa: Number(h.id_casa), ocupada: h.id_residente != null }])),
    emails: new Set(emails.map((e) => e.correo)),
  };
}

/** Valida el archivo completo y devuelve, por hoja, cada fila con su estado. No guarda nada. */
async function previewImport(base64) {
  const data = await readWorkbook(base64);
  const existing = await loadExisting();
  const { validateHousePayload } = require("./housesService").__private__;
  const fileHouses = new Map();
  const fileEmails = new Set();
  const residentHouses = new Set();
  const result = { viviendas: [], residentes: [], inquilinos: [], saldos: [] };

  for (const row of data.viviendas) {
    const item = { fila: row.fila, vivienda: houseLabel(row.torre, row.numero), estado: "NUEVA", errores: [] };
    try { validateHousePayload(row); } catch (error) { item.errores.push(error.message); }
    const key = houseKey(row.torre, row.numero);
    if (existing.houses.has(key)) item.estado = "YA_EXISTE";
    else if (fileHouses.has(key)) item.errores.push("La vivienda está repetida en el archivo.");
    if (!item.errores.length && item.estado === "NUEVA") fileHouses.set(key, true);
    if (item.errores.length) item.estado = "ERROR";
    result.viviendas.push(item);
  }

  const houseExists = (row) => existing.houses.has(houseKey(row.torre, row.numero)) || fileHouses.has(houseKey(row.torre, row.numero));
  for (const kind of ["residentes", "inquilinos"]) {
    for (const row of data[kind]) {
      const correo = row.correo.toLowerCase();
      const item = { fila: row.fila, nombre: row.nombre, correo, vivienda: houseLabel(row.torre, row.numero), estado: "NUEVO", errores: [] };
      if (row.nombre.length < 3) item.errores.push("Escribe el nombre completo.");
      if (!EMAIL.test(correo)) item.errores.push("El correo no es válido.");
      else if (existing.emails.has(correo)) item.estado = "YA_EXISTE";
      else if (fileEmails.has(correo)) item.errores.push("El correo está repetido en el archivo.");
      if (!row.numero) item.errores.push("Indica el número de vivienda.");
      else if (!houseExists(row)) item.errores.push(`La vivienda ${item.vivienda} no existe ni está en la hoja Viviendas.`);
      const key = houseKey(row.torre, row.numero);
      if (kind === "residentes" && item.estado === "NUEVO") {
        if (existing.houses.get(key)?.ocupada || residentHouses.has(key)) item.errores.push(`La vivienda ${item.vivienda} ya tiene un residente responsable.`);
        else if (!item.errores.length) residentHouses.add(key);
      }
      if (kind === "inquilinos" && item.estado === "NUEVO" && !existing.houses.get(key)?.ocupada && !residentHouses.has(key)) {
        item.errores.push(`La vivienda ${item.vivienda} no tiene residente: agrega primero al residente.`);
      }
      if (item.errores.length) item.estado = "ERROR";
      else if (item.estado === "NUEVO") fileEmails.add(correo);
      result[kind].push(item);
    }
  }

  for (const row of data.saldos) {
    const item = { fila: row.fila, vivienda: houseLabel(row.torre, row.numero), monto: Number(String(row.monto).replace(/[Q,\s]/g, "")), fecha_limite: row.fecha_limite || null, estado: "NUEVO", errores: [] };
    if (!houseExists(row)) item.errores.push(`La vivienda ${item.vivienda} no existe ni está en la hoja Viviendas.`);
    if (!Number.isFinite(item.monto) || item.monto <= 0 || Math.round(item.monto * 100) !== item.monto * 100 || item.monto > 9999999) item.errores.push("El saldo debe ser un monto mayor a 0 con máximo 2 decimales.");
    if (item.fecha_limite && (!/^\d{4}-\d{2}-\d{2}$/.test(item.fecha_limite) || Number.isNaN(new Date(item.fecha_limite).getTime()))) item.errores.push("La fecha debe tener formato AAAA-MM-DD.");
    if (item.errores.length) item.estado = "ERROR";
    result.saldos.push(item);
  }

  const all = Object.values(result).flat();
  return {
    ...result,
    resumen: {
      listas: all.filter((item) => ["NUEVA", "NUEVO"].includes(item.estado)).length,
      existentes: all.filter((item) => item.estado === "YA_EXISTE").length,
      errores: all.filter((item) => item.estado === "ERROR").length,
      ejemplos_ignorados: data.ejemplos_ignorados,
    },
  };
}

async function findHouseId(torre, numero) {
  const rows = await query("SELECT id_casa FROM CASA WHERE COALESCE(torre, '') = ? AND numero = ? LIMIT 1", [String(torre || "").trim(), String(numero).trim()]);
  return rows[0] ? Number(rows[0].id_casa) : null;
}

async function typeId(name) {
  const [row] = await query("SELECT id_tipo_usuario FROM TIPO_USUARIO WHERE nombre = ?", [name]);
  return Number(row.id_tipo_usuario);
}

/** Aplica las filas válidas. Las filas con error o ya existentes se omiten y se reportan. */
async function applyImport(base64, { invitar = true } = {}) {
  const preview = await previewImport(base64);
  const data = await readWorkbook(base64);
  const houses = require("./housesService");
  const users = require("./usersService");
  const report = { viviendas: 0, residentes: 0, inquilinos: 0, saldos: 0, omitidas: 0, fallidas: [], invitaciones: 0 };
  const statusOf = (kind, row) => preview[kind].find((item) => item.fila === row.fila)?.estado;
  const invite = async (correo) => {
    if (!invitar) return;
    try { await require("./passwordResetService").requestPasswordReset(correo); report.invitaciones += 1; } catch { /* el usuario puede usar "Olvidé mi contraseña" */ }
  };

  for (const row of data.viviendas) {
    if (statusOf("viviendas", row) !== "NUEVA") { report.omitidas += 1; continue; }
    try { await houses.createHouse(row); report.viviendas += 1; } catch (error) { report.fallidas.push({ hoja: "Viviendas", fila: row.fila, error: error.message }); }
  }
  for (const [kind, role, sheet] of [["residentes", "residente", "Residentes"], ["inquilinos", "inquilino", "Inquilinos"]]) {
    const idTipo = await typeId(role);
    for (const row of data[kind]) {
      if (statusOf(kind, row) !== "NUEVO") { report.omitidas += 1; continue; }
      try {
        const idCasa = await findHouseId(row.torre, row.numero);
        await users.createUser({ nombre: row.nombre, correo: row.correo, telefono: row.telefono, password: crypto.randomBytes(18).toString("base64url"), id_tipo_usuario: idTipo, id_casa: idCasa });
        report[kind] += 1;
        await invite(row.correo.toLowerCase());
      } catch (error) { report.fallidas.push({ hoja: sheet, fila: row.fila, error: error.message }); }
    }
  }
  if (data.saldos.length) {
    await query("INSERT INTO SERVICIO(nombre,tipo_servicio,descripcion) SELECT 'Saldo inicial','Residencial','Saldo pendiente al migrar al sistema' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM SERVICIO WHERE nombre='Saldo inicial')");
    const [service] = await query("SELECT id_servicio FROM SERVICIO WHERE nombre='Saldo inicial' LIMIT 1");
    const today = new Date().toISOString().slice(0, 10);
    for (const row of data.saldos) {
      const item = preview.saldos.find((entry) => entry.fila === row.fila);
      if (item?.estado !== "NUEVO") { report.omitidas += 1; continue; }
      try {
        const idCasa = await findHouseId(row.torre, row.numero);
        const [owner] = await query("SELECT u.id_usuario, u.nombre, u.correo FROM CASA c JOIN RESIDENTE r ON r.id_residente = c.id_residente JOIN USUARIO u ON u.id_usuario = r.id_usuario WHERE c.id_casa = ?", [idCasa]);
        await query(
          `INSERT INTO CUOTA (id_servicio, id_casa, monto, fecha_limite, origen, concepto_snapshot, id_responsable, responsable_snapshot, creado_en)
           VALUES (?, ?, ?, ?, 'HISTORICO', ?, ?, ?, UTC_TIMESTAMP())`,
          [service.id_servicio, idCasa, item.monto.toFixed(2), item.fecha_limite || today, (row.descripcion || "Saldo inicial").slice(0, 100), owner?.id_usuario ?? null, owner ? JSON.stringify({ id_usuario: owner.id_usuario, nombre: owner.nombre, correo: owner.correo }) : null],
        );
        report.saldos += 1;
      } catch (error) { report.fallidas.push({ hoja: "Saldos iniciales", fila: row.fila, error: error.message }); }
    }
  }
  return report;
}

module.exports = { SHEETS, buildTemplate, readWorkbook, previewImport, applyImport };
