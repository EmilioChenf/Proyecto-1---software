const { pool: defaultPool } = require('../database/mysql');
const { calculateBalance, QUOTA_BALANCES_SQL, toCents } = require('./financialBalance');
const { BLOCKING_CHECKOUT_CONDITION } = require('./recurrenteCheckoutGuard');
const { refundBlockingSql } = require('./recurrenteRefundGuard');
const { successReviewSql } = require('./recurrenteReviewGuard');
const { enqueue, currentCycle, DEADLINE_TYPES, money } = require('./financialNotificationOutbox');

function guatemalaDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const plusDays = (day, days) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
async function config(c) {
  const [rows] = await c.execute("SELECT clave,valor FROM CONFIGURACION WHERE clave IN ('recordatorios_activo','recordatorios_dias_antes')");
  const values = Object.fromEntries(rows.map(r => [r.clave, r.valor]));
  const lead = Number(values.recordatorios_dias_antes ?? 3);
  if (!Number.isInteger(lead) || lead < 0 || lead > 60) throw new Error('Configuración de recordatorios inválida.');
  return { active: values.recordatorios_activo == null || values.recordatorios_activo === 'true', lead };
}
async function quotaSnapshot(c, quotaId) {
  const [rows] = await c.execute(`SELECT q.*,DATE_FORMAT(q.fecha_limite,'%Y-%m-%d') vencimiento,s.nombre servicio,
    s.tipo_servicio FROM (${QUOTA_BALANCES_SQL}) q JOIN SERVICIO s ON s.id_servicio=q.id_servicio WHERE q.id_cuota=?`, [quotaId]);
  const row = rows[0];
  if (!row) return null;
  try {
    const balance = calculateBalance({ monto: row.monto, recargo: row.recargo, pagado: row.total_pagado, reembolsado: row.total_reembolsado });
    if (balance.requiere_revision) return null;
    return { ...row, balance };
  } catch { return null; }
}
async function blocked(c, quotaId) {
  const [rows] = await c.execute(`SELECT (EXISTS(SELECT 1 FROM CHECKOUT_RECURRENTE WHERE id_cuota=?
    AND (${BLOCKING_CHECKOUT_CONDITION} OR estado_proveedor='payment_in_progress')) OR ${refundBlockingSql('?')}
    OR EXISTS(SELECT 1 FROM CHECKOUT_RECURRENTE co WHERE co.id_cuota=? AND ${successReviewSql('co.id_checkout')})) bloqueada`,
  [quotaId, quotaId, quotaId, quotaId]);
  return Boolean(Number(rows[0].bloqueada));
}

// Match the actual account screens. Tenant account currently selects one house
// with LIMIT 1; use the identical join/selection rather than widen permissions.
async function recipients(c, quotaId, debt = true) {
  const ownerVisibility = debt ? `AND LOWER(COALESCE(s.tipo_servicio,'')) <> 'alquiler'
    AND LOWER(s.nombre) NOT LIKE '%alquiler%' AND LOWER(s.nombre) NOT LIKE '%renta%'` : '';
  const [rows] = await c.execute(`SELECT u.id_usuario FROM CUOTA q JOIN CASA ca ON ca.id_casa=q.id_casa
    LEFT JOIN RESIDENTE r ON r.id_residente=ca.id_residente
    JOIN USUARIO u ON u.id_usuario=q.id_responsable OR
      (q.id_responsable IS NULL AND ca.relaciones_confirmadas_en IS NULL AND u.id_usuario=r.id_usuario)
    JOIN TIPO_USUARIO t ON t.id_tipo_usuario=u.id_tipo_usuario JOIN SERVICIO s ON s.id_servicio=q.id_servicio
    WHERE q.id_cuota=? AND u.activo=TRUE AND LOWER(t.nombre) IN ('residente','inquilino')
      AND (q.id_responsable IS NOT NULL OR (LOWER(t.nombre)='residente' ${ownerVisibility}))`, [quotaId]);
  return rows.map(r => Number(r.id_usuario));
}
async function stage(c, quota, userId, cycle, today, lead) {
  const remaining = daysBetween(today, quota.vencimiento);
  if (remaining > lead) return null;
  if (remaining > 0) return { type: 'CUOTA_PROXIMA', window: quota.vencimiento, date: today };
  if (remaining === 0) return { type: 'CUOTA_HOY', window: quota.vencimiento, date: today };
  const [old] = await c.execute(`SELECT ventana,DATE_FORMAT(fecha_entrega,'%Y-%m-%d') ultima
    FROM ENTREGA_NOTIFICACION_FINANCIERA WHERE id_cuota=? AND id_usuario=? AND ciclo=?
    AND tipo_evento='CUOTA_VENCIDA' AND estado='ENTREGADA' ORDER BY id_entrega DESC LIMIT 1`, [quota.id_cuota, userId, cycle]);
  const last = old[0];
  if (!last) return { type: 'CUOTA_VENCIDA', window: 'INICIAL', date: today };
  if (daysBetween(last.ultima,today) < 7) return null;
  const next = last.ventana === 'INICIAL' ? 1 : Number(last.ventana.split(':')[1]) + 1;
  if (!Number.isSafeInteger(next) || next < 1) throw new Error('Ventana persistida inválida.');
  return { type: 'CUOTA_VENCIDA', window: `SEMANA:${next}`, date: plusDays(last.ultima,7) };
}
function deadlineData(quota, userId, cycle, selection) {
  const balance = quota.balance, cents = toCents(balance.saldo);
  const surcharge = toCents(balance.recargo_pendiente);
  const title = { CUOTA_PROXIMA: 'Cuota próxima a vencer', CUOTA_HOY: 'Cuota vence hoy', CUOTA_VENCIDA: 'Cuota vencida pendiente' }[selection.type];
  // Concept is bounded, stripped of controls/markup, and never provider text.
  const concept = String(quota.servicio).replace(/[<>\u0000-\u001f\u007f]/g, '').slice(0, 65);
  return { id_usuario: userId, id_cuota: quota.id_cuota, tipo_evento: selection.type,
    ciclo: cycle, ventana: selection.window, fecha_objetivo: selection.date, fecha_vencimiento: quota.vencimiento,
    monto_centavos: cents, saldo_centavos: cents, recargo_centavos: surcharge,
    titulo: title,
    mensaje: `Cuota ${quota.id_cuota}: ${concept}. Saldo pendiente ${money(cents)}. Vencimiento ${quota.vencimiento}.${surcharge ? ` Incluye recargos pendientes de ${money(surcharge)}.` : ''}`,
    accion_codigo: 'ESTADO_CUENTA' };
}
async function validFinancialSource(c, row) {
  if (row.tipo_evento === 'PAGO_CONFIRMADO') {
    const [source] = await c.execute(`SELECT tr.id_usuario FROM TRANSACCION_RECURRENTE tr JOIN PAGO p ON p.id_pago=tr.id_pago
      JOIN PAGO_ORIGEN po ON po.id_pago=p.id_pago AND po.origen='RECURRENTE' AND po.ambiente=tr.ambiente
      WHERE p.id_pago=? AND p.id_cuota=? AND tr.id_usuario=? AND tr.ambiente=? AND tr.monto_centavos=?
      AND tr.estado IN ('CONFIRMADA','REEMBOLSADA_PARCIAL','REEMBOLSADA')`,
    [row.id_pago,row.id_cuota,row.id_usuario,row.ambiente,row.monto_centavos]);
    return source.length === 1;
  }
  if (row.tipo_evento === 'REEMBOLSO_CONFIRMADO') {
    const [source] = await c.execute(`SELECT rr.id_reembolso FROM REEMBOLSO_RECURRENTE rr JOIN TRANSACCION_RECURRENTE tr
      ON tr.id_transaccion=rr.id_transaccion WHERE rr.id_reembolso=? AND rr.estado='CONFIRMADO' AND rr.aplicado_en IS NOT NULL
      AND tr.id_pago=? AND tr.id_usuario=? AND tr.id_cuota=? AND rr.ambiente=? AND rr.monto_centavos=?`,
    [row.id_reembolso,row.id_pago,row.id_usuario,row.id_cuota,row.ambiente,row.monto_centavos]);
    return source.length === 1;
  }
  const [source] = await c.execute(`SELECT i.id_intento FROM INTENTO_RECURRENTE i JOIN TRANSACCION_RECURRENTE tr
    ON tr.id_transaccion=i.id_transaccion WHERE i.id_externo=? AND i.estado=? AND i.ambiente=?
    AND tr.id_usuario=? AND tr.id_cuota=? AND i.monto_centavos=?`,
  [row.referencia_intento,row.tipo_evento === 'PAGO_CANCELADO' ? 'CANCELADA' : 'FALLIDA',row.ambiente,row.id_usuario,row.id_cuota,row.monto_centavos]);
  return source.length === 1;
}

function createFinancialNotificationsService({ pool = defaultPool, now = () => new Date() } = {}) {
  async function transaction(work) {
    const c = await pool.getConnection();
    try { await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED'); await c.beginTransaction();
      const result = await work(c); await c.commit(); return result;
    } catch (error) { await c.rollback(); throw error; } finally { c.release(); }
  }
  async function generateDeadlines() {
    const today = guatemalaDate(now()), reader = await pool.getConnection();
    let candidates, settings;
    try {
      settings = await config(reader);
      if (!settings.active) return { pendientes: 0, activo: false, fecha_revision: today };
      [candidates] = await reader.execute(`SELECT id_cuota FROM (${QUOTA_BALANCES_SQL}) cu
        WHERE cu.saldo_pendiente>0 AND cu.sobrepago=0 AND cu.reembolso_inconsistente=0
        AND cu.fecha_limite<=DATE_ADD(?,INTERVAL ? DAY) ORDER BY cu.id_cuota`, [today, settings.lead]);
    } finally { reader.release(); }
    let pending = 0;
    for (const candidate of candidates) pending += await transaction(async c => {
      await c.execute('SELECT id_cuota FROM CUOTA WHERE id_cuota=? FOR UPDATE', [candidate.id_cuota]);
      const quota = await quotaSnapshot(c, candidate.id_cuota);
      const currentSettings = await config(c);
      if (!currentSettings.active || !quota || toCents(quota.balance.saldo) === 0 || await blocked(c, quota.id_cuota)) return 0;
      const cycle = await currentCycle(c, quota.id_cuota), users = await recipients(c, quota.id_cuota);
      let created = 0;
      for (const user of users) {
        const selection = await stage(c, quota, user, cycle, today, currentSettings.lead);
        if (!selection) continue;
        const result = await enqueue(c, deadlineData(quota,user,cycle,selection),
          ['cuota',Number(quota.id_cuota),user,cycle,selection.type,selection.window]);
        if (result.created) created++;
      }
      return created;
    });
    return { pendientes: pending, activo: true, fecha_revision: today };
  }
  async function deliver(id) {
    return transaction(async c => {
      const [locator] = await c.execute('SELECT id_cuota FROM ENTREGA_NOTIFICACION_FINANCIERA WHERE id_entrega=?', [id]);
      if (!locator[0]) return 'omitida';
      // Never lock outbox then quota: financial producers already own quota.
      if (locator[0].id_cuota) await c.execute('SELECT id_cuota FROM CUOTA WHERE id_cuota=? FOR UPDATE', [locator[0].id_cuota]);
      const [rows] = await c.execute("SELECT e.*,DATE_FORMAT(e.fecha_objetivo,'%Y-%m-%d') fecha_objetivo FROM ENTREGA_NOTIFICACION_FINANCIERA e WHERE id_entrega=? FOR UPDATE", [id]);
      const row = rows[0];
      if (!['PENDIENTE','ERROR'].includes(row.estado)) return 'existente';
      const debt = DEADLINE_TYPES.includes(row.tipo_evento);
      const users = row.id_cuota ? await recipients(c,row.id_cuota,debt) : [];
      let reason = users.includes(Number(row.id_usuario)) ? null : 'DESTINATARIO_NO_AUTORIZADO';
      if (!reason && debt) {
        const settings = await config(c), quota = await quotaSnapshot(c,row.id_cuota);
        const cycle = await currentCycle(c,row.id_cuota);
        if (!quota || toCents(quota.balance.saldo) === 0) reason = 'DEUDA_RESUELTA_O_REVISION';
        else if (cycle !== Number(row.ciclo)) reason = 'CICLO_ANTERIOR';
        else if (!settings.active || await blocked(c,row.id_cuota)) {
          await c.execute(`UPDATE ENTREGA_NOTIFICACION_FINANCIERA SET estado='PENDIENTE',error_codigo='DEUDA_BLOQUEADA',
            proximo_reintento_en=DATE_ADD(NOW(6),INTERVAL 5 MINUTE) WHERE id_entrega=?`, [id]);
          return 'pendiente';
        } else {
          const today = guatemalaDate(now());
          const selection = await stage(c,quota,row.id_usuario,cycle,today,settings.lead);
          if (!selection || selection.type !== row.tipo_evento || selection.window !== row.ventana) reason = 'VENTANA_ANTERIOR';
          else Object.assign(row, deadlineData(quota,row.id_usuario,cycle,{type:row.tipo_evento,window:row.ventana,date:row.fecha_objetivo}));
        }
      } else if (!reason && !await validFinancialSource(c,row)) reason = 'EVIDENCIA_NO_APLICADA';
      if (reason) {
        await c.execute(`UPDATE ENTREGA_NOTIFICACION_FINANCIERA SET estado='OMITIDA',error_codigo=?,intentos=intentos+1,
          proximo_reintento_en=NULL WHERE id_entrega=?`, [reason,id]);
        return 'omitida';
      }
      const [notification] = await c.execute(`INSERT INTO NOTIFICACION(id_usuario,id_acceso,tipo,titulo,mensaje,leido)
        VALUES(?,NULL,?,?,?,FALSE)`, [row.id_usuario,row.tipo_evento,row.titulo,row.mensaje]);
      await c.execute(`UPDATE ENTREGA_NOTIFICACION_FINANCIERA SET estado='ENTREGADA',id_notificacion=?,entregado_en=NOW(6),
        intentos=intentos+1,error_codigo=NULL,proximo_reintento_en=NULL,titulo=?,mensaje=?,monto_centavos=?,saldo_centavos=?,
        recargo_centavos=?,fecha_vencimiento=?,fecha_entrega=? WHERE id_entrega=?`,
      [notification.insertId,row.titulo,row.mensaje,row.monto_centavos,row.saldo_centavos,row.recargo_centavos,
        row.fecha_vencimiento,guatemalaDate(now()),id]);
      return 'entregada';
    });
  }
  async function consume({ batchSize = 100, maxBatches = 10 } = {}) {
    if (![batchSize,maxBatches].every(v => Number.isInteger(v) && v > 0 && v <= 1000)) throw new Error('Lote inválido.');
    const totals = { entregadas: 0, recordatorios: 0, omitidas: 0, errores: 0, pendientes: 0 };
    for (let batch = 0; batch < maxBatches; batch++) {
      const reader = await pool.getConnection(); let rows;
      try { [rows] = await reader.execute(`SELECT id_entrega,tipo_evento FROM ENTREGA_NOTIFICACION_FINANCIERA
        WHERE estado IN ('PENDIENTE','ERROR') AND (proximo_reintento_en IS NULL OR proximo_reintento_en<=NOW(6))
        ORDER BY id_entrega LIMIT ${batchSize}`); } finally { reader.release(); }
      if (!rows.length) break;
      for (const row of rows) {
        try {
          const result = await deliver(row.id_entrega);
          if (result === 'entregada') totals.entregadas++;
          if (result === 'entregada' && DEADLINE_TYPES.includes(row.tipo_evento)) totals.recordatorios++;
          if (result === 'omitida') totals.omitidas++;
          if (result === 'pendiente') totals.pendientes++;
        } catch {
          totals.errores++;
          const c = await pool.getConnection();
          try { await c.execute(`UPDATE ENTREGA_NOTIFICACION_FINANCIERA SET estado='ERROR',error_codigo='ENTREGA_REINTENTABLE',
            intentos=intentos+1,proximo_reintento_en=DATE_ADD(NOW(6),INTERVAL 5 MINUTE)
            WHERE id_entrega=? AND estado IN ('PENDIENTE','ERROR')`, [row.id_entrega]); } finally { c.release(); }
        }
      }
      if (rows.length < batchSize) break;
    }
    return totals;
  }
  async function run() { const deadlines = await generateDeadlines(); return { ...deadlines, ...await consume() }; }
  return { generateDeadlines, consume, deliver, run };
}
module.exports = { createFinancialNotificationsService, guatemalaDate, daysBetween, plusDays,
  __private__: { quotaSnapshot, recipients, blocked, stage, deadlineData, validFinancialSource } };
