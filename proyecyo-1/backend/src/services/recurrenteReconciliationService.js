const { pool: defaultPool } = require('../database/mysql');
const { QUOTA_BALANCES_SQL, toCents } = require('./financialBalance');
const { createRecurrenteReadClient } = require('./recurrenteReadClient');
const { compareOperation, officialDate, RESULTS } = require('./recurrenteReconciliationCompare');
const { paymentTime } = require('./recurrenteWebhookPayload');
const MAX_OPERATIONS = 200;
const STATES = ['PENDIENTE', 'CONFIRMADA', 'FALLIDA', 'CANCELADA', 'REEMBOLSADA_PARCIAL', 'REEMBOLSADA', 'CREADO', 'CONFIRMADO', 'FALLIDO', 'CANCELADO', 'EXPIRADO', 'INCIERTO'];
const ERROR_CODES = ['RESPUESTA_INVALIDA', 'TIMEOUT', 'REFERENCIA_NO_LOCALIZADA', 'AUTENTICACION_PROVEEDOR', 'LIMITE_PROVEEDOR', 'PROVEEDOR_NO_DISPONIBLE', 'NO_CONFIGURADO', 'CONTEXTO_SANDBOX_INVALIDO', 'REFERENCIA_INVALIDA'];
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const positiveId = v => /^\d+$/.test(String(v)) && Number.isSafeInteger(Number(v)) && Number(v) > 0;
function filters(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(k => !['desde', 'hasta', 'estado_local', 'resultado', 'residente', 'referencia'].includes(k))) fail('Los filtros de conciliación son inválidos.');
  const out = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, String(v ?? '').trim()]));
  for (const key of ['desde', 'hasta']) if (out[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(out[key]) || !paymentTime(`${out[key]}T00:00:00Z`))) fail('El rango de fechas es inválido.');
  if (out.desde && out.hasta && out.desde > out.hasta) fail('La fecha inicial no puede ser posterior a la final.');
  if (out.estado_local && !STATES.includes(out.estado_local)) fail('El estado local es inválido.');
  if (out.resultado && !RESULTS.includes(out.resultado)) fail('El resultado de conciliación es inválido.');
  if (out.residente && !positiveId(out.residente)) fail('El residente del filtro es inválido.');
  if (out.referencia && !/^[A-Za-z0-9_-]{1,191}$/.test(out.referencia)) fail('La referencia del filtro es inválida.');
  return out;
}
function selection(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(k => !['id_transaccion', 'ids_transacciones', 'id_checkout', 'filtros', 'descubrir_externas'].includes(k))) fail('Envía únicamente identificadores locales o filtros.');
  const selectors = ['id_transaccion', 'ids_transacciones', 'id_checkout'].filter(k => body[k] !== undefined);
  if (selectors.length > 1 || selectors.length && body.filtros !== undefined) fail('La selección y los filtros no pueden combinarse.');
  if (body.descubrir_externas !== undefined && typeof body.descubrir_externas !== 'boolean') fail('La opción de descubrimiento es inválida.');
  const f = filters(body.filtros);
  let ids = null, checkoutId = null;
  if (selectors[0] === 'ids_transacciones') {
    if (!Array.isArray(body.ids_transacciones) || !body.ids_transacciones.length || body.ids_transacciones.length > 100 || !body.ids_transacciones.every(positiveId)) fail('La selección de transacciones es inválida.');
    ids = [...new Set(body.ids_transacciones.map(Number))];
  } else if (selectors[0]) {
    if (!positiveId(body[selectors[0]])) fail('El identificador local es inválido.');
    if (selectors[0] === 'id_checkout') checkoutId = Number(body.id_checkout); else ids = [Number(body.id_transaccion)];
  }
  if (body.descubrir_externas && (selectors.length || !f.desde || !f.hasta)) fail('El descubrimiento externo requiere un período completo y filtros.');
  return { filters: f, ids, checkoutId, discover: body.descubrir_externas === true };
}
const placeholders = values => values.map(() => '?').join(',');
async function loadCatalog(criteria, pool = defaultPool) {
  const c = await pool.getConnection();
  try {
    await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await c.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    const f = criteria.filters, where = ["co.ambiente='sandbox'"], params = [];
    if (criteria.ids) { where.push(`tr.id_transaccion IN (${placeholders(criteria.ids)})`); params.push(...criteria.ids); }
    if (criteria.checkoutId) { where.push('co.id_checkout=?'); params.push(criteria.checkoutId); }
    if (criteria.externalIds) {
      where.push(`(co.id_externo IN (${placeholders(criteria.externalIds)}) OR tr.id_externo IN (${placeholders(criteria.externalIds)})
        OR EXISTS(SELECT 1 FROM INTENTO_RECURRENTE ir WHERE ir.id_transaccion=tr.id_transaccion AND ir.id_externo IN (${placeholders(criteria.externalIds)})))`);
      params.push(...criteria.externalIds, ...criteria.externalIds,...criteria.externalIds);
    }
    if (f.residente) { where.push('co.id_residente=?'); params.push(Number(f.residente)); }
    if (f.estado_local) { where.push('COALESCE(tr.estado,co.estado)=?'); params.push(f.estado_local); }
    if (f.referencia) {
      where.push("(co.id_externo=? OR co.referencia_local=? OR tr.id_externo=? OR tr.id_pago_externo=? OR CONCAT('NXR-',LPAD(pg.id_pago,8,'0'))=? OR CAST(co.id_checkout AS CHAR)=? OR CAST(tr.id_transaccion AS CHAR)=? OR CAST(pg.id_pago AS CHAR)=? OR CAST(co.id_cuota AS CHAR)=?)");
      params.push(...Array(9).fill(f.referencia));
      where[where.length-1]=`(${where[where.length-1]} OR EXISTS(SELECT 1 FROM INTENTO_RECURRENTE ir WHERE ir.id_transaccion=tr.id_transaccion AND ir.id_externo=?))`;
      params.push(f.referencia);
    }
    const accountingDate = 'COALESCE(DATE(DATE_SUB(tr.fecha_proveedor_utc,INTERVAL 6 HOUR)),pg.fecha_pago)';
    if (f.desde) { where.push(`(${accountingDate} IS NULL OR ${accountingDate}>=?)`); params.push(f.desde); }
    if (f.hasta) { where.push(`(${accountingDate} IS NULL OR ${accountingDate}<=?)`); params.push(f.hasta); }
    // Unknown dates remain visible. DATE columns are already accounting dates in Guatemala;
    // timestamp interpretation uses the authoritative original value below, never SQL NOW().
    const [rows] = await c.execute(`SELECT co.id_checkout,co.referencia_local,co.id_externo co_externo,co.id_cuota,co.id_usuario,
      co.id_residente,co.id_casa,co.monto_centavos co_monto,co.moneda co_moneda,co.ambiente co_ambiente,
      co.estado co_estado,co.estado_proveedor,co.sandbox_id,DATE_FORMAT(co.verificado_en,'%Y-%m-%d %H:%i:%s.%f') verificado_en,
      DATE_FORMAT(co.actualizado_en,'%Y-%m-%d %H:%i:%s.%f') co_actualizado,
      r.id_residente actual_residente,cu.id_casa cuota_casa,COALESCE(cu.id_responsable,co.id_usuario) residente_usuario,u.nombre residente_nombre,
      CONCAT_WS('-',NULLIF(ca.torre,''),ca.numero) unidad,srv.nombre concepto,
      tr.id_transaccion,tr.id_externo tr_externo,tr.id_pago_externo,tr.id_pago,tr.id_cuota tr_cuota,tr.id_usuario tr_usuario,tr.id_casa tr_casa,
      tr.monto_centavos tr_monto,tr.moneda tr_moneda,tr.ambiente tr_ambiente,tr.estado tr_estado,
      tr.fecha_proveedor_original,DATE_FORMAT(tr.fecha_proveedor_utc,'%Y-%m-%dT%H:%i:%s.%fZ') fecha_utc,
      DATE_FORMAT(tr.confirmado_en,'%Y-%m-%d %H:%i:%s.%f') confirmado_en,tr.capital_aplicado_centavos,tr.recargo_aplicado_centavos,
      tr.motivo_codigo,tr.motivo_sanitizado,DATE_FORMAT(tr.actualizado_en,'%Y-%m-%d %H:%i:%s.%f') tr_actualizado,
      pg.id_pago pg_id,pg.id_cuota pg_cuota,pg.monto_pagado,DATE_FORMAT(pg.fecha_pago,'%Y-%m-%d') fecha_pago,
      po.origen,po.ambiente pago_ambiente,b.saldo_pendiente,b.total_pagado,b.total_reembolsado,b.abono_neto,b.recargo,b.sobrepago
      FROM CHECKOUT_RECURRENTE co JOIN CUOTA cu ON cu.id_cuota=co.id_cuota
      JOIN CASA ca ON ca.id_casa=cu.id_casa LEFT JOIN RESIDENTE r
        ON r.id_usuario=COALESCE(cu.id_responsable,co.id_usuario)
      JOIN USUARIO u ON u.id_usuario=COALESCE(cu.id_responsable,co.id_usuario) JOIN SERVICIO srv ON srv.id_servicio=cu.id_servicio
      JOIN (${QUOTA_BALANCES_SQL}) b ON b.id_cuota=co.id_cuota
      LEFT JOIN TRANSACCION_RECURRENTE tr ON tr.id_checkout=co.id_checkout
      LEFT JOIN PAGO pg ON pg.id_pago=tr.id_pago LEFT JOIN PAGO_ORIGEN po ON po.id_pago=pg.id_pago
      WHERE ${where.join(' AND ')} ORDER BY co.id_checkout DESC,tr.id_transaccion DESC LIMIT 201`, params);
    const mapped = rows.map(row => ({
      key: row.id_transaccion ? `intent:${row.id_transaccion}` : `checkout:${row.id_checkout}`,
      checkout: { id_checkout: Number(row.id_checkout), referencia_local: row.referencia_local, id_externo: row.co_externo,
        id_cuota: Number(row.id_cuota), id_usuario: Number(row.id_usuario), id_residente: Number(row.id_residente), id_casa: Number(row.id_casa),
        monto_centavos: Number(row.co_monto), moneda: row.co_moneda, ambiente: row.co_ambiente, estado: row.co_estado,
        estado_proveedor: row.estado_proveedor, sandbox_id: row.sandbox_id, verificado_en: row.verificado_en, actualizado_en: row.co_actualizado },
      intent: row.id_transaccion ? { id_transaccion: Number(row.id_transaccion), id_externo: row.tr_externo, id_pago_externo: row.id_pago_externo,
        id_pago: row.id_pago == null ? null : Number(row.id_pago), id_cuota: Number(row.tr_cuota), id_usuario: Number(row.tr_usuario), id_casa: Number(row.tr_casa),
        monto_centavos: Number(row.tr_monto), moneda: row.tr_moneda, ambiente: row.tr_ambiente, estado: row.tr_estado,
        fecha_proveedor_original: row.fecha_proveedor_original || row.fecha_utc, confirmado_en: row.confirmado_en,
        capital_aplicado_centavos: row.capital_aplicado_centavos == null ? null : Number(row.capital_aplicado_centavos),
        recargo_aplicado_centavos: row.recargo_aplicado_centavos == null ? null : Number(row.recargo_aplicado_centavos),
        motivo_codigo: row.motivo_codigo, motivo_sanitizado: row.motivo_sanitizado, actualizado_en: row.tr_actualizado } : null,
      payment: row.pg_id ? { id_pago: Number(row.pg_id), id_cuota: Number(row.pg_cuota), monto_pagado: row.monto_pagado,
        fecha_pago: row.fecha_pago, origen: row.origen, ambiente: row.pago_ambiente } : null,
      residentId: Number(row.actual_residente), residentUserId: Number(row.residente_usuario), quotaHouseId: Number(row.cuota_casa),
      residentName: row.residente_nombre, unit: row.unidad, concept: row.concepto,
      balance: { saldo: row.saldo_pendiente, pagado: row.total_pagado, reembolsado: row.total_reembolsado, abono_neto: row.abono_neto, recargo: row.recargo, sobrepago: row.sobrepago },
      events: [], refunds: [],
    }));
    const filtered = mapped.filter(op => dateMatches(localDate(op), f));
    const complete = rows.length <= MAX_OPERATIONS, operations = filtered.slice(0, MAX_OPERATIONS);
    const coIds = [...new Set(operations.map(op => op.checkout.id_checkout))];
    const externalIds = [...new Set(operations.flatMap(op => [op.intent?.id_externo, op.intent?.id_pago_externo]).filter(Boolean))];
    const trIds = operations.map(op => op.intent?.id_transaccion).filter(Boolean);
    let events = [], refunds = [], attempts = [];
    if (coIds.length) [events] = await c.execute(`SELECT id_evento,svix_id,tipo_evento,estado,intentos,error_codigo,id_checkout,id_operacion_externa
      FROM EVENTO_RECURRENTE WHERE id_checkout IN (${placeholders(coIds)})${externalIds.length ? ` OR id_operacion_externa IN (${placeholders(externalIds)})` : ''} ORDER BY id_evento`, [...coIds, ...externalIds]);
    if (trIds.length) [refunds] = await c.execute(`SELECT id_reembolso,id_transaccion,id_externo,estado,estado_proveedor,monto_centavos,moneda,ambiente,aplicado_en,capital_revertido_centavos,recargo_revertido_centavos,DATE_FORMAT(fecha_contable,'%Y-%m-%d') fecha_contable FROM REEMBOLSO_RECURRENTE
      WHERE id_transaccion IN (${placeholders(trIds)}) ORDER BY id_reembolso`, trIds);
    if(trIds.length) [attempts]=await c.execute(`SELECT id_intento,id_transaccion,id_externo,id_pago_externo,estado,id_evento,
      monto_centavos,moneda,fecha_proveedor_original FROM INTENTO_RECURRENTE WHERE id_transaccion IN (${placeholders(trIds)}) ORDER BY id_intento`,trIds);
    for (const op of operations) {
      op.events = events.filter(e => Number(e.id_checkout) === op.checkout.id_checkout || [op.intent?.id_externo, op.intent?.id_pago_externo].includes(e.id_operacion_externa));
      op.refunds = refunds.filter(r => Number(r.id_transaccion) === op.intent?.id_transaccion);
      op.attempts = attempts.filter(r=>Number(r.id_transaccion)===op.intent?.id_transaccion);
    }
    await c.commit(); return { operations, complete };
  } catch (e) { await c.rollback().catch(() => {}); throw e; }
  finally { c.release(); }
}
function localDate(op) { return officialDate(op.intent?.fecha_proveedor_original) || op.payment?.fecha_pago || null; }
function dateMatches(date, f) { return !date || (!f.desde || date >= f.desde) && (!f.hasta || date <= f.hasta); }
function publicOperation(op, observation = {}, decision = compareOperation(op)) {
  const date = officialDate(observation.intent?.createdAt) || (op.intent ? localDate(op) : officialDate(observation.checkout?.createdAt));
  return { clave: op.key, id_transaccion: op.intent?.id_transaccion ?? null, id_checkout: op.checkout.id_checkout,
    id_cuota: op.checkout.id_cuota, id_pago: op.payment?.id_pago ?? null, id_residente: op.residentId,
    residente: op.residentName, unidad: op.unit, concepto: op.concept, referencia_local: op.checkout.referencia_local,
    numero_comprobante: op.payment && ['CONFIRMADA','REEMBOLSADA_PARCIAL','REEMBOLSADA'].includes(op.intent?.estado) ? `NXR-${String(op.payment.id_pago).padStart(8, '0')}` : null,
    fecha_operacion: date, sin_fecha_verificable: date === null, ...decision,
    interno: { intent_id: op.intent?.id_externo ?? null, checkout_id: op.checkout.id_externo, pago_externo: op.intent?.id_pago_externo ?? null,
      estado_transaccion: op.intent?.estado ?? null, estado_checkout: op.checkout.estado, estado_proveedor: op.checkout.estado_proveedor,
      monto_centavos: op.intent?.monto_centavos ?? op.checkout.monto_centavos, moneda: op.intent?.moneda ?? op.checkout.moneda,
      ambiente: op.checkout.ambiente, fecha_pago: op.payment?.fecha_pago ?? null },
    externo: observation.checkout || observation.intent ? { intent_id: observation.intent?.id ?? null, checkout_id: observation.checkout?.id ?? null,
      pago_externo: observation.checkout?.paymentId ?? null, estado_intento: observation.intent?.status ?? null,
      estado_checkout: observation.checkout?.status ?? null, monto_centavos: observation.intent?.amount ?? observation.checkout?.amount ?? null,
      moneda: observation.intent?.currency ?? observation.checkout?.currency ?? null, ambiente: observation.context?.environment ?? null,
      fecha_original: observation.intent?.createdAt ?? observation.checkout?.createdAt ?? null,
      motivo_codigo: observation.intent?.reason?.code ?? null, motivo: observation.intent?.reason?.message ?? null } : null,
    saldo_actual_centavos: toCents(op.balance.saldo), sobrepago_centavos: toCents(op.balance.sobrepago),
    cobertura_reembolsos: { completa: false, motivo: 'SIN_LISTADO_AUTORITATIVO_DE_REEMBOLSOS' },
    intentos: op.attempts || [],
    reembolsos: op.refunds, devuelto_centavos: op.refunds.filter(r=>r.estado==='CONFIRMADO'&&r.aplicado_en).reduce((n,r)=>n+Number(r.monto_centavos),0),
    abono_neto_centavos: op.intent ? Number(op.intent.monto_centavos)-op.refunds.filter(r=>r.estado==='CONFIRMADO'&&r.aplicado_en).reduce((n,r)=>n+Number(r.monto_centavos),0) : null,
    eventos: op.events.map(e => ({ id: Number(e.id_evento), svix_id: e.svix_id, tipo: e.tipo_evento, estado: e.estado, intentos: e.intentos, codigo: e.error_codigo })),
  };
}
function response(operations, criteria, complete, discovery = { solicitada: false, completa: null, motivo: 'NO_SOLICITADA' }, candidates = [], verified = false) {
  const summary = { evaluadas: operations.length, conciliadas: 0, diferencias: 0, pendientes: 0, errores_verificacion: 0, sin_fecha: 0 };
  const count = { CONCILIADA: 'conciliadas', DIFERENCIA: 'diferencias', PENDIENTE: 'pendientes', ERROR_DE_VERIFICACION: 'errores_verificacion' };
  for (const op of operations) { summary[count[op.clasificacion]]++; if (op.sin_fecha_verificable) summary.sin_fecha++; }
  return { ambiente: 'sandbox', alcance: criteria.ids || criteria.checkoutId ? 'seleccion' : 'filtros', verificado: verified,
    completo: complete && (!discovery.solicitada || discovery.completa === true), limite_operaciones: MAX_OPERATIONS,
    resumen: summary, operaciones: operations.filter(op => !criteria.filters.resultado || op.clasificacion === criteria.filters.resultado),
    exploracion_externa: discovery, externas_sin_asociacion: candidates };
}
function createReconciliationService({ load = loadCatalog, client = createRecurrenteReadClient() } = {}) {
  const inFlight = new Map();
  function share(key, work) {
    if (!inFlight.has(key)) { const pending = Promise.resolve().then(work); inFlight.set(key, pending); pending.finally(() => { if (inFlight.get(key) === pending) inFlight.delete(key); }).catch(() => {}); }
    return inFlight.get(key);
  }
  return {
    async list(input) {
      const criteria = { filters: filters(input), ids: null, checkoutId: null }, snapshot = await load(criteria);
      return response(snapshot.operations.map(op => publicOperation(op)), criteria, snapshot.complete);
    },
    async verify(body) {
      const criteria = selection(body), before = await load(criteria);
      if (criteria.ids && criteria.ids.some(id => !before.operations.some(op => op.intent?.id_transaccion === id))
        || criteria.checkoutId && !before.operations.length) fail('La operación local no existe.', 404);
      let session, contextError = null;
      if (before.operations.length || criteria.discover) {
        try { session = await client.open(); } catch (e) { contextError = ERROR_CODES.includes(e.code) ? e.code : 'PROVEEDOR_NO_DISPONIBLE'; }
      }
      const observations = new Map();
      // At most four simultaneous operation verifications; no SQL connection survives HTTP.
      async function observe(op) {
        const o = { context: session?.context };
        if (contextError) { o.error = contextError; observations.set(op.key, o); return; }
        if (!op.checkout.id_externo) { observations.set(op.key, o); return; }
        try {
          const key = `${session.context.accountId}:${session.context.sandboxId}`;
          o.resource = 'checkout'; o.reference = op.checkout.id_externo;
          o.checkout = await share(`${key}:checkout:${op.checkout.id_externo}`, () => session.getCheckout(op.checkout.id_externo));
          if (op.intent) {
            o.resource = 'intent'; o.reference = op.intent.id_externo;
            o.intent = await share(`${key}:intent:${op.intent.id_externo}`, () => session.getIntent(op.intent.id_externo));
          }
          o.refunds=[];
          for (const r of op.refunds) if(r.id_externo) {
            o.resource='refund';o.reference=r.id_externo;
            o.refunds.push(await share(`${key}:refund:${r.id_externo}`,()=>session.getRefund(r.id_externo)));
          }
        } catch (e) { o.error = ERROR_CODES.includes(e.code) ? e.code : 'PROVEEDOR_NO_DISPONIBLE'; }
        observations.set(op.key, o);
      }
      for (let i = 0; i < before.operations.length; i += 4) await Promise.all(before.operations.slice(i, i + 4).map(observe));
      let discovery = { solicitada: criteria.discover, completa: null, motivo: criteria.discover ? 'NO_VERIFICADA' : 'NO_SOLICITADA' }, candidates = [];
      if (criteria.discover && session) {
        try {
          const from = `${criteria.filters.desde}T00:00:00-06:00`, until = `${criteria.filters.hasta}T23:59:59.999999-06:00`;
          const intents = await session.discoverIntents(from, until), checkouts = await session.discoverCheckouts(from, until);
          discovery = { solicitada: true, completa: intents.complete && checkouts.complete, motivo: intents.reason || checkouts.reason,
            paginas_intents: intents.pages, paginas_checkouts: checkouts.pages };
          // Resolve association by exact discovered references, independently of active filters
          // or the 200-row display limit; never call a known local operation unassociated.
          const references = [...new Set([...intents.records, ...checkouts.records].map(v => v.id))];
          const knownOperations = []; let knownComplete = true;
          for (let i = 0; i < references.length; i += 100) {
            const batch = await load({ filters: {}, ids: null, checkoutId: null, externalIds: references.slice(i, i + 100) });
            knownOperations.push(...batch.operations); knownComplete = knownComplete && batch.complete;
          }
          const allKnown = { operations: knownOperations, complete: knownComplete };
          const knownIntent = new Set(allKnown.operations.flatMap(op => [op.intent?.id_externo,...(op.attempts||[]).map(a=>a.id_externo)]));
          const knownCheckout = new Set(allKnown.operations.map(op => op.checkout.id_externo));
          candidates = [...intents.records.filter(v => v.type === 'payment' && !knownIntent.has(v.id)).map(v => ({ tipo: 'intent', id_externo: v.id, checkout_id: v.checkout?.id ?? null, estado: v.status, monto_centavos: v.amount, moneda: v.currency, fecha_operacion: officialDate(v.createdAt) })),
            ...checkouts.records.filter(v => !knownCheckout.has(v.id)).map(v => ({ tipo: 'checkout', id_externo: v.id, checkout_id: v.id, estado: v.status, monto_centavos: v.amount, moneda: v.currency, fecha_operacion: officialDate(v.createdAt) }))]
            .map(v => ({ ...v, clasificacion: 'PENDIENTE', motivo: 'ASOCIACION_NO_VERIFICADA' }));
          if (!allKnown.complete) { candidates = []; discovery.completa = false; discovery.motivo = 'CATALOGO_LOCAL_PARCIAL'; }
        } catch (e) { discovery = { solicitada: true, completa: false, motivo: ERROR_CODES.includes(e.code) ? e.code : 'PROVEEDOR_NO_DISPONIBLE' }; }
      } else if (criteria.discover && contextError) discovery = { solicitada: true, completa: false, motivo: contextError };
      const after = await load(criteria), latest = new Map(after.operations.map(op => [op.key, op]));
      const operations = before.operations.map(op => {
        const o = observations.get(op.key) || {};
        o.concurrent = !latest.has(op.key) || JSON.stringify(op) !== JSON.stringify(latest.get(op.key));
        const current = latest.get(op.key) || op;
        return publicOperation(current, o, compareOperation(current, o));
      }).filter(op => dateMatches(op.fecha_operacion, criteria.filters));
      if (after.operations.some(op => !observations.has(op.key))) {
        for (const op of after.operations.filter(op => !observations.has(op.key))) operations.push(publicOperation(op, {}, compareOperation(op, { concurrent: true })));
      }
      return response(operations, criteria, before.complete && after.complete, discovery, candidates, true);
    },
  };
}
module.exports = { createReconciliationService, loadCatalog, filters, selection };
