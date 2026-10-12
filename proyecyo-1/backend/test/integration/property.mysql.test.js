const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {configureTestEnvironment}=require('./support/isolatedMysql');
const {assertOwnedSuiteDatabase}=require('./support/suiteIsolation');
configureTestEnvironment();assertOwnedSuiteDatabase();
const {pool,query}=require('../../src/database/mysql');
const contracts=require('../../src/services/propertyContractsService');
const {billHouse}=require('../../src/services/monthlyBillingService').__private__;
const {account}=require('../../src/services/contractFinancialAccount');
const {payObligation}=require('../../src/services/simulatedPaymentsService');
const {getPaymentReceipt}=require('../../src/services/paymentReceiptService');
const {createCheckoutService}=require('../../src/services/recurrenteCheckoutService');
const {recipients}=require('../../src/services/financialNotificationsService').__private__;
const {getHouseDetail}=require('../../src/services/housesService');
const {guatemalaToday}=require('../../src/utils/guatemalaTime');
let admin,owner,renter,privateTenant,buyer,newOwner;
const today=guatemalaToday(),first=contracts.__private__.nextPeriod(today);
async function user(role,label){
  const [t]=await query('SELECT id_tipo_usuario FROM TIPO_USUARIO WHERE nombre=?',[role]);
  const result=await query('INSERT INTO USUARIO(nombre,dpi,correo,password,activo,id_tipo_usuario) VALUES(?,?,?,?,1,?)',[label,`TEST${randomUUID().slice(0,12)}`,`${randomUUID()}@contract.test`,'test-only',t.id_tipo_usuario]);return result.insertId;
}
async function house(){const r=await query('INSERT INTO CASA(numero,torre,id_residente,activo) VALUES(?,NULL,NULL,1)',[randomUUID().slice(0,8)]);return r.insertId;}
function payload(type='PROPIEDAD_PRIVADA',person=owner,extra={}){return {id_operacion:randomUUID(),version:0,tipo:type,fecha_efectiva:today,cuota_vivienda:type==='PROPIEDAD_PRIVADA'?'0':'4000',meses_financiamiento:type==='COMPRA_FINANCIADA'?2:null,responsable:{id_usuario:person},responsable_habita:false,inquilino_privado:null,confirmado:true,...extra};}
async function configured(type='PROPIEDAD_PRIVADA',person=owner,extra={}){const id=await house();await contracts.configureHouse(id,payload(type,person,extra),admin);return id;}
async function rows(id){return query("SELECT q.*,DATE_FORMAT(q.periodo,'%Y-%m-%d') periodo FROM CUOTA q WHERE id_casa=? ORDER BY id_cuota",[id]);}
async function settle(id){for(const q of await rows(id))await payObligation(q.id_responsable,q.id_responsable===renter?'inquilino':'residente',q.id_cuota);}
test.before(async()=>{
  admin=await user('admin','Admin contratos');owner=await user('residente','Propietario');newOwner=await user('residente','Nuevo propietario');buyer=await user('residente','Comprador');renter=await user('inquilino','Arrendatario');privateTenant=await user('inquilino','Inquilino privado');
  await contracts.saveMaintenance({monto:'500',vigente_desde:first},admin);
});
test.after(async()=>{await pool.end();});
test('B01 compra financiada separa comprador, plazo e importes',async()=>{const id=await configured('COMPRA_FINANCIADA',buyer);const h=await contracts.getHouseContracts(id);assert.equal(h.versiones[0].tipo,'COMPRA_FINANCIADA');assert.equal(Number(h.versiones[0].meses_financiamiento),2);});
test('B02 renta directa conserva titular empresa y responsable arrendatario',async()=>{const id=await configured('RENTA_DIRECTA',renter);const h=await contracts.getHouseContracts(id);assert.equal(Number(h.titularidades[0].titular_empresa),1);assert.equal(h.titularidades[0].id_usuario,null);assert.equal(Number(h.versiones[0].id_responsable),renter);});
test('B03 privada no permite cuota de vivienda',async()=>{const id=await configured('PROPIEDAD_PRIVADA',owner,{cuota_vivienda:'999'});assert.equal(Number((await contracts.getHouseContracts(id)).versiones[0].cuota_vivienda),0);});
test('B04 tipo libre rechazado sin cambios',async()=>{const id=await house();await assert.rejects(contracts.configureHouse(id,payload('OTRO'),admin),{status:422});assert.equal((await contracts.getHouseContracts(id)).versiones.length,0);});
test('B05 compra requiere plazo válido',async()=>{const id=await house();await assert.rejects(contracts.configureHouse(id,payload('COMPRA_FINANCIADA',buyer,{meses_financiamiento:0}),admin),{status:422});});
test('B06 compra genera vivienda y mantenimiento',async()=>{const id=await configured('COMPRA_FINANCIADA',buyer);await billHouse(id,first);assert.deepEqual((await rows(id)).map(q=>q.concepto),['VIVIENDA','MANTENIMIENTO']);assert.equal((await rows(id)).reduce((n,q)=>n+Number(q.monto),0),4500);});
test('B07 renta genera alquiler y mantenimiento al arrendatario',async()=>{const id=await configured('RENTA_DIRECTA',renter);await billHouse(id,first);const q=await rows(id);assert.deepEqual(q.map(q=>q.concepto),['ALQUILER_RESIDENCIAL','MANTENIMIENTO']);assert(q.every(q=>Number(q.id_responsable)===renter));});
test('B08 privada genera únicamente mantenimiento',async()=>{const id=await configured();await billHouse(id,first);assert.deepEqual((await rows(id)).map(q=>q.concepto),['MANTENIMIENTO']);});
test('B09 inquilino privado ve Q0 y ningún pago del propietario',async()=>{const id=await configured('PROPIEDAD_PRIVADA',owner,{inquilino_privado:{id_usuario:privateTenant}});await billHouse(id,first);const data=await account(privateTenant,'inquilino');assert.equal(data.resumen.saldo_pendiente,0);assert.deepEqual(data.cuotas,[]);assert.deepEqual(data.pagos,[]);});
test('B10 inquilino privado no puede pagar al propietario',async()=>{const id=await configured();await billHouse(id,first);await assert.rejects(payObligation(privateTenant,'inquilino',(await rows(id))[0].id_cuota),{status:403});});
test('B11 inquilino privado no puede crear checkout del propietario',async()=>{const id=await configured();await billHouse(id,first);const service=createCheckoutService({client:{sandboxId:()=> 'contract-test'}});await assert.rejects(service.startResidentCheckout(privateTenant,(await rows(id))[0].id_cuota),e=>e.status===403);});
test('B12 inquilino privado no puede leer comprobante del propietario',async()=>{const id=await configured();await billHouse(id,first);const payment=await payObligation(owner,'residente',(await rows(id))[0].id_cuota);await assert.rejects(getPaymentReceipt(privateTenant,'inquilino',payment.id_pago),{status:404});});
test('B13 recordatorio se dirige sólo al responsable financiero',async()=>{const id=await configured();await billHouse(id,first);const c=await pool.getConnection();try{assert.deepEqual(await recipients(c,(await rows(id))[0].id_cuota),[owner]);}finally{c.release();}});
test('B14 ejecutar dos veces no duplica el mes',async()=>{const id=await configured();await billHouse(id,first);assert.equal((await billHouse(id,first)).generadas,0);assert.equal((await rows(id)).length,1);});
test('B15 facturación simultánea crea sólo un conjunto',async()=>{const id=await configured('RENTA_DIRECTA',renter);const result=await Promise.all([billHouse(id,first),billHouse(id,first),billHouse(id,first)]);assert.equal(result.reduce((n,r)=>n+r.generadas,0),2);assert.equal((await rows(id)).length,2);});
test('B16 plazo N no genera N+1 y mantenimiento continúa',async()=>{const id=await configured('COMPRA_FINANCIADA',buyer);let p=first;for(let n=0;n<4;n++){await billHouse(id,p);p=contracts.__private__.nextPeriod(p);}const q=await rows(id);assert.equal(q.filter(q=>q.concepto==='VIVIENDA').length,2);assert.equal(q.filter(q=>q.concepto==='MANTENIMIENTO').length,4);assert.equal((await contracts.getHouseContracts(id)).versiones[0].estado,'FINANCIAMIENTO_COMPLETADO');});
test('B17 cuota generada cuenta aunque esté pendiente',async()=>{const id=await configured('COMPRA_FINANCIADA',buyer,{meses_financiamiento:1});await billHouse(id,first);await billHouse(id,contracts.__private__.nextPeriod(first));assert.equal((await rows(id)).filter(q=>q.concepto==='VIVIENDA').length,1);});
test('B18 tarifa nueva conserva importes históricos',async()=>{const id=await configured();await billHouse(id,first);const p=contracts.__private__.nextPeriod(first);await contracts.saveMaintenance({monto:'550',vigente_desde:p},admin);await billHouse(id,p);assert.deepEqual((await rows(id)).map(q=>Number(q.monto)),[500,550]);});
test('B19 cambio a mitad de mes comienza el mes siguiente',()=>{assert.equal(contracts.__private__.effectivePeriod('2030-03-17'),'2030-04-01');});
test('B20 venta con deuda real bloqueada',async()=>{const id=await configured();await billHouse(id,first);await assert.rejects(contracts.configureHouse(id,payload('PROPIEDAD_PRIVADA',newOwner,{version:1,fecha_efectiva:contracts.__private__.nextPeriod(first)}),admin),{code:'VENTA_CON_DEUDA'});});
test('B21 venta en Q0 permite historial pagado sin moverlo',async()=>{const id=await configured();await billHouse(id,first);await settle(id);const before=await rows(id);await contracts.configureHouse(id,payload('PROPIEDAD_PRIVADA',newOwner,{version:1,fecha_efectiva:contracts.__private__.nextPeriod(first)}),admin);assert.deepEqual(await rows(id),before);});
test('B22 nuevo propietario no ve cuotas del anterior',async()=>{const id=await configured();await billHouse(id,first);await settle(id);await contracts.configureHouse(id,payload('PROPIEDAD_PRIVADA',newOwner,{version:1,fecha_efectiva:contracts.__private__.nextPeriod(first)}),admin);const data=await account(newOwner,'residente');assert(!data.cuotas.some(q=>q.id_casa===id));});
test('B23 propietario anterior conserva comprobante propio',async()=>{const id=await configured();await billHouse(id,first);const payment=await payObligation(owner,'residente',(await rows(id))[0].id_cuota);await contracts.configureHouse(id,payload('PROPIEDAD_PRIVADA',newOwner,{version:1,fecha_efectiva:contracts.__private__.nextPeriod(first)}),admin);assert.equal((await getPaymentReceipt(owner,'residente',payment.id_pago)).titular_nombre,'Propietario');await assert.rejects(getPaymentReceipt(newOwner,'residente',payment.id_pago),{status:404});});
test('B24 casa desocupada privada sigue pagando mantenimiento',async()=>{const id=await configured();assert.equal((await getHouseDetail(id)).estado,'DISPONIBLE');await billHouse(id,first);assert.equal((await rows(id)).length,1);});
test('B25 doble envío devuelve la misma operación',async()=>{const id=await house(),body=payload();const [a,b]=await Promise.all([contracts.configureHouse(id,body,admin),contracts.configureHouse(id,body,admin)]);assert.equal(a.id_version,b.id_version);assert.equal((await contracts.getHouseContracts(id)).versiones.length,1);});
test('B26 reutilizar operación con otro cuerpo se rechaza',async()=>{const id=await house(),body=payload();await contracts.configureHouse(id,body,admin);await assert.rejects(contracts.configureHouse(id,{...body,responsable_habita:true},admin),{code:'OPERACION_CONFLICTO'});});
test('B27 versión obsoleta se rechaza',async()=>{const id=await configured();await assert.rejects(contracts.configureHouse(id,payload(),admin),{code:'VERSION_CONFLICTO'});});
test('B28 error de persona revierte todo el guardado',async()=>{const id=await house();await assert.rejects(contracts.configureHouse(id,payload('PROPIEDAD_PRIVADA',999999),admin),{status:422});assert.equal((await contracts.getHouseContracts(id)).versiones.length,0);});
test('B29 vivienda no configurada no recibe cobros inventados',async()=>{const id=await house();assert.equal((await billHouse(id,first)).generadas,0);assert.equal((await rows(id)).length,0);});
test('B30 auditoría registra usuario, fechas y titular previo',async()=>{const id=await configured();const [a]=await query("SELECT * FROM AUDITORIA WHERE entidad='CASA' AND entidad_id=? AND accion='PROPERTY_CONTRACT_CONFIGURED' ORDER BY id_auditoria DESC LIMIT 1",[String(id)]);assert.equal(Number(a.id_usuario),admin);assert(a.datos_nuevos);});

const http=(options)=>require('supertest')(require('../../src/app').createApp(options));
async function authorization(id){return 'Bearer '+(await require('../../src/services/activeSessionsService').createActiveSession(id)).token;}
test('B31 endpoints administrativos rechazan sesión ausente y rol falsificado en el body',async()=>{
  const id=await house();
  await http().get(`/admin/viviendas/${id}/contratos`).expect(401);
  await http().put(`/admin/viviendas/${id}/contrato`).set('Authorization',await authorization(owner)).send({...payload(),role:'admin',id_usuario:admin}).expect(403);
  assert.equal((await contracts.getHouseContracts(id)).versiones.length,0);
});
test('B32 IDOR HTTP de pago y recibo rechaza al inquilino privado',async()=>{
  const id=await configured();await billHouse(id,first);const q=(await rows(id))[0];
  const auth=await authorization(privateTenant);
  await http().post('/inquilino/pagos-simulados').set('Authorization',auth).send({id_cuota:q.id_cuota,id_usuario:owner,role:'residente'}).expect(403);
  const payment=await payObligation(owner,'residente',q.id_cuota);
  await http().get(`/inquilino/pagos/${payment.id_pago}/comprobante`).set('Authorization',auth).expect(404);
});
test('B33 dos administradores con la misma versión no crean contratos incompatibles',async()=>{
  const id=await house(),secondAdmin=await user('admin','Segundo administrador');
  const result=await Promise.allSettled([contracts.configureHouse(id,payload(),admin),contracts.configureHouse(id,payload('PROPIEDAD_PRIVADA',newOwner),secondAdmin)]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(result.find(r=>r.status==='rejected').reason.status,409);
  assert.equal((await contracts.getHouseContracts(id)).versiones.length,1);
});
test('B34 crear persona y fallar después revierte usuario y todas las relaciones',async()=>{
  const id=await house(),email=`${randomUUID()}@atomic.test`;
  await assert.rejects(contracts.configureHouse(id,payload('PROPIEDAD_PRIVADA',owner,{responsable:{nombre:'Nuevo propietario atómico',correo:email,password:'test-only'},inquilino_privado:{id_usuario:999999999}}),admin),{status:422});
  assert.equal((await query('SELECT id_usuario FROM USUARIO WHERE correo=?',[email])).length,0);
  assert.equal((await contracts.getHouseContracts(id)).versiones.length,0);
});
test('B35 generación concurrente con venta conserva un único responsable por cargo',async()=>{
  const id=await configured(),period=contracts.__private__.nextPeriod(first);
  const results=await Promise.allSettled([contracts.configureHouse(id,payload('PROPIEDAD_PRIVADA',newOwner,{version:1,fecha_efectiva:period}),admin),billHouse(id,period)]);
  assert.equal(results[1].status,'fulfilled');
  const q=await rows(id);assert.equal(q.length,1);
  if(results[0].status==='fulfilled')assert.equal(Number(q[0].id_responsable),newOwner);
  else {assert.equal(results[0].reason.code,'VENTA_CON_DEUDA');assert.equal(Number(q[0].id_responsable),owner);}
});
test('B36 tarifa con cero congela período sin inventar un cargo',async()=>{
  const period=contracts.__private__.nextPeriod(contracts.__private__.nextPeriod(first));
  await contracts.saveMaintenance({monto:'0',vigente_desde:period},admin);
  const id=await configured();assert.equal((await billHouse(id,period)).generadas,0);
  assert.equal((await billHouse(id,period)).estado,'YA_FACTURADO');
  assert.equal((await rows(id)).length,0);
});
test('B37 renta directa mantiene permisos y proveedores con titular empresa',async()=>{
  const tenant=await user('inquilino','Arrendatario operativo');
  await configured('RENTA_DIRECTA',tenant,{responsable_habita:true});
  const auth=await authorization(tenant);
  await http().get('/inquilino/permisos').set('Authorization',auth).expect(200);
  await http().get('/inquilino/proveedores').set('Authorization',auth).expect(200);
});
test('B38 scheduler usa medianoche Guatemala y omite otros días',async()=>{
  const {generateMonthlyBilling}=require('../../src/services/monthlyBillingService');
  const skipped=await generateMonthlyBilling({automatic:true,now:new Date('2030-04-01T05:59:59Z')});
  assert.equal(skipped.omitido,true);assert.equal(skipped.periodo,'2030-03-01');
  const run=await generateMonthlyBilling({automatic:true,now:new Date('2030-04-01T06:00:00Z')});
  assert.equal(run.periodo,'2030-04-01');
  const again=await generateMonthlyBilling({automatic:true,now:new Date('2030-04-01T06:01:00Z')});assert.equal(again.generadas,0);
});

test('B39 renta directa paga mediante checkout y webhook conservando titular y comprobante',async()=>{
  const tenant=await user('inquilino','Pagador directo');const id=await configured('RENTA_DIRECTA',tenant);
  await billHouse(id,first);const q=(await rows(id))[0];
  const {TEST_SANDBOX,paymentPayload}=require('./support/recurrenteWebhookFixtures');
  const {delivery}=require('./support/recurrenteRefundFixtures');
  let role;
  const service=createCheckoutService({client:{sandboxId:()=>TEST_SANDBOX,async createCheckout(local,mark){role=local.rol;await mark();const external='ch_TEST_'+randomUUID().replaceAll('-','');return {id_externo:external,estado_proveedor:'unpaid',checkout_url:`https://app.recurrente.com/checkout-session/${external}`};}}});
  const checkout=await service.startResidentCheckout(tenant,q.id_cuota);assert.equal(role,'inquilino');
  const [local]=await query('SELECT * FROM CHECKOUT_RECURRENTE WHERE referencia_local=?',[checkout.referencia_local]);
  assert.equal(local.id_residente,null);
  assert.equal(await require('../../src/services/recurrenteWebhookService').createWebhookService().receive(delivery(paymentPayload(local))),'processed');
  const [paid]=await query('SELECT * FROM PAGO WHERE id_cuota=?',[q.id_cuota]);assert.equal(Number(paid.id_actor),tenant);
  assert.equal((await getPaymentReceipt(tenant,'inquilino',paid.id_pago)).titular_nombre,'Pagador directo');
  await http().get(`/inquilino/pagos/${paid.id_pago}/comprobante`).set('Authorization',await authorization(tenant)).expect(200).expect('Content-Type',/pdf/);
  await http({recurrenteCheckoutService:service}).get(`/inquilino/pagos/recurrente/checkouts/${checkout.referencia_local}`).set('Authorization',await authorization(tenant)).expect(200);
  await http({recurrenteCheckoutService:service}).get(`/inquilino/pagos/recurrente/checkouts/${checkout.referencia_local}`).set('Authorization',await authorization(privateTenant)).expect(404);
});

test('B40 checkout legado conserva actor confirmado antes de clasificar la casa',async()=>{
  const id=await house();
  await query('INSERT INTO RESIDENTE(id_usuario) VALUES(?) ON DUPLICATE KEY UPDATE id_usuario=VALUES(id_usuario)',[owner]);
  const [resident]=await query('SELECT id_residente FROM RESIDENTE WHERE id_usuario=?',[owner]);
  await query('UPDATE CASA SET id_residente=? WHERE id_casa=?',[resident.id_residente,id]);
  const legacy=(await query("INSERT INTO CUOTA(id_servicio,id_casa,monto,fecha_limite) VALUES(1,?,5,'2026-10-20')",[id])).insertId;
  const {TEST_SANDBOX,paymentPayload}=require('./support/recurrenteWebhookFixtures');
  const {delivery}=require('./support/recurrenteRefundFixtures');
  const local={referencia_local:randomUUID(),id_externo:'ch_TEST_'+randomUUID().replaceAll('-',''),idempotency_key:randomUUID(),id_cuota:legacy,id_usuario:owner,id_residente:resident.id_residente,id_casa:id,monto_centavos:500,capital_centavos:500,recargo_centavos:0,moneda:'GTQ',ambiente:'sandbox',sandbox_id:TEST_SANDBOX,estado:'PENDIENTE',estado_proveedor:'unpaid'};
  const c=await pool.getConnection();try{await c.query('INSERT INTO CHECKOUT_RECURRENTE SET ?',local);}finally{c.release();}
  await contracts.configureHouse(id,payload(),admin);
  assert.equal(await require('../../src/services/recurrenteWebhookService').createWebhookService().receive(delivery(paymentPayload(local))),'processed');
  const [payment]=await query('SELECT * FROM PAGO WHERE id_cuota=?',[legacy]);
  assert.equal(Number(payment.id_actor),owner);
  assert.equal((await query('SELECT id_responsable FROM CUOTA WHERE id_cuota=?',[legacy]))[0].id_responsable,null);
});

test('B41 cambio contractual a mitad de mes conserva el mes emitido y aplica al siguiente',async()=>{
  const id=await configured();await billHouse(id,first);await settle(id);const before=await rows(id);
  const middle=first.slice(0,7)+'-15',next=contracts.__private__.nextPeriod(middle);
  await contracts.configureHouse(id,payload('COMPRA_FINANCIADA',owner,{version:1,fecha_efectiva:middle,cuota_vivienda:'700',meses_financiamiento:1}),admin);
  assert.deepEqual(await rows(id),before);
  assert.equal((await billHouse(id,first)).estado,'YA_FACTURADO');
  await billHouse(id,next);
  const charges=(await rows(id)).filter(q=>q.periodo===next);
  assert.equal(Number(charges.find(q=>q.concepto==='VIVIENDA').monto),700);
  assert.equal(Number(charges.find(q=>q.concepto==='MANTENIMIENTO').monto),550);
});
test('B42 fin de financiamiento permite transición privada confirmada y mantiene deuda histórica',async()=>{
  const id=await configured('COMPRA_FINANCIADA',buyer,{meses_financiamiento:1});
  await billHouse(id,first);const historical=await rows(id),next=contracts.__private__.nextPeriod(first);
  await contracts.configureHouse(id,payload('PROPIEDAD_PRIVADA',buyer,{version:1,fecha_efectiva:next}),admin);
  await billHouse(id,next);
  assert.deepEqual((await rows(id)).slice(0,historical.length),historical);
  assert.deepEqual((await rows(id)).filter(q=>q.periodo===next).map(q=>q.concepto),['MANTENIMIENTO']);
  assert.equal((await contracts.getHouseContracts(id)).versiones[0].tipo,'PROPIEDAD_PRIVADA');
});
test('B43 aviso financiero legado ajeno se oculta sin ocultar avisos operativos del inquilino',async()=>{
  const id=await configured();await billHouse(id,first);const q=(await rows(id))[0];
  const debt=(await query("INSERT INTO NOTIFICACION(id_usuario,tipo,titulo,mensaje) VALUES(?,'RECORDATORIO_PAGO','Deuda privada','Dato financiero privado')",[privateTenant])).insertId;
  await query("INSERT INTO RECORDATORIO_PAGO(id_casa,id_cuota,id_usuario,id_notificacion,tipo,titulo,mensaje,monto,fecha_limite,dias_para_vencer,fecha_envio) VALUES(?,?,?,?,'VENCIDO','Deuda','TEST',500,?,-1,?)",[id,q.id_cuota,privateTenant,debt,q.fecha_limite,today]);
  const operational=(await query("INSERT INTO NOTIFICACION(id_usuario,tipo,titulo,mensaje) VALUES(?,'AVISO','Acceso autorizado','Aviso operativo')",[privateTenant])).insertId;
  const notifications=require('../../src/services/notificationsService'),visible=await notifications.listNotifications(privateTenant);
  assert(!visible.some(n=>n.id_notificacion===debt));assert(visible.some(n=>n.id_notificacion===operational));
  await assert.rejects(notifications.markNotificationAsRead(privateTenant,debt),{status:404});
});
test('B44 venta financiada en Q0 bloquea sólo deuda emitida y conserva cuotas pagadas',async()=>{
  const id=await configured('COMPRA_FINANCIADA',buyer);await billHouse(id,first);await settle(id);const before=await rows(id);
  await contracts.configureHouse(id,payload('PROPIEDAD_PRIVADA',newOwner,{version:1,fecha_efectiva:contracts.__private__.nextPeriod(first)}),admin);
  assert.deepEqual(await rows(id),before);
  assert.equal((await contracts.getHouseContracts(id)).versiones[0].id_responsable,newOwner);
});

test.describe('Migración aditiva desde esquema anterior',()=>{
  let c,before,after,schema;
  const tables=['USUARIO','RESIDENTE','INQUILINO','CASA','CUOTA','PAGO','SERVICIO','PAGO_ORIGEN'];
  const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await c.query(`SELECT * FROM ${table} ORDER BY 1`))[0]])));
  test.before(async()=>{
    const {createOwnedRestoreDatabase}=require('./support/suiteIsolation');
    const {connect}=require('./support/isolatedMysql');
    const parent=await connect();try{schema=await createOwnedRestoreDatabase(parent);}finally{await parent.end();}
    const {spawnSync}=require('node:child_process');
    const initialized=spawnSync(process.execPath,['scripts/prepare-property-migration-fixture.js'],{cwd:require('node:path').resolve(__dirname,'../..'),env:{...process.env,PHASE0_TEST_DATABASE:schema,DB_NAME:schema},windowsHide:true,encoding:'utf8'});
    assert.equal(initialized.status,0,initialized.stderr);
    c=await connect(schema);before=await snapshot();
    const [[old]]=await c.execute("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CUOTA' AND COLUMN_NAME='id_responsable'");assert.equal(Number(old.n),0);
    await require('../../src/database/propertyContractMigration').applyPropertyContractMigration(c);after=await snapshot();
    console.log(JSON.stringify({migrationDatabase:schema,antes:Object.fromEntries(tables.map(t=>[t,before[t].length])),despues:Object.fromEntries(tables.map(t=>[t,after[t].length]))}));
  });
  test.after(async()=>{await c?.end();});
  function preserved(table){assert.deepEqual(after[table].map((row,i)=>Object.fromEntries(Object.keys(before[table][i]).map(k=>[k,row[k]]))),before[table]);}
  test('M01 preserva todas las personas y sus credenciales',()=>preserved('USUARIO'));
  test('M02 preserva residentes e inquilinos',()=>{preserved('RESIDENTE');preserved('INQUILINO');});
  test('M03 preserva viviendas, IDs y relaciones actuales',()=>preserved('CASA'));
  test('M04 preserva cuotas, importes y vencimientos',()=>preserved('CUOTA'));
  test('M05 preserva pagos y sus fechas',()=>preserved('PAGO'));
  test('M06 preserva servicios y trazabilidad Recurrente',()=>{preserved('SERVICIO');preserved('PAGO_ORIGEN');});
  test('M07 cuotas históricas conservan responsable desconocido nullable',()=>{assert(after.CUOTA.every(q=>q.origen==='HISTORICO'&&q.id_responsable===null&&q.periodo===null));});
  test('M08 no inventa contratos, tarifas ni cobros',async()=>{for(const table of ['CONTRATO_CASA','CONTRATO_CASA_VERSION','TARIFA_MANTENIMIENTO','FACTURACION_CASA_PERIODO'])assert.equal(Number((await c.query(`SELECT COUNT(*) n FROM ${table}`))[0][0].n),0);});
  test('M09 migración repetida es idempotente y conserva datos',async()=>{await require('../../src/database/propertyContractMigration').applyPropertyContractMigration(c);assert.deepEqual(await snapshot(),after);});
  test('M10 aplicación responde y las claves financieras están presentes',async()=>{await require('supertest')(require('../../src/app').createApp()).get('/health').expect(200);const [keys]=await c.query("SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CUOTA'");assert(keys.some(k=>k.INDEX_NAME==='uq_cuota_casa_periodo_concepto'));assert(keys.some(k=>k.INDEX_NAME==='uq_cuota_contrato_numero'));});
});
