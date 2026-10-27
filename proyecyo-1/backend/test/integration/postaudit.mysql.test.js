const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { configureTestEnvironment } = require('./support/isolatedMysql');
const { assertOwnedSuiteDatabase } = require('./support/suiteIsolation');
configureTestEnvironment();
assertOwnedSuiteDatabase();
const { pool, query } = require('../../src/database/mysql');
const contracts = require('../../src/services/propertyContractsService');
const { billHouse } = require('../../src/services/monthlyBillingService').__private__;
const { syncHouseRelations } = require('../../src/services/contractHouseRelations');
const { payObligation } = require('../../src/services/simulatedPaymentsService');
const { guatemalaToday } = require('../../src/utils/guatemalaTime');
const today = guatemalaToday(), first = contracts.__private__.nextPeriod(today);
const second = contracts.__private__.nextPeriod(first), third = contracts.__private__.nextPeriod(second);
let admin, juan, maria;
async function user(role, name) {
  const [type] = await query('SELECT id_tipo_usuario FROM TIPO_USUARIO WHERE nombre=?', [role]);
  return (await query('INSERT INTO USUARIO(nombre,dpi,correo,password,activo,id_tipo_usuario) VALUES(?,?,?,?,1,?)',
    [name, `T${randomUUID().slice(0,12)}`, `${randomUUID()}@audit.test`, 'test-only', type.id_tipo_usuario])).insertId;
}
async function house() {
  return (await query('INSERT INTO CASA(numero,id_residente,activo) VALUES(?,NULL,1)', [randomUUID().slice(0,8)])).insertId;
}
function body(person=juan, extra={}) {
  return { id_operacion:randomUUID(), version:0, tipo:'PROPIEDAD_PRIVADA', fecha_efectiva:today,
    cuota_vivienda:'0', meses_financiamiento:null, responsable:{id_usuario:person}, responsable_habita:false,
    inquilino_privado:null, confirmado:true, ...extra };
}
async function configured(person=juan, extra={}) {
  const id=await house(); await contracts.configureHouse(id,body(person,extra),admin); return id;
}
const quotas = id => query('SELECT * FROM CUOTA WHERE id_casa=? ORDER BY id_cuota',[id]);
async function sync(id, day) {
  const c=await pool.getConnection();
  try { await c.beginTransaction(); const result=await syncHouseRelations(c,id,day); await c.commit(); return result; }
  catch(e){await c.rollback();throw e;} finally{c.release();}
}
test.before(async()=>{
  admin=await user('admin','Administrador'); juan=await user('residente','Juan'); maria=await user('residente','María');
  await contracts.saveMaintenance({monto:'500',vigente_desde:first},admin);
});
test.after(async()=>{await pool.end();});

test('H1 deuda posterior bloquea toda la activación; pago y reintento transfieren una sola vez',async()=>{
  const id=await configured();
  await contracts.configureHouse(id,body(maria,{version:1,fecha_efectiva:third}),admin);
  await billHouse(id,first);
  await sync(id,third);
  const [owner]=await query('SELECT r.id_usuario FROM CASA c JOIN RESIDENTE r ON r.id_residente=c.id_residente WHERE c.id_casa=?',[id]);
  assert.equal(Number(owner.id_usuario),juan,'La venta debe permanecer bloqueada');
  assert.deepEqual((await query('SELECT id_usuario FROM CASA_RESPONSABLE_FINANCIERO WHERE id_casa=? AND id_version_pendiente IS NULL AND vigente_desde<=? AND (vigente_hasta IS NULL OR vigente_hasta>?)',[id,third,third])).map(r=>Number(r.id_usuario)),[juan]);
  await billHouse(id,third);
  const emitted=await quotas(id);
  assert(emitted.every(q=>Number(q.id_responsable)===juan));
  const pending=(await contracts.getHouseContracts(id)).versiones[0];
  assert.equal(pending.activacion_estado,'BLOQUEADA');
  for(const q of emitted)await payObligation(juan,'residente',q.id_cuota);
  await Promise.all([sync(id,third),sync(id,third)]);
  const [current]=await query('SELECT r.id_usuario FROM CASA c JOIN RESIDENTE r ON r.id_residente=c.id_residente WHERE c.id_casa=?',[id]);
  assert.equal(Number(current.id_usuario),maria);
  assert.deepEqual((await quotas(id)).map(q=>[q.id_cuota,q.id_responsable]),emitted.map(q=>[q.id_cuota,q.id_responsable]));
  const activations=await query("SELECT id_auditoria FROM AUDITORIA WHERE entidad='CASA' AND entidad_id=? AND accion='PROPERTY_TRANSFER_ACTIVATED'",[String(id)]);
  assert.equal(activations.length,1);
  const next=contracts.__private__.nextPeriod(third);await billHouse(id,next);
  assert.equal(Number((await quotas(id)).at(-1).id_responsable),maria);
});

test('H2 traslado desde vínculo legado conserva historia y dirige visitas y solicitudes a la nueva casa',async()=>{
  const pedro=await user('inquilino','Pedro'), old=await house(), current=await house();
  await query('INSERT INTO RESIDENTE(id_usuario) VALUES(?) ON DUPLICATE KEY UPDATE id_usuario=VALUES(id_usuario)',[juan]);
  const [r]=await query('SELECT id_residente FROM RESIDENTE WHERE id_usuario=?',[juan]);
  await query('UPDATE CASA SET id_residente=? WHERE id_casa=?',[r.id_residente,old]);
  await query('INSERT INTO INQUILINO(id_usuario,autorizado) VALUES(?,1)',[pedro]);
  const [i]=await query('SELECT id_inquilino FROM INQUILINO WHERE id_usuario=?',[pedro]);
  await query('INSERT INTO INQUILINO_CASA(id_inquilino,id_casa) VALUES(?,?)',[i.id_inquilino,old]);
  const visits=require('../../src/services/visitsService');
  const historic=await visits.createVisit(pedro,'inquilino',{nombre:'Visita previa',dpi:`${Date.now()}`.slice(-12)+'1',placa:'',fecha:first,hora_inicio:'10:00',hora_fin:'10:30',tipo_visita:'VISITA'});
  await contracts.configureHouse(current,body(maria,{inquilino_privado:{id_usuario:pedro}}),admin);
  assert.deepEqual((await query('SELECT id_casa FROM INQUILINO_CASA WHERE id_inquilino=?',[i.id_inquilino])).map(x=>Number(x.id_casa)),[current]);
  const created=await visits.createVisit(pedro,'inquilino',{nombre:'Visita nueva',dpi:`${Date.now()}`.slice(-12)+'2',placa:'',fecha:first,hora_inicio:'11:00',hora_fin:'11:30',tipo_visita:'VISITA'});
  assert.equal(Number((await query('SELECT id_casa FROM ACCESO WHERE id_acceso=?',[created.id_acceso]))[0].id_casa),current);
  assert.equal(Number((await query('SELECT id_casa FROM ACCESO WHERE id_acceso=?',[historic.id_acceso]))[0].id_casa),old);
  const service=require('../../src/services/sprintStoriesService');
  const requested=await service.createTenantAuthorizationRequest(pedro,{accion:'VISITAS',motivo:'Solicitud de prueba'});
  const [request]=await query('SELECT id_casa,id_propietario_usuario FROM SOLICITUD_AUTORIZACION_DIGITAL WHERE id_solicitud=?',[requested.id_solicitud]);
  assert.equal(Number(request.id_casa),current);assert.equal(Number(request.id_propietario_usuario),maria);
});

test('H1 activación tardía conserva el mes emitido y comienza responsabilidad nueva el siguiente',async()=>{
  const id=await configured();await contracts.configureHouse(id,body(maria,{version:1,fecha_efectiva:third}),admin);
  await billHouse(id,first);await sync(id,third);
  for(const q of await quotas(id))await payObligation(juan,'residente',q.id_cuota);
  const late=third.slice(0,7)+'-15';await sync(id,late);
  const current=(await contracts.getHouseContracts(id)).versiones[0];
  assert.equal(current.activacion_estado,'ACTIVA');assert.equal(current.vigente_desde,contracts.__private__.nextPeriod(third));
  await billHouse(id,third,null,{},late);
  assert.equal(Number((await quotas(id)).at(-1).id_responsable),juan);
});

test('Idempotencia entre dos procesos independientes y un reinicio conserva un cargo',async()=>{
  const id=await configured();
  const {spawn}=require('node:child_process');
  const source=`require('./test/integration/support/isolatedMysql').configureTestEnvironment();require('./test/integration/support/suiteIsolation').assertOwnedSuiteDatabase();const db=require('./src/database/mysql');(async()=>{try{console.log(JSON.stringify(await require('./src/services/monthlyBillingService').__private__.billHouse(${id},'${first}')));}finally{await db.pool.end();}})().catch(e=>{console.error(e.code||e.name);process.exitCode=1;});`;
  const run=()=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['-e',source],{env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',failure='';
    child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>failure+=d);child.once('error',reject);
    child.once('exit',code=>{if(code!==0)reject(new Error(failure));else{try{resolve(JSON.parse(output.trim()));}catch(e){reject(e);}}});
  });
  const concurrent=await Promise.all([run(),run()]);assert.equal(concurrent.reduce((n,r)=>n+r.generadas,0),1);
  assert.equal((await run()).estado,'YA_FACTURADO');assert.equal((await quotas(id)).length,1);
});

test('Arranque real aplica 009 y 010 en esquema anterior temporal sin inventar datos',async()=>{
  const {connect}=require('./support/isolatedMysql'),{createOwnedRestoreDatabase}=require('./support/suiteIsolation');
  const parent=await connect();let schema;try{schema=await createOwnedRestoreDatabase(parent);}finally{await parent.end();}
  const {spawnSync,spawn}=require('node:child_process');
  const prepared=spawnSync(process.execPath,['scripts/prepare-property-migration-fixture.js'],{env:{...process.env,PHASE0_TEST_DATABASE:schema,DB_NAME:schema},windowsHide:true,encoding:'utf8'});
  assert.equal(prepared.status,0,prepared.stderr);
  const c=await connect(schema);let child,closed;
  try{
    const tables=['USUARIO','CASA','CUOTA','PAGO'];
    const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async t=>[t,(await c.query(`SELECT * FROM ${t} ORDER BY 1`))[0]])));
    const before=await snapshot();
    const [[backups]]=await c.execute("SELECT valor FROM CONFIGURACION WHERE clave='respaldos_activo'");assert.equal(backups.valor,'false');
    const net=require('node:net'),reservation=net.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
    const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
    let output='',errors='';
    child=spawn(process.execPath,['server.js'],{env:{...process.env,PHASE0_TEST_DATABASE:schema,DB_NAME:schema,PORT:String(port)},windowsHide:true,stdio:['ignore','pipe','pipe']});
    closed=new Promise(resolve=>child.once('close',resolve));child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>errors+=d);
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{clearInterval(poll);reject(new Error('Arranque temporal agotó espera: '+errors));},90000);
      const poll=setInterval(()=>{
        if(output.includes('Servidor corriendo')){clearTimeout(timeout);clearInterval(poll);resolve();}
        else if(child.exitCode!==null){clearTimeout(timeout);clearInterval(poll);reject(new Error(errors));}
      },100);
    });
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status,200);
    const after=await snapshot();for(const t of tables)assert.deepEqual(after[t].map((r,i)=>Object.fromEntries(Object.keys(before[t][i]).map(k=>[k,r[k]]))),before[t]);
    for(const t of ['CONTRATO_CASA','CONTRATO_CASA_VERSION','TARIFA_MANTENIMIENTO','FACTURACION_CASA_PERIODO'])assert.equal(Number((await c.query(`SELECT COUNT(*) n FROM ${t}`))[0][0].n),0);
    const [[strict]]=await c.execute("SELECT COUNT(*) n FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND CONSTRAINT_NAME='chk_contrato_plazo_obligatorio'");assert.equal(Number(strict.n),1);
  }finally{if(child&&child.exitCode===null){child.kill();await closed;}await c.end();}
});

async function sanction(id, quota) {
  return (await query("INSERT INTO SANCION(id_casa,id_cuota,motivo,codigo_regla,detalle,fecha_incumplimiento,monto,estado,creado_por) VALUES(?,?,'Auditoría','AUDIT','Prueba',?,10,'PENDIENTE',?)",[id,quota,today,admin])).insertId;
}
test('H3 sanción de Juan permanece atribuida a Juan después de vender',async()=>{
  const id=await configured();await billHouse(id,first);const [q]=await quotas(id);
  await payObligation(juan,'residente',q.id_cuota);const sid=await sanction(id,q.id_cuota);
  await contracts.configureHouse(id,body(maria,{version:1,fecha_efectiva:second}),admin);await sync(id,second);
  const history=require('../../src/services/sanctionHistoryService');
  assert.equal((await history.detail(sid)).residente,'Juan');
  assert((await history.list({search:'Juan'})).items.some(s=>s.id_sancion===sid));
  assert(!(await history.list({search:'María'})).items.some(s=>s.id_sancion===sid));
});
test('H3 renta directa y responsable legado desconocido no desaparecen del historial',async()=>{
  const pedro=await user('inquilino','Arrendatario de sanción');
  const id=await configured(pedro,{tipo:'RENTA_DIRECTA',cuota_vivienda:'100'});await billHouse(id,first);
  const sid=await sanction(id,(await quotas(id))[0].id_cuota);
  assert.equal((await require('../../src/services/sanctionHistoryService').detail(sid)).residente,'Arrendatario de sanción');
  const legacy=await house(), unknown=await sanction(legacy,null);
  assert.equal((await require('../../src/services/sanctionHistoryService').detail(unknown)).residente,'Responsable no confirmado');
});

test('H4 antiguo propietario sin vivienda puede editar perfil sin alterar relaciones',async()=>{
  const former=await user('residente','Antiguo'), id=await configured(former);
  await contracts.configureHouse(id,body(maria,{version:1,fecha_efectiva:second}),admin);await sync(id,second);
  const users=require('../../src/services/usersService'), before=await users.getUserById(former);
  assert.equal(before.id_casa,null);
  const updated=await users.updateUser(former,{...before,telefono:'55551234',password:'',id_casa:null});
  assert.equal(updated.telefono,'55551234');assert.equal(updated.id_casa,null);
  const other=await house();
  await assert.rejects(users.updateUser(former,{...updated,id_casa:other}),e=>e.status===409);
});

test('H6 omitir cambios de ocupación conserva habitante futuro; baja explícita lo cierra',async()=>{
  const pedro=await user('inquilino','Habitante futuro'), id=await configured(juan,{fecha_efectiva:first,inquilino_privado:{id_usuario:pedro}});
  await contracts.configureHouse(id,body(juan,{version:1,fecha_efectiva:second}),admin);
  let data=await contracts.getHouseContracts(id);
  assert(data.habitantes.some(h=>Number(h.id_usuario)===pedro&&(!h.vigente_hasta||h.vigente_hasta>second)));
  await contracts.configureHouse(id,body(juan,{version:2,fecha_efectiva:third,habitantes_accion:'ACTUALIZAR'}),admin);
  data=await contracts.getHouseContracts(id);
  assert(data.habitantes.every(h=>Number(h.id_usuario)!==pedro||h.vigente_hasta===third));
});

test('H7 llegada notifica a quien autorizó: propietario, inquilino y arrendatario directo; nunca a tercero',async()=>{
  const fs=require('node:fs'), Module=require('node:module'), path=require('node:path');
  const source=path.resolve('src/services/visitsService.js'), instrumented=new Module(source,module);
  instrumented.filename=source;instrumented.paths=Module._nodeModulePaths(path.dirname(source));
  instrumented._compile(fs.readFileSync(source,'utf8')+'\nmodule.exports.auditArrival=createArrivalNotification;',source);
  for(const kind of ['owner','privateTenant','direct','invalid']){
    const occupant=await user(kind==='owner'?'residente':'inquilino',`Visitante ${kind}`);
    const id=kind==='direct'?await configured(occupant,{tipo:'RENTA_DIRECTA',cuota_vivienda:'100',responsable_habita:true}):await configured(kind==='owner'?occupant:juan,{inquilino_privado:kind==='privateTenant'?{id_usuario:occupant}:null});
    const visitor=(await query('INSERT INTO VISITANTE(nombre,dpi) VALUES(?,?)',[`Visita ${kind}`,`V${randomUUID().slice(0,10)}`])).insertId;
    const access=(await query("INSERT INTO ACCESO(id_visitante,id_casa,id_usuario_autoriza,fecha,hora_inicio,hora_fin,tipo_visita,estado_acceso) VALUES(?,?,?,?,'10:00','11:00','VISITA','AUTORIZADA')",[visitor,id,occupant,today])).insertId;
    const c=await pool.getConnection();try{await instrumented.exports.auditArrival(c,access);}finally{c.release();}
    const notices=await query("SELECT id_usuario FROM NOTIFICACION WHERE id_acceso=? AND tipo='LLEGADA_VISITA'",[access]);
    assert.deepEqual(notices.map(n=>Number(n.id_usuario)),kind==='invalid'?[]:[occupant],kind);
  }
});

test('H8 DB rechaza compra financiada con plazo NULL',async()=>{
  const id=await house();
  await assert.rejects(query('INSERT INTO CONTRATO_CASA(id_casa,tipo,fecha_inicio,primer_periodo,meses_financiamiento,creado_por) VALUES(?,?,?,?,NULL,?)',[id,'COMPRA_FINANCIADA',today,first,admin]),e=>e.code==='ER_CHECK_CONSTRAINT_VIOLATED');
});

test('H8 DB conserva rango financiado y NULL solamente en modalidades sin plazo',async()=>{
  const id=await house();
  for(const [type,term,valid] of [['COMPRA_FINANCIADA',1,true],['COMPRA_FINANCIADA',1200,true],['COMPRA_FINANCIADA',0,false],['COMPRA_FINANCIADA',1201,false],['RENTA_DIRECTA',null,true],['PROPIEDAD_PRIVADA',null,true],['RENTA_DIRECTA',1,false]]){
    const insert=()=>query('INSERT INTO CONTRATO_CASA(id_casa,tipo,fecha_inicio,primer_periodo,meses_financiamiento,creado_por) VALUES(?,?,?,?,?,?)',[id,type,today,first,term,admin]);
    if(valid)await insert();else await assert.rejects(insert(),e=>e.code==='ER_CHECK_CONSTRAINT_VIOLATED');
  }
});

test('H6 editar solamente renta conserva al habitante futuro y cambia el monto mensual',async()=>{
  const pedro=await user('inquilino','Renta futura'),id=await configured(pedro,{tipo:'RENTA_DIRECTA',cuota_vivienda:'100',fecha_efectiva:first,responsable_habita:true});
  await contracts.configureHouse(id,body(pedro,{tipo:'RENTA_DIRECTA',cuota_vivienda:'200',version:1,fecha_efectiva:second}),admin);
  const inhabitants=(await contracts.getHouseContracts(id)).habitantes;
  assert(inhabitants.some(h=>Number(h.id_usuario)===pedro&&h.vigente_desde===first&&h.vigente_hasta===null));
  await billHouse(id,first);await billHouse(id,second);
  assert.deepEqual((await quotas(id)).filter(q=>q.concepto==='ALQUILER_RESIDENCIAL').map(q=>Number(q.monto)),[100,200]);
});

for(const transferDay of [third,today])test(`H1/H8 actualización desde 009 protege venta ${transferDay}, conserva IDs y es repetible`,async()=>{
  const cutoff=contracts.__private__.effectivePeriod(transferDay);
  const priorDate=new Date(cutoff+'T00:00:00Z');priorDate.setUTCMonth(priorDate.getUTCMonth()-1);
  const prior=priorDate.toISOString().slice(0,10);
  const {connect}=require('./support/isolatedMysql'),{createOwnedRestoreDatabase}=require('./support/suiteIsolation');
  const parent=await connect();let schema;try{schema=await createOwnedRestoreDatabase(parent);}finally{await parent.end();}
  const {spawnSync}=require('node:child_process');
  const prepared=spawnSync(process.execPath,['scripts/prepare-property-migration-fixture.js'],{env:{...process.env,PHASE0_TEST_DATABASE:schema,DB_NAME:schema},windowsHide:true,encoding:'utf8'});
  assert.equal(prepared.status,0,prepared.stderr);
  const c=await connect(schema);
  try{
    const migration=require('../../src/database/propertyContractMigration');
    for(const statement of require('../../src/database/recurrenteMigration').migrationStatements(migration.PROPERTY_CONTRACT_MIGRATION_PATH))await c.query(statement);
    const [[role]]=await c.execute("SELECT id_tipo_usuario FROM TIPO_USUARIO WHERE nombre='residente'");
    const insertUser=async name=>(await c.execute('INSERT INTO USUARIO(nombre,dpi,correo,password,activo,id_tipo_usuario) VALUES(?,?,?,?,1,?)',[name,randomUUID().slice(0,12),`${randomUUID()}@migration.test`,'test-only',role.id_tipo_usuario]))[0].insertId;
    const oldOwner=await insertUser('Juan legado'),newOwner=await insertUser('María legada');
    const [[actor]]=await c.execute("SELECT u.id_usuario FROM USUARIO u JOIN TIPO_USUARIO t ON t.id_tipo_usuario=u.id_tipo_usuario WHERE t.nombre='admin' LIMIT 1");
    const actorId=actor.id_usuario;
    const [resident]=await c.execute('INSERT INTO RESIDENTE(id_usuario) VALUES(?)',[oldOwner]);
    const [createdHouse]=await c.execute('INSERT INTO CASA(numero,id_residente,activo,version_contractual,relaciones_confirmadas_en) VALUES(?,?,1,2,UTC_TIMESTAMP())',['LEGACY',resident.insertId]);
    const id=createdHouse.insertId;
    const addVersion=async(owner,start,end)=>{
      const [contract]=await c.execute("INSERT INTO CONTRATO_CASA(id_casa,tipo,fecha_inicio,primer_periodo,creado_por) VALUES(?,'PROPIEDAD_PRIVADA',?,?,?)",[id,start,start,actorId]);
      const [responsible]=await c.execute("INSERT INTO CASA_RESPONSABLE_FINANCIERO(id_casa,id_usuario,calidad,vigente_desde,vigente_hasta,creado_por) VALUES(?,?,'PROPIETARIO',?,?,?)",[id,owner,start,end,actorId]);
      const [version]=await c.execute('INSERT INTO CONTRATO_CASA_VERSION(id_contrato,id_casa,id_responsabilidad,vigente_desde,vigente_hasta,creado_por) VALUES(?,?,?,?,?,?)',[contract.insertId,id,responsible.insertId,start,end,actorId]);
      return version.insertId;
    };
    const oldVersion=await addVersion(oldOwner,prior,cutoff),newVersion=await addVersion(newOwner,cutoff,null);
    const [oldTitle]=await c.execute('INSERT INTO CASA_TITULARIDAD(id_casa,id_usuario,titular_empresa,vigente_desde,vigente_hasta,creado_por) VALUES(?,?,0,?,?,?)',[id,oldOwner,prior,transferDay,actorId]);
    const [newTitle]=await c.execute('INSERT INTO CASA_TITULARIDAD(id_casa,id_usuario,titular_empresa,vigente_desde,creado_por) VALUES(?,?,0,?,?)',[id,newOwner,transferDay,actorId]);
    await c.execute("INSERT INTO CASA_HABITANTE(id_casa,id_usuario,calidad,vigente_desde,vigente_hasta,creado_por) VALUES(?,?,'PROPIETARIO',?,?,?)",[id,oldOwner,prior,transferDay,actorId]);
    await c.execute("INSERT INTO CASA_HABITANTE(id_casa,id_usuario,calidad,vigente_desde,creado_por) VALUES(?,?,'PROPIETARIO',?,?)",[id,newOwner,transferDay,actorId]);
    const [debt]=await c.execute('INSERT INTO CUOTA(id_servicio,id_casa,monto,fecha_limite,id_responsable) VALUES(1,?,500,?,?)',[id,prior,oldOwner]);
    await migration.applyPropertyContractMigration(c);await migration.applyPropertyContractMigration(c);
    const [[pending]]=await c.execute('SELECT activacion_estado FROM CONTRATO_CASA_VERSION WHERE id_version=?',[newVersion]);assert.equal(pending.activacion_estado,'PENDIENTE');
    const [[previous]]=await c.execute('SELECT vigente_hasta FROM CONTRATO_CASA_VERSION WHERE id_version=?',[oldVersion]);assert.equal(previous.vigente_hasta,null);
    const activate=async()=>{await c.beginTransaction();try{await syncHouseRelations(c,id,transferDay);await c.commit();}catch(e){await c.rollback();throw e;}};
    await activate();
    assert.equal(Number((await c.execute('SELECT id_residente FROM CASA WHERE id_casa=?',[id]))[0][0].id_residente),resident.insertId);
    await c.execute('INSERT INTO PAGO(id_cuota,monto_pagado,fecha_pago,id_actor) VALUES(?,500,?,?)',[debt.insertId,transferDay,oldOwner]);
    await activate();await migration.applyPropertyContractMigration(c);
    assert.equal((await c.execute('SELECT activacion_estado FROM CONTRATO_CASA_VERSION WHERE id_version=?',[newVersion]))[0][0].activacion_estado,'ACTIVA');
    const [titles]=await c.execute('SELECT id_titularidad FROM CASA_TITULARIDAD WHERE id_casa=? ORDER BY id_titularidad',[id]);
    assert.deepEqual(titles.map(t=>Number(t.id_titularidad)),[oldTitle.insertId,newTitle.insertId]);
    const [activeHabitants]=await c.execute('SELECT id_usuario FROM CASA_HABITANTE WHERE id_casa=? AND id_version_pendiente IS NULL AND vigente_desde<=? AND (vigente_hasta IS NULL OR vigente_hasta>?)',[id,transferDay,transferDay]);
    assert.deepEqual(activeHabitants.map(h=>Number(h.id_usuario)),[newOwner]);
    assert.equal(Number((await c.execute('SELECT id_responsable FROM CUOTA WHERE id_cuota=?',[debt.insertId]))[0][0].id_responsable),oldOwner);
    await assert.rejects(c.execute("INSERT INTO CONTRATO_CASA(id_casa,tipo,fecha_inicio,primer_periodo,meses_financiamiento,creado_por) VALUES(?,'COMPRA_FINANCIADA',?,?,NULL,?)",[id,today,first,actorId]),e=>e.code==='ER_CHECK_CONSTRAINT_VIOLATED');
  }finally{await c.end();}
});

test('Lote mensual aísla fallo por vivienda y reintenta sin duplicar las casas correctas',async()=>{
  const ids=[];for(let n=0;n<3;n++)ids.push(await configured());
  const trigger=`audit_fault_${randomUUID().replaceAll('-','')}`;
  await pool.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON CUOTA FOR EACH ROW BEGIN IF NEW.id_casa=${ids[1]} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fallo aislado'; END IF; END`);
  const generate=require('../../src/services/monthlyBillingService').generateMonthlyBilling;
  try{
    const result=await generate({periodo:first,now:new Date(first+'T06:00:00Z')});
    assert.equal(result.fallidas,1);assert.equal(result.resultados.find(r=>r.id_casa===ids[1]).estado,'ERROR');
    assert.deepEqual(await Promise.all(ids.map(async id=>(await quotas(id)).length)),[1,0,1]);
  }finally{await pool.query(`DROP TRIGGER ${trigger}`);}
  const retry=await generate({periodo:first,now:new Date(first+'T06:00:00Z')});
  assert.equal(retry.fallidas,0);assert.deepEqual(await Promise.all(ids.map(async id=>(await quotas(id)).length)),[1,1,1]);
});
