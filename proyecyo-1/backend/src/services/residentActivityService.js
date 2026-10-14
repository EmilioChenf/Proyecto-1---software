const { query } = require('../database/mysql');
const { paymentAccessSql } = require('./paymentHistoricalActor');
const { ensureValidDate } = require('../utils/dateTimeValidation');

const sources = {
  sancion: `SELECT CONCAT('sancion:',s.id_sancion) id, 'sancion' tipo,
    DATE_FORMAT(s.fecha_generacion,'%Y-%m-%d') fecha, TIME_FORMAT(s.fecha_generacion,'%H:%i:%s') hora,
    s.motivo titulo, s.estado, s.monto, COALESCE(s.detalle,s.codigo_regla) detalle
    FROM SANCION s JOIN CUOTA cu ON cu.id_cuota=s.id_cuota
    WHERE COALESCE(cu.id_responsable,
      CAST(NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(cu.responsable_snapshot,'$.id_usuario')),'null'),'') AS UNSIGNED))=?`,
  visita: `SELECT CONCAT('visita:',a.id_acceso) id, 'visita' tipo,
    DATE_FORMAT(a.fecha,'%Y-%m-%d') fecha, TIME_FORMAT(a.hora_inicio,'%H:%i:%s') hora,
    v.nombre titulo, a.estado_acceso estado, NULL monto,
    CONCAT(COALESCE(a.tipo_visita,'VISITA'),' · ',COALESCE(a.motivo_servicio,'Visita autorizada')) detalle
    FROM ACCESO a JOIN VISITANTE v ON v.id_visitante=a.id_visitante WHERE a.id_usuario_autoriza=?`,
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

function filters(input = {}) {
  const invalid = () => Object.assign(new Error('Filtros de actividad inválidos.'), { status: 400 });
  const allowed = ['tipo', 'desde', 'hasta', 'page', 'limit'];
  if (Object.keys(input).some(key => !allowed.includes(key) || typeof input[key] !== 'string')) throw invalid();
  const tipo = input.tipo || '';
  if (tipo && !Object.hasOwn(sources, tipo)) throw invalid();
  const desde = input.desde ? ensureValidDate(input.desde, 'desde') : '';
  const hasta = input.hasta ? ensureValidDate(input.hasta, 'hasta') : '';
  if (desde && hasta && desde > hasta) throw invalid();
  function integer(key, fallback, max) {
    if (input[key] === undefined) return fallback;
    if (!/^[1-9]\d*$/.test(input[key]) || Number(input[key]) > max) throw invalid();
    return Number(input[key]);
  }
  return { tipo, desde, hasta, page: integer('page', 1, 10000), limit: integer('limit', 50, 100) };
}

async function list(userId, input = {}) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw Object.assign(new Error('Sesión inválida.'), { status: 401 });
  const f = filters(input), selected = f.tipo ? [sources[f.tipo]] : Object.values(sources);
  const params = selected.map(() => userId), where = [];
  if (f.desde) { where.push('fecha>=?'); params.push(f.desde); }
  if (f.hasta) { where.push('fecha<=?'); params.push(f.hasta); }
  // LIMIT/OFFSET interpolate only bounded integers validated above, never raw query values.
  const records = await query(`SELECT * FROM (${selected.join(' UNION ALL ')}) actividad
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY fecha DESC, hora DESC, id DESC LIMIT ${f.limit + 1} OFFSET ${(f.page - 1) * f.limit}`, params);
  return { items: records.slice(0, f.limit).map(row => ({ ...row, monto: row.monto == null ? null : Number(row.monto) })),
    hasMore: records.length > f.limit, page: f.page, limit: f.limit };
}
module.exports = { list, filters };
