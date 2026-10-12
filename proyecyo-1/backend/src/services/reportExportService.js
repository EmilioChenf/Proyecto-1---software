const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");
const db = require("../database/mysql");
const { QUOTA_BALANCES_SQL } = require("./financialBalance");
const accesses = require("./adminAccessesService");
const { ensureValidDate } = require("../utils/dateTimeValidation");

const TIMEZONE = "America/Guatemala";
const MAX_ROWS = 10000;
const REPORTS = {
  accesos: { title: "Accesos", columns: { fecha: "Fecha", hora: "Ingreso / inicio", hora_salida: "Salida", nombre: "Nombre", casa_unidad: "Unidad", placa: "Placa", tipo: "Tipo", estado: "Estado", autorizado_por: "Autorizado por" } },
  reservas: { title: "Reservas", columns: { fecha: "Fecha", hora_inicio: "Inicio", hora_fin: "Fin", usuario: "Usuario", amenidad: "Amenidad", estado: "Estado" }, sql: `
    SELECT DATE_FORMAT(r.fecha, '%Y-%m-%d') fecha,
      TIME_FORMAT(r.hora_inicio, '%H:%i:%s') hora_inicio, TIME_FORMAT(r.hora_fin, '%H:%i:%s') hora_fin,
      u.nombre usuario, am.nombre amenidad, r.estado
    FROM RESERVA r JOIN USUARIO u ON u.id_usuario=r.id_usuario
    JOIN AMENIDAD am ON am.id_amenidad=r.id_amenidad` },
  morosos: { title: "Morosos", columns: { fecha: "Vencimiento", residente: "Residente", unidad: "Unidad", monto: "Saldo pendiente (Q)" }, sql: `
    SELECT DATE_FORMAT(cu.fecha_limite, '%Y-%m-%d') fecha,
      COALESCE(JSON_UNQUOTE(JSON_EXTRACT(cu.responsable_snapshot,'$.nombre')),u.nombre,'Responsable pendiente de confirmar') residente,
      CONCAT_WS('-', NULLIF(c.torre, ''), c.numero) unidad,
      cu.saldo_pendiente monto
    FROM (${QUOTA_BALANCES_SQL}) cu JOIN CASA c ON c.id_casa=cu.id_casa
    LEFT JOIN RESIDENTE r ON r.id_residente=c.id_residente
    LEFT JOIN USUARIO u ON u.id_usuario=cu.id_responsable OR (cu.id_responsable IS NULL AND c.relaciones_confirmadas_en IS NULL AND u.id_usuario=r.id_usuario)
    WHERE cu.fecha_limite < ? AND cu.saldo_pendiente > 0` },
  sanciones: { title: "Sanciones", columns: { fecha: "Fecha", hora: "Hora", residente: "Residente", motivo: "Motivo", monto: "Monto (Q)", estado: "Estado" }, sql: `
    SELECT DATE_FORMAT(s.fecha_generacion, '%Y-%m-%d') fecha,
      DATE_FORMAT(s.fecha_generacion, '%H:%i:%s') hora, COALESCE(JSON_UNQUOTE(JSON_EXTRACT(cu.responsable_snapshot,'$.nombre')),u.nombre,'Responsable pendiente de confirmar') residente, s.motivo, s.monto, s.estado
    FROM SANCION s JOIN CASA c ON c.id_casa=s.id_casa
    LEFT JOIN CUOTA cu ON cu.id_cuota=s.id_cuota
    LEFT JOIN RESIDENTE r ON r.id_residente=c.id_residente
    LEFT JOIN USUARIO u ON u.id_usuario=cu.id_responsable OR (cu.id_responsable IS NULL AND c.relaciones_confirmadas_en IS NULL AND u.id_usuario=r.id_usuario)` },
};
const invalid = message => Object.assign(new Error(message), { status: 400 });
function validate(type, format) {
  if (typeof type !== "string" || !Object.hasOwn(REPORTS, type)) throw invalid("Reporte inválido.");
  if (!["pdf", "xlsx"].includes(format)) throw invalid("Formato inválido.");
  return { type, format };
}
function validateFilters(input = {}, type) {
  const result = {};
  for (const key of ["desde", "hasta"]) {
    if (input[key] != null && typeof input[key] !== "string") throw invalid("Fecha de reporte inválida.");
    result[key] = input[key] ? ensureValidDate(input[key], key) : "";
  }
  if (result.desde && result.hasta && result.desde > result.hasta) throw invalid("El rango del reporte es inválido.");
  for (const key of ["search", "house", "plate", "type", "status", "vista"]) {
    if (input[key] == null || input[key] === "") continue;
    if (type !== "accesos") throw invalid("Estos filtros solo se permiten en accesos.");
    if (typeof input[key] !== "string" || input[key].length > 150) throw invalid("Filtro de reporte inválido.");
    result[key] = input[key].trim();
  }
  for (const [key, allowed] of Object.entries({ type: ["TODOS", "RESIDENTE", "VISITANTE", "PROVEEDOR"], status: ["TODOS", "APROBADO", "PENDIENTE", "RECHAZADO"], vista: ["hoy"] })) {
    if (result[key] && !allowed.includes(result[key])) throw invalid("Filtro de reporte inválido.");
  }
  return result;
}
function localTimestamp(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
function safe(value) {
  const text = String(value ?? "");
  return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
}
async function rows(type, input = {}, now = new Date()) {
  validate(type, "pdf");
  const filters = validateFilters(input, type);
  let data;
  if (type === "accesos") {
    data = await accesses.listAdminAccesses(filters, filters);
  } else {
    const clauses = [], params = type === "morosos" ? [localTimestamp(now).slice(0, 10)] : [];
    // Delinquency is current debt, not a period movement. Date ranges must never
    // hide outstanding quotas or restrict the payments used to calculate their balance.
    if (type !== "morosos" && filters.desde) { clauses.push("reporte.fecha >= ?"); params.push(filters.desde); }
    if (type !== "morosos" && filters.hasta) { clauses.push("reporte.fecha <= ?"); params.push(filters.hasta); }
    data = await db.query(`SELECT * FROM (${REPORTS[type].sql}) reporte
      ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY reporte.fecha DESC LIMIT ${MAX_ROWS + 1}`, params);
  }
  if (data.length > MAX_ROWS) throw invalid(`El reporte supera ${MAX_ROWS} registros. Reduzca el período para exportarlo completo.`);
  return data;
}
function display(key, value) {
  if (value == null || value === "") return "-";
  if (key === "fecha" && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value).split("-").reverse().join("/");
  if (key === "monto") return Number(value).toFixed(2);
  return String(value);
}
function metadata(type, data, user, filters, now) {
  validate(type, "pdf");
  const details = type === "morosos"
    ? ["Saldo real actual de todas las cuotas vencidas. Las fechas del formulario solo filtran movimientos; no limitan este listado de deuda."]
    : [`Período: ${filters.desde ? display("fecha", filters.desde) : "Sin límite inicial"} a ${filters.hasta ? display("fecha", filters.hasta) : "Sin límite final"}`];
  const labels = { search: "Búsqueda", house: "Unidad", plate: "Placa", type: "Tipo", status: "Estado" };
  for (const [key, label] of Object.entries(labels)) if (filters[key] && filters[key] !== "TODOS") details.push(`${label}: ${filters[key]}`);
  return [`NexusResidencial - Reporte de ${REPORTS[type].title}`, `Generado: ${localTimestamp(now)} (${TIMEZONE}) | Usuario: ${user}`, ...details, `Total de registros: ${data.length}`];
}
async function excel(type, data, user, filters = {}, now = new Date()) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Reporte");
  const info = metadata(type, data, user, filters, now);
  const columns = Object.entries(REPORTS[type].columns);
  info.forEach(line => { const row = sheet.addRow([safe(line)]); sheet.mergeCells(row.number, 1, row.number, columns.length); });
  sheet.getRow(1).font = { bold: true, size: 16, color: { argb: "FF1E3A5F" } };
  const header = sheet.addRow(columns.map(([, label]) => label));
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
  for (const record of data) sheet.addRow(columns.map(([key]) => key === "monto" && record[key] != null ? Number(record[key]) : safe(display(key, record[key]))));
  if (!data.length) sheet.addRow(["Sin datos para los filtros seleccionados."]);
  columns.forEach(([key], index) => { sheet.getColumn(index + 1).width = 24; if (key === "monto") sheet.getColumn(index + 1).numFmt = '#,##0.00'; });
  sheet.eachRow(row => {
    row.alignment = { vertical: "top", wrapText: true };
    let lines = 1;
    row.eachCell(cell => {
      const charactersPerLine = row.number <= info.length ? 22 * columns.length : 22;
      lines = Math.max(lines, String(cell.value ?? "").split("\n").reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0));
    });
    row.height = Math.min(409, Math.max(30, lines * 15 + 8));
  });
  sheet.views = [{ state: "frozen", ySplit: header.number }];
  if (data.length) sheet.autoFilter = { from: { row: header.number, column: 1 }, to: { row: header.number + data.length, column: columns.length } };
  sheet.pageSetup = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  sheet.pageSetup.printTitlesRow = `${header.number}:${header.number}`;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
function pdf(type, data, user, filters = {}, now = new Date()) {
  const info = metadata(type, data, user, filters, now);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, bufferPages: true });
    const chunks = [];
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const columns = Object.entries(REPORTS[type].columns), width = doc.page.width - 72, cellWidth = width / columns.length;
    let y;
    function header() {
      doc.fillColor("#1e3a5f").font("Helvetica-Bold").fontSize(17).text(info[0], 36, 30);
      doc.fillColor("#334155").font("Helvetica").fontSize(9);
      info.slice(1).forEach(line => doc.text(line, { width }));
      y = doc.y + 12;
      doc.rect(36, y, width, 30).fill("#1e3a5f");
      doc.font("Helvetica-Bold").fontSize(9).fillColor("white");
      columns.forEach(([, label], i) => doc.text(label, 42 + i * cellWidth, y + 7, { width: cellWidth - 12, lineBreak: false }));
      y += 30;
      doc.font("Helvetica").fontSize(9).fillColor("#0f172a");
    }
    // Wrap explicitly so even a long unbroken value can continue on the next page.
    function lines(value) {
      const result = [];
      for (const paragraph of value.split(/\r?\n/)) {
        let line = "";
        for (const char of paragraph) {
          if (line && doc.widthOfString(line + char) > cellWidth - 12) {
            const space = line.lastIndexOf(" ");
            if (space > 0) { result.push(line.slice(0, space)); line = line.slice(space + 1); }
            else { result.push(line); line = ""; }
          }
          line += char;
        }
        result.push(line);
      }
      return result;
    }
    header();
    if (!data.length) doc.text("Sin datos para los filtros seleccionados.", 36, y + 14);
    data.forEach((record, rowIndex) => {
      const cells = columns.map(([key]) => lines(display(key, record[key])));
      const count = Math.max(...cells.map(cell => cell.length));
      let offset = 0;
      while (offset < count) {
        let available = Math.floor((doc.page.height - 60 - y - 12) / 12);
        if (available < 1) { doc.addPage(); header(); available = Math.floor((doc.page.height - 60 - y - 12) / 12); }
        const take = Math.min(count - offset, available), height = take * 12 + 12;
        doc.rect(36, y, width, height).fill(rowIndex % 2 ? "#f1f5f9" : "#ffffff");
        doc.fillColor("#0f172a");
        cells.forEach((cell, i) => cell.slice(offset, offset + take).forEach((line, j) => doc.text(line, 42 + i * cellWidth, y + 6 + j * 12, { lineBreak: false })));
        y += height;
        offset += take;
      }
    });
    const pages = doc.bufferedPageRange();
    for (let page = 0; page < pages.count; page++) {
      doc.switchToPage(page);
      doc.fontSize(8).fillColor("#64748b").text(`NexusResidencial | Página ${page + 1} de ${pages.count}`, 36, doc.page.height - 30, { lineBreak: false });
    }
    doc.end();
  });
}
module.exports = { validate, validateFilters, safe, rows, excel, pdf, localTimestamp, display };
