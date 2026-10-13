const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto'),{spawnSync}=require('node:child_process');
const {configureTestEnvironment,connect}=require('./support/isolatedMysql');
const {assertOwnedSuiteDatabase,createOwnedRestoreDatabase}=require('./support/suiteIsolation');
configureTestEnvironment();assertOwnedSuiteDatabase();
const {pool,query}=require('../../src/database/mysql');
const receipts=require('../../src/services/paymentReceiptService');
const {getFinancialDetail}=require('../../src/services/residentFinancialDetailService');
const {listResidentAccountStatement}=require('../../src/services/residentAccountService');
const {payObligation}=require('../../src/services/simulatedPaymentsService');
const contracts=require('../../src/services/propertyContractsService');
const {billHouse}=require('../../src/services/monthlyBillingService').__private__;
const {syncHouseRelations}=require('../../src/services/contractHouseRelations');
const {receiptPdfText}=require('./support/receiptPdfText');
const http=require('supertest')(require('../../src/app').createApp());
const today=require('../../src/utils/guatemalaTime').guatemalaToday(),first=contracts.__private__.nextPeriod(today),people={};
async function person(role,name){
  const [t]=await query('SELECT id_tipo_usuario FROM TIPO_USUARIO WHERE nombre=?',[role]);
  const id=(await query('INSERT INTO USUARIO(nombre,dpi,correo,password,activo,id_tipo_usuario) VALUES(?,?,?,?,1,?)',[name,randomUUID().slice(0,12),randomUUID()+'@n2.test','test-only',t.id_tipo_usuario])).insertId;
  const resident=role==='residente'?(await query('INSERT INTO RESIDENTE(id_usuario) VALUES(?)',[id])).insertId:null;
  return{id,resident,role,name,auth:'Bearer '+(await require('../../src/services/activeSessionsService').createActiveSession(id)).token};
}
async function legacy({current=people.maria,actor=people.juan,unknown=false}={}){
  const house=(await query('INSERT INTO CASA(numero,id_residente,activo) VALUES(?,?,1)',[randomUUID().slice(0,8),current?.resident||null])).insertId;
  const quota=(await query("INSERT INTO CUOTA(id_casa,id_servicio,monto,fecha_limite) VALUES(?,1,123,'2025-09-10')",[house])).insertId;
  const payment=(await query("INSERT INTO PAGO(id_cuota,monto_pagado,fecha_pago) VALUES(?,123,'2025-09-09')",[quota])).insertId;
  if(!unknown)await query("INSERT INTO TRANSACCION_SIMULADA(id_pago,id_usuario,id_casa,rol,concepto,monto,estado) VALUES(?,?,?,?,'Pago histórico N2',123,'APROBADA')",[payment,actor.id,house,actor.role]);
  await query("INSERT INTO PAGO_ORIGEN(id_pago,id_cuota,origen,ambiente) VALUES(?,?,'SIMULADO','academic')",[payment,quota]);
  return{house,quota,payment};
}
function body(p,extra={}){return{id_operacion:randomUUID(),version:0,tipo:'PROPIEDAD_PRIVADA',fecha_efectiva:today,cuota_vivienda:'0',meses_financiamiento:null,responsable:{id_usuario:p.id},responsable_habita:false,inquilino_privado:null,confirmado:true,...extra};}
async function configured(p,extra={}){const h=(await query('INSERT INTO CASA(numero,activo) VALUES(?,1)',[randomUUID().slice(0,8)])).insertId;await contracts.configureHouse(h,body(p,extra),people.admin.id);return h;}
async function activate(h,day){const c=await pool.getConnection();try{await c.beginTransaction();await syncHouseRelations(c,h,day);await c.commit();}catch(e){await c.rollback();throw e;}finally{c.release();}}
async function denied(p,payment,extra=''){
  const prefix=p.role==='inquilino'?'inquilino':'residente',paths=[`/${prefix}/pagos/${payment}/comprobante${extra}`];
  if(prefix==='residente')paths.push(`/residente/pagos/${payment}/comprobante/datos${extra}`);
  for(const path of paths){const r=await http.get(path).set('Authorization',p.auth);assert.equal(r.status,404,path);assert.doesNotMatch(r.text||'',/NXR-|Juan|Pago histórico N2|123\.00/);}
}
test.before(async()=>{
  for(const [key,role,name]of [['juan','residente','Juan histórico N2'],['maria','residente','María actual N2'],['other','residente','Otra vivienda N2'],['private','inquilino','Inquilino privado N2'],['direct','inquilino','Arrendatario directo N2'],['admin','admin','Administrador N2']])people[key]=await person(role,name);
  await contracts.saveMaintenance({monto:'500',vigente_desde:first},people.admin.id);
  await query('INSERT INTO CASA(numero,id_residente,activo) VALUES(?,?,1)',['OTHER-N2',people.other.resident]);
});
test.after(async()=>{await pool.end();});
test('N2 BEFORE/AFTER servicio niega al residente actual el comprobante del pagador legado',async()=>{
  const f=await legacy();assert.equal((await receipts.getPaymentReceipt(people.juan.id,'residente',f.payment)).titular_nombre,people.juan.name);
  await assert.rejects(receipts.getPaymentReceipt(people.maria.id,'residente',f.payment),{status:404});
});
test('N2 BEFORE/AFTER HTTP JSON/PDF con sesiones reales bloquea cambio de residente',async()=>{
  const f=await legacy();await denied(people.maria,f.payment);
  const json=await http.get(`/residente/pagos/${f.payment}/comprobante/datos`).set('Authorization',people.juan.auth).expect(200);assert.equal(json.body.titular_nombre,people.juan.name);
  const pdf=await http.get(`/residente/pagos/${f.payment}/comprobante`).set('Authorization',people.juan.auth).expect(200);assert.equal(pdf.body.subarray(0,4).toString(),'%PDF');assert(receiptPdfText(pdf.body).includes(people.juan.name));
});
test('N2 BEFORE/AFTER upgrade real conserva datos y separa Juan/María/tercero/admin',async()=>{
  const c=await connect();let schema;try{schema=await createOwnedRestoreDatabase(c);}finally{await c.end();}
  const env={...process.env,PHASE0_TEST_DATABASE:schema,DB_NAME:schema};
  for(const script of ['scripts/prepare-property-migration-fixture.js','test/integration/support/n2UpgradeProbe.js']){
    const child=spawnSync(process.execPath,[script],{env,encoding:'utf8',windowsHide:true,timeout:300000});process.stdout.write(child.stdout||'');assert.equal(child.status,0,child.stderr||child.error?.message);
  }
});
test('N2 historial y estado de cuenta conservan al pagador sin casa actual',async()=>{
  const f=await legacy(),old=await getFinancialDetail(people.juan.id),current=await getFinancialDetail(people.maria.id);
  assert(old.pagos.some(p=>p.id_pago===f.payment));assert(!current.pagos.some(p=>p.id_pago===f.payment));assert(!current.cargos.some(q=>q.id_cuota===f.quota));
  assert((await listResidentAccountStatement(people.juan.id)).cuotas.some(q=>q.id_cuota===f.quota));assert(!(await listResidentAccountStatement(people.maria.id)).cuotas.some(q=>q.id_cuota===f.quota));
});
for(const key of ['maria','other','private'])test(`N2 IDOR ${key}: URL/IDs/query no conceden comprobante ajeno`,async()=>{
  const f=await legacy();await denied(people[key],f.payment,`?id_usuario=${people.juan.id}&id_casa=${f.house}&paymentId=${f.payment}&role=residente`);await denied(people[key],2147483647);
  const route=people[key].role==='inquilino'?'/inquilino/historial-financiero':'/residente/detalle-financiero';
  const r=await http.get(`${route}?id_usuario=${people.juan.id}&id_casa=${f.house}`).set('Authorization',people[key].auth).expect(200);assert(!(r.body.pagos||[]).some(p=>p.id_pago===f.payment));
  await http.get('/admin/reportes/exportar?reporte=morosos&formato=xlsx').set('Authorization',people[key].auth).expect(403);
});
test('N2 pagador legado que sigue como residente conserva JSON/PDF y hecho histórico',async()=>{
  const f=await legacy({current:people.juan}),data=await receipts.getPaymentReceipt(people.juan.id,'residente',f.payment);
  assert.equal(data.titular_nombre,people.juan.name);assert.equal(data.monto_pagado,123);assert.equal(data.fecha_pago,'2025-09-09');assert.equal(data.fecha_limite,'2025-09-10');assert(receiptPdfText(await receipts.createPaymentReceiptPdf(data)).includes(people.juan.name));
});
test('N2 venta real conserva recibo legado del vendedor y excluye comprador',async()=>{
  const f=await legacy({current:people.juan}),next=contracts.__private__.nextPeriod(first);await contracts.configureHouse(f.house,body(people.juan),people.admin.id);await contracts.configureHouse(f.house,body(people.maria,{version:1,fecha_efectiva:next}),people.admin.id);await activate(f.house,next);
  assert.equal((await query('SELECT r.id_usuario FROM CASA c JOIN RESIDENTE r ON r.id_residente=c.id_residente WHERE c.id_casa=?',[f.house]))[0].id_usuario,people.maria.id);
  await denied(people.maria,f.payment);assert.equal((await receipts.getPaymentReceipt(people.juan.id,'residente',f.payment)).titular_nombre,people.juan.name);
  assert((await getFinancialDetail(people.juan.id)).pagos.some(p=>p.id_pago===f.payment));assert(!(await getFinancialDetail(people.maria.id)).pagos.some(p=>p.id_pago===f.payment));
});
test('N2 cambios de ocupante y lecturas concurrentes no cambian el actor del recibo',async()=>{
  const f=await legacy({current:people.juan}),original=await receipts.getPaymentReceipt(people.juan.id,'residente',f.payment);
  for(const resident of [people.maria.resident,null,people.other.resident,people.juan.resident]){await query('UPDATE CASA SET id_residente=? WHERE id_casa=?',[resident,f.house]);const rows=await Promise.all(Array.from({length:4},()=>receipts.getPaymentReceipt(people.juan.id,'residente',f.payment)));rows.forEach(r=>assert.deepEqual(r,original));await denied(people.maria,f.payment);}
});
test('N2 nuevo modelo conserva snapshot tras venta y renombrar al comprador',async()=>{
  const buyer=await person('residente','Comprador nuevo N2'),house=await configured(people.juan);await billHouse(house,first);const [q]=await query('SELECT id_cuota FROM CUOTA WHERE id_casa=?',[house]);const p=await payObligation(people.juan.id,'residente',q.id_cuota),original=await receipts.getPaymentReceipt(people.juan.id,'residente',p.id_pago),next=contracts.__private__.nextPeriod(first);
  await contracts.configureHouse(house,body(buyer,{version:1,fecha_efectiva:next}),people.admin.id);await activate(house,next);await query("UPDATE USUARIO SET nombre='Comprador renombrado N2' WHERE id_usuario=?",[buyer.id]);
  assert.deepEqual(await receipts.getPaymentReceipt(people.juan.id,'residente',p.id_pago),original);await denied(buyer,p.id_pago);
});
test('N2 renta directa con residente NULL conserva PDF e historial al terminar contrato',async()=>{
  const house=await configured(people.direct,{tipo:'RENTA_DIRECTA',cuota_vivienda:'900'});await billHouse(house,first);const [q]=await query('SELECT id_cuota FROM CUOTA WHERE id_casa=? ORDER BY id_cuota',[house]);const p=await payObligation(people.direct.id,'inquilino',q.id_cuota),original=await receipts.getPaymentReceipt(people.direct.id,'inquilino',p.id_pago);
  assert.equal(original.titular_nombre,people.direct.name);await http.get(`/inquilino/pagos/${p.id_pago}/comprobante`).set('Authorization',people.direct.auth).expect(200);
  for(const row of await query('SELECT id_cuota FROM CUOTA WHERE id_casa=? AND id_cuota<>?',[house,q.id_cuota]))await payObligation(people.direct.id,'inquilino',row.id_cuota);
  const next=contracts.__private__.nextPeriod(first);await contracts.configureHouse(house,body(people.maria,{version:1,fecha_efectiva:next}),people.admin.id);await activate(house,next);
  assert.deepEqual(await receipts.getPaymentReceipt(people.direct.id,'inquilino',p.id_pago),original);const r=await http.get('/inquilino/historial-financiero').set('Authorization',people.direct.auth).expect(200);assert(r.body.pagos.some(row=>row.id_pago===p.id_pago));await denied(people.maria,p.id_pago);
});
test('N2 inquilino privado mantiene Q0 sin pagos/PDF del propietario',async()=>{
  const house=await configured(people.juan,{inquilino_privado:{id_usuario:people.private.id}});await billHouse(house,first);const [q]=await query('SELECT id_cuota FROM CUOTA WHERE id_casa=?',[house]);const p=await payObligation(people.juan.id,'residente',q.id_cuota);await denied(people.private,p.id_pago);
  const r=await http.get('/inquilino/estado-cuenta').set('Authorization',people.private.auth).expect(200);assert.equal(r.body.resumen.saldo_pendiente,0);assert.deepEqual(r.body.pagos,[]);
});
test('N2 actor desconocido no se atribuye al residente ni al solicitante',async()=>{
  const f=await legacy({unknown:true});await denied(people.maria,f.payment);await denied(people.juan,f.payment);const [row]=await query('SELECT id_actor,titular_snapshot FROM PAGO WHERE id_pago=?',[f.payment]);assert.equal(row.id_actor,null);assert.equal(row.titular_snapshot,null);assert(!(await getFinancialDetail(people.maria.id)).pagos.some(p=>p.id_pago===f.payment));
});
test('N2 admin conserva pagos/reportes completos sin adquirir permisos residenciales',async()=>{
  const f=await legacy(),report=await http.get('/admin/reportes/financiero-mensual?mes=9&anio=2025').set('Authorization',people.admin.auth).expect(200);assert(report.body.pagos.some(p=>p.id_pago===f.payment));const recent=await http.get('/admin/pagos/recientes').set('Authorization',people.admin.auth).expect(200);assert(recent.body.some(p=>p.id_pago===f.payment&&p.usuario===people.juan.name));
  assert.equal(report.body.detalle.find(row=>row.id_casa===f.house).usuario,people.juan.name);
  for(const format of ['pdf','xlsx'])await http.get(`/admin/reportes/exportar?reporte=morosos&formato=${format}`).set('Authorization',people.admin.auth).expect(200);await http.get(`/residente/pagos/${f.payment}/comprobante/datos`).set('Authorization',people.admin.auth).expect(403);
});
test('N2 cuota parcial legada no expone saldo ni recordatorios al nuevo residente',async()=>{
  const f=await legacy();await query('UPDATE CUOTA SET monto=200 WHERE id_cuota=?',[f.quota]);await assert.rejects(payObligation(people.maria.id,'residente',f.quota),{status:403});
  const service=require('../../src/services/recurrenteCheckoutService').createCheckoutService({client:{sandboxId:()=> 'n2-test-only'}});await assert.rejects(service.startResidentCheckout(people.maria.id,f.quota),e=>e.status===403);
  const c=await pool.getConnection();try{assert.deepEqual(await require('../../src/services/financialNotificationsService').__private__.recipients(c,f.quota),[people.juan.id]);}finally{c.release();}
});
test('N2 actor explícito del pago prevalece sobre transacción/cuota de otra persona',async()=>{
  const f=await legacy({actor:people.maria});
  await query('UPDATE CUOTA SET id_responsable=?,responsable_snapshot=? WHERE id_cuota=?',[people.maria.id,JSON.stringify({id_usuario:people.maria.id,nombre:people.maria.name}),f.quota]);
  await query('UPDATE PAGO SET id_actor=?,titular_snapshot=? WHERE id_pago=?',[people.juan.id,JSON.stringify({id_usuario:people.juan.id,nombre:people.juan.name}),f.payment]);
  assert.equal((await receipts.getPaymentReceipt(people.juan.id,'residente',f.payment)).titular_nombre,people.juan.name);await denied(people.maria,f.payment);
  assert(!(await getFinancialDetail(people.maria.id)).pagos.some(p=>p.id_pago===f.payment));
});
test('N2 snapshot identificable sin id_actor conserva identidad al renombrar usuario',async()=>{
  const actor=await person('residente','Nombre histórico guardado N2'),f=await legacy({actor});
  await query('DELETE FROM TRANSACCION_SIMULADA WHERE id_pago=?',[f.payment]);
  await query('UPDATE PAGO SET titular_snapshot=? WHERE id_pago=?',[JSON.stringify({id_usuario:actor.id,nombre:actor.name,correo:'historico@n2.test'}),f.payment]);
  await query("UPDATE USUARIO SET nombre='Nombre posterior N2' WHERE id_usuario=?",[actor.id]);
  assert.equal((await receipts.getPaymentReceipt(actor.id,'residente',f.payment)).titular_nombre,actor.name);await denied(people.maria,f.payment);
});
test('N2 evidencia contradictoria no habilita fallback al residente actual',async()=>{
  const f=await legacy(),second=(await query("INSERT INTO PAGO(id_cuota,monto_pagado,fecha_pago,id_actor) VALUES(?,1,'2025-09-09',?)",[f.quota,people.other.id])).insertId;
  await denied(people.maria,f.payment);await denied(people.maria,second);
  assert(!(await listResidentAccountStatement(people.maria.id)).cuotas.some(q=>q.id_cuota===f.quota));
});
test('N2 pago desconocido conserva etiqueta administrativa y filas sin backfill',async()=>{
  const f=await legacy({unknown:true}),report=await http.get('/admin/reportes/financiero-mensual?mes=9&anio=2025').set('Authorization',people.admin.auth).expect(200);
  assert(report.body.pagos.some(p=>p.id_pago===f.payment));assert.equal(report.body.detalle.find(r=>r.id_casa===f.house).usuario,'Responsable no confirmado');
});
test('N2 IDOR en body no autoriza pagar cuota histórica ajena ni entrega datos parciales',async()=>{
  const f=await legacy();await query('UPDATE CUOTA SET monto=200 WHERE id_cuota=?',[f.quota]);
  await http.post('/residente/pagos-simulados').set('Authorization',people.maria.auth).send({id_cuota:f.quota,id_usuario:people.juan.id,id_casa:f.house,role:'admin'}).expect(403);
  await http.get(`/residente/pagos/${f.payment}/comprobante/datos`).expect(401);
  assert.equal((await query('SELECT COUNT(*) n FROM PAGO WHERE id_cuota=?',[f.quota]))[0].n,1);
});
test('N2 Recurrente legado: transacción/listado/JSON/PDF y reembolsos respetan pagador',async()=>{
  const f=await legacy();await query('DELETE FROM TRANSACCION_SIMULADA WHERE id_pago=?',[f.payment]);
  await query("UPDATE PAGO_ORIGEN SET origen='RECURRENTE',ambiente='sandbox' WHERE id_pago=?",[f.payment]);
  const token=randomUUID().replaceAll('-','');
  const co=(await query(`INSERT INTO CHECKOUT_RECURRENTE(referencia_local,idempotency_key,id_externo,id_cuota,id_usuario,id_residente,id_casa,monto_centavos,capital_centavos,recargo_centavos,moneda,ambiente,estado,estado_proveedor)
    VALUES(?,?,?,?,?,?,?,12300,12300,0,'GTQ','sandbox','CONFIRMADO','paid')`,[randomUUID(),randomUUID(),'ch_N2_'+token,f.quota,people.juan.id,people.juan.resident,f.house])).insertId;
  const tr=(await query(`INSERT INTO TRANSACCION_RECURRENTE(id_checkout,id_externo,idempotency_key,id_cuota,id_usuario,id_casa,id_pago,monto_centavos,moneda,ambiente,estado,confirmado_en,capital_aplicado_centavos,recargo_aplicado_centavos)
    VALUES(?,?,?,?,?,?,?,12300,'GTQ','sandbox','CONFIRMADA',UTC_TIMESTAMP(),12300,0)`,[co,'in_N2_'+token,randomUUID(),f.quota,people.juan.id,f.house,f.payment])).insertId;
  const refund=(await query(`INSERT INTO REEMBOLSO_RECURRENTE(id_transaccion,id_externo,idempotency_key,id_usuario_solicitante,tipo,monto_centavos,moneda,ambiente,estado,confirmado_en,fecha_contable,aplicado_en,capital_revertido_centavos,recargo_revertido_centavos)
    VALUES(?,?,?,?,'PARCIAL',100,'GTQ','sandbox','CONFIRMADO',UTC_TIMESTAMP(),'2025-09-10',UTC_TIMESTAMP(),100,0)`,[tr,'re_N2_'+token,randomUUID(),people.admin.id])).insertId;
  const url=`/residente/pagos/recurrente/transacciones/${tr}/comprobante`;
  const own=await http.get(url).set('Authorization',people.juan.auth).expect(200);assert.equal(own.body.titular_nombre,people.juan.name);assert.equal(own.body.reembolsado,1);
  for(const p of [people.maria,people.other]){await http.get(url).set('Authorization',p.auth).expect(404);await denied(p,f.payment);const list=await http.get('/residente/pagos/recurrente/comprobantes').set('Authorization',p.auth).expect(200);assert(!list.body.some(r=>r.id_pago===f.payment));assert(!(await getFinancialDetail(p.id)).reembolsos.some(r=>r.id_reembolso===refund));}
  const list=await http.get('/residente/pagos/recurrente/comprobantes').set('Authorization',people.juan.auth).expect(200);assert(list.body.some(r=>r.id_pago===f.payment));
  assert((await getFinancialDetail(people.juan.id)).reembolsos.some(r=>r.id_reembolso===refund));
  await http.get(`/residente/pagos/${f.payment}/comprobante`).set('Authorization',people.juan.auth).expect(200);
});
