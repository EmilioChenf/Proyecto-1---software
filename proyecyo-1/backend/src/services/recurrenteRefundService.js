const { randomUUID, createHash } = require('node:crypto');
const { pool: defaultPool } = require('../database/mysql');
const { calculateBalance, assertCollectible, toCents, refundedQuotaSql } = require('./financialBalance');
const { refundBlockingSql } = require('./recurrenteRefundGuard');
const { BLOCKING_CHECKOUT_CONDITION } = require('./recurrenteCheckoutGuard');
const { createRecurrenteRefundClient } = require('./recurrenteRefundClient');
const { RefundError, HISTORICAL_SUCCESS, RESERVED, providerId, object } = require('./recurrenteRefundContract');
const { paymentReference } = require('./paymentReceiptService');
const { enqueueRefund } = require('./financialNotificationOutbox');
const positive = v => /^\d+$/.test(String(v)) && Number.isSafeInteger(Number(v)) && Number(v) > 0;
const centsMoney = n => `${Math.floor(n / 100)}.${String(n % 100).padStart(2, '0')}`;
function admin(actor) { if (!positive(actor?.id) || actor.role !== 'admin') throw new RefundError('REFUND_FORBIDDEN', 403); }
function requestInput(body) {
  if (!object(body) || Object.keys(body).some(k => !['motivo', 'idempotency_key'].includes(k))
    || typeof body.motivo !== 'string' || !body.motivo.trim() || body.motivo.length > 500
    || /[\u0000-\u001f\u007f]|<|>|(?:\d[ -]?){13,19}|\b(?:cvc|cvv|pan|secret|whsec|sk_live|sk_test)\b|whsec_|sk_(?:live|test)_|X-SECRET-KEY|RECURRENTE_(?:SECRET_KEY|WEBHOOK_SECRET)/i.test(body.motivo)
    || typeof body.idempotency_key !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(body.idempotency_key)) {
    throw new RefundError('REFUND_INVALID_REQUEST', 400);
  }
  return { motivo: body.motivo.trim().normalize('NFC'), idempotency_key: body.idempotency_key.toLowerCase() };
}
async function localTransaction(c, id) {
  const [rows] = await c.execute(`SELECT tr.*, co.id_externo checkout_externo,co.estado checkout_estado,
    co.estado_proveedor checkout_proveedor,co.sandbox_id,co.monto_centavos checkout_monto,
    co.moneda checkout_moneda,co.id_cuota checkout_cuota,co.id_usuario checkout_usuario,co.id_casa checkout_casa,
    p.monto_pagado,DATE_FORMAT(p.fecha_pago,'%Y-%m-%d') fecha_pago,po.origen,po.ambiente pago_ambiente,
    cu.monto,cu.id_casa cuota_casa,DATE_FORMAT(cu.fecha_limite,'%Y-%m-%d') fecha_limite,srv.nombre concepto,
    COALESCE(cu.id_responsable,co.id_usuario) residente_usuario,co.id_residente,r.id_residente actual_residente,u.nombre residente,
    CONCAT_WS('-',NULLIF(ca.torre,''),ca.numero) unidad,
    COALESCE(CASE WHEN e.tipo_evento='payment_intent.succeeded' THEN e.id_operacion_externa END,
      (SELECT orig.id_operacion_externa FROM EVENTO_RECURRENTE orig WHERE orig.id_checkout=tr.id_checkout
       AND orig.tipo_evento='payment_intent.succeeded' AND orig.estado='PROCESADO' ORDER BY orig.id_evento LIMIT 1)) legacy_intent
    FROM TRANSACCION_RECURRENTE tr JOIN CHECKOUT_RECURRENTE co ON co.id_checkout=tr.id_checkout
    JOIN CUOTA cu ON cu.id_cuota=tr.id_cuota JOIN CASA ca ON ca.id_casa=cu.id_casa
    LEFT JOIN RESIDENTE r ON r.id_usuario=COALESCE(cu.id_responsable,co.id_usuario)
    JOIN USUARIO u ON u.id_usuario=COALESCE(cu.id_responsable,co.id_usuario)
    JOIN SERVICIO srv ON srv.id_servicio=cu.id_servicio LEFT JOIN PAGO p ON p.id_pago=tr.id_pago AND p.id_cuota=tr.id_cuota
    LEFT JOIN PAGO_ORIGEN po ON po.id_pago=p.id_pago LEFT JOIN EVENTO_RECURRENTE e ON e.id_evento=tr.id_evento
    WHERE tr.id_transaccion=?`, [id]);
  if (!rows[0]) throw new RefundError('REFUND_NOT_FOUND', 404);
  return rows[0];
}
async function lockTransaction(c, id) {
  const locator = await localTransaction(c, id);
  await c.execute('SELECT id_cuota FROM CUOTA WHERE id_cuota=? FOR UPDATE', [locator.id_cuota]);
  await c.execute('SELECT id_checkout FROM CHECKOUT_RECURRENTE WHERE id_checkout=? FOR UPDATE', [locator.id_checkout]);
  await c.execute('SELECT id_transaccion FROM TRANSACCION_RECURRENTE WHERE id_transaccion=? FOR UPDATE', [id]);
  return localTransaction(c, id);
}
async function refunds(c, id, lock = false) {
  const [rows] = await c.execute(`SELECT * FROM REEMBOLSO_RECURRENTE WHERE id_transaccion=? ORDER BY id_reembolso${lock ? ' FOR UPDATE' : ''}`, [id]);
  return rows;
}
function budget(local, rows) {
  const gross = Number(local.monto_centavos);
  const returned = rows.filter(r => r.estado === 'CONFIRMADO' && r.aplicado_en).reduce((s, r) => s + Number(r.monto_centavos), 0);
  const reserved = rows.filter(r => RESERVED.includes(r.estado) || r.estado === 'CONFIRMADO' && !r.aplicado_en).reduce((s, r) => s + Number(r.monto_centavos), 0);
  if (![gross, returned, reserved].every(Number.isSafeInteger) || returned + reserved > gross) throw new RefundError('REFUND_INELIGIBLE');
  return { original_centavos: gross, devuelto_centavos: returned, reservado_centavos: reserved, disponible_centavos: gross - returned - reserved,
    abono_neto_centavos: gross - returned };
}
function eligibleLocal(local, sandboxId) {
  try {
    return local.ambiente === 'sandbox' && local.sandbox_id === sandboxId && local.moneda === 'GTQ'
      && local.checkout_moneda === 'GTQ' && local.origen === 'RECURRENTE' && local.pago_ambiente === 'sandbox'
      && positive(local.id_pago) && HISTORICAL_SUCCESS.includes(local.estado) && !!local.confirmado_en
      && local.checkout_estado === 'CONFIRMADO' && local.checkout_proveedor === 'paid'
      && providerId(local.id_externo, 'in') && providerId(local.id_pago_externo, 'pa') && providerId(local.checkout_externo, 'ch')
      && Number(local.monto_centavos) > 0 && Number(local.monto_centavos) === toCents(local.monto_pagado)
      && Number(local.checkout_monto) === Number(local.monto_centavos)
      && ['id_cuota', 'id_usuario', 'id_casa'].every(k => Number(local[k]) === Number(local['checkout_' + k.slice(3)]))
      && Number(local.id_casa) === Number(local.cuota_casa) && Number(local.id_usuario) === Number(local.residente_usuario)
      && Number(local.id_residente) === Number(local.actual_residente)
      && local.capital_aplicado_centavos != null && local.recargo_aplicado_centavos != null
      && Number(local.capital_aplicado_centavos) + Number(local.recargo_aplicado_centavos) === Number(local.monto_centavos);
  } catch { return false; }
}
function coherentAggregate(local, amounts) {
  const expected = amounts.devuelto_centavos === 0 ? 'CONFIRMADA'
    : amounts.devuelto_centavos === amounts.original_centavos ? 'REEMBOLSADA' : 'REEMBOLSADA_PARCIAL';
  return local.estado === expected;
}
function publicRefund(r) {
  return Object.fromEntries(['id_reembolso','id_transaccion','referencia_local','id_externo','monto_centavos','moneda','ambiente','tipo','estado',
    'motivo','estado_proveedor','error_codigo','creado_en','enviado_en','verificado_en','fecha_proveedor_original','fecha_contable','confirmado_en',
    'aplicado_en','capital_revertido_centavos','recargo_revertido_centavos','evidencia_confirmacion'].map(k => [k, r[k] ?? null]));
}
async function quotaTotals(c, local) {
  const [rows] = await c.execute(`SELECT COALESCE((SELECT SUM(monto_pagado) FROM PAGO WHERE id_cuota=?),0) pagado,
    COALESCE((SELECT SUM(monto_recargo) FROM RECARGO_APLICADO WHERE id_cuota=?),0) recargo,
    ${refundedQuotaSql(String(Number(local.id_cuota)))} reembolsado,
    ${refundBlockingSql(String(Number(local.id_cuota)))} refund_bloqueante`, [local.id_cuota, local.id_cuota]);
  return rows[0];
}

// Caller owns the SQL transaction. HTTP and signed webhooks use this same applier.
async function applyRefundEvidence(c, refundId, evidence, channel, context, eventId = null) {
  const [locators] = await c.execute('SELECT id_transaccion FROM REEMBOLSO_RECURRENTE WHERE id_reembolso=?', [refundId]);
  if (!locators[0]) throw new RefundError('REFUND_NOT_FOUND', 404);
  const local = await lockTransaction(c, locators[0].id_transaccion), all = await refunds(c, local.id_transaccion, true);
  const rr = all.find(r => Number(r.id_reembolso) === Number(refundId));
  let valid = eligibleLocal(local, context.sandboxId) && context.environment === 'sandbox' && rr.ambiente === 'sandbox'
    && rr.sandbox_id === context.sandboxId && providerId(evidence.id, 're') && (!rr.id_externo || rr.id_externo === evidence.id)
    && providerId(rr.cuenta_proveedor, 'ac') && rr.cuenta_proveedor === context.accountId
    && (!evidence.accountId || evidence.accountId === rr.cuenta_proveedor)
    && (evidence.currency == null && evidence.status !== 'succeeded' || evidence.currency === rr.moneda)
    && (evidence.amount == null && evidence.status !== 'succeeded' || evidence.amount === Number(rr.monto_centavos));
  const [external] = await c.execute('SELECT id_reembolso FROM REEMBOLSO_RECURRENTE WHERE ambiente=? AND id_externo=? FOR UPDATE', [rr.ambiente, evidence.id]);
  valid = valid && (!external.length || Number(external[0].id_reembolso) === Number(rr.id_reembolso));
  if (!valid || evidence.status === 'voided' || evidence.status === 'succeeded' && !evidence.time) {
    await c.execute(`UPDATE REEMBOLSO_RECURRENTE SET estado=IF(aplicado_en IS NULL,'REVISION',estado),error_codigo='REFUND_REVIEW' WHERE id_reembolso=?`, [rr.id_reembolso]);
    return { result: 'review', refund: publicRefund({ ...rr, estado: rr.aplicado_en ? rr.estado : 'REVISION', error_codigo: 'REFUND_REVIEW' }) };
  }
  if (rr.aplicado_en) {
    if (evidence.status !== 'succeeded') {
      await c.execute("UPDATE REEMBOLSO_RECURRENTE SET error_codigo='REFUND_REVIEW' WHERE id_reembolso=?", [rr.id_reembolso]);
      return { result: 'review', refund: publicRefund(rr) };
    }
    return { result: 'duplicate', refund: publicRefund(rr) };
  }
  if (rr.estado === 'FALLIDO' && evidence.status === 'succeeded') {
    await c.execute("UPDATE REEMBOLSO_RECURRENTE SET estado='REVISION',error_codigo='REFUND_REVIEW' WHERE id_reembolso=?", [rr.id_reembolso]);
    return { result: 'review', refund: publicRefund({ ...rr, estado: 'REVISION', error_codigo: 'REFUND_REVIEW' }) };
  }
  if (evidence.status !== 'succeeded') {
    const state = evidence.status === 'failed' && evidence.reason !== 'PROVIDER_OUTCOME_UNKNOWN' ? 'FALLIDO' : 'PENDIENTE';
    await c.execute(`UPDATE REEMBOLSO_RECURRENTE SET id_externo=?,estado=?,estado_proveedor=?,error_codigo=?,verificado_en=NOW(6),
      fecha_proveedor_original=?,fecha_proveedor_utc=?,importe_comercio_centavos=?,id_evento=COALESCE(id_evento,?) WHERE id_reembolso=?`,
    [evidence.id, state, evidence.status, evidence.reason, evidence.time?.original ?? null, evidence.time?.utc ?? null,
      evidence.merchantAmount ?? null, eventId, rr.id_reembolso]);
    const [updated] = await c.execute('SELECT * FROM REEMBOLSO_RECURRENTE WHERE id_reembolso=?', [rr.id_reembolso]);
    return { result: 'processed', refund: publicRefund(updated[0]) };
  }
  const others = all.filter(r => Number(r.id_reembolso) !== Number(refundId));
  const limits = budget(local, others);
  if (Number(rr.monto_centavos) > limits.disponible_centavos) throw new RefundError('REFUND_INELIGIBLE');
  const totals = await quotaTotals(c, local);
  const before = calculateBalance({ monto: local.monto, ...totals }); assertCollectible(before);
  const after = calculateBalance({ monto: local.monto, ...totals,
    reembolsado: centsMoney(toCents(totals.reembolsado) + Number(rr.monto_centavos)) });
  const capital = toCents(after.capital_pendiente) - toCents(before.capital_pendiente);
  const surcharge = toCents(after.recargo_pendiente) - toCents(before.recargo_pendiente);
  if (capital < 0 || surcharge < 0 || capital + surcharge !== Number(rr.monto_centavos)) throw new RefundError('REFUND_INELIGIBLE');
  await c.execute(`UPDATE REEMBOLSO_RECURRENTE SET id_externo=?,estado='CONFIRMADO',estado_proveedor='succeeded',error_codigo=NULL,
    fecha_proveedor_original=?,fecha_proveedor_utc=?,fecha_contable=?,confirmado_en=NOW(6),aplicado_en=NOW(6),verificado_en=NOW(6),
    capital_revertido_centavos=?,recargo_revertido_centavos=?,evidencia_confirmacion=?,importe_comercio_centavos=?,
    id_evento=COALESCE(id_evento,?) WHERE id_reembolso=? AND aplicado_en IS NULL`,
  [evidence.id, evidence.time.original, evidence.time.utc, evidence.time.accountingDate, capital, surcharge, channel,
    evidence.merchantAmount ?? null, eventId, rr.id_reembolso]);
  const total = limits.devuelto_centavos + Number(rr.monto_centavos);
  await c.execute('UPDATE TRANSACCION_RECURRENTE SET estado=? WHERE id_transaccion=?',
    [total === Number(local.monto_centavos) ? 'REEMBOLSADA' : 'REEMBOLSADA_PARCIAL', local.id_transaccion]);
  await enqueueRefund(c, local, rr, before, after, evidence.time.accountingDate);
  const [updated] = await c.execute('SELECT * FROM REEMBOLSO_RECURRENTE WHERE id_reembolso=?', [rr.id_reembolso]);
  return { result: 'processed', refund: publicRefund(updated[0]) };
}

function createRefundService({ pool = defaultPool, client = createRecurrenteRefundClient() } = {}) {
  async function transaction(work) {
    const c = await pool.getConnection();
    try { await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED'); await c.beginTransaction(); const result = await work(c); await c.commit(); return result; }
    catch (e) { await c.rollback().catch(() => {}); throw e instanceof RefundError ? e : new RefundError('REFUND_PERSISTENCE', 503, { uncertain: true }); }
    finally { c.release(); }
  }
  async function eligibility(actor, id) {
    admin(actor); if (!positive(id)) throw new RefundError('REFUND_INVALID_REQUEST', 400);
    // An immutable read snapshot avoids presenting mixed totals during confirmation.
    const c = await pool.getConnection();
    try {
      await c.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
      const local = await localTransaction(c, id), history = await refunds(c, id), money = budget(local, history), totals = await quotaTotals(c, local);
      const eligible = eligibleLocal(local, client.sandboxId()) && coherentAggregate(local,money) && money.disponible_centavos > 0 && !Number(totals.refund_bloqueante)
        && !calculateBalance({ monto: local.monto, ...totals }).requiere_revision;
      const result = { id_transaccion: Number(id), id_pago: local.id_pago, id_cuota: local.id_cuota, id_checkout: local.id_checkout,
        numero_comprobante: local.id_pago ? paymentReference(local.id_pago) : null, concepto: local.concepto, residente: local.residente,
        unidad: local.unidad, fecha_pago: local.fecha_pago, fecha_limite: local.fecha_limite, estado: local.estado,
        ambiente: local.ambiente, moneda: local.moneda, ...money, elegible: eligible,
        motivo_inhabilitacion: eligible ? null : Number(totals.refund_bloqueante) ? 'REFUND_BLOCKED' : 'REFUND_INELIGIBLE',
        requiere_verificacion_proveedor: true, reembolsos: history.map(publicRefund) };
      await c.commit(); return result;
    } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
  }
  async function reserve(actor, id, body) {
    return transaction(async c => {
      const local = await lockTransaction(c, id);
      const [admins] = await c.execute(`SELECT u.id_usuario FROM USUARIO u JOIN TIPO_USUARIO t ON t.id_tipo_usuario=u.id_tipo_usuario
        WHERE u.id_usuario=? AND u.activo=TRUE AND LOWER(t.nombre)='admin'`, [actor.id]);
      if (!admins.length) throw new RefundError('REFUND_FORBIDDEN', 403);
      const [same] = await c.execute("SELECT * FROM REEMBOLSO_RECURRENTE WHERE ambiente='sandbox' AND idempotency_key=? FOR UPDATE", [body.idempotency_key]);
      const history = await refunds(c, id, true), money = budget(local, history);
      const fingerprint = createHash('sha256').update(JSON.stringify({
        transaction: Number(id), actor: Number(actor.id), motivo: body.motivo, intent_id: local.id_externo,
        checkout: Number(local.id_checkout), payment: Number(local.id_pago), quota: Number(local.id_cuota),
        user: Number(local.id_usuario), house: Number(local.id_casa), currency: local.moneda, environment: local.ambiente,
        sandbox: local.sandbox_id, original_amount: Number(local.monto_centavos),
        authorized_refund: Number(same[0]?.monto_centavos ?? money.disponible_centavos),
      })).digest('hex');
      if (same.length) {
        if (same[0].request_fingerprint !== fingerprint || Number(same[0].id_transaccion) !== Number(id)) throw new RefundError('REFUND_IDEMPOTENCY_CONFLICT');
        return { repeated: true, refund: same[0], local };
      }
      const totals = await quotaTotals(c, local);
      if (Number(totals.refund_bloqueante)) throw new RefundError('REFUND_BLOCKED');
      if (!eligibleLocal(local, client.sandboxId()) || !coherentAggregate(local,money) || money.disponible_centavos <= 0) throw new RefundError('REFUND_INELIGIBLE');
      try { assertCollectible(calculateBalance({ monto: local.monto, ...totals })); }
      catch { throw new RefundError('REFUND_INELIGIBLE'); }
      const [checkouts] = await c.execute(`SELECT id_checkout FROM CHECKOUT_RECURRENTE WHERE id_cuota=? AND ${BLOCKING_CHECKOUT_CONDITION} FOR UPDATE`, [local.id_cuota]);
      if (checkouts.length) throw new RefundError('REFUND_BLOCKED');
      const [insert] = await c.execute(`INSERT INTO REEMBOLSO_RECURRENTE
        (id_transaccion,idempotency_key,id_usuario_solicitante,monto_centavos,moneda,ambiente,tipo,estado,referencia_local,request_fingerprint,motivo,sandbox_id)
        VALUES(?,?,?,?,'GTQ','sandbox','TOTAL','SOLICITADO',?,?,?,?)`,
      [Number(id), body.idempotency_key, actor.id, money.disponible_centavos, randomUUID(), fingerprint, body.motivo, client.sandboxId()]);
      const [rows] = await c.execute('SELECT * FROM REEMBOLSO_RECURRENTE WHERE id_reembolso=?', [insert.insertId]);
      return { local, refund: rows[0], repeated: false };
    });
  }
  async function markFailure(id, error, dispatched) {
    await transaction(async c => {
      const [locators] = await c.execute('SELECT id_transaccion FROM REEMBOLSO_RECURRENTE WHERE id_reembolso=?', [id]);
      await lockTransaction(c, locators[0].id_transaccion); const all = await refunds(c, locators[0].id_transaccion, true);
      const r = all.find(v => Number(v.id_reembolso) === Number(id));
      if (r.aplicado_en || r.estado === 'CONFIRMADO' || r.estado === 'FALLIDO') return;
      // Preflight failure never dispatched a refund. After dispatch uncertainty reserves forever.
      const uncertain = dispatched && (!(error instanceof RefundError) || error.uncertain);
      const state = r.estado === 'REVISION' ? 'REVISION' : uncertain ? 'INCIERTO' : 'FALLIDO';
      const externalId = providerId(error.refund?.id, 're') ? error.refund.id : null;
      const [conflict] = externalId ? await c.execute('SELECT id_reembolso FROM REEMBOLSO_RECURRENTE WHERE ambiente=? AND id_externo=?', [r.ambiente, externalId]) : [[]];
      if (conflict.some(v => Number(v.id_reembolso) !== Number(id))) {
        await c.execute("UPDATE REEMBOLSO_RECURRENTE SET estado='REVISION',error_codigo='REFUND_REVIEW' WHERE id_reembolso=?", [id]); return;
      }
      await c.execute(`UPDATE REEMBOLSO_RECURRENTE SET estado=?,error_codigo=?,id_externo=COALESCE(id_externo,?) WHERE id_reembolso=?`,
        [state, state === 'REVISION' ? 'REFUND_REVIEW' : uncertain ? 'REFUND_UNKNOWN' : 'REFUND_PROVIDER_REJECTED', externalId, id]);
    });
  }
  async function apply(id, evidence, channel, context) {
    return transaction(c => applyRefundEvidence(c, id, evidence, channel, context));
  }
  return { eligibility, async history(actor, id) { return (await eligibility(actor, id)).reembolsos; }, apply,
    async request(actor, id, input) {
      admin(actor); if (!positive(id)) throw new RefundError('REFUND_INVALID_REQUEST', 400);
      const body = requestInput(input), operation = await reserve(actor, id, body);
      if (operation.repeated) return { result: 'existing', refund: publicRefund(operation.refund) };
      let dispatched = false, evidence = null;
      try {
        const session = await client.open(operation.local);
        evidence = await session.send(operation.refund, async () => {
          await transaction(async c => {
            await lockTransaction(c, id);
            const [r] = await c.execute("UPDATE REEMBOLSO_RECURRENTE SET estado='INCIERTO',enviado_en=NOW(6),cuenta_proveedor=?,error_codigo='REFUND_SENDING' WHERE id_reembolso=? AND estado='SOLICITADO'", [session.context.accountId, operation.refund.id_reembolso]);
            if (r.affectedRows !== 1) throw new RefundError('REFUND_BLOCKED');
          }); dispatched = true;
        });
        return await apply(operation.refund.id_reembolso, evidence, 'POST', session.context);
      } catch (e) {
        const safe = e instanceof RefundError ? e : new RefundError(dispatched ? 'REFUND_UNKNOWN' : 'REFUND_EXTERNAL_EVIDENCE', 503, { uncertain: dispatched });
        if (providerId(evidence?.id, "re") && !safe.refund) safe.refund={id:evidence.id};
        await markFailure(operation.refund.id_reembolso, safe, dispatched);
        throw safe;
      }
    },
    async verify(actor, id) {
      admin(actor); if (!positive(id)) throw new RefundError('REFUND_INVALID_REQUEST', 400);
      const c = await pool.getConnection(); let local;
      try { const [rows] = await c.execute('SELECT * FROM REEMBOLSO_RECURRENTE WHERE id_reembolso=?', [id]); local = rows[0]; }
      finally { c.release(); }
      if (!local) throw new RefundError('REFUND_NOT_FOUND', 404);
      if (!providerId(local.id_externo, 're')) throw new RefundError('REFUND_NO_EXTERNAL_ID');
      let observation;
      try { observation = await client.getRefund(local.id_externo); }
      catch { throw new RefundError('REFUND_UNKNOWN', 503, { uncertain: true }); }
      return apply(id, observation.refund, 'GET', observation.context);
    } };
}

async function receiveRefundWebhook(c, event, inbox, sandboxId, complete) {
  const [known] = event.sourceId ? await c.execute("SELECT id_reembolso,id_transaccion,cuenta_proveedor FROM REEMBOLSO_RECURRENTE WHERE ambiente='sandbox' AND id_externo=?", [event.sourceId]) : [[]];
  let local;
  if (known[0]) local = await localTransaction(c, known[0].id_transaccion);
  else if (event.parentId) {
    const [parents] = await c.execute(`SELECT DISTINCT tr.id_transaccion FROM TRANSACCION_RECURRENTE tr
      LEFT JOIN EVENTO_RECURRENTE e ON e.id_evento=tr.id_evento WHERE tr.ambiente='sandbox' AND tr.id_pago IS NOT NULL
      AND (e.tipo_evento='payment_intent.succeeded' AND e.id_operacion_externa=? OR EXISTS(SELECT 1 FROM EVENTO_RECURRENTE orig
        WHERE orig.id_checkout=tr.id_checkout AND orig.tipo_evento='payment_intent.succeeded' AND orig.id_operacion_externa=?))`, [event.parentId, event.parentId]);
    if (parents.length === 1) local = await localTransaction(c, parents[0].id_transaccion);
  }
  if (local) {
    // Assigning this FK takes a checkout lock. Acquire quota -> checkout ->
    // transaction first so simultaneous refund deliveries cannot invert that order.
    local = await lockTransaction(c, local.id_transaccion);
    await c.execute('UPDATE EVENTO_RECURRENTE SET id_checkout=? WHERE id_evento=?', [local.id_checkout, inbox.id_evento]);
  }
  if (event.code || !local || local.sandbox_id !== sandboxId || !providerId(local.legacy_intent, 'pa') || local.legacy_intent !== event.parentId) {
    return complete('REVISION', event.code || 'REFUND_ASSOCIATION_UNPROVEN');
  }
  if (!known[0]) {
    // A webhook may outrun binding of the POST response. Exact parent alone does not
    // prove which request created a refund; never bind by equal amount.
    const all = await refunds(c, local.id_transaccion);
    if (all.some(r => RESERVED.includes(r.estado) && !r.id_externo)) {
      throw Object.assign(new Error('Entrega reintentable.'), { code: 'WEBHOOK_REFUND_NOT_READY', status: 503 });
    }
    return complete('REVISION', 'REFUND_EXTERNAL_UNKNOWN');
  }
  const outcome = await applyRefundEvidence(c, known[0].id_reembolso, event.refund, 'WEBHOOK',
    { environment: 'sandbox', sandboxId, accountId: known[0].cuenta_proveedor }, inbox.id_evento);
  await complete(outcome.result === 'review' ? 'REVISION' : 'PROCESADO', outcome.result === 'review' ? 'REFUND_REVIEW' : null);
  return outcome.result;
}
module.exports = { createRefundService, applyRefundEvidence, receiveRefundWebhook,
  __private__: { requestInput, eligibleLocal, budget, localTransaction, publicRefund } };
