const { query } = require('../database/mysql');
const { QUOTA_BALANCES_SQL } = require('./financialBalance');
const { quotaActorSql } = require('./paymentHistoricalActor');
const { ensureValidDate } = require('../utils/dateTimeValidation');

function period(input, today) {
  const result = {};
  for (const key of ['desde', 'hasta']) {
    const value = input[key];
    if (value !== undefined && typeof value !== 'string') {
      throw Object.assign(new Error('El período debe contener fechas únicas.'), { status: 400 });
    }
    result[key] = value ? ensureValidDate(value, key) : key === 'desde' ? `${today.slice(0, 7)}-01` : today;
  }
  if (result.desde > result.hasta || (Date.parse(result.hasta) - Date.parse(result.desde)) / 86400000 > 365) {
    throw Object.assign(new Error('Selecciona un rango ordenado de hasta 366 días.'), { status: 400 });
  }
  return result;
}

function localDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala' }).format(now);
}
function numbers(row = {}) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value ?? 0)]));
}

async function summary(input = {}, now = new Date()) {
  const today = localDate(now);
  const range = period(input, today);
  const [balances] = await query(`SELECT
    COALESCE(SUM(cu.saldo_pendiente),0) pendiente,
    COALESCE(SUM(cu.capital_pendiente),0) capital_pendiente,
    COALESCE(SUM(cu.recargo_pendiente),0) recargo_pendiente,
    COALESCE(SUM(IF(cu.fecha_limite < ?,cu.saldo_pendiente,0)),0) mora,
    COUNT(CASE WHEN cu.saldo_pendiente>0 THEN 1 END) cuotas_pendientes,
    COUNT(CASE WHEN cu.fecha_limite < ? AND cu.saldo_pendiente>0 THEN 1 END) cuotas_morosas,
    COUNT(DISTINCT CASE WHEN cu.fecha_limite < ? AND cu.saldo_pendiente>0 THEN ${quotaActorSql()} END) responsables_morosos,
    COUNT(CASE WHEN cu.fecha_limite < ? AND cu.saldo_pendiente>0 AND ${quotaActorSql()} IS NULL THEN 1 END) cuotas_sin_responsable,
    COALESCE(SUM(cu.sobrepago),0) sobrepago,
    COALESCE(SUM(cu.reembolso_inconsistente),0) reembolso_inconsistente
    FROM (${QUOTA_BALANCES_SQL}) cu`, [today, today, today, today]);
  const [movements] = await query(`SELECT
    (SELECT COALESCE(SUM(monto_pagado),0) FROM PAGO WHERE fecha_pago BETWEEN ? AND ?) cobrado,
    (SELECT COUNT(*) FROM PAGO WHERE fecha_pago BETWEEN ? AND ?) cantidad_pagos,
    (SELECT COALESCE(SUM(rr.monto_centavos),0)/100 FROM REEMBOLSO_RECURRENTE rr
      JOIN TRANSACCION_RECURRENTE tr ON tr.id_transaccion=rr.id_transaccion
      JOIN PAGO_ORIGEN po ON po.id_pago=tr.id_pago AND po.origen='RECURRENTE' AND po.ambiente=rr.ambiente
      WHERE rr.estado='CONFIRMADO' AND rr.aplicado_en IS NOT NULL
      AND rr.fecha_contable BETWEEN ? AND ?) devuelto`,
    [range.desde, range.hasta, range.desde, range.hasta, range.desde, range.hasta]);
  const totals = numbers(movements);
  totals.neto = (Math.round(totals.cobrado * 100) - Math.round(totals.devuelto * 100)) / 100;
  const [surcharges] = await query(`SELECT COALESCE(SUM(monto_recargo),0) registrado, COUNT(*) cantidad
    FROM RECARGO_APLICADO WHERE fecha_aplicacion BETWEEN ? AND ?`, [range.desde, range.hasta]);
  const concepts = await query(`SELECT COALESCE(cu.concepto,'LEGADO') concepto,
    COALESCE(SUM(cu.capital_pendiente),0) capital, COALESCE(SUM(cu.recargo_pendiente),0) recargo,
    COALESCE(SUM(cu.saldo_pendiente),0) pendiente, COUNT(*) cuotas
    FROM (${QUOTA_BALANCES_SQL}) cu WHERE cu.saldo_pendiente>0
    GROUP BY COALESCE(cu.concepto,'LEGADO') ORDER BY pendiente DESC, concepto`);
  return { fecha_corte: today, periodo: range, saldos: numbers(balances), movimientos: totals,
    recargos: numbers(surcharges), conceptos: concepts.map(({ concepto, ...amounts }) => ({ concepto, ...numbers(amounts) })) };
}

module.exports = { summary, localDate, period };
