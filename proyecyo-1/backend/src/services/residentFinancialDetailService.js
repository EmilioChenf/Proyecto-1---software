const { query } = require("../database/mysql");
const { calculateBalance, balanceDetails, sumMoney, refundedQuotaSql } = require("./financialBalance");
const { getQuotaStatus, isPartiallyPaid } = require("./quotaStatus");
const { guatemalaToday } = require("../utils/guatemalaTime");

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeDate(value) {
  const normalized = normalizeString(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

// HU32: el estado usa la misma regla que "Mis pagos" (quotaStatus). Antes este
// detalle ignoraba la fecha limite y una cuota vencida aparecia como "Pendiente".
function mapCharge(row, today = guatemalaToday()) {
  const balance = calculateBalance(row);
  const { monto, pagado, recargo } = balance;

  return {
    id_cuota: Number(row.id_cuota),
    servicio: row.servicio,
    monto,
    pagado,
    recargo,
    saldo: balance.saldo,
    ...balanceDetails(balance),
    fecha_limite: row.fecha_limite,
    estado: getQuotaStatus({ saldo: balance.saldo, fecha_limite: row.fecha_limite }, today),
    pago_parcial: isPartiallyPaid(balance),
  };
}

function mapSurcharge(row) {
  return {
    id_recargo: Number(row.id_recargo),
    id_cuota: Number(row.id_cuota),
    servicio: row.servicio,
    tipo_regla: row.tipo_regla,
    monto_original: Number(row.monto_original || 0),
    monto_recargo: Number(row.monto_recargo || 0),
    fecha_aplicacion: row.fecha_aplicacion,
  };
}

function mapPayment(row) {
  return {
    id_pago: Number(row.id_pago),
    id_cuota: Number(row.id_cuota),
    servicio: row.servicio,
    monto_pagado: Number(row.monto_pagado || 0),
    fecha_pago: row.fecha_pago,
    numero_comprobante: `NXR-${String(row.id_pago).padStart(8, "0")}`,
  };
}

async function getResidentHouse(userId) {
  const rows = await query(
    `
      SELECT c.id_casa,
             c.numero,
             c.torre
      FROM CASA c
      INNER JOIN RESIDENTE r ON r.id_residente = c.id_residente
      WHERE r.id_usuario = ? AND c.relaciones_confirmadas_en IS NULL
      LIMIT 1
    `,
    [userId],
  );

  if (!rows[0]) {
    const error = new Error("No se encontro una unidad asociada a este residente.");
    error.status = 404;
    throw error;
  }

  return rows[0];
}

// HU32: misma politica de visibilidad que "Mis pagos" (residentAccountService) y los
// avisos de deuda HU19: el alquiler pertenece al inquilino y no es una obligacion
// del propietario. Solo filtra lo que se muestra; no altera calculos ni historicos.
const OWNER_VISIBLE_SERVICE_SQL = `LOWER(COALESCE(srv.tipo_servicio, '')) <> 'alquiler'
        AND LOWER(srv.nombre) NOT LIKE '%alquiler%'
        AND LOWER(srv.nombre) NOT LIKE '%renta%'`;

async function getFinancialDetail(userId, filters = {}) {
  const contractual = await require('./contractFinancialAccount').detail(userId,filters);
  if (contractual) return contractual;
  const desde = normalizeDate(filters.desde);
  const hasta = normalizeDate(filters.hasta);
  const house = await getResidentHouse(userId);

  const chargeFilters = ["cu.id_casa = ?", OWNER_VISIBLE_SERVICE_SQL];
  const chargeParams = [house.id_casa];

  const charges = await query(
    `
      SELECT
        cu.id_cuota,
        srv.nombre AS servicio,
        cu.monto,
        DATE_FORMAT(cu.fecha_limite, '%Y-%m-%d') AS fecha_limite,
        COALESCE(pagos.total_pagado, 0) AS pagado,
        ${refundedQuotaSql("cu.id_cuota")} AS total_reembolsado,
        COALESCE(rec.monto_recargo, 0) AS recargo
      FROM CUOTA cu
      INNER JOIN SERVICIO srv ON srv.id_servicio = cu.id_servicio
      LEFT JOIN (
        SELECT id_cuota, SUM(monto_pagado) AS total_pagado
        FROM PAGO
        GROUP BY id_cuota
      ) pagos ON pagos.id_cuota = cu.id_cuota
      LEFT JOIN RECARGO_APLICADO rec ON rec.id_cuota = cu.id_cuota
      WHERE ${chargeFilters.join(" AND ")}
      ORDER BY cu.fecha_limite DESC, cu.id_cuota DESC
    `,
    chargeParams,
  );

  const surchargeFilters = ["rec.id_casa = ?", OWNER_VISIBLE_SERVICE_SQL];
  const surchargeParams = [house.id_casa];
  if (desde) {
    surchargeFilters.push("rec.fecha_aplicacion >= ?");
    surchargeParams.push(desde);
  }
  if (hasta) {
    surchargeFilters.push("rec.fecha_aplicacion <= ?");
    surchargeParams.push(hasta);
  }

  const surcharges = await query(
    `
      SELECT
        rec.id_recargo,
        rec.id_cuota,
        srv.nombre AS servicio,
        rec.tipo_regla,
        rec.monto_original,
        rec.monto_recargo,
        DATE_FORMAT(rec.fecha_aplicacion, '%Y-%m-%d') AS fecha_aplicacion
      FROM RECARGO_APLICADO rec
      INNER JOIN CUOTA cu ON cu.id_cuota = rec.id_cuota
      INNER JOIN SERVICIO srv ON srv.id_servicio = cu.id_servicio
      WHERE ${surchargeFilters.join(" AND ")}
      ORDER BY rec.fecha_aplicacion DESC, rec.id_recargo DESC
    `,
    surchargeParams,
  );

  const paymentFilters = ["cu.id_casa = ?", OWNER_VISIBLE_SERVICE_SQL];
  const paymentParams = [house.id_casa];
  if (desde) {
    paymentFilters.push("pg.fecha_pago >= ?");
    paymentParams.push(desde);
  }
  if (hasta) {
    paymentFilters.push("pg.fecha_pago <= ?");
    paymentParams.push(hasta);
  }

  const payments = await query(
    `
      SELECT
        pg.id_pago,
        pg.id_cuota,
        srv.nombre AS servicio,
        pg.monto_pagado,
        DATE_FORMAT(pg.fecha_pago, '%Y-%m-%d') AS fecha_pago
      FROM PAGO pg
      INNER JOIN CUOTA cu ON cu.id_cuota = pg.id_cuota
      INNER JOIN SERVICIO srv ON srv.id_servicio = cu.id_servicio
      WHERE ${paymentFilters.join(" AND ")}
      ORDER BY pg.fecha_pago DESC, pg.id_pago DESC
    `,
    paymentParams,
  );

  const refundWhere=["cu.id_casa=?","rr.estado='CONFIRMADO'","rr.aplicado_en IS NOT NULL",OWNER_VISIBLE_SERVICE_SQL], refundParams=[house.id_casa];
  if(desde){refundWhere.push('rr.fecha_contable>=?');refundParams.push(desde);} if(hasta){refundWhere.push('rr.fecha_contable<=?');refundParams.push(hasta);}
  const reembolsos=await query(`SELECT rr.id_reembolso,tr.id_pago,tr.id_cuota,rr.monto_centavos,
    DATE_FORMAT(rr.fecha_contable,'%Y-%m-%d') fecha_reembolso,srv.nombre servicio FROM REEMBOLSO_RECURRENTE rr
    JOIN TRANSACCION_RECURRENTE tr ON tr.id_transaccion=rr.id_transaccion JOIN CUOTA cu ON cu.id_cuota=tr.id_cuota
    JOIN SERVICIO srv ON srv.id_servicio=cu.id_servicio WHERE ${refundWhere.join(' AND ')} ORDER BY rr.fecha_contable DESC,rr.id_reembolso DESC`,refundParams);
  const today = guatemalaToday();
  const cargos = charges.map((row) => mapCharge(row, today));
  const recargos = surcharges.map(mapSurcharge);
  const pagos = payments.map(mapPayment);

  const totalCargos = sumMoney(cargos.map((item) => item.monto));
  const totalRecargos = sumMoney(cargos.map((item) => item.recargo));
  const totalPagado = sumMoney(cargos.map((item) => item.pagado));

  return {
    unidad: house.torre ? `${house.torre}-${house.numero}` : house.numero,
    periodo: {
      desde: desde || null,
      hasta: hasta || null,
    },
    resumen: {
      total_cargos: Number(totalCargos.toFixed(2)),
      total_recargos: Number(totalRecargos.toFixed(2)),
      total_pagado: Number(totalPagado.toFixed(2)),
      total_reembolsado: sumMoney(cargos.map(c=>c.reembolsado)), abono_neto: sumMoney(cargos.map(c=>c.abono_neto)),
      total_devuelto_periodo: sumMoney(reembolsos.map(r=>Number(r.monto_centavos)/100)),
      saldo_pendiente: sumMoney(cargos.map((item) => item.saldo)),
      total_pagado_periodo: sumMoney(pagos.map((item) => item.monto_pagado)),
      sobrepago: sumMoney(cargos.map((item) => item.sobrepago)),
      requiere_revision: cargos.some((item) => item.requiere_revision),
    },
    cargos,
    recargos,
    pagos, reembolsos,
  };
}

module.exports = {
  getFinancialDetail,
  __private__: {
    normalizeDate,
    mapCharge,
    mapSurcharge,
    mapPayment,
  },
};
