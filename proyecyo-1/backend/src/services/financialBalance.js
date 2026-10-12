// PAGO contains applied accounting payments, never unconfirmed payment attempts.
// One allocation rule, evaluated in cents in JS and as exact DECIMAL expressions in SQL.
function allocate(principal, surcharge, paid, ops) {
  const surchargeApplied = ops.min(paid, surcharge);
  const principalApplied = ops.min(principal, ops.max(ops.sub(paid, surcharge), 0));
  const capital = ops.sub(principal, principalApplied);
  const recargos = ops.sub(surcharge, surchargeApplied);
  return { capital, recargos, saldo: ops.add(capital, recargos),
    sobrepago: ops.max(ops.sub(paid, ops.add(principal, surcharge)), 0) };
}

function toCents(value = 0) {
  const text = String(value ?? 0).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    throw Object.assign(new Error("Importe financiero invalido; se requieren centavos no negativos."), { code: "INVALID_FINANCIAL_AMOUNT" });
  }
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw Object.assign(new Error("Importe fuera de rango."), { code: "INVALID_FINANCIAL_AMOUNT" });
  return cents;
}

// Only for totals of already validated monetary values (floating point aggregation).
function toMoney(value) { return Math.round(Number(value ?? 0) * 100) / 100; }
function sumMoney(values) { return values.reduce((sum, value) => sum + toCents(value), 0) / 100; }
const arithmetic = { min: Math.min, max: Math.max, sub: (a, b) => a - b, add: (a, b) => a + b };
function calculateBalance({ monto = 0, recargo = 0, pagado = 0, reembolsado = 0, total_reembolsado }) {
  const principal = toCents(monto), surcharge = toCents(recargo), gross = toCents(pagado);
  const refunded = toCents(total_reembolsado ?? reembolsado);
  if (refunded > gross) throw Object.assign(new Error("Reembolsos superiores a los pagos; se requiere revisión."), { code: "INVALID_REFUND_AMOUNT" });
  const paid = gross - refunded;
  if (!Number.isSafeInteger(principal + surcharge)) throw new Error("Importe fuera de rango.");
  const allocated = allocate(principal, surcharge, paid, arithmetic);
  return {
    monto: principal / 100, recargo: surcharge / 100, pagado: gross / 100,
    cobrado_bruto: gross / 100, reembolsado: refunded / 100, abono_neto: paid / 100,
    total: (principal + surcharge) / 100, saldo: allocated.saldo / 100,
    capital_pendiente: allocated.capital / 100, recargo_pendiente: allocated.recargos / 100,
    sobrepago: allocated.sobrepago / 100, requiere_revision: allocated.sobrepago > 0,
  };
}
function balanceDetails(balance) {
  return { cobrado_bruto: balance.cobrado_bruto, reembolsado: balance.reembolsado, abono_neto: balance.abono_neto,
    capital_pendiente: balance.capital_pendiente, recargo_pendiente: balance.recargo_pendiente,
    sobrepago: balance.sobrepago, requiere_revision: balance.requiere_revision };
}
function assertCollectible(balance) {
  if (balance.requiere_revision) {
    throw Object.assign(new Error("Existe un sobrepago; la cuota requiere revision antes de cobrar."),
      { status: 409, code: "FINANCIAL_OVERPAYMENT" });
  }
}
const sqlOps = {
  min: (a, b) => `LEAST(${a}, ${b})`, max: (a, b) => `GREATEST(${a}, ${b})`,
  sub: (a, b) => `(${a} - ${b})`, add: (a, b) => `(${a} + ${b})`,
};
// Only provider-confirmed AND atomically applied refunds reduce historical credit.
// Never subtract pending reservations and never restrict this sum by movement dates.
const REFUND_TOTALS_SQL = `SELECT tr.id_cuota, CAST(SUM(rr.monto_centavos) / 100 AS DECIMAL(20,2)) AS total_reembolsado
  FROM REEMBOLSO_RECURRENTE rr JOIN TRANSACCION_RECURRENTE tr ON tr.id_transaccion=rr.id_transaccion
  JOIN PAGO_ORIGEN po ON po.id_pago=tr.id_pago AND po.origen='RECURRENTE' AND po.ambiente=rr.ambiente
  WHERE rr.estado='CONFIRMADO' AND rr.aplicado_en IS NOT NULL GROUP BY tr.id_cuota`;
function refundedQuotaSql(quotaExpression) {
  return `COALESCE((SELECT ref.total_reembolsado FROM (${REFUND_TOTALS_SQL}) ref WHERE ref.id_cuota=${quotaExpression}),0)`;
}
const netCredit = "GREATEST(totales.total_pagado - totales.total_reembolsado, 0)";
const expressions = allocate("totales.monto", "totales.recargo", netCredit, sqlOps);
// Date restrictions must be applied to movement lists, never to these sums.
const QUOTA_BALANCES_SQL = `
  SELECT totales.*, ${netCredit} AS abono_neto,
    GREATEST(totales.total_reembolsado-totales.total_pagado,0) AS reembolso_inconsistente,
    ${expressions.capital} AS capital_pendiente,
    ${expressions.recargos} AS recargo_pendiente,
    ${expressions.saldo} AS saldo_pendiente,
    ${expressions.sobrepago} AS sobrepago
  FROM (
    SELECT cu.id_cuota, cu.id_casa, cu.id_servicio, cu.monto, cu.fecha_limite,
      cu.id_responsable,cu.responsable_snapshot,cu.periodo,cu.concepto,cu.concepto_snapshot,
      COALESCE(rec.recargo, 0) AS recargo, COALESCE(pg.total_pagado, 0) AS total_pagado,
      pg.ultimo_pago, COALESCE(rf.total_reembolsado,0) AS total_reembolsado
    FROM CUOTA cu
    LEFT JOIN (SELECT id_cuota, SUM(monto_recargo) recargo FROM RECARGO_APLICADO GROUP BY id_cuota) rec
      ON rec.id_cuota = cu.id_cuota
    LEFT JOIN (SELECT id_cuota, SUM(monto_pagado) total_pagado, MAX(fecha_pago) ultimo_pago FROM PAGO GROUP BY id_cuota) pg
      ON pg.id_cuota = cu.id_cuota
    LEFT JOIN (${REFUND_TOTALS_SQL}) rf ON rf.id_cuota=cu.id_cuota
  ) totales`;

module.exports = { calculateBalance, balanceDetails, assertCollectible, toCents, toMoney, sumMoney,
  QUOTA_BALANCES_SQL, REFUND_TOTALS_SQL, refundedQuotaSql };
