const { query } = require('../database/mysql');
const { paymentAccessSql } = require('./paymentHistoricalActor');

const sources = {
  reserva: `SELECT CONCAT('reserva:',r.id_usuario,':',r.id_amenidad,':',r.fecha,':',r.hora_inicio) id,
    'reserva' tipo, DATE_FORMAT(r.fecha,'%Y-%m-%d') fecha, TIME_FORMAT(r.hora_inicio,'%H:%i:%s') hora,
    am.nombre titulo, r.estado, NULL monto,
    CONCAT('Horario: ',TIME_FORMAT(r.hora_inicio,'%H:%i'),' a ',TIME_FORMAT(r.hora_fin,'%H:%i')) detalle
    FROM RESERVA r JOIN AMENIDAD am ON am.id_amenidad=r.id_amenidad WHERE r.id_usuario=?`,
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
