const {test,describe,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs');
const {configureTestEnvironment,connect}=require('./support/isolatedMysql');
if(process.env.RUN_PHASE0_MYSQL_TESTS!=='1')test('HU18 requiere una base temporal propiedad del runner',{skip:true},()=>{});
else {
  const isolation=require('./support/suiteIsolation');isolation.assertOwnedSuiteDatabase();configureTestEnvironment();
  const db=require('../../src/database/mysql');
  const migration=require('../../src/database/recurrenteMigration');
  const {createRefundService}=require('../../src/services/recurrenteRefundService');
  const {RefundError}=require('../../src/services/recurrenteRefundContract');
  const {createWebhookService}=require('../../src/services/recurrenteWebhookService');
  const {createCheckoutService}=require('../../src/services/recurrenteCheckoutService');
  const {QUOTA_BALANCES_SQL}=require('../../src/services/financialBalance');
  const {paidFixture,evidence,mockClient,context,refundPayload,observedRefundPayload,delivery}=require('./support/recurrenteRefundFixtures');
  const {signed,configuration}=require('./support/recurrenteWebhookFixtures');
  const {inspectEvent,verifyWebhook}=require('../../src/services/recurrenteWebhookPayload');
  const {previewReview}=require('../../src/services/recurrenteRecoveryPreview');
  const {refundBlockingSql}=require('../../src/services/recurrenteRefundGuard');
  const originalFetch=global.fetch;
  global.fetch=(url,options)=>{assert.equal(new URL(url).hostname,'127.0.0.1','No external requests permitted');return originalFetch(url,options);};
  const actor={id:1,role:'admin'}, body=(changes={})=>({motivo:'Reembolso administrativo TEST',idempotency_key:randomUUID(),...changes});
  let conn,protectedBefore,server,base,adminToken,residentToken;
  const query=async(sql,args=[])=>(await conn.query(sql,args))[0];
  const balance=async id=>(await query(`SELECT * FROM (${QUOTA_BALANCES_SQL}) b WHERE id_cuota=?`,[id]))[0];
  const fixture=opts=>paidFixture(conn,opts);
  const txId=f=>f.transactions[0].id_transaccion;
  const row=async id=>(await query('SELECT * FROM REEMBOLSO_RECURRENTE WHERE id_reembolso=?',[id]))[0];
  const request=async(f,client=mockClient(),input=body())=>{const s=createRefundService({client});return {service:s,response:await s.request(actor,txId(f),input),client};};
  const beforeFinancial=async f=>({p:await query('SELECT * FROM PAGO WHERE id_cuota=?',[f.id]),o:await query('SELECT * FROM PAGO_ORIGEN WHERE id_cuota=?',[f.id]),
    co:await query('SELECT * FROM CHECKOUT_RECURRENTE WHERE id_cuota=?',[f.id]), rec:await query('SELECT * FROM RECARGO_APLICADO WHERE id_cuota=?',[f.id])});
  const refundFinancial=async f=>({...await beforeFinancial(f),tr:await query('SELECT * FROM TRANSACCION_RECURRENTE WHERE id_cuota=?',[f.id]),
    refunds:await query('SELECT * FROM REEMBOLSO_RECURRENTE WHERE id_transaccion=?',[txId(f)])});
  const blocked=async f=>Number((await query('SELECT '+refundBlockingSql(String(f.id))+' blocked'))[0].blocked);
  const stamp='2026-10-04 14:12:18.011275';
  async function legacyRefundReview({modify=()=>{},pending=false}={}) {
    const f=await fixture(),ev=evidence(500,{merchantAmount:500}),r=await request(f,mockClient({reply:ev,send:pending?()=>({...ev,status:'pending'}):undefined}));
    const payload=observedRefundPayload(f,ev);modify(payload);
    const capture=signed(payload),verified=verifyWebhook(capture.raw,capture.headers,configuration());
    const event=inspectEvent(verified.payload,context.sandboxId),hook=createWebhookService();
    // Emulate the old normalizer only in this disposable fixture. The receipt
    // still originates from bytes verified by the official Svix library.
    assert.equal(await hook.receive({...verified,event:{...event,code:'REFUND_ENVIRONMENT_UNPROVEN',liveMode:null},sandboxId:context.sandboxId}),'review');
    const [receipt]=await query('SELECT * FROM EVENTO_RECURRENTE WHERE svix_id=?',[capture.svixId]);
    await query('UPDATE EVENTO_RECURRENTE SET procesado_en=? WHERE id_evento=?',[stamp,receipt.id_evento]);
    return {f,ev,r,event,body:capture.raw,receipt:(await query('SELECT * FROM EVENTO_RECURRENTE WHERE id_evento=?',[receipt.id_evento]))[0]};
  }
  function failingPool(pattern){let triggered=false;return {getConnection:async()=>{const c=await db.pool.getConnection(),execute=c.execute.bind(c),release=c.release.bind(c);
    c.execute=(sql,args)=>{if(!triggered&&pattern.test(sql)){triggered=true;return execute('SELECT invalid_hu18_column FROM CUOTA');}return execute(sql,args);};
    c.release=()=>{c.execute=execute;c.release=release;release();};return c;}};}
  describe('HU18 SQL real aislado, API y firmas Svix con proveedor MOCK',{concurrency:false},()=>{
    before(async()=>{
      conn=await connect();protectedBefore=await isolation.protectedSnapshot(conn);
      const {createActiveSession}=require('../../src/services/activeSessionsService');adminToken=(await createActiveSession(1)).token;residentToken=(await createActiveSession(3)).token;
      server=require('../../src/app').createApp({recurrenteRefundService:createRefundService({client:mockClient()})}).listen(0,'127.0.0.1');
      await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;
    });
    after(async()=>{try{assert.deepEqual(await isolation.protectedSnapshot(conn),protectedBefore,'Evidencia 171/395/296/433 y 998/486/937 intacta');}
      finally{await new Promise(r=>server.close(r));await conn.end();await db.pool.end();global.fetch=originalFetch;}});
    test('005 reaplicada dos veces preserva todas las filas existentes y constraints',async()=>{
      const f=await fixture(),r=await request(f),beforeRows=await query('SELECT * FROM REEMBOLSO_RECURRENTE ORDER BY 1');
      await migration.applyRecurrenteRefundsMigration(conn);await migration.applyRecurrenteRefundsMigration(conn);
      assert.deepEqual(await query('SELECT * FROM REEMBOLSO_RECURRENTE ORDER BY 1'),beforeRows);
      assert.doesNotMatch(fs.readFileSync(migration.REFUNDS_MIGRATION_PATH,'utf8'),/DROP\s+(TABLE|COLUMN|DATABASE)|DELETE\s+FROM|TRUNCATE/i);
      assert.equal((await row(r.response.refund.id_reembolso)).evidencia_confirmacion,'POST');
      const ddl=(await query('SHOW CREATE TABLE REEMBOLSO_RECURRENTE'))[0]['Create Table'];
      for(const name of ['PRIMARY KEY','uq_reembolso_externo','uq_reembolso_idempotencia','uq_refund_reference_hu18',
        'fk_refund_event_hu18','chk_refund_state_hu18','chk_refund_provider_hu18','chk_refund_application_hu18','chk_refund_evidence_hu18'])assert(ddl.includes(name),name);
      const refundId=r.response.refund.id_reembolso;
      for(const change of ["estado='INVALIDO'","estado_proveedor='paid'","evidencia_confirmacion='FAKE'",'capital_revertido_centavos=501','id_evento=0'])
        await assert.rejects(query(`UPDATE REEMBOLSO_RECURRENTE SET ${change} WHERE id_reembolso=?`,[refundId]));
      const existing=await row(refundId);
      for(const unique of ['id_externo','idempotency_key','referencia_local']) {
        const candidate={id_transaccion:txId(f),idempotency_key:randomUUID(),referencia_local:randomUUID(),id_usuario_solicitante:1,monto_centavos:500,
          moneda:'GTQ',ambiente:'sandbox',tipo:'TOTAL',estado:'SOLICITADO',[unique]:existing[unique]};
        await assert.rejects(query('INSERT INTO REEMBOLSO_RECURRENTE SET ?',candidate),{code:'ER_DUP_ENTRY'});
      }
    });
    test('primera aplicación 005 sobre esquema 001–004 con refund preexistente no lo convierte en abono',async()=>{
      const f=await fixture(),targetName=await isolation.createOwnedRestoreDatabase(conn),target=await connect(targetName);
      try{
        await target.query('SET FOREIGN_KEY_CHECKS=0');
        const tables=await query('SELECT TABLE_NAME name FROM information_schema.tables WHERE table_schema=DATABASE()');
        for(const {name}of tables)if(name!=='REEMBOLSO_RECURRENTE'){
          const show=(await query(`SHOW CREATE TABLE \`${name}\``))[0]['Create Table'];await target.query(show.replace('CREATE TABLE','CREATE TABLE IF NOT EXISTS'));
        }
        await target.query(migration.migrationStatements().find(s=>/CREATE TABLE IF NOT EXISTS REEMBOLSO_RECURRENTE/.test(s)));
        const {BACKUP_TABLES}=require('../../src/database/backupTables');
        for(const t of BACKUP_TABLES.filter(t=>t!=='REEMBOLSO_RECURRENTE'))for(const r of await query(`SELECT * FROM ${t}`)){
          const serialized=Object.fromEntries(Object.entries(r).map(([k,v])=>[k,v&&typeof v==='object'&&!(v instanceof Date)&&!Buffer.isBuffer(v)?JSON.stringify(v):v]));
          await target.query(`INSERT INTO ${t} SET ?`,serialized);
        }
        const original={id_transaccion:txId(f),idempotency_key:randomUUID(),id_usuario_solicitante:1,monto_centavos:500,moneda:'GTQ',ambiente:'sandbox',tipo:'TOTAL',estado:'SOLICITADO'};
        await target.query('INSERT INTO REEMBOLSO_RECURRENTE SET ?',original);await target.query('SET FOREIGN_KEY_CHECKS=1');
        const old=(await target.query('SELECT * FROM REEMBOLSO_RECURRENTE'))[0];await migration.applyRecurrenteRefundsMigration(target);
        const next=(await target.query('SELECT * FROM REEMBOLSO_RECURRENTE'))[0];
        assert.deepEqual(next.map(r=>Object.fromEntries(Object.keys(old[0]).map(k=>[k,r[k]]))),old);assert.equal(next[0].aplicado_en,null);
        assert.equal(Number((await target.query(`SELECT total_reembolsado FROM (${QUOTA_BALANCES_SQL}) b WHERE id_cuota=?`,[f.id]))[0][0].total_reembolsado),0);
      }finally{await target.end();}
    });
    test('PAGO, origen, checkout y aplicación histórica son inmutables; Q5 reabre la misma cuota',async()=>{
      const f=await fixture(),snapshot=await beforeFinancial(f),txBefore=f.transactions[0],r=await request(f);assert.equal(r.response.refund.estado,'CONFIRMADO');
      assert.deepEqual(await beforeFinancial(f),snapshot);const [tr]=await query('SELECT * FROM TRANSACCION_RECURRENTE WHERE id_transaccion=?',[txId(f)]);
      for(const k of ['id_pago','monto_centavos','fecha_proveedor_original','fecha_proveedor_utc','confirmado_en','capital_aplicado_centavos','recargo_aplicado_centavos'])assert.equal(tr[k],txBefore[k],k);
      assert.equal(tr.estado,'REEMBOLSADA');const b=await balance(f.id);assert.equal(Number(b.saldo_pendiente),5);assert.equal(Number(b.abono_neto),0);assert.equal(Number(b.total_pagado),5);
    });
    test('fecha proveedor Guatemala separada de recepción/aplicación y monto comercio no decide contabilidad',async()=>{
      const f=await fixture(),r=await request(f),rr=await row(r.response.refund.id_reembolso);
      assert.equal(rr.fecha_contable,'2026-10-02');assert.equal(rr.importe_comercio_centavos,483);assert.equal(rr.monto_centavos,500);
      assert.equal(rr.fecha_proveedor_utc,'2026-10-03 02:30:00.123456');assert(rr.aplicado_en);assert(rr.creado_en);assert(rr.enviado_en);
    });
    test('múltiples pagos: redistribución global mantiene recargos primero sin reescribir aplicaciones',async()=>{
      const f=await fixture({principal:'100.00',surcharge:'15.00',payments:[5000,6500]}),before=await beforeFinancial(f);
      await request(f);const b=await balance(f.id);assert.equal(Number(b.total_pagado),115);assert.equal(Number(b.total_reembolsado),50);
      assert.equal(Number(b.capital_pendiente),50);assert.equal(Number(b.recargo_pendiente),0);assert.equal(Number(b.saldo_pendiente),50);
      assert.deepEqual(await beforeFinancial(f),before);const rr=(await query('SELECT * FROM REEMBOLSO_RECURRENTE WHERE id_transaccion=?',[txId(f)]))[0];assert.equal(rr.capital_revertido_centavos,5000);assert.equal(rr.recargo_revertido_centavos,0);
    });
    test('refund Q115 revierte capital100/recargos15 sin saldo negativo',async()=>{
      const f=await fixture({principal:'100.00',surcharge:'15.00',payments:[11500]}),r=await request(f),rr=await row(r.response.refund.id_reembolso);
      assert.equal(rr.capital_revertido_centavos,10000);assert.equal(rr.recargo_revertido_centavos,1500);assert.equal(Number((await balance(f.id)).saldo_pendiente),115);
    });
    test('reapertura vencida conserva concepto/vencimiento y recargo existente no se duplica',async()=>{
      const f=await fixture({principal:'100.00',surcharge:'15.00',payments:[11500],deadline:'2026-09-01'});await request(f);
      const {listResidentAccountStatement}=require('../../src/services/residentAccountService');const a=await listResidentAccountStatement(3);assert.equal(a.cuotas.find(q=>q.id_cuota===f.id).estado,'VENCIDA');
      await require('../../src/services/financialRulesService').applySurcharges(1);await require('../../src/services/financialRulesService').applySurcharges(1);
      assert.equal((await query('SELECT COUNT(*) n FROM RECARGO_APLICADO WHERE id_cuota=?',[f.id]))[0].n,1);assert.equal(Number((await balance(f.id)).recargo),15);
    });
    test('mora administrativa tras refund usa capital neto con recargos primero, sin duplicar recargo',async()=>{
      const f=await fixture({principal:'100.00',surcharge:'15.00',payments:[10000,1500],deadline:'2026-09-01'});
      await createRefundService({client:mockClient()}).request(actor,f.transactions[1].id_transaccion,body());
      const b=await balance(f.id);assert.equal(Number(b.abono_neto),100);assert.equal(Number(b.capital_pendiente),15);assert.equal(Number(b.recargo_pendiente),0);
      const sanctions=require('../../src/services/adminSanctionsService');await sanctions.applyAutomaticSanctions(1);await sanctions.applyAutomaticSanctions(1);
      assert.equal((await query("SELECT COUNT(*) n FROM SANCION WHERE id_cuota=? AND codigo_regla='CUOTA_VENCIDA'",[f.id]))[0].n,1);
      assert.equal((await query('SELECT COUNT(*) n FROM RECARGO_APLICADO WHERE id_cuota=?',[f.id]))[0].n,1);assert.equal(Number((await balance(f.id)).saldo_pendiente),15);
    });
    test('saldo completo independiente del período; movimientos de refund respetan fechas',async()=>{
      const f=await fixture();await request(f);const s=require('../../src/services/residentFinancialDetailService');
      const outside=await s.getFinancialDetail(3,{desde:'2030-01-01',hasta:'2030-01-02'}),inside=await s.getFinancialDetail(3,{desde:'2026-10-02',hasta:'2026-10-02'});
      assert.equal(outside.cargos.find(q=>q.id_cuota===f.id).saldo,5);assert.equal(outside.reembolsos.filter(r=>r.id_cuota===f.id).length,0);assert.equal(inside.reembolsos.filter(r=>r.id_cuota===f.id).length,1);
    });
    test('doble clic simultáneo mismo identificador solo envía un POST/aplica una vez',async()=>{
      const f=await fixture(),client=mockClient(),s=createRefundService({client}),input=body();const results=await Promise.all([s.request(actor,txId(f),input),s.request(actor,txId(f),input)]);
      assert.equal(client.counts().posts,1);assert.deepEqual(results.map(r=>r.result).sort(),['existing','processed']);assert.equal((await query('SELECT COUNT(*) n FROM REEMBOLSO_RECURRENTE WHERE id_transaccion=?',[txId(f)]))[0].n,1);
    });
    test('dos ADMIN requests distintas sobre el mismo pago no exceden el original',async()=>{
      const f=await fixture(),client=mockClient(),s=createRefundService({client});const results=await Promise.allSettled([s.request(actor,txId(f),body()),s.request(actor,txId(f),body())]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(client.counts().posts,1);assert.equal(Number((await balance(f.id)).total_reembolsado),5);
    });
    test('fingerprint diferente con la misma clave se rechaza sin POST adicional',async()=>{
      const f=await fixture(),input=body(),r=await request(f,mockClient(),input);await assert.rejects(r.service.request(actor,txId(f),{...input,motivo:'Otra solicitud TEST'}),{code:'REFUND_IDEMPOTENCY_CONFLICT'});assert.equal(r.client.counts().posts,1);
    });
    test('SQL se libera antes del POST mock; otra conexión puede bloquear la cuota',async()=>{
      const f=await fixture(),client=mockClient({send:async rr=>{
        const other=await connect();try{await other.beginTransaction();await other.execute('SELECT id_cuota FROM CUOTA WHERE id_cuota=? FOR UPDATE',[f.id]);await other.commit();}
        finally{await other.end();}return evidence(Number(rr.monto_centavos));
      }});const r=await request(f,client);assert.equal(r.response.refund.estado,'CONFIRMADO');
    });
    test('legacy CONFIRMADO sin marcador queda bloqueado y no reduce el saldo',async()=>{
      const f=await fixture();await query("INSERT INTO REEMBOLSO_RECURRENTE(id_transaccion,idempotency_key,id_usuario_solicitante,monto_centavos,moneda,ambiente,tipo,estado) VALUES(?,?,1,500,'GTQ','sandbox','TOTAL','CONFIRMADO')",[txId(f),randomUUID()]);
      assert.equal(Number((await balance(f.id)).total_reembolsado),0);const client=mockClient(),s=createRefundService({client});assert.equal((await s.eligibility(actor,txId(f))).elegible,false);
      await assert.rejects(s.request(actor,txId(f),body()),{code:'REFUND_BLOCKED'});assert.equal(client.counts().posts,0);
    });
    for(const state of ['pending','unknown'])test(`refund ${state} reserva y bloquea real/simulado/otro refund sin alterar saldo`,async()=>{
      const f=await fixture(),client=mockClient({send:()=>{if(state==='unknown')throw new RefundError('REFUND_UNKNOWN',504,{uncertain:true});return evidence(500,{status:'pending'});}}),s=createRefundService({client}),input=body();
      if(state==='unknown')await assert.rejects(s.request(actor,txId(f),input));else await s.request(actor,txId(f),input);
      assert.equal(Number((await balance(f.id)).saldo_pendiente),0);const el=await s.eligibility(actor,txId(f));assert.equal(el.reservado_centavos,500);assert.equal(el.elegible,false);
      await assert.rejects(s.request(actor,txId(f),body()),{code:'REFUND_BLOCKED'});assert.equal((await s.request(actor,txId(f),input)).result,'existing');assert.equal(client.counts().posts,1);
      await assert.rejects(createCheckoutService({client:{sandboxId:()=>context.sandboxId}}).startResidentCheckout(3,f.id),{code:'CHECKOUT_REFUND_BLOCKED'});
      await assert.rejects(require('../../src/services/simulatedPaymentsService').payObligation(3,'residente',f.id),{code:'CHECKOUT_REFUND_BLOCKED'});
    });
    test('resultado incierto no se desbloquea por antigüedad ni vuelve a enviarse',async()=>{
      const f=await fixture(),client=mockClient({send:()=>{throw new RefundError('REFUND_UNKNOWN',503,{uncertain:true});}}),s=createRefundService({client}),input=body();
      await assert.rejects(s.request(actor,txId(f),input));await query("UPDATE REEMBOLSO_RECURRENTE SET creado_en='2020-01-01' WHERE id_transaccion=?",[txId(f)]);
      await assert.rejects(s.request(actor,txId(f),body()),{code:'REFUND_BLOCKED'});assert.equal(client.counts().posts,1);
    });
    test('preflight falla antes de POST y libera únicamente reserva no enviada',async()=>{
      const f=await fixture(),client=mockClient({open:()=>{throw new RefundError('REFUND_EXTERNAL_EVIDENCE');}}),s=createRefundService({client});await assert.rejects(s.request(actor,txId(f),body()));
      assert.equal(client.counts().posts,0);const el=await s.eligibility(actor,txId(f));assert.equal(el.reservado_centavos,0);assert.equal(el.reembolsos[0].estado,'FALLIDO');assert.equal(Number((await balance(f.id)).saldo_pendiente),0);
    });
    test('FALLIDO definitivo no aplica, nuevo intento ADMIN explícito sí puede solicitarse',async()=>{
      const f=await fixture(),client=mockClient({send:r=>evidence(Number(r.monto_centavos),{status:'failed',reason:'REFUND_PROVIDER_FAILED'})});await request(f,client);
      assert.equal(Number((await balance(f.id)).total_reembolsado),0);const success=await request(f);assert.equal(success.response.refund.estado,'CONFIRMADO');
      assert.equal((await query('SELECT COUNT(*) n FROM REEMBOLSO_RECURRENTE WHERE id_transaccion=?',[txId(f)]))[0].n,2);
    });
    for(const changes of [{amount:499},{currency:'USD'},{time:null},{status:'voided'},{accountId:'ac_OTHER'}])test(`evidencia inválida ${JSON.stringify(changes)} queda REVISION sin contabilidad`,async()=>{
      const f=await fixture(),r=await request(f,mockClient({reply:evidence(500,changes)}));assert.equal(r.response.result,'review');assert.equal(Number((await balance(f.id)).total_reembolsado),0);assert.equal((await r.service.eligibility(actor,txId(f))).elegible,false);
    });
    test('GET conocido confirma PENDIENTE sin POST adicional y aplicación persistente',async()=>{
      const f=await fixture(),ev=evidence(),client=mockClient({reply:ev,send:()=>({...ev,status:'pending'})}),r=await request(f,client);
      assert.equal(r.response.refund.estado,'PENDIENTE');const verified=await r.service.verify(actor,r.response.refund.id_reembolso);assert.equal(verified.refund.estado,'CONFIRMADO');assert.equal(client.counts().posts,1);assert.equal(client.counts().gets,1);
      const saved=await row(verified.refund.id_reembolso);assert.equal((await r.service.verify(actor,saved.id_reembolso)).result,'duplicate');assert.deepEqual(await row(saved.id_reembolso),saved);
    });
    test('INCIERTO sin ID conocido exige revisión y no consulta por monto',async()=>{
      const f=await fixture(),client=mockClient({send:()=>{throw new RefundError('REFUND_UNKNOWN',504,{uncertain:true});}}),s=createRefundService({client});await assert.rejects(s.request(actor,txId(f),body()));
      const el=await s.eligibility(actor,txId(f));await assert.rejects(s.verify(actor,el.reembolsos[0].id_reembolso),{code:'REFUND_NO_EXTERNAL_ID'});assert.equal(client.counts().gets,0);
    });
    test('refund externo UNIQUE evita asociación del mismo re_ con otro pago',async()=>{
      const a=await fixture(),b=await fixture(),ev=evidence();await request(a,mockClient({reply:ev}));const other=await request(b,mockClient({reply:ev}));assert.equal(other.response.result,'review');assert.equal(Number((await balance(b.id)).total_reembolsado),0);
    });
    test('HTTP luego webhook: distinct svix-id y replay no duplican refund ni fecha',async()=>{
      const f=await fixture(),ev=evidence(),r=await request(f,mockClient({reply:ev})),before=await row(r.response.refund.id_reembolso),hook=createWebhookService(),input=delivery(refundPayload(f,ev));
      assert.equal(await hook.receive(input),'duplicate');assert.equal(await hook.receive(input),'duplicate');assert.equal(await hook.receive(delivery(refundPayload(f,ev))),'duplicate');
      assert.deepEqual(await row(before.id_reembolso),before);assert.equal(Number((await balance(f.id)).total_reembolsado),5);
    });
    test('webhook firmado conocido pendiente aplica y POST/GET tardío es duplicate',async()=>{
      const f=await fixture(),ev=evidence(),client=mockClient({reply:ev,send:()=>({...ev,status:'pending'})}),r=await request(f,client),hook=createWebhookService();
      assert.equal(await hook.receive(delivery(refundPayload(f,ev))),'processed');assert.equal((await row(r.response.refund.id_reembolso)).evidencia_confirmacion,'WEBHOOK');
      assert.equal((await r.service.verify(actor,r.response.refund.id_reembolso)).result,'duplicate');assert.equal(Number((await balance(f.id)).saldo_pendiente),5);
    });
    test('webhook antes de respuesta POST queda reintentable; respuesta posterior liga solo ID autoritativo',async()=>{
      const f=await fixture(),ev=evidence(),input=delivery(refundPayload(f,ev)),hook=createWebhookService();
      const client=mockClient({send:async()=>{await assert.rejects(hook.receive(input),{code:'WEBHOOK_REFUND_NOT_READY'});return ev;}});
      await request(f,client);assert.equal(await hook.receive(input),'duplicate');assert.equal(Number((await balance(f.id)).total_reembolsado),5);
    });
    test('concurrencia GET/webhook confirma exactamente una aplicación',async()=>{
      const f=await fixture(),ev=evidence(),r=await request(f,mockClient({reply:ev,send:()=>({...ev,status:'pending'})}));
      const results=await Promise.all([r.service.verify(actor,r.response.refund.id_reembolso),createWebhookService().receive(delivery(refundPayload(f,ev)))]);
      assert(results.some(r=>r==='duplicate'||r.result==='duplicate'));assert.equal(Number((await balance(f.id)).total_reembolsado),5);assert.equal((await query('SELECT COUNT(*) n FROM PAGO WHERE id_cuota=?',[f.id]))[0].n,1);
    });
    test('success original tardío preserva refund y no reaplica PAGO',async()=>{
      const f=await fixture();await request(f);const before=await beforeFinancial(f),rr=(await query('SELECT * FROM REEMBOLSO_RECURRENTE WHERE id_transaccion=?',[txId(f)]))[0];
      assert.equal(await createWebhookService().receive(delivery(f.pairs[0].intent)),'duplicate');assert.deepEqual(await beforeFinancial(f),before);assert.deepEqual(await row(rr.id_reembolso),rr);assert.equal(Number((await balance(f.id)).saldo_pendiente),5);
    });
    test('success canónico primero y legacy después se correlacionan sin confundir payment pa con intent pa',async()=>{
      const id=(await query("INSERT INTO CUOTA(id_servicio,id_casa,monto,fecha_limite) VALUES(1,1,5,'2026-10-08')")).insertId;
      const co={referencia_local:randomUUID(),id_externo:`ch_TEST_${randomUUID().replaceAll('-','')}`,idempotency_key:randomUUID(),id_cuota:id,id_usuario:3,id_residente:1,id_casa:1,monto_centavos:500,capital_centavos:500,recargo_centavos:0,moneda:'GTQ',ambiente:'sandbox',sandbox_id:context.sandboxId,estado:'PENDIENTE',estado_proveedor:'unpaid'};
      co.id_checkout=(await query('INSERT INTO CHECKOUT_RECURRENTE SET ?',co)).insertId;
      const pair=require('./support/recurrenteWebhookFixtures').observedPaymentPair(co),hook=createWebhookService();assert.equal(await hook.receive(delivery(pair.intent)),'processed');assert.equal(await hook.receive(delivery(pair.paymentIntent)),'duplicate');
      const f={id,local:[co],pairs:[pair],transactions:await query('SELECT * FROM TRANSACCION_RECURRENTE WHERE id_cuota=?',[id])},ev=evidence();
      await request(f,mockClient({reply:ev,send:()=>({...ev,status:'pending'})}));assert.equal(await hook.receive(delivery(refundPayload(f,ev))),'processed');assert.equal(Number((await balance(id)).saldo_pendiente),5);
    });
    for(const mode of ['missing','physical','external'])test(`refund webhook ${mode} queda revisión sin inventar ADMIN ni aplicar saldo`,async()=>{
      const f=await fixture(),ev=evidence();let payload=refundPayload(f,ev);
      if(mode==='missing'){delete payload.live_mode;delete payload.sandbox_id;}if(mode==='physical')payload.intentable.id=f.transactions[0].id_pago_externo;
      const input=delivery(payload);assert.equal(await createWebhookService().receive(input),'review');assert.equal(Number((await balance(f.id)).total_reembolsado),0);
      assert.equal((await query('SELECT COUNT(*) n FROM REEMBOLSO_RECURRENTE WHERE id_transaccion=?',[txId(f)]))[0].n,0);
      if(mode==='external')await assert.rejects(createRefundService({client:mockClient()}).request(actor,txId(f),body()),{code:'REFUND_BLOCKED'});
    });
    test('refund firmado sin ID externo conserva inbox durable en revisión y no modifica saldo',async()=>{
      const f=await fixture(),payload=refundPayload(f,evidence());delete payload.refund.id;
      const input=delivery(payload);assert.equal(await createWebhookService().receive(input),'review');
      const [inbox]=await query('SELECT * FROM EVENTO_RECURRENTE WHERE svix_id=?',[input.svixId]);
      assert.equal(inbox.estado,'REVISION');assert.equal(inbox.error_codigo,'REFUND_INVALID_EVIDENCE');assert.equal(inbox.id_operacion_externa,null);
      assert.equal(Number((await balance(f.id)).total_reembolsado),0);assert.equal(Number((await balance(f.id)).saldo_pendiente),0);
      await assert.rejects(createRefundService({client:mockClient()}).request(actor,txId(f),body()),{code:'REFUND_BLOCKED'});
    });
    test('rollback entre refund y agregado transacción deja reserva y ningún efecto financiero',async()=>{
      const f=await fixture(),client=mockClient(),s=createRefundService({pool:failingPool(/UPDATE TRANSACCION_RECURRENTE SET estado=/),client});
      await assert.rejects(s.request(actor,txId(f),body()));const [rr]=await query('SELECT * FROM REEMBOLSO_RECURRENTE WHERE id_transaccion=?',[txId(f)]);
      assert.equal(rr.aplicado_en,null);assert.equal(rr.estado,'INCIERTO');assert.equal(Number((await balance(f.id)).total_reembolsado),0);assert.equal((await query('SELECT estado FROM TRANSACCION_RECURRENTE WHERE id_transaccion=?',[txId(f)]))[0].estado,'CONFIRMADA');
    });
    test('rollback webhook conserva inbox reintentable y reserva; replay aplica una sola vez',async()=>{
      const f=await fixture(),ev=evidence(),r=await request(f,mockClient({reply:ev,send:()=>({...ev,status:'pending'})})),input=delivery(refundPayload(f,ev));
      await assert.rejects(createWebhookService({pool:failingPool(/UPDATE TRANSACCION_RECURRENTE SET estado=/)}).receive(input),{status:503});
      assert.equal((await row(r.response.refund.id_reembolso)).aplicado_en,null);assert.equal(Number((await balance(f.id)).total_reembolsado),0);
      assert.equal(await createWebhookService().receive(input),'processed');assert.equal(Number((await balance(f.id)).total_reembolsado),5);
    });
    test('observed nested refund after POST and multiple deliveries preserve all financial rows',async()=>{
      const f=await fixture(),ev=evidence(),r=await request(f,mockClient({reply:ev})),saved=await refundFinancial(f),hook=createWebhookService();
      const payload=observedRefundPayload(f,ev),input=delivery(payload);
      assert.equal(await hook.receive(input),'duplicate');assert.equal(await hook.receive(input),'duplicate');
      assert.equal(await hook.receive(delivery(payload)),'duplicate');assert.deepEqual(await refundFinancial(f),saved);
      assert.equal((await row(r.response.refund.id_reembolso)).evidencia_confirmacion,'POST');assert.equal(Number((await balance(f.id)).saldo_pendiente),5);assert.equal(await blocked(f),0);
    });
    test('concurrent observed refund webhooks create receipts but no second financial application',async()=>{
      const f=await fixture(),ev=evidence();await request(f,mockClient({reply:ev}));const saved=await refundFinancial(f),hook=createWebhookService(),p=observedRefundPayload(f,ev);
      assert.deepEqual(await Promise.all([hook.receive(delivery(p)),hook.receive(delivery(p))]),['duplicate','duplicate']);assert.deepEqual(await refundFinancial(f),saved);assert.equal(await blocked(f),0);
    });
    for(const mode of ['contradiction','wrong-sandbox','missing'])test('observed refund '+mode+' stays in review and keeps protection',async()=>{
      const f=await fixture(),ev=evidence();await request(f,mockClient({reply:ev}));const saved=await refundFinancial(f),p=observedRefundPayload(f,ev);
      if(mode==='contradiction')p.live_mode=true;if(mode==='wrong-sandbox')p.sandbox_id='sbx_OTHER';
      if(mode==='missing'){delete p.intentable.live_mode;delete p.intentable.checkout.live_mode;}
      const input=delivery(p);assert.equal(await createWebhookService().receive(input),'review');assert.equal(await blocked(f),1);assert.deepEqual(await refundFinancial(f),saved);
      const [inbox]=await query('SELECT * FROM EVENTO_RECURRENTE WHERE svix_id=?',[input.svixId]);assert.equal(inbox.error_codigo,mode==='contradiction'?'REFUND_ENVIRONMENT_CONFLICT':'REFUND_ENVIRONMENT_UNPROVEN');
    });
    test('refund review dry-run uses a read-only transaction and makes exact applied-refund proof',async()=>{
      const t=await legacyRefundReview(),saved=await refundFinancial(t.f),read=await connect();
      try{await read.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');const preview=await previewReview(read,{receipt:t.receipt,event:t.event,sandboxId:context.sandboxId});
        assert.equal(preview.result,'duplicate');assert.equal(preview.refundId,t.r.response.refund.id_reembolso);assert.equal(preview.paymentId,t.f.transactions[0].id_pago);
        assert.equal(preview.alreadyApplied,true);assert.equal(preview.balance,'5.00');assert.equal(preview.liveMode,false);assert.equal(preview.financialRowsModified,0);
      }finally{await read.rollback();await read.end();}
      assert.equal(await blocked(t.f),1);assert.deepEqual(await refundFinancial(t.f),saved);assert.equal((await query('SELECT COUNT(*) n FROM REVISION_EVENTO_RECURRENTE WHERE id_evento=?',[t.receipt.id_evento]))[0].n,0);
    });
    test('refund recovery resolves original signed receipt once, preserves SQL microseconds and financial content',async()=>{
      const t=await legacyRefundReview(),saved=await refundFinancial(t.f),hook=createWebhookService(),args={eventId:t.receipt.id_evento,originalBody:t.body,sandboxId:context.sandboxId};
      assert.equal(await hook.reprocessReview(args),'duplicate');assert.equal(await hook.reprocessReview(args),'duplicate');assert.deepEqual(await refundFinancial(t.f),saved);
      const [inbox]=await query('SELECT * FROM EVENTO_RECURRENTE WHERE id_evento=?',[t.receipt.id_evento]);
      assert.equal(inbox.estado,'PROCESADO');assert.equal(inbox.error_codigo,null);assert.equal(inbox.live_mode,0);assert.equal(inbox.intentos,2);
      for(const k of ['svix_id','hash_body','recibido_en','id_operacion_externa','tipo_evento','id_checkout'])assert.equal(inbox[k],t.receipt[k],k);
      const revisions=await query('SELECT * FROM REVISION_EVENTO_RECURRENTE WHERE id_evento=?',[inbox.id_evento]);assert.equal(revisions.length,1);assert.equal(revisions[0].procesado_anterior,stamp);
      assert.equal(revisions[0].estado_anterior,'REVISION');assert.equal(revisions[0].error_anterior,'REFUND_ENVIRONMENT_UNPROVEN');assert.equal(revisions[0].estado_resultante,'PROCESADO');assert.equal(await blocked(t.f),0);
    });
    test('two concurrent recoveries archive only one review and never apply another refund',async()=>{
      const t=await legacyRefundReview(),saved=await refundFinancial(t.f),hook=createWebhookService(),args={eventId:t.receipt.id_evento,originalBody:t.body,sandboxId:context.sandboxId};
      assert.deepEqual(await Promise.all([hook.reprocessReview(args),hook.reprocessReview(args)]),['duplicate','duplicate']);assert.deepEqual(await refundFinancial(t.f),saved);
      assert.equal((await query('SELECT COUNT(*) n FROM REVISION_EVENTO_RECURRENTE WHERE id_evento=?',[t.receipt.id_evento]))[0].n,1);assert.equal(await blocked(t.f),0);
    });
    test('recovery rejects a changed body, unrelated review code or positive stored live_mode',async()=>{
      const t=await legacyRefundReview(),saved=await refundFinancial(t.f),hook=createWebhookService(),args={eventId:t.receipt.id_evento,originalBody:t.body,sandboxId:context.sandboxId};
      await assert.rejects(hook.reprocessReview({...args,originalBody:Buffer.concat([t.body,Buffer.from(' ')])}),{code:'WEBHOOK_RECOVERY_REJECTED'});
      for(const change of ["error_codigo='REFUND_ASSOCIATION_UNPROVEN'",'live_mode=1']){
        await query('UPDATE EVENTO_RECURRENTE SET '+change+' WHERE id_evento=?',[t.receipt.id_evento]);
        await assert.rejects(hook.reprocessReview(args),{code:'WEBHOOK_RECOVERY_REJECTED'});
        await query("UPDATE EVENTO_RECURRENTE SET error_codigo='REFUND_ENVIRONMENT_UNPROVEN',live_mode=NULL WHERE id_evento=?",[t.receipt.id_evento]);
      }
      assert.deepEqual(await refundFinancial(t.f),saved);assert.equal(await blocked(t.f),1);
    });
    for(const key of ['parent','checkout','intent','payment','checkout-payment','amount','currency'])test('refund recovery rejects conflicting '+key+' reference in original body',async()=>{
      const t=await legacyRefundReview({modify:p=>{
        if(key==='parent')p.intentable.id='pa_TEST_OTHER';if(key==='checkout')p.intentable.checkout.id='ch_TEST_OTHER';
        if(key==='intent')p.intentable.checkout.latest_intent.id='in_TEST_OTHER';if(key==='payment')p.intentable.payment.id='pa_TEST_OTHER';
        if(key==='checkout-payment')p.intentable.checkout.payment.id='pa_TEST_OTHER';if(key==='amount')p.intentable.checkout.total_in_cents=501;
        if(key==='currency')p.intentable.checkout.currency='USD';
      }}),saved=await refundFinancial(t.f);
      assert.equal((await previewReview(conn,{receipt:t.receipt,event:t.event,sandboxId:context.sandboxId})).result,'review');
      await assert.rejects(createWebhookService().reprocessReview({eventId:t.receipt.id_evento,originalBody:t.body,sandboxId:context.sandboxId}),{code:'WEBHOOK_RECOVERY_REJECTED'});
      assert.deepEqual(await refundFinancial(t.f),saved);assert.equal(await blocked(t.f),1);assert.equal((await query('SELECT COUNT(*) n FROM REVISION_EVENTO_RECURRENTE WHERE id_evento=?',[t.receipt.id_evento]))[0].n,0);
    });
    test('controlled recovery cannot apply a pending refund',async()=>{
      const t=await legacyRefundReview({pending:true}),saved=await refundFinancial(t.f);
      assert.equal((await previewReview(conn,{receipt:t.receipt,event:t.event,sandboxId:context.sandboxId})).result,'review');
      await assert.rejects(createWebhookService().reprocessReview({eventId:t.receipt.id_evento,originalBody:t.body,sandboxId:context.sandboxId}),{code:'WEBHOOK_RECOVERY_REJECTED'});
      assert.deepEqual(await refundFinancial(t.f),saved);assert.equal(Number((await balance(t.f.id)).saldo_pendiente),0);
    });
    test('resolving a known refund preserves any other genuine review block',async()=>{
      const t=await legacyRefundReview(),unknown=observedRefundPayload(t.f,evidence());assert.equal(await createWebhookService().receive(delivery(unknown)),'review');
      assert.equal(await createWebhookService().reprocessReview({eventId:t.receipt.id_evento,originalBody:t.body,sandboxId:context.sandboxId}),'duplicate');assert.equal(await blocked(t.f),1);
    });
    for(const failure of [/INSERT INTO REVISION_EVENTO_RECURRENTE/,/UPDATE REVISION_EVENTO_RECURRENTE SET finalizado_en=/])test('refund review recovery rollback at '+failure.source,async()=>{
      const t=await legacyRefundReview(),saved=await refundFinancial(t.f),hook=createWebhookService({pool:failingPool(failure)});
      await assert.rejects(hook.reprocessReview({eventId:t.receipt.id_evento,originalBody:t.body,sandboxId:context.sandboxId}),{status:503});
      assert.deepEqual(await refundFinancial(t.f),saved);assert.deepEqual((await query('SELECT * FROM EVENTO_RECURRENTE WHERE id_evento=?',[t.receipt.id_evento]))[0],t.receipt);
      assert.equal((await query('SELECT COUNT(*) n FROM REVISION_EVENTO_RECURRENTE WHERE id_evento=?',[t.receipt.id_evento]))[0].n,0);assert.equal(await blocked(t.f),1);
    });
    test('HU16 comprobante permanente y PDF conservan original aunque abono neto sea cero',async()=>{
      const f=await fixture(),s=require('../../src/services/paymentReceiptService'),id=f.transactions[0].id_pago,original=await s.getPaymentReceipt(3,'residente',id);await request(f);
      const receipt=await s.getPaymentReceipt(3,'residente',id);assert.equal(receipt.numero_comprobante,original.numero_comprobante);assert.equal(receipt.fecha_pago,original.fecha_pago);assert.equal(receipt.monto_pagado,5);assert.equal(receipt.reembolsado,5);assert.equal(receipt.abono_neto,0);
      assert((await s.listResidentRecurrenteReceipts(3)).some(r=>r.id_pago===id));const text=require('./support/receiptPdfText').receiptPdfText(await s.createPaymentReceiptPdf(receipt));assert(text.includes('Monto devuelto'));assert(text.includes('Abono neto actual'));assert(text.includes(receipt.numero_comprobante));
    });
    test('HU17 compara pago/refund conocidos y no escribe ninguna fila financiera',async()=>{
      const f=await fixture(),ev=evidence();await request(f,mockClient({reply:ev}));const before=await beforeFinancial(f),rr=(await query('SELECT * FROM REEMBOLSO_RECURRENTE WHERE id_transaccion=?',[txId(f)]))[0],tr=(await query('SELECT * FROM TRANSACCION_RECURRENTE WHERE id_transaccion=?',[txId(f)]))[0];
      const client={open:async()=>({context,getCheckout:async()=>({id:f.local[0].id_externo,status:'paid',amount:500,currency:'GTQ',paymentId:tr.id_pago_externo}),getIntent:async()=>({id:tr.id_externo,type:'payment',status:'succeeded',amount:500,currency:'GTQ',createdAt:tr.fecha_proveedor_original,checkout:{id:f.local[0].id_externo}}),getRefund:async()=>ev})};
      const result=await require('../../src/services/recurrenteReconciliationService').createReconciliationService({client}).verify({id_transaccion:txId(f)});assert.equal(result.operaciones[0].clasificacion,'CONCILIADA');assert.equal(result.operaciones[0].devuelto_centavos,500);assert.equal(result.operaciones[0].abono_neto_centavos,0);assert.equal(result.operaciones[0].cobertura_reembolsos.completa,false);
      assert.deepEqual(await beforeFinancial(f),before);assert.deepEqual(await row(rr.id_reembolso),rr);assert.deepEqual((await query('SELECT * FROM TRANSACCION_RECURRENTE WHERE id_transaccion=?',[txId(f)]))[0],tr);
    });
    test('ADMIN sesión real crea refund solo mock; residente y sesión revocada no acceden',async()=>{
      const f=await fixture(),path=`/admin/pagos/recurrente/${txId(f)}/refunds`,http=(token,input)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(input)});
      assert.equal((await http(residentToken,body())).status,403);const {createActiveSession}=require('../../src/services/activeSessionsService'),revoked=await createActiveSession(1);await query('UPDATE SESION_ACTIVA SET revocada_en=NOW() WHERE id_sesion=?',[revoked.sessionId]);assert.equal((await http(revoked.token,body())).status,401);
      const success=await http(adminToken,body());assert.equal(success.status,200);assert.equal((await success.json()).refund.estado,'CONFIRMADO');
    });
    test('TR FALLIDA protegida ineligible; consulta no modifica 486/937',async()=>{
      const client=mockClient(),s=createRefundService({client});assert.equal((await s.eligibility(actor,486)).elegible,false);await assert.rejects(s.request(actor,486,body()),{code:'REFUND_INELIGIBLE'});assert.equal(client.counts().posts,0);
    });
    test('backup/restore de refund aplicado conserva marcador, fecha, importe y FK',async()=>{
      const content=await require('../../src/services/automaticBackupsService').generateSql();assert(content.includes('capital_revertido_centavos'));assert(content.includes('request_fingerprint'));
      const {validateBackupPayload,verifyRestoredReferences}=require('../../src/services/restoresService'),validation=validateBackupPayload({filename:'hu18.sql',content});
      const targetName=await isolation.createOwnedRestoreDatabase(conn),target=await connect(targetName);
      try{await target.query('SET FOREIGN_KEY_CHECKS=0');for(const {name}of await query('SELECT TABLE_NAME name FROM information_schema.tables WHERE table_schema=DATABASE()')){
        const show=(await query(`SHOW CREATE TABLE \`${name}\``))[0]['Create Table'];await target.query(show.replace('CREATE TABLE','CREATE TABLE IF NOT EXISTS'));
      }await target.beginTransaction();for(const sql of validation.statements)await target.query(sql);await verifyRestoredReferences(target,validation.tables);await target.commit();await target.query('SET FOREIGN_KEY_CHECKS=1');
      assert.deepEqual((await target.query('SELECT * FROM REEMBOLSO_RECURRENTE ORDER BY 1'))[0],await query('SELECT * FROM REEMBOLSO_RECURRENTE ORDER BY 1'));
      for(const t of ['EVENTO_RECURRENTE','REVISION_EVENTO_RECURRENTE','REPARACION_REVISION_RECURRENTE'])
        assert.deepEqual((await target.query('SELECT * FROM `'+t+'` ORDER BY 1'))[0],await query('SELECT * FROM `'+t+'` ORDER BY 1'));
      assert.deepEqual((await target.query(`SELECT id_cuota,saldo_pendiente,total_reembolsado FROM (${QUOTA_BALANCES_SQL}) b ORDER BY id_cuota`))[0],await query(`SELECT id_cuota,saldo_pendiente,total_reembolsado FROM (${QUOTA_BALANCES_SQL}) b ORDER BY id_cuota`));
      }finally{await target.end();}
    });
  });
}
