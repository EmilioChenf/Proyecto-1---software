const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { configureTestEnvironment, connect } = require('./support/isolatedMysql');

if (process.env.RUN_PHASE0_MYSQL_TESTS !== '1') test('HU19 necesita el runner MySQL desechable', { skip: true }, () => {});
else {
  const isolation = require('./support/suiteIsolation'); isolation.assertOwnedSuiteDatabase(); configureTestEnvironment();
  const db = require('../../src/database/mysql');
  const migrations = require('../../src/database/recurrenteMigration');
  const { createFinancialNotificationsService, guatemalaDate, __private__: rules } = require('../../src/services/financialNotificationsService');
  const { enqueuePayment } = require('../../src/services/financialNotificationOutbox');
  const { createWebhookService } = require('../../src/services/recurrenteWebhookService');
  const { createRefundService } = require('../../src/services/recurrenteRefundService');
  const { QUOTA_BALANCES_SQL, calculateBalance } = require('../../src/services/financialBalance');
  const { paymentPayload, TEST_SANDBOX } = require('./support/recurrenteWebhookFixtures');
  const { attemptPayload, legacyAttempt } = require('./support/recurrenteAttemptFixtures');
  const { paidFixture, delivery, evidence, mockClient, refundPayload } = require('./support/recurrenteRefundFixtures');
  let conn, protectedBefore, server, base, externalCalls = 0;
  const savedFetch = global.fetch;
  global.fetch = (url, ...args) => {
    if (new URL(url).hostname !== '127.0.0.1') { externalCalls++; throw new Error('External requests forbidden'); }
    return savedFetch(url, ...args);
  };
  const query = async (sql, params = []) => (await conn.query(sql, params))[0];
  const clock = day => () => new Date(`${day}T12:00:00-06:00`);
  const job = (day = '2026-10-04', pool = db.pool) => createFinancialNotificationsService({ pool, now: clock(day) });
  const entries = id => query('SELECT * FROM ENTREGA_NOTIFICACION_FINANCIERA WHERE id_cuota=? ORDER BY id_entrega', [id]);
  const debtEntries = async id => (await entries(id)).filter(r => r.tipo_evento.startsWith('CUOTA_'));
  const balance = async id => (await query(`SELECT * FROM (${QUOTA_BALANCES_SQL}) q WHERE id_cuota=?`, [id]))[0];
  const notifications = id => query(`SELECT n.* FROM NOTIFICACION n JOIN ENTREGA_NOTIFICACION_FINANCIERA e
    ON e.id_notificacion=n.id_notificacion WHERE e.id_cuota=? ORDER BY n.id_notificacion`, [id]);
  async function quota({ amount = '5.00', surcharge = '0.00', paid = '0.00', deadline = '2026-10-04', house = 1, rent = false } = {}) {
    let serviceId = 1;
    if (rent) serviceId = (await query("INSERT INTO SERVICIO(nombre,tipo_servicio,descripcion) VALUES('Renta HU19 TEST','Alquiler','TEST')")).insertId;
    const id = (await query('INSERT INTO CUOTA(id_servicio,id_casa,monto,fecha_limite) VALUES(?,?,?,?)', [serviceId,house,amount,deadline])).insertId;
    if (Number(surcharge)) await query("INSERT INTO RECARGO_APLICADO(id_cuota,id_casa,tipo_regla,monto_original,monto_recargo,fecha_aplicacion) VALUES(?,?,'FIJO',?,?,'2026-10-01')", [id,house,amount,surcharge]);
    if (Number(paid)) {
      const payment = (await query("INSERT INTO PAGO(id_cuota,monto_pagado,fecha_pago) VALUES(?,?,'2020-01-01')", [id,paid])).insertId;
      await query("INSERT INTO PAGO_ORIGEN VALUES(?,?,'HISTORICO','historical',NOW(6))", [payment,id]);
    }
    return id;
  }
  async function checkout(id, state = 'PENDIENTE') {
    const local = { id_cuota: id,id_casa: 1,id_usuario: 3,id_residente: 1,referencia_local: randomUUID(),
      id_externo: `ch_TEST_${randomUUID().replaceAll('-','')}`,idempotency_key: randomUUID(),
      monto_centavos: 500,capital_centavos: 500,recargo_centavos: 0,moneda: 'GTQ',ambiente: 'sandbox',
      sandbox_id: TEST_SANDBOX,estado: state,estado_proveedor: 'unpaid' };
    local.id_checkout = (await query('INSERT INTO CHECKOUT_RECURRENTE SET ?', local)).insertId;
    return local;
  }
  async function locked(id, work, pool = db.pool) {
    const c = await pool.getConnection();
    try { await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED'); await c.beginTransaction();
      await c.execute('SELECT id_cuota FROM CUOTA WHERE id_cuota=? FOR UPDATE', [id]);
      const result = await work(c); await c.commit(); return result;
    } catch (error) { await c.rollback(); throw error; } finally { c.release(); }
  }
  function instrumentPool({ fail, intercept, trace = [] } = {}) {
    let fired = false;
    return { async getConnection() {
      const c = await db.pool.getConnection(), execute = c.execute.bind(c), release = c.release.bind(c);
      c.execute = async (sql,args) => {
        trace.push(sql);
        if (intercept) await intercept(sql,args);
        if (!fired && fail?.test(sql)) { fired = true; return execute('SELECT nonexistent_hu19_column FROM CUOTA'); }
        return execute(sql,args);
      };
      c.release = () => { c.execute = execute; c.release = release; release(); };
      return c;
    } };
  }
  const refund = async (f, client = mockClient()) => createRefundService({ client }).request({ id:1,role:'admin' }, f.transactions[0].id_transaccion,
    { motivo:'Reembolso HU19 TEST',idempotency_key:randomUUID() });
  describe('HU19 SQL real: notificaciones sin proveedor real ni BD compartida mutable', { concurrency: false }, () => {
    before(async () => {
      conn = await connect(); protectedBefore = await isolation.protectedSnapshot(conn);
      await query("INSERT INTO CONFIGURACION(clave,valor) VALUES('recordatorios_activo','true'),('recordatorios_dias_antes','3') ON DUPLICATE KEY UPDATE valor=VALUES(valor)");
      server = require('../../src/app').createApp().listen(0,'127.0.0.1'); await new Promise(r => server.once('listening',r));
      base = `http://127.0.0.1:${server.address().port}`;
    });
    after(async () => {
      try { assert.deepEqual(await isolation.protectedSnapshot(conn),protectedBefore); assert.equal(externalCalls,0); }
      finally { await new Promise(r => server.close(r)); await conn.end(); await db.pool.end(); global.fetch = savedFetch; }
    });
    test('008 es aditiva, reaplicable dos veces, sin backfill', async () => {
      const beforeRows = await query('SELECT * FROM ENTREGA_NOTIFICACION_FINANCIERA');
      await migrations.applyFinancialNotificationsMigration(conn); await migrations.applyFinancialNotificationsMigration(conn);
      assert.deepEqual(await query('SELECT * FROM ENTREGA_NOTIFICACION_FINANCIERA'),beforeRows);
      assert.doesNotMatch(fs.readFileSync(migrations.FINANCIAL_NOTIFICATIONS_MIGRATION_PATH,'utf8'), /DROP|TRUNCATE|DELETE FROM|INSERT INTO/i);
      assert.equal((await entries(171)).length,0); assert.equal((await entries(998)).length,0); assert.equal((await entries(1210)).length,0);
    });
    test('PK, UNIQUE, FK, CHECK y DATETIME(6) reales', async () => {
      const ddl = (await query('SHOW CREATE TABLE ENTREGA_NOTIFICACION_FINANCIERA'))[0]['Create Table'];
      for (const text of ['PRIMARY KEY','uq_entrega_dedup','uq_entrega_notificacion','ix_entrega_pendiente','FOREIGN KEY','CHECK','datetime(6)']) assert(ddl.includes(text),text);
      const id = await quota(); await job().run(); const [row] = await entries(id);
      const copy = { ...row }; delete copy.id_entrega;
      await assert.rejects(query('INSERT INTO ENTREGA_NOTIFICACION_FINANCIERA SET ?',copy), { code:'ER_DUP_ENTRY' });
      copy.dedup_key = 'f'.repeat(64); copy.id_usuario = 2147483647; copy.id_notificacion = null; copy.entregado_en = null; copy.estado = 'PENDIENTE';
      await assert.rejects(query('INSERT INTO ENTREGA_NOTIFICACION_FINANCIERA SET ?',copy), { code:'ER_NO_REFERENCED_ROW_2' });
      await assert.rejects(query("UPDATE ENTREGA_NOTIFICACION_FINANCIERA SET estado='FAKE' WHERE id_entrega=?",[row.id_entrega]));
      const stamp = '2026-10-04 12:34:56.123456';
      await query('UPDATE ENTREGA_NOTIFICACION_FINANCIERA SET creado_en=? WHERE id_entrega=?',[stamp,row.id_entrega]);
      assert.equal((await query('SELECT creado_en FROM ENTREGA_NOTIFICACION_FINANCIERA WHERE id_entrega=?',[row.id_entrega]))[0].creado_en,stamp);
    });
    test('próxima: un aviso al entrar, sin repetición diaria', async () => {
      const id = await quota({deadline:'2026-10-07'});
      await job('2026-10-03').run(); assert.equal((await entries(id)).length,0);
      for (const date of ['2026-10-04','2026-10-05','2026-10-06']) await job(date).run();
      const rows = await entries(id); assert.equal(rows.filter(r => r.id_usuario === 3).length,1); assert.equal(rows[0].tipo_evento,'CUOTA_PROXIMA');
    });
    test('vence hoy es una etapa distinta y única', async () => {
      const id = await quota({deadline:'2026-10-07'}); await job('2026-10-04').run();
      await job('2026-10-07').run(); await job('2026-10-07').run();
      assert.deepEqual((await entries(id)).filter(r => r.id_usuario === 3).map(r => r.tipo_evento),['CUOTA_PROXIMA','CUOTA_HOY']);
    });
    test('cambiar anticipación no repite próxima ya publicada en ese ciclo', async () => {
      const id = await quota({deadline:'2026-10-07'}); await job().run();
      await query("UPDATE CONFIGURACION SET valor='5' WHERE clave='recordatorios_dias_antes'");
      try { await job().run(); assert.equal((await entries(id)).filter(r => r.id_usuario === 3).length,1); }
      finally { await query("UPDATE CONFIGURACION SET valor='3' WHERE clave='recordatorios_dias_antes'"); }
    });
    test('vencida inicial, cada siete días y recuperación sin spam atrasado', async () => {
      const id = await quota({deadline:'2026-10-01'});
      for (let day = 4; day <= 10; day++) await job(`2026-10-${String(day).padStart(2,'0')}`).run();
      assert.equal((await entries(id)).filter(r => r.id_usuario === 3).length,1);
      await job('2026-10-11').run(); await job('2026-10-11').run(); await job('2026-11-02').run();
      assert.deepEqual((await entries(id)).filter(r => r.id_usuario === 3).map(r => r.ventana),['INICIAL','SEMANA:1','SEMANA:2']);
    });
    test('entrega inicial atrasada ancla los siete días; no aviso al día siguiente', async () => {
      const id = await quota({deadline:'2026-10-01'}); await job().generateDeadlines();
      const row = (await entries(id)).find(r => r.id_usuario === 3);
      assert.equal(await job('2026-10-10').deliver(row.id_entrega),'entregada');
      await job('2026-10-11').run(); await job('2026-10-16').run();
      assert.equal((await entries(id)).filter(r => r.id_usuario === 3).length,1);
      await job('2026-10-17').run(); assert.equal((await entries(id)).filter(r => r.id_usuario === 3).length,2);
    });
    test('historial ADMIN combina anteriores y HU19, conserva fecha e importe entregados', async () => {
      const id = await quota({deadline:'2026-10-01'}); await job().run();
      const [row] = await entries(id), service = require('../../src/services/adminRemindersService');
      const summary = await service.getReminderSummary(); assert(summary.total > 0);
      await query("UPDATE CUOTA SET fecha_limite='2026-12-01' WHERE id_cuota=?",[id]);
      const history = await service.listReminders({type:'VENCIDO'}), item = history.find(r => r.id_recordatorio === -Number(row.id_entrega));
      assert(item); assert.equal(item.fecha_limite,'2026-10-01'); assert.equal(item.monto,5);
    });
    for (const [name,options,expected,surcharge] of [
      ['saldo cero', {paid:'5.00'},0,0], ['abono parcial fuera del período', {amount:'100.00',surcharge:'15.00',paid:'50.00'},6500,0],
      ['recargo existente y abono menor', {amount:'100.00',surcharge:'15.00',paid:'10.00'},10500,500],
      ['sobrepago histórico', {paid:'80.00'},null,null],
    ]) test(name, async () => {
      const id = await quota(options); await job().run(); const rows = await entries(id);
      if (!expected) assert.equal(rows.length,0);
      else { assert.equal(Number(rows[0].monto_centavos),expected); assert.equal(Number(rows[0].recargo_centavos),surcharge);
        assert.doesNotMatch(rows[0].mensaje,/evitar recargos/i); if (surcharge) assert.match(rows[0].mensaje,/Q5.00/); }
    });
    for (const count of [1,10,100]) test(`${count} ejecuciones crean una entrega lógica por cuota/usuario/etapa`, async () => {
      const id = await quota(); for (let n = 0; n < count; n++) await job().run();
      assert.equal((await entries(id)).filter(r => r.id_usuario === 3).length,1);
      assert.equal((await notifications(id)).filter(r => r.id_usuario === 3).length,1);
    });
    test('dos generadores concurrentes: UNIQUE y bloqueo de cuota', async () => {
      const id = await quota(); await Promise.all([job().generateDeadlines(),job().generateDeadlines()]);
      assert.equal((await entries(id)).filter(r => r.id_usuario === 3).length,1);
    });
    test('dos consumidores concurrentes no crean avisos duplicados', async () => {
      const id = await quota(); await job().generateDeadlines();
      await Promise.all([job().consume(),job().consume()]);
      assert.equal((await notifications(id)).filter(r => r.id_usuario === 3).length,1);
    });
    test('pago confirmado genera outbox atómico y acción HU16', async () => {
      const f = await paidFixture(conn); const rows = await entries(f.id);
      assert.equal(rows.length,1); assert.equal(rows[0].estado,'PENDIENTE'); assert.equal(rows[0].tipo_evento,'PAGO_CONFIRMADO');
      assert.equal(rows[0].id_pago,f.transactions[0].id_pago); assert.equal(rows[0].fecha_objetivo,'2026-10-02');
      await job().consume(); const [n] = await notifications(f.id);
      assert.equal(n.tipo,'PAGO_CONFIRMADO'); assert.match(n.mensaje,/Q5.00/); assert.equal((await entries(f.id))[0].accion_codigo,'COMPROBANTE_PAGO');
    });
    test('aliases de éxito, replay y 100 solicitudes concurrentes: un PAGO/outbox', async () => {
      const id = await quota(), co = await checkout(id), payload = paymentPayload(co);
      const hook = createWebhookService(), input = delivery(payload);
      await Promise.all(Array.from({length:100},() => hook.receive(input)));
      assert.equal((await query('SELECT * FROM PAGO WHERE id_cuota=?',[id])).length,1);
      assert.equal((await entries(id)).length,1); assert.equal(Number((await balance(id)).saldo_pendiente),0);
    });
    for (const canceled of [false,true]) test(`${canceled ? 'cancelación' : 'rechazo'} autoritativo: aviso único, cero PAGO`, async () => {
      const id = await quota(), co = await checkout(id), payload = attemptPayload(co,{canceled,reason:'secret TEST CVV 000 unsafe'});
      const hook = createWebhookService(); assert.equal(await hook.receive(delivery(payload)),'processed');
      assert.equal(await hook.receive(delivery(payload)),'duplicate');
      if (!canceled) assert.equal(await hook.receive(delivery(legacyAttempt(payload))),'duplicate');
      await job().consume(); const rows = await entries(id), [n] = await notifications(id);
      assert.equal(rows.length,1); assert.equal(n.tipo,canceled ? 'PAGO_CANCELADO' : 'PAGO_NO_COMPLETADO');
      assert.match(n.mensaje,/No se registró un abono/); assert.doesNotMatch(n.mensaje,/secret|CVV|unsafe/);
      assert.equal((await query('SELECT * FROM PAGO WHERE id_cuota=?',[id])).length,0);
      assert.equal(Number((await balance(id)).saldo_pendiente),5);
    });
    for (const state of ['INCIERTO','PENDIENTE','CREADO']) test(`checkout ${state}: sin recordatorios ni avisos definitivos`, async () => {
      const id = await quota(); await checkout(id,state); await job().run(); assert.equal((await entries(id)).length,0);
    });
    test('éxito en revisión no genera aviso definitivo ni recordatorio', async () => {
      const id = await quota(), co = await checkout(id);
      const p = paymentPayload(co,{amount_in_cents:501}); assert.equal(await createWebhookService().receive(delivery(p)),'review');
      await query("UPDATE CHECKOUT_RECURRENTE SET estado='EXPIRADO',estado_proveedor='expired',verificado_en=NOW(6) WHERE id_checkout=?",[co.id_checkout]);
      await job().run(); assert.equal((await entries(id)).length,0);
    });
    test('payment_in_progress almacenado bloquea recordatorios', async () => {
      const id = await quota(), co = await checkout(id);
      await query("UPDATE CHECKOUT_RECURRENTE SET estado_proveedor='payment_in_progress' WHERE id_checkout=?",[co.id_checkout]);
      await job().run(); assert.equal((await entries(id)).length,0);
    });
    test('refund incierto no crea aviso de reembolso ni de deuda', async () => {
      const f = await paidFixture(conn), client = mockClient({send:()=>{throw new Error('TEST unknown');}});
      await assert.rejects(refund(f,client)); await job('2026-11-01').run();
      assert.deepEqual((await entries(f.id)).map(r => r.tipo_evento),['PAGO_CONFIRMADO']);
      assert.equal(Number((await balance(f.id)).saldo_pendiente),0);
    });
    test('provider_outcome_unknown conserva reserva sin aviso definitivo de refund', async () => {
      const f = await paidFixture(conn), reply = evidence(500,{status:'failed',reason:'PROVIDER_OUTCOME_UNKNOWN'});
      const response = await refund(f,mockClient({reply}));
      assert.equal(response.refund.estado,'PENDIENTE'); await job('2026-11-01').run();
      assert.equal((await entries(f.id)).filter(r => r.tipo_evento === 'REEMBOLSO_CONFIRMADO').length,0);
      assert.equal((await debtEntries(f.id)).length,0); assert.equal(Number((await balance(f.id)).saldo_pendiente),0);
    });
    test('refund confirmado reabre saldo, nuevo ciclo y mismo aviso explica reapertura', async () => {
      const id = await quota({deadline:'2026-10-01'}); await job().run(); const history = await notifications(id);
      const co = await checkout(id), input = delivery(paymentPayload(co)); await createWebhookService().receive(input);
      const tr = (await query('SELECT * FROM TRANSACCION_RECURRENTE WHERE id_cuota=?',[id]))[0];
      const response = await createRefundService({client:mockClient()}).request({id:1,role:'admin'},tr.id_transaccion,{motivo:'HU19 TEST',idempotency_key:randomUUID()});
      assert.equal(response.result,'processed'); await job().run();
      const rows = await entries(id), notice = rows.find(r => r.tipo_evento === 'REEMBOLSO_CONFIRMADO');
      assert.equal(Number(notice.ciclo),1); assert.match(notice.mensaje,/vuelve a tener saldo/); assert.equal(Number(notice.saldo_centavos),500);
      assert.deepEqual((await debtEntries(id)).filter(r => r.id_usuario === 3).map(r => Number(r.ciclo)),[0,1]);
      const currentHistory = await notifications(id); for (const n of history) assert.deepEqual(currentHistory.find(x => x.id_notificacion === n.id_notificacion),n);
      assert.equal(Number((await balance(id)).saldo_pendiente),5);
    });
    test('refund parcial sin transición 0 a positivo no avanza ciclo', async () => {
      const f = await paidFixture(conn,{principal:'10.00',payments:[500]}); await refund(f);
      const notice = (await entries(f.id)).find(r => r.tipo_evento === 'REEMBOLSO_CONFIRMADO');
      assert.equal(Number(notice.ciclo),0); assert.doesNotMatch(notice.mensaje,/vuelve a tener/); assert.equal(Number(notice.saldo_centavos),1000);
    });
    test('refund replay y verificación concurrente: una entrega/ciclo/aplicación', async () => {
      const f = await paidFixture(conn), ev = evidence(), client = mockClient({reply:ev});
      const response = await refund(f,client), rr = response.refund, service = createRefundService({client});
      const input = delivery(refundPayload(f,ev));
      await Promise.all([service.verify({id:1,role:'admin'},rr.id_reembolso),createWebhookService().receive(input)]);
      assert.equal((await entries(f.id)).filter(r => r.tipo_evento === 'REEMBOLSO_CONFIRMADO').length,1);
      assert.equal((await query('SELECT ciclo FROM CICLO_NOTIFICACION_CUOTA WHERE id_cuota=?',[f.id]))[0].ciclo,1);
    });
    test('rollback HU14 ante fallo del outbox: cero pago, transacción y entrega; retry seguro', async () => {
      const id = await quota(), co = await checkout(id), input = delivery(paymentPayload(co));
      await assert.rejects(createWebhookService({pool:instrumentPool({fail:/INSERT INTO ENTREGA_NOTIFICACION_FINANCIERA/})}).receive(input));
      assert.equal((await query('SELECT * FROM PAGO WHERE id_cuota=?',[id])).length,0);
      assert.equal((await query('SELECT * FROM TRANSACCION_RECURRENTE WHERE id_cuota=?',[id])).length,0); assert.equal((await entries(id)).length,0);
      assert.equal(await createWebhookService().receive(input),'processed'); assert.equal((await entries(id)).length,1);
    });
    test('rollback HU15: fallo del outbox revierte intento e histórico', async () => {
      const id = await quota(), co = await checkout(id), input = delivery(attemptPayload(co));
      await assert.rejects(createWebhookService({pool:instrumentPool({fail:/INSERT INTO ENTREGA_NOTIFICACION_FINANCIERA/})}).receive(input));
      assert.equal((await query('SELECT * FROM TRANSACCION_RECURRENTE WHERE id_cuota=?',[id])).length,0); assert.equal((await entries(id)).length,0);
      assert.equal(await createWebhookService().receive(input),'processed'); assert.equal((await entries(id)).length,1);
      assert.equal((await query('SELECT * FROM PAGO WHERE id_cuota=?',[id])).length,0);
    });
    test('rollback HU18: refund, saldo, ciclo y aviso atómicos; recuperación conservadora', async () => {
      const f = await paidFixture(conn), ev = evidence(), client = mockClient({reply:ev,send:()=>({...ev,status:'pending'})});
      const response = await refund(f,client), rr = response.refund;
      const broken = createRefundService({pool:instrumentPool({fail:/INSERT INTO ENTREGA_NOTIFICACION_FINANCIERA/}),client});
      await assert.rejects(broken.apply(rr.id_reembolso,ev,'GET',require('./support/recurrenteRefundFixtures').context));
      assert.equal(Number((await balance(f.id)).saldo_pendiente),0);
      assert.equal((await query('SELECT * FROM CICLO_NOTIFICACION_CUOTA WHERE id_cuota=?',[f.id])).length,0);
      assert.equal((await entries(f.id)).filter(r => r.tipo_evento === 'REEMBOLSO_CONFIRMADO').length,0);
      const [original] = await query('SELECT * FROM REEMBOLSO_RECURRENTE WHERE id_reembolso=?',[rr.id_reembolso]); assert.equal(original.aplicado_en,null);
      await createRefundService({client}).verify({id:1,role:'admin'},rr.id_reembolso);
      assert.equal(Number((await balance(f.id)).saldo_pendiente),5); assert.equal((await entries(f.id)).filter(r => r.tipo_evento === 'REEMBOLSO_CONFIRMADO').length,1);
    });
    test('orden de locks: productor y consumidor cuota antes de outbox', async () => {
      const id = await quota(), co = await checkout(id), trace = [];
      await createWebhookService({pool:instrumentPool({trace})}).receive(delivery(paymentPayload(co)));
      const parent = trace.findIndex(s => /FROM CUOTA.*FOR UPDATE/s.test(s));
      const enqueueIndex = trace.findIndex(s => /INSERT INTO ENTREGA_NOTIFICACION_FINANCIERA/.test(s)); assert(parent >= 0 && parent < enqueueIndex);
      trace.length = 0; await job('2026-10-04',instrumentPool({trace})).deliver((await entries(id))[0].id_entrega);
      assert(trace.findIndex(s => /FROM CUOTA.*FOR UPDATE/.test(s)) < trace.findIndex(s => /FROM ENTREGA_NOTIFICACION_FINANCIERA.*FOR UPDATE/.test(s)));
    });
    test('HU15 y HU18 conservan cuota antes de checkout/transacción/refund/outbox', async () => {
      const id = await quota(), co = await checkout(id), attemptTrace = [];
      await createWebhookService({pool:instrumentPool({trace:attemptTrace})}).receive(delivery(attemptPayload(co)));
      const positions = trace => [trace.findIndex(s => /FROM CUOTA.*FOR UPDATE/s.test(s)),
        trace.findIndex(s => /FROM CHECKOUT_RECURRENTE.*FOR UPDATE/s.test(s)),
        trace.findIndex(s => /INSERT INTO ENTREGA_NOTIFICACION_FINANCIERA/.test(s))];
      let [parent,child,outbox] = positions(attemptTrace); assert(parent >= 0 && parent < child && child < outbox);
      const f = await paidFixture(conn), reply = evidence(), client = mockClient({reply,send:()=>({...reply,status:'pending'})});
      const response = await refund(f,client), refundTrace = [];
      await createRefundService({pool:instrumentPool({trace:refundTrace}),client}).apply(response.refund.id_reembolso,reply,'GET',require('./support/recurrenteRefundFixtures').context);
      [parent,child,outbox] = positions(refundTrace); assert(parent >= 0 && parent < child && child < outbox);
      assert(refundTrace.findIndex(s => /FROM REEMBOLSO_RECURRENTE.*FOR UPDATE/s.test(s)) < outbox);
    });
    test('pago confirmado entre generación y entrega omite recordatorio antiguo', async () => {
      const id = await quota(); await job().generateDeadlines(); const co = await checkout(id);
      await createWebhookService().receive(delivery(paymentPayload(co))); await job().consume();
      assert((await debtEntries(id)).every(r => r.estado === 'OMITIDA'));
      assert.equal((await notifications(id)).filter(r => r.tipo.startsWith('CUOTA_')).length,0);
    });
    test('job esperando cuota ve PAGO commitido y no inserta deuda antigua', async () => {
      const id = await quota(), c = await db.pool.getConnection();
      await c.beginTransaction(); await c.execute('SELECT id_cuota FROM CUOTA WHERE id_cuota=? FOR UPDATE',[id]);
      let reached; const waiting = new Promise(r => { reached = r; });
      const concurrent = job('2026-10-04',instrumentPool({intercept:async(sql,args)=>{if(/FROM CUOTA.*FOR UPDATE/.test(sql) && Number(args[0])===id) reached();}})).generateDeadlines();
      await waiting;
      await c.execute("INSERT INTO PAGO(id_cuota,monto_pagado,fecha_pago) VALUES(?,5,'2026-10-04')",[id]);
      await c.commit(); c.release(); await concurrent; assert.equal((await debtEntries(id)).length,0);
    });
    test('refund y generador concurrentes usan nuevo ciclo sin perder aviso', async () => {
      const f = await paidFixture(conn,{deadline:'2026-10-01'});
      await Promise.all([refund(f),job().generateDeadlines()]); await job().run();
      assert.equal((await entries(f.id)).filter(r => r.tipo_evento === 'REEMBOLSO_CONFIRMADO').length,1);
      assert.equal((await debtEntries(f.id)).filter(r => r.id_usuario === 3 && Number(r.ciclo)===1).length,1);
    });
    test('consumer crash después de INSERT NOTIFICACION hace rollback; reinicio entrega una vez', async () => {
      const id = await quota(); await job().generateDeadlines(); const row = (await entries(id)).find(r => r.id_usuario === 3);
      const broken = job('2026-10-04',instrumentPool({fail:/UPDATE ENTREGA_NOTIFICACION_FINANCIERA SET estado='ENTREGADA'/}));
      await assert.rejects(broken.deliver(row.id_entrega)); assert.equal((await notifications(id)).filter(r => r.id_usuario === 3).length,0);
      assert.equal((await entries(id)).find(r => r.id_entrega === row.id_entrega).estado,'PENDIENTE');
      await job().deliver(row.id_entrega); await job().deliver(row.id_entrega);
      assert.equal((await notifications(id)).filter(r => r.id_usuario === 3).length,1);
    });
    test('error recuperable se guarda sanitizado y próxima ejecución lo recupera', async () => {
      const id = await quota(); await job().generateDeadlines();
      const broken = job('2026-10-04',instrumentPool({fail:/INSERT INTO NOTIFICACION/})); const result = await broken.consume(); assert.equal(result.errores,1);
      const [row] = (await query("SELECT * FROM ENTREGA_NOTIFICACION_FINANCIERA WHERE estado='ERROR'"));
      assert.equal(row.error_codigo,'ENTREGA_REINTENTABLE');
      await query('UPDATE ENTREGA_NOTIFICACION_FINANCIERA SET proximo_reintento_en=NULL WHERE id_entrega=?',[row.id_entrega]);
      await job().consume(); assert.equal((await query('SELECT estado FROM ENTREGA_NOTIFICACION_FINANCIERA WHERE id_entrega=?',[row.id_entrega]))[0].estado,'ENTREGADA');
    });
    test('usuario incorrecto y otra unidad no reciben eventos de operación', async () => {
      const f = await paidFixture(conn), row = (await entries(f.id))[0];
      await query('UPDATE ENTREGA_NOTIFICACION_FINANCIERA SET id_usuario=1 WHERE id_entrega=?',[row.id_entrega]);
      assert.equal(await job().deliver(row.id_entrega),'omitida');
      await locked(f.id,c => enqueuePayment(c,{...f.local[0],id_usuario:4},f.transactions[0].id_pago,delivery(f.pairs[0].intent).event));
      const other = (await entries(f.id)).find(r => r.id_usuario === 4); assert.equal(await job().deliver(other.id_entrega),'omitida');
    });
    test('inquilino privado autorizado no recibe deuda del propietario', async () => {
      const id = await quota(), [tenant] = await query('SELECT i.id_inquilino,i.id_usuario FROM INQUILINO i JOIN INQUILINO_CASA ic ON ic.id_inquilino=i.id_inquilino WHERE ic.id_casa=1 AND i.autorizado=TRUE LIMIT 1');
      assert(tenant); await job().run();
      assert(!(await entries(id)).some(r=>r.id_usuario===tenant.id_usuario));
      assert(!(await notifications(id)).some(r=>r.id_usuario===tenant.id_usuario));
    });
    test('alquiler legado sin responsable explícito no se atribuye al propietario ni al inquilino', async () => {
      const id = await quota({rent:true}); await job().run(); const rows = await entries(id);
      assert.equal(rows.length,0);
      const c = await db.pool.getConnection(); try { assert(!(await rules.recipients(c,id)).includes(3)); } finally { c.release(); }
    });
    test('Guatemala: medianoche UTC aún es el día anterior', async () => {
      assert.equal(guatemalaDate(new Date('2026-10-05T00:00:00Z')),'2026-10-04');
      assert.equal(guatemalaDate(new Date('2026-10-05T05:59:59Z')),'2026-10-04');
      assert.equal(guatemalaDate(new Date('2026-10-05T06:00:00Z')),'2026-10-05');
      const id = await quota({deadline:'2026-10-05'});
      await createFinancialNotificationsService({now:()=>new Date('2026-10-05T00:00:00Z')}).run();
      assert.equal((await entries(id))[0].tipo_evento,'CUOTA_PROXIMA');
    });
    test('conteo >20, marcar individual, aviso ajeno 404, todas y nuevo aviso', async () => {
      const service = require('../../src/services/notificationsService');
      for (let n=0;n<25;n++) await query("INSERT INTO NOTIFICACION(id_usuario,tipo,titulo,mensaje) VALUES(3,'AVISO','HU19 COUNT TEST','TEST')");
      const count = await service.countUnreadNotifications(3), list = await service.listNotifications(3);
      assert(count > 20); assert.equal(list.length,20);
      await service.markNotificationAsRead(3,list[0].id_notificacion); assert.equal(await service.countUnreadNotifications(3),count-1);
      await assert.rejects(service.markNotificationAsRead(4,list[1].id_notificacion),{status:404});
      await service.markAllNotificationsAsRead(3); assert.equal(await service.countUnreadNotifications(3),0);
      await query("INSERT INTO NOTIFICACION(id_usuario,tipo,titulo,mensaje) VALUES(3,'AVISO','Nuevo durante lectura','TEST')");
      assert.equal(await service.countUnreadNotifications(3),1); assert.equal((await service.listNotifications(3))[0].leido,false);
    });
    test('rutas conservan aislamiento y job ADMIN protegido, no endpoint público HU19', async () => {
      const userHeaders = {'x-user-id':'3','x-user-role':'residente'};
      assert.equal((await fetch(base+'/notificaciones/no-leidas',{headers:userHeaders})).status,200);
      assert.equal((await fetch(base+'/admin/recordatorios/generar',{method:'POST',headers:userHeaders})).status,403);
      assert.equal((await fetch(base+'/jobs/notificaciones',{method:'POST'})).status,404);
    });
    test('historical notice leído permanece inmutable tras pago/refund', async () => {
      const id = await quota({deadline:'2026-10-01'}); await job().run();
      const n = (await notifications(id)).find(r => r.id_usuario === 3);
      await query('UPDATE NOTIFICACION SET leido=TRUE,leido_en=NOW() WHERE id_notificacion=?',[n.id_notificacion]);
      const original = (await query('SELECT * FROM NOTIFICACION WHERE id_notificacion=?',[n.id_notificacion]))[0];
      const co = await checkout(id); await createWebhookService().receive(delivery(paymentPayload(co)));
      const tr = (await query('SELECT * FROM TRANSACCION_RECURRENTE WHERE id_cuota=?',[id]))[0];
      await createRefundService({client:mockClient()}).request({id:1,role:'admin'},tr.id_transaccion,{motivo:'TEST',idempotency_key:randomUUID()}); await job().run();
      assert.deepEqual((await query('SELECT * FROM NOTIFICACION WHERE id_notificacion=?',[n.id_notificacion]))[0],original);
    });
    test('backup/restore real preserva notificaciones, recordatorios, ciclos y dedup', async () => {
      const { BACKUP_TABLES, NOTIFICATION_TABLES } = require('../../src/database/backupTables');
      const { generateSql } = require('../../src/services/automaticBackupsService');
      const { validateBackupPayload, verifyRestoredReferences } = require('../../src/services/restoresService');
      await query("INSERT INTO RECORDATORIO_PAGO(id_casa,id_cuota,id_usuario,tipo,titulo,mensaje,monto,fecha_limite,dias_para_vencer,fecha_envio) VALUES(1,171,3,'VENCIDO','Aviso histórico HU19 TEST','TEST',5,'2026-10-08',-1,'2026-10-09')");
      await query("INSERT INTO RECORDATORIO_RESERVA(id_usuario,id_amenidad,fecha,hora_inicio,fecha_envio) VALUES(3,1,'2026-12-01','12:00','2026-12-01')");
      const content = await generateSql(), parsed = validateBackupPayload({filename:'hu19-test.sql',content});
      for (const table of NOTIFICATION_TABLES) assert(parsed.tables.includes(table),table);
      const targetName = await isolation.createOwnedRestoreDatabase(conn), target = await connect(targetName);
      try {
        await target.query('SET FOREIGN_KEY_CHECKS=0');
        const tables = await query("SELECT TABLE_NAME name FROM information_schema.tables WHERE table_schema=DATABASE() AND TABLE_NAME<>'NEXUS_TEST_RUN_OWNER'");
        for (const {name} of tables) await target.query((await query(`SHOW CREATE TABLE \`${name}\``))[0]['Create Table']);
        await target.beginTransaction();
        for (const sql of parsed.statements) await target.query(sql);
        await verifyRestoredReferences(target,BACKUP_TABLES); await target.commit(); await target.query('SET FOREIGN_KEY_CHECKS=1');
        for (const table of NOTIFICATION_TABLES) assert.deepEqual((await target.query(`SELECT * FROM ${table} ORDER BY 1`))[0],await query(`SELECT * FROM ${table} ORDER BY 1`),table);
        // Replay same backup does not duplicate notifications or business keys.
        await target.beginTransaction(); for (const sql of parsed.statements) await target.query(sql); await target.commit();
        for (const table of NOTIFICATION_TABLES) assert.equal((await target.query(`SELECT COUNT(*) n FROM ${table}`))[0][0].n,(await query(`SELECT COUNT(*) n FROM ${table}`))[0].n);
        const sample = (await target.query('SELECT * FROM ENTREGA_NOTIFICACION_FINANCIERA LIMIT 1'))[0][0]; delete sample.id_entrega;
        await assert.rejects(target.query('INSERT INTO ENTREGA_NOTIFICACION_FINANCIERA SET ?',sample),{code:'ER_DUP_ENTRY'});
      } finally { await target.end(); }
    });
    test('cero llamadas nuevas a Recurrente, cero aplicación paralela de recargos', async () => {
      assert.equal(externalCalls,0);
      const source = fs.readFileSync(require.resolve('../../src/services/financialNotificationsService'),'utf8');
      assert.doesNotMatch(source,/fetch\(|createRecurrente|applySurcharges|\/admin\/recargos\/aplicar/);
      assert.equal(calculateBalance({monto:100,recargo:15,pagado:50}).saldo,65);
    });
    test('CLI real procesa pendientes, cierra pool y termina sin proveedor', async () => {
      const {execFile} = require('node:child_process'), {promisify} = require('node:util');
      // La CLI usa el reloj real: su fixture debe compartir la fecha operativa,
      // no el 4 de octubre fijo de los otros casos con reloj inyectado.
      const today = guatemalaDate();
      const run = promisify(execFile), id = await quota({deadline:today});
      await job(today).generateDeadlines();
      const result = await run(process.execPath,['scripts/run-financial-notifications.js'],
        {cwd:require('node:path').resolve(__dirname,'../..'),env:process.env,windowsHide:true,timeout:60000});
      const summary = JSON.parse(result.stdout.trim()); assert.equal(summary.errores,0);
      const delivered = await entries(id);
      assert(delivered.length > 0);
      assert(delivered.every(r => r.estado === 'ENTREGADA'));
      assert.equal(externalCalls,0);
    });
  });
}
