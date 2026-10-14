const { query } = require('../database/mysql');
const { paymentAccessSql } = require('./paymentHistoricalActor');

const sources = {
  pago: `SELECT CONCAT('pago:',pg.id_pago) id, 'pago' tipo,
    DATE_FORMAT(pg.fecha_pago,'%Y-%m-%d') fecha, NULL hora,
    COALESCE(cu.concepto_snapshot,sv.nombre) titulo, 'APLICADO' estado, pg.monto_pagado monto,
    CONCAT('Pago #',pg.id_pago,' · Cuota #',cu.id_cuota) detalle
    FROM PAGO pg JOIN CUOTA cu ON cu.id_cuota=pg.id_cuota
    JOIN SERVICIO sv ON sv.id_servicio=cu.id_servicio
    JOIN (SELECT ? user_id) viewer
    WHERE ${paymentAccessSql('pg', 'cu', 'viewer.user_id')}`,
};

async function list(userId) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw Object.assign(new Error('Sesión inválida.'), { status: 401 });
  const records = await query(`SELECT * FROM (${Object.values(sources).join(' UNION ALL ')}) actividad
    ORDER BY fecha DESC, hora DESC, id DESC LIMIT 51`, Object.keys(sources).map(() => userId));
  return { items: records.slice(0, 50).map(row => ({ ...row, monto: row.monto == null ? null : Number(row.monto) })),
    hasMore: records.length > 50, page: 1, limit: 50 };
}
module.exports = { list };
