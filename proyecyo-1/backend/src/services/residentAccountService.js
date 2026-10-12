const { query } = require("../database/mysql");
const { calculateBalance, balanceDetails, toMoney, sumMoney, refundedQuotaSql } = require("./financialBalance");
const { QUOTA_STATUSES, getQuotaStatus: getSharedQuotaStatus } = require("./quotaStatus");
const { guatemalaToday } = require("../utils/guatemalaTime");

const ACCOUNT_STATUSES = QUOTA_STATUSES;
const getCurrentDateInTimezone = () => guatemalaToday();

function buildHouseLabel(row) {
  const tower = String(row.torre || "").trim();
  const number = String(row.numero || "").trim();

  return tower ? `${tower}-${number}` : number;
}

function getQuotaStatus(row, currentDate = getCurrentDateInTimezone()) {
  const { saldo } = calculateBalance({ ...row, pagado: row.total_pagado });
  return getSharedQuotaStatus({ saldo, fecha_limite: row.fecha_limite }, currentDate);
}

function mapQuota(row, currentDate = getCurrentDateInTimezone()) {
  const balance = calculateBalance({ ...row, pagado: row.total_pagado });
  const status = getQuotaStatus(row, currentDate);

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
    estado: status,
  };
}

function buildSummary(quotas, currentDate = getCurrentDateInTimezone()) {
  const pendingQuotas = quotas.filter((quota) => quota.estado !== ACCOUNT_STATUSES.PAID);
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
    total_pagado: toMoney(quotas.reduce((total, quota) => total + quota.monto_pagado, 0)),
    total_reembolsado: sumMoney(quotas.map(q => q.reembolsado || 0)),
    abono_neto: sumMoney(quotas.map(q => q.abono_neto ?? q.monto_pagado)),
    sobrepago: sumMoney(quotas.map((quota) => quota.sobrepago || 0)),
    requiere_revision: quotas.some((quota) => quota.requiere_revision),
    proximo_vencimiento: upcomingDueDates[0] || null,
    actualizado_en: new Date().toISOString(),
  };
}

async function listResidentAccountStatement(userId) {
  const contractual = await require('./contractFinancialAccount').account(userId,'residente');
  if (contractual) return {resumen:contractual.resumen,cuotas:contractual.cuotas};
  const currentDate = getCurrentDateInTimezone();
  const rows = await query(
    `
      SELECT
        cu.id_cuota,
        cu.id_casa,
        cu.monto,
        DATE_FORMAT(cu.fecha_limite, '%Y-%m-%d') AS fecha_limite,
        c.numero,
        c.torre,
        srv.nombre AS servicio,
        srv.tipo_servicio,
        COALESCE(MAX(rec.monto_recargo), 0) AS recargo,
        COALESCE(SUM(p.monto_pagado), 0) AS total_pagado,
        ${refundedQuotaSql("cu.id_cuota")} AS total_reembolsado,
        DATE_FORMAT(MAX(p.fecha_pago), '%Y-%m-%d') AS ultimo_pago
      FROM CUOTA cu
      INNER JOIN CASA c
        ON c.id_casa = cu.id_casa
      INNER JOIN RESIDENTE r
        ON r.id_residente = c.id_residente
      INNER JOIN SERVICIO srv
        ON srv.id_servicio = cu.id_servicio
      LEFT JOIN PAGO p
        ON p.id_cuota = cu.id_cuota
      LEFT JOIN RECARGO_APLICADO rec
        ON rec.id_cuota = cu.id_cuota
      WHERE r.id_usuario = ? AND c.relaciones_confirmadas_en IS NULL
        AND LOWER(COALESCE(srv.tipo_servicio, '')) <> 'alquiler'
        AND LOWER(srv.nombre) NOT LIKE '%alquiler%'
        AND LOWER(srv.nombre) NOT LIKE '%renta%'
      GROUP BY
        cu.id_cuota,
        cu.id_casa,
        cu.monto,
        cu.fecha_limite,
        c.numero,
        c.torre,
        srv.nombre,
        srv.tipo_servicio
      ORDER BY cu.fecha_limite ASC, cu.id_cuota ASC
    `,
    [userId],
  );

  const quotas = rows.map((row) => mapQuota(row, currentDate));

  return {
    resumen: buildSummary(quotas, currentDate),
    cuotas: quotas,
  };
}

module.exports = {
  listResidentAccountStatement,
  __private__: {
    ACCOUNT_STATUSES,
    buildHouseLabel,
    buildSummary,
    getQuotaStatus,
    mapQuota,
    toMoney,
  },
};
