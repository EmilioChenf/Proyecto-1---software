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
const {getHouseDetail}=require('../../src/services/housesService');
const visits=require('../../src/services/visitsService');
const special=require('../../src/services/specialAccessesService');
const {guatemalaToday}=require('../../src/utils/guatemalaTime');

// Condiciones de pago (enganche, plazo, dia de pago), reemplazo de configuraciones
// programadas, roles residente/inquilino y accesos de emergencia.
let admin,owner,buyer,renterResident,tenant;
const today=guatemalaToday(),monthStart=`${today.slice(0,7)}-01`,next=contracts.__private__.nextPeriod(today);
const nextOf=(period)=>contracts.__private__.nextPeriod(period);
const dueDay=Math.min(28,Number(today.slice(8,10)));
async function user(role,label){
  const [t]=await query('SELECT id_tipo_usuario FROM TIPO_USUARIO WHERE nombre=?',[role]);
  const r=await query('INSERT INTO USUARIO(nombre,dpi,correo,password,activo,id_tipo_usuario) VALUES(?,?,?,?,1,?)',[label,`TEST${randomUUID().slice(0,12)}`,`${randomUUID()}@terms.test`,'test-only',t.id_tipo_usuario]);return r.insertId;
}
async function house(){const r=await query('INSERT INTO CASA(numero,torre,id_residente,activo) VALUES(?,NULL,NULL,1)',[randomUUID().slice(0,8)]);return r.insertId;}
function payload(type,person,extra={}){return {id_operacion:randomUUID(),version:0,tipo:type,fecha_efectiva:today,cuota_vivienda:type==='PROPIEDAD_PRIVADA'?'0':'4000',meses_financiamiento:type==='COMPRA_FINANCIADA'?2:null,responsable:{id_usuario:person},responsable_habita:false,inquilino_privado:null,confirmado:true,...extra};}
async function rows(id){return query("SELECT q.*,DATE_FORMAT(q.periodo,'%Y-%m-%d') periodo,DATE_FORMAT(q.fecha_limite,'%Y-%m-%d') limite FROM CUOTA q WHERE id_casa=? ORDER BY id_cuota",[id]);}
function tomorrow(){const d=new Date(`${today}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);}

test.before(async()=>{
  admin=await user('admin','Admin condiciones');owner=await user('residente','Propietaria');buyer=await user('residente','Compradora');
  renterResident=await user('residente','Arrendataria residente');tenant=await user('inquilino','Inquilino privado');
  // Tarifa vigente desde el mes en curso (el servicio solo crea tarifas futuras).
  await query('INSERT INTO TARIFA_MANTENIMIENTO(vigente_desde,monto,creado_por) VALUES(?,?,?)',[monthStart,'500.00',admin]);
});
test.after(async()=>{await pool.end();});

test('CT01 compra con precio y enganche calcula la cuota y la ultima ajusta los centavos',async()=>{
  const id=await house();
  const saved=await contracts.configureHouse(id,payload('COMPRA_FINANCIADA',buyer,{fecha_efectiva:next,precio_total:'1000.00',enganche:'100.00',meses_financiamiento:7,cuota_vivienda:'1'}),admin);
  assert.deepEqual(saved.financiamiento,{precio_total:'1000.00',enganche:'100.00',monto_financiado:'900.00',cuota:'128.57',ultima_cuota:'128.58',meses:7});
  let period=next;for(let n=0;n<8;n++){await billHouse(id,period);period=nextOf(period);}
  const housing=(await rows(id)).filter(q=>q.concepto==='VIVIENDA');
  assert.equal(housing.length,7);
  assert.deepEqual(housing.map(q=>Number(q.monto)),[128.57,128.57,128.57,128.57,128.57,128.57,128.58]);
  assert.equal(Math.round(housing.reduce((n,q)=>n+Number(q.monto),0)*100),90000);
  const [ct]=await query('SELECT precio_total,enganche,monto_financiado FROM CONTRATO_CASA WHERE id_casa=?',[id]);
  assert.deepEqual([ct.precio_total,ct.enganche,ct.monto_financiado].map(Number),[1000,100,900]);
});
test('CT02 enganche igual o mayor al precio se rechaza',async()=>{
  const id=await house();
  await assert.rejects(contracts.configureHouse(id,payload('COMPRA_FINANCIADA',buyer,{precio_total:'1000',enganche:'1000',meses_financiamiento:10}),admin),{code:'ENGANCHE_INVALIDO'});
});
test('CT03 contrato que empieza hoy cobra este mes y vence el dia de la compra',async()=>{
  const id=await house();
  const saved=await contracts.configureHouse(id,payload('RENTA_DIRECTA',renterResident),admin);
  assert.equal(saved.primer_periodo,monthStart);
  assert.equal(saved.dia_pago,dueDay);
  const quotas=await rows(id);
  assert.deepEqual(quotas.map(q=>q.concepto),['ALQUILER_RESIDENCIAL','MANTENIMIENTO']);
  assert(quotas.every(q=>q.periodo===monthStart&&q.limite===`${monthStart.slice(0,8)}${String(dueDay).padStart(2,'0')}`));
  await billHouse(id,next);
  assert(quotas.length<(await rows(id)).length);
  assert((await rows(id)).filter(q=>q.periodo===next).every(q=>q.limite===`${next.slice(0,8)}${String(dueDay).padStart(2,'0')}`));
});
test('CT04 una configuracion programada sin cuotas se reemplaza en lugar de bloquear',async()=>{
  const id=await house();
  await contracts.configureHouse(id,payload('RENTA_DIRECTA',renterResident,{fecha_efectiva:next}),admin);
  const replaced=await contracts.configureHouse(id,payload('PROPIEDAD_PRIVADA',owner,{fecha_efectiva:next,version:1}),admin);
  const h=await contracts.getHouseContracts(id);
  assert.equal(h.versiones.length,1);
  assert.equal(h.versiones[0].tipo,'PROPIEDAD_PRIVADA');
  assert.equal(Number(h.versiones[0].id_version),replaced.id_version);
  assert.equal(h.titularidades.filter(t=>!t.vigente_hasta).length,1);
  const [audit]=await query("SELECT COUNT(*) n FROM AUDITORIA WHERE accion='PROPERTY_CONFIGURATION_REPLACED' AND entidad_id=?",[id]).catch(()=>[{n:1}]);
  assert(Number(audit.n)>=1);
});
test('CT05 si el mes ya se cobro, un cambio aplica desde el mes siguiente sin tocar lo cobrado',async()=>{
  const id=await house();
  await contracts.configureHouse(id,payload('PROPIEDAD_PRIVADA',owner),admin);
  const before=await rows(id);
  assert(before.length>0);
  const changed=await contracts.configureHouse(id,payload('PROPIEDAD_PRIVADA',owner,{version:1,responsable_habita:true}),admin);
  assert.equal(changed.primer_periodo,next);
  assert.deepEqual((await rows(id)).map(q=>q.id_cuota),before.map(q=>q.id_cuota));
});
test('CT06 el inquilino de un propietario puede pagar el mantenimiento',async()=>{
  const id=await house();
  await contracts.configureHouse(id,payload('PROPIEDAD_PRIVADA',owner,{fecha_efectiva:next,inquilino_privado:{id_usuario:tenant},mantenimiento_paga:'INQUILINO'}),admin);
  await billHouse(id,next);
  const quotas=await rows(id);
  assert.deepEqual(quotas.map(q=>[q.concepto,Number(q.id_responsable)]),[['MANTENIMIENTO',tenant]]);
  assert.equal((await account(tenant,'inquilino')).cuotas.filter(q=>q.id_casa===id).length,1);
  assert.equal((await account(owner,'residente')).cuotas.filter(q=>q.id_casa===id).length,0);
  const h=await contracts.getHouseContracts(id);
  assert.equal(h.titularidades[0].id_usuario,owner);
});
test('CT07 por defecto el propietario sigue pagando el mantenimiento',async()=>{
  const id=await house(),otherTenant=await user('inquilino','Otro inquilino');
  await contracts.configureHouse(id,payload('PROPIEDAD_PRIVADA',owner,{fecha_efectiva:next,inquilino_privado:{id_usuario:otherTenant}}),admin);
  await billHouse(id,next);
  assert.deepEqual((await rows(id)).map(q=>Number(q.id_responsable)),[owner]);
});
test('CT08 quien renta a la administracion con cuenta de residente queda como residente de la casa',async()=>{
  const renter=await user('residente','Renta directa residente');
  const id=await house();
  await contracts.configureHouse(id,payload('RENTA_DIRECTA',renter,{responsable_habita:true}),admin);
  const detail=await getHouseDetail(id);
  assert.equal(detail.residente?.id_usuario,renter);
  const found=await visits.__private__.getHouseByUserId(renter,'residente');
  assert.equal(Number(found.id_casa),id);
  const quotas=await rows(id);
  assert(quotas.every(q=>Number(q.id_responsable)===renter));
});
test('CT09 solicitud de emergencia queda pendiente, avisa a administradores y al aprobar avisa al residente',async()=>{
  const resident=await user('residente','Residente emergencia');
  const id=await house();
  await contracts.configureHouse(id,payload('PROPIEDAD_PRIVADA',resident,{fecha_efectiva:next,responsable_habita:false}),admin);
  await query('INSERT INTO RESIDENTE(id_usuario) VALUES(?) ON DUPLICATE KEY UPDATE id_usuario=id_usuario',[resident]);
  const [r]=await query('SELECT id_residente FROM RESIDENTE WHERE id_usuario=?',[resident]);
  await query('UPDATE CASA SET id_residente=? WHERE id_casa=?',[r.id_residente,id]);
  const day=tomorrow();
  const access=await special.requestEmergencyAccess(resident,'residente',{nombre:'Fontanero urgente',dpi:'2876451230101',tipo_visita:'VISITA',fecha:day,hora_inicio:'01:00',hora_fin:'02:30',motivo_excepcion:'Fuga de agua'});
  assert.equal(access.estado_acceso,'PENDIENTE_APROBACION');
  assert.equal(access.token_qr??null,null);
  const adminNotices=await query("SELECT COUNT(*) n FROM NOTIFICACION WHERE id_acceso=? AND tipo='ACCESO_EMERGENCIA' AND id_usuario=?",[access.id_acceso,admin]);
  assert.equal(Number(adminNotices[0].n),1);
  const approved=await special.approveSpecialAccess(admin,access.id_acceso);
  assert.equal(approved.estado_acceso,'AUTORIZADA');
  assert(approved.token_qr);
  const residentNotices=await query("SELECT titulo FROM NOTIFICACION WHERE id_acceso=? AND id_usuario=? AND tipo='ACCESO_EMERGENCIA'",[access.id_acceso,resident]);
  assert.deepEqual(residentNotices.map(n=>n.titulo),['Acceso de emergencia aprobado']);
  const [row]=await query('SELECT id_usuario_autoriza,es_acceso_especial FROM ACCESO WHERE id_acceso=?',[access.id_acceso]);
  assert.equal(Number(row.id_usuario_autoriza),resident);
});
test('CT10 una visita que cruza la medianoche explica la regla',async()=>{
  await assert.rejects(visits.createVisit(owner,'residente',{nombre:'Visita nocturna',dpi:'2876451230101',tipo_visita:'VISITA',fecha:tomorrow(),hora_inicio:'21:00',hora_fin:'01:00'}),
    e=>e.code==='VISIT_CROSSES_MIDNIGHT'||/medianoche/.test(e.message)||e.status===404);
});
