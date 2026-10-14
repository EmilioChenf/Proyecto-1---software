const { query } = require('../database/mysql');
const { QUOTA_BALANCES_SQL } = require('./financialBalance');
const { quotaActorSql } = require('./paymentHistoricalActor');

function localDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala' }).format(now);
}
function numbers(row = {}) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value ?? 0)]));
}

async function summary(input = {}, now = new Date()) {
  const today = localDate(now);
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
  return { fecha_corte: today, saldos: numbers(balances) };
}

module.exports = { summary, localDate };
