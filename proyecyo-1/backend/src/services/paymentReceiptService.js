const PDFDocument = require("pdfkit");
const { query } = require("../database/mysql");
const { HISTORICAL_SUCCESS } = require("./recurrenteRefundContract");
const { toCents } = require("./financialBalance");
const { paymentActorSql, paymentAccessSql, paymentNameSql } = require('./paymentHistoricalActor');

function receiptError(code, status, message) {
  return Object.assign(new Error(message), { code, status });
}
function notConfirmed() {
  return receiptError("RECEIPT_NOT_CONFIRMED", 409, "No existe una aplicación financiera confirmada para emitir este comprobante.");
}

function normalizePaymentId(value) {
  const id = Number(value);
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(id) || id <= 0 || id > 2147483647) {
    const error = new Error("El identificador del pago es invalido.");
    error.status = 400;
    throw error;
  }
  return id;
}

function paymentReference(id) {
  return `NXR-${String(id).padStart(8, "0")}`;
}

async function receiptRows(userId, role, paymentId) {
  const rows = await query(
    `SELECT pg.id_pago, pg.id_cuota, pg.monto_pagado,
            DATE_FORMAT(pg.fecha_pago, '%Y-%m-%d') AS fecha_pago,
            COALESCE(cu.concepto_snapshot,srv.nombre) AS servicio, cu.monto AS monto_cuota,
            DATE_FORMAT(cu.periodo,'%Y-%m') periodo,cu.concepto,
            DATE_FORMAT(cu.fecha_limite, '%Y-%m-%d') AS fecha_limite,
            ${paymentNameSql()} AS titular_nombre,
            COALESCE(JSON_UNQUOTE(JSON_EXTRACT(pg.titular_snapshot,'$.correo')),historico.correo) AS titular_correo,
            c.numero, c.torre, c.id_casa,
            origen.origen AS pago_origen, origen.ambiente AS pago_ambiente,
            tr.id_transaccion, tr.id_pago AS transaccion_pago, tr.id_cuota AS transaccion_cuota,
            tr.id_casa AS transaccion_casa, tr.id_usuario AS transaccion_usuario,
            tr.id_checkout AS transaccion_checkout, tr.estado AS transaccion_estado,
            tr.monto_centavos, tr.moneda, tr.ambiente AS transaccion_ambiente,
            tr.id_externo AS referencia_transaccion, tr.id_pago_externo AS referencia_pago_externa,
            tr.confirmado_en, tr.capital_aplicado_centavos, tr.recargo_aplicado_centavos,
            co.id_checkout, co.id_cuota AS checkout_cuota, co.id_casa AS checkout_casa,
            co.id_usuario AS checkout_usuario, co.estado AS checkout_estado,
            COALESCE((SELECT SUM(rr.monto_centavos) FROM REEMBOLSO_RECURRENTE rr WHERE rr.id_transaccion=tr.id_transaccion AND rr.estado='CONFIRMADO' AND rr.aplicado_en IS NOT NULL),0) devuelto_centavos,
            co.estado_proveedor, co.monto_centavos AS checkout_monto,
            co.moneda AS checkout_moneda, co.ambiente AS checkout_ambiente
       FROM PAGO pg
       INNER JOIN CUOTA cu ON cu.id_cuota = pg.id_cuota
       INNER JOIN SERVICIO srv ON srv.id_servicio = cu.id_servicio
       INNER JOIN CASA c ON c.id_casa = cu.id_casa
       INNER JOIN USUARIO usuario ON usuario.id_usuario = ?
       LEFT JOIN USUARIO historico ON historico.id_usuario=${paymentActorSql()}
       LEFT JOIN PAGO_ORIGEN origen ON origen.id_pago = pg.id_pago
       LEFT JOIN TRANSACCION_RECURRENTE tr ON tr.id_pago = pg.id_pago
       LEFT JOIN CHECKOUT_RECURRENTE co ON co.id_checkout = tr.id_checkout
       LEFT JOIN TRANSACCION_SIMULADA sim ON sim.id_pago=pg.id_pago
      WHERE ${paymentAccessSql('pg','cu','usuario.id_usuario')}
      AND ${paymentId == null ? "origen.origen='RECURRENTE' AND tr.estado IN ('CONFIRMADA','REEMBOLSADA_PARCIAL','REEMBOLSADA') ORDER BY pg.fecha_pago DESC, pg.id_pago DESC" : "pg.id_pago = ? LIMIT 1"}`,
    paymentId == null ? [userId] : [userId, paymentId],
  );
  return rows;
}

async function getPaymentReceipt(userId, role, paymentIdInput) {
  if (!["residente", "inquilino"].includes(role)) throw receiptError("RECEIPT_FORBIDDEN", 403, "No tienes permiso para consultar este comprobante.");
  const rows = await receiptRows(userId, role, normalizePaymentId(paymentIdInput));
  if (!rows[0]) {
    const error = new Error("No se encontro el pago solicitado para este usuario.");
    error.status = 404;
    throw error;
  }
  return mapReceipt(rows[0]);
}

function mapReceipt(row) {
  const payment = {
    id_pago: Number(row.id_pago), id_cuota: Number(row.id_cuota),
    numero_comprobante: paymentReference(row.id_pago), servicio: row.servicio,
    periodo:row.periodo||null,concepto:row.concepto||null,
    monto_pagado: Number(row.monto_pagado || 0), monto_cuota: Number(row.monto_cuota || 0),
    fecha_pago: row.fecha_pago, fecha_limite: row.fecha_limite,
    titular_nombre: row.titular_nombre, titular_correo: row.titular_correo,
    unidad: row.torre ? `${row.torre}-${row.numero}` : row.numero,
  };
  if (row.pago_origen === "RECURRENTE" || row.id_transaccion != null) {
    if (!confirmedRelationship(row)) throw notConfirmed();
    // Explicit allowlist: no credentials, signatures, checkout URLs or raw payloads.
    const { titular_correo, ...publicPayment } = payment;
    return { ...publicPayment, estado: "CONFIRMADO", moneda: "GTQ", proveedor: "Recurrente",
      reembolsado: Number(row.devuelto_centavos || 0) / 100, abono_neto: (Number(row.monto_centavos) - Number(row.devuelto_centavos || 0)) / 100,
      estado_transaccion: row.transaccion_estado, reembolso_posterior: Number(row.devuelto_centavos || 0) > 0,
      origen: "RECURRENTE", ambiente: row.pago_ambiente, id_transaccion: Number(row.id_transaccion),
      id_checkout: Number(row.id_checkout), referencia_transaccion: row.referencia_transaccion,
      referencia_pago_externa: row.referencia_pago_externa || null };
  }
  return { ...payment, estado: "APLICADO", moneda: "GTQ",
    proveedor: row.pago_origen === "SIMULADO" ? "Simulado" : "Histórico",
    origen: row.pago_origen || "HISTORICO", ambiente: row.pago_ambiente || "historical" };
}

function confirmedRelationship(row) {
  try {
    const equal = (a, b) => a != null && b != null && Number(a) === Number(b);
    const positiveId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
    const cents = Number(row.monto_centavos), capital = Number(row.capital_aplicado_centavos), surcharge = Number(row.recargo_aplicado_centavos);
    return row.pago_origen === "RECURRENTE" && ["sandbox", "production"].includes(row.pago_ambiente)
      && Number(row.devuelto_centavos || 0) >= 0 && Number(row.devuelto_centavos || 0) <= Number(row.monto_centavos)
      && positiveId(row.id_transaccion) && positiveId(row.id_checkout)
      && HISTORICAL_SUCCESS.includes(row.transaccion_estado) && !!row.confirmado_en
      && row.checkout_estado === "CONFIRMADO" && row.estado_proveedor === "paid"
      && equal(row.transaccion_pago, row.id_pago) && equal(row.transaccion_cuota, row.id_cuota)
      && equal(row.checkout_cuota, row.id_cuota) && equal(row.transaccion_casa, row.id_casa)
      && equal(row.checkout_casa, row.id_casa) && equal(row.transaccion_checkout, row.id_checkout)
      && equal(row.transaccion_usuario, row.checkout_usuario)
      && row.transaccion_ambiente === row.pago_ambiente && row.checkout_ambiente === row.pago_ambiente
      && row.moneda === "GTQ" && row.checkout_moneda === "GTQ"
      && Number.isSafeInteger(cents) && cents > 0 && cents === toCents(row.monto_pagado)
      && cents === Number(row.checkout_monto) && row.capital_aplicado_centavos != null && row.recargo_aplicado_centavos != null
      && Number.isSafeInteger(capital) && capital >= 0 && Number.isSafeInteger(surcharge) && surcharge >= 0
      && capital + surcharge === cents && /^\d{4}-\d{2}-\d{2}$/.test(row.fecha_pago)
      && /^in_[A-Za-z0-9_-]{1,188}$/.test(row.referencia_transaccion)
      && (row.referencia_pago_externa == null || /^pa_[A-Za-z0-9_-]{1,188}$/.test(row.referencia_pago_externa));
  } catch { return false; }
}

async function getResidentTransactionReceipt(userId, transactionIdInput) {
  const transactionId = normalizePaymentId(transactionIdInput);
  const rows = await query(`SELECT tr.id_pago, tr.estado FROM TRANSACCION_RECURRENTE tr
    INNER JOIN CUOTA cu ON cu.id_cuota=tr.id_cuota AND cu.id_casa=tr.id_casa
    INNER JOIN CASA ca ON ca.id_casa=cu.id_casa
    WHERE tr.id_usuario=? AND tr.id_transaccion=? LIMIT 1`, [userId, transactionId]);
  if (!rows[0]) throw receiptError("RECEIPT_NOT_FOUND", 404, "No se encontró el comprobante solicitado para este usuario.");
  if (!HISTORICAL_SUCCESS.includes(rows[0].estado) || !rows[0].id_pago) throw notConfirmed();
  return getPaymentReceipt(userId, "residente", rows[0].id_pago);
}

async function listResidentRecurrenteReceipts(userId) {
  // Candidates are local accounting payments only; apply exactly the same eligibility
  // validation as JSON/PDF, so no attempt or checkout becomes a receipt in the UI.
  const candidates = await receiptRows(userId, "residente", null);
  const receipts = [];
  for (const row of candidates) {
    try { receipts.push(mapReceipt(row)); }
    catch (error) { if (![404, 409].includes(error.status)) throw error; }
  }
  return receipts;
}

function createPaymentReceiptPdf(payment) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 52, info: {
      Title: `Comprobante ${payment.numero_comprobante}`, Author: "Nexus Residencial",
    } });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.rect(0, 0, doc.page.width, 112).fill("#0f172a");
    doc.font("Helvetica-Bold").fontSize(21).fillColor("#ffffff").text("NEXUS RESIDENCIAL", 52, 40);
    doc.font("Helvetica").fontSize(10).text("Comprobante de pago", 52, 72);
    if (payment.ambiente === "sandbox") {
      doc.rect(52, 126, 508, 26).fill("#fef3c7");
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#92400e").text("SANDBOX / PRUEBA", 62, 133);
    }
    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(15).text(payment.estado === "CONFIRMADO" ? "PAGO CONFIRMADO" : "PAGO APLICADO", 52, 169);
    const rows = [
      ["Comprobante", payment.numero_comprobante], ["Concepto", payment.servicio],
      ["Fecha", payment.fecha_pago], ["Monto pagado", `Q${payment.monto_pagado.toFixed(2)}`],
      ["Residente / titular", payment.titular_nombre], ["Unidad", payment.unidad],
      ["Moneda", payment.moneda || "GTQ"], ["Estado", payment.estado === "CONFIRMADO" ? "Confirmado" : "Aplicado"],
      ["Proveedor", payment.proveedor || "Histórico"],
    ];
    if(payment.periodo)rows.push(['Período',payment.periodo]);
    if(payment.concepto)rows.push(['Concepto contractual',payment.concepto]);
    if (payment.reembolso_posterior) rows.push(["Reembolso posterior", "Reembolsado"], ["Monto devuelto", `Q${payment.reembolsado.toFixed(2)}`], ["Abono neto actual", `Q${payment.abono_neto.toFixed(2)}`]);
    if (payment.origen === "RECURRENTE") rows.push(["Transacción externa", payment.referencia_transaccion],
      ["Referencia interna", `Pago ${payment.id_pago} · Transacción ${payment.id_transaccion} · Checkout ${payment.id_checkout}`]);
    else if (payment.titular_correo) rows.push(["Correo", payment.titular_correo]);
    let y = 213;
    rows.forEach(([label, value]) => {
      const text = String(value || "");
      doc.font("Helvetica-Bold").fontSize(10);
      const height = Math.max(34, doc.heightOfString(text, { width: 315 }) + 10);
      if (y + height > 710) { doc.addPage(); y = 60; }
      doc.font("Helvetica").fontSize(10).fillColor("#64748b").text(label, 58, y);
      doc.font("Helvetica-Bold").fillColor("#0f172a").text(text, 220, y, { width: 315, align: "right" });
      y += height;
    });
    doc.font("Helvetica").fontSize(8).fillColor("#64748b").text("Documento generado por NexusResidencial.", 58, Math.max(650, y + 12), { width: 480, align: "center" });
    doc.end();
  });
}

module.exports = { getPaymentReceipt, getResidentTransactionReceipt, listResidentRecurrenteReceipts,
  createPaymentReceiptPdf, paymentReference, __private__: { normalizePaymentId, confirmedRelationship } };
