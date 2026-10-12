const { calculateBalance, balanceDetails, toMoney, sumMoney } = require("./financialBalance");
const { QUOTA_STATUSES, getQuotaStatus: getSharedQuotaStatus } = require("./quotaStatus");
const { guatemalaToday } = require("../utils/guatemalaTime");

const ACCOUNT_STATUSES = QUOTA_STATUSES;
const getCurrentDateInTimezone = () => guatemalaToday();

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeDate(value) {
  const date = normalizeString(value);
  if (!date) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const error = new Error("La fecha debe tener formato YYYY-MM-DD.");
    error.status = 400;
    throw error;
  }
  return date;
}

function buildHouseLabel(row) {
  const tower = normalizeString(row.torre);
  const number = normalizeString(row.numero);

  return tower ? `${tower}-${number}` : number;
}

function isRentQuota(row) {
  const haystack = [row.servicio, row.tipo_servicio]
    .map((value) => normalizeString(value).toLowerCase())
    .join(" ");

  return ["alquiler", "renta", "arrendamiento"].some((keyword) => haystack.includes(keyword));
}

function getQuotaStatus(row, currentDate = getCurrentDateInTimezone()) {
  const { saldo } = calculateBalance({ ...row, pagado: row.total_pagado });
  return getSharedQuotaStatus({ saldo, fecha_limite: row.fecha_limite }, currentDate);
}

function mapQuota(row, currentDate = getCurrentDateInTimezone()) {
  const balance = calculateBalance({ ...row, pagado: row.total_pagado });

  return {
    id_cuota: row.id_cuota,
    id_casa: row.id_casa,
    casa_unidad: buildHouseLabel(row),
    servicio: row.servicio,
    tipo_servicio: row.tipo_servicio || "General",
    monto: balance.total,
    monto_base: balance.monto,
    recargo: balance.recargo,
    monto_pagado: balance.pagado,
    saldo_pendiente: balance.saldo,
    ...balanceDetails(balance),
    fecha_limite: row.fecha_limite,
    ultimo_pago: row.ultimo_pago || null,
    estado: getQuotaStatus(row, currentDate),
    es_alquiler: isRentQuota(row),
  };
}

function buildSummary(quotas, currentDate = getCurrentDateInTimezone()) {
  const pendingQuotas = quotas.filter((quota) => quota.estado !== ACCOUNT_STATUSES.PAID);
  const rentQuotas = quotas.filter((quota) => quota.es_alquiler);
  const additionalQuotas = quotas.filter((quota) => !quota.es_alquiler);
  const upcomingDueDates = pendingQuotas
    .filter((quota) => quota.fecha_limite >= currentDate)
    .map((quota) => quota.fecha_limite)
    .sort();

  return {
    total_cuotas: quotas.length,
    cuotas_pagadas: quotas.filter((quota) => quota.estado === ACCOUNT_STATUSES.PAID).length,
    cuotas_pendientes: quotas.filter((quota) => quota.estado === ACCOUNT_STATUSES.PENDING).length,
    cuotas_vencidas: quotas.filter((quota) => quota.estado === ACCOUNT_STATUSES.OVERDUE).length,
    saldo_pendiente: toMoney(
      pendingQuotas.reduce((total, quota) => total + quota.saldo_pendiente, 0),
    ),
    alquiler_pendiente: toMoney(
      rentQuotas.reduce((total, quota) => total + quota.saldo_pendiente, 0),
    ),
    cuotas_adicionales_pendientes: toMoney(
      additionalQuotas.reduce((total, quota) => total + quota.saldo_pendiente, 0),
    ),
    total_pagado: toMoney(quotas.reduce((total, quota) => total + quota.monto_pagado, 0)),
    total_reembolsado: sumMoney(quotas.map(q => q.reembolsado || 0)),
    abono_neto: sumMoney(quotas.map(q => q.abono_neto ?? q.monto_pagado)),
    sobrepago: sumMoney(quotas.map((quota) => quota.sobrepago || 0)),
    requiere_revision: quotas.some((quota) => quota.requiere_revision),
    proximo_vencimiento: upcomingDueDates[0] || null,
    actualizado_en: new Date().toISOString(),
  };
}

async function listTenantAccountStatement(userId, filters = {}) {
  return require('./contractFinancialAccount').account(userId, 'inquilino', filters);
}

module.exports = {
  listTenantAccountStatement,
  __private__: {
    ACCOUNT_STATUSES,
    buildHouseLabel,
    buildSummary,
    getQuotaStatus,
    isRentQuota,
    mapQuota,
    toMoney,
    normalizeDate,
  },
};
