const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { configureTestEnvironment, connect } = require('./support/isolatedMysql');
const { assertOwnedSuiteDatabase, createOwnedRestoreDatabase } = require('./support/suiteIsolation');
configureTestEnvironment();
assertOwnedSuiteDatabase();
const { pool, query } = require('../../src/database/mysql');
const contracts = require('../../src/services/propertyContractsService');
const migration = require('../../src/database/propertyContractMigration');
const { migrationStatements } = require('../../src/database/recurrenteMigration');
const { syncHouseRelations } = require('../../src/services/contractHouseRelations');
const visits = require('../../src/services/visitsService');
const accesses = require('../../src/services/adminAccessesService');
const reports = require('../../src/services/reportExportService');
const today = require('../../src/utils/guatemalaTime').guatemalaToday();
const first = contracts.__private__.nextPeriod(today), second = contracts.__private__.nextPeriod(first);
const yesterday = new Date(new Date(today+'T12:00:00Z').getTime()-86400000).toISOString().slice(0,10);
let admin;
async function user(role, name) {
  const [type] = await query('SELECT id_tipo_usuario FROM TIPO_USUARIO WHERE nombre=?',[role]);
  return (await query('INSERT INTO USUARIO(nombre,dpi,correo,password,activo,id_tipo_usuario) VALUES(?,?,?,?,1,?)',
    [name,randomUUID().slice(0,12),randomUUID()+'@final-audit.test','test-only',type.id_tipo_usuario])).insertId;
}
function body(person, extra={}) {
  return {id_operacion:randomUUID(),version:0,tipo:'PROPIEDAD_PRIVADA',fecha_efectiva:today,cuota_vivienda:'0',
    meses_financiamiento:null,responsable:{id_usuario:person},responsable_habita:false,inquilino_privado:null,confirmado:true,...extra};
}
async function configured(person, extra={}) {
  const h=(await query('INSERT INTO CASA(numero,activo) VALUES(?,1)',[randomUUID().slice(0,8)])).insertId;
  await contracts.configureHouse(h,body(person,extra),admin); return h;
}
async function sync(c, house, day=today) {
  await c.beginTransaction();
  try {const result=await syncHouseRelations(c,house,day);await c.commit();return result;}
  catch(error){await c.rollback();throw error;}
}
async function owner(c, house) {
  return (await c.execute('SELECT r.id_usuario FROM CASA c LEFT JOIN RESIDENTE r ON r.id_residente=c.id_residente WHERE c.id_casa=?',[house]))[0][0].id_usuario;
}
const savedTables=['USUARIO','RESIDENTE','INQUILINO','INQUILINO_CASA','CASA','CUOTA','PAGO','VISITANTE','ACCESO','REGISTRO_ACCESO'];
async function snapshot(c, tables=savedTables) {
  return Object.fromEntries(await Promise.all(tables.map(async t=>[t,(await c.query(`SELECT * FROM ${t} ORDER BY 1`))[0]])));
}
function preserved(before, after) {
  for(const [table, rows]of Object.entries(before))assert.deepEqual(after[table].map((row,i)=>Object.fromEntries(Object.keys(rows[i]||{}).map(k=>[k,row[k]]))),rows,table);
}

// The fixture models the rows written by 009, before activation state existed.
async function legacy({transfer=yesterday, completed=false, debt=500}={}) {
  const parent=await connect();let schema;
  try{schema=await createOwnedRestoreDatabase(parent);}finally{await parent.end();}
  const prepared=spawnSync(process.execPath,['scripts/prepare-property-migration-fixture.js'],{
    env:{...process.env,PHASE0_TEST_DATABASE:schema,DB_NAME:schema},windowsHide:true,encoding:'utf8'});
  assert.equal(prepared.status,0,prepared.stderr);
  const c=await connect(schema);
  try{
    for(const statement of migrationStatements(migration.PROPERTY_CONTRACT_MIGRATION_PATH))await c.query(statement);
    const [[role]]=await c.execute("SELECT id_tipo_usuario FROM TIPO_USUARIO WHERE nombre='residente'");
    const addUser=async name=>(await c.execute('INSERT INTO USUARIO(nombre,dpi,correo,password,activo,id_tipo_usuario) VALUES(?,?,?,?,1,?)',
      [name,randomUUID().slice(0,12),randomUUID()+'@legacy.test','test-only',role.id_tipo_usuario]))[0].insertId;
    const outgoing=await addUser('Juan legado final'),incoming=await addUser('María legada final');
    const [[actor]]=await c.execute("SELECT u.id_usuario FROM USUARIO u JOIN TIPO_USUARIO t ON t.id_tipo_usuario=u.id_tipo_usuario WHERE t.nombre='admin' LIMIT 1");
    const cutoff=contracts.__private__.effectivePeriod(transfer),d=new Date(cutoff+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()-1);const prior=d.toISOString().slice(0,10);
    const [resident]=await c.execute('INSERT INTO RESIDENTE(id_usuario) VALUES(?)',[outgoing]);
    const [buyerResident]=await c.execute('INSERT INTO RESIDENTE(id_usuario) VALUES(?)',[incoming]);
    const [house]=await c.execute('INSERT INTO CASA(numero,id_residente,activo,version_contractual,relaciones_confirmadas_en) VALUES(?,?,1,2,UTC_TIMESTAMP())',
      ['LEG-'+randomUUID().slice(0,6),completed?buyerResident.insertId:resident.insertId]);
    const addVersion=async(u,start,end)=>{
      const [ct]=await c.execute("INSERT INTO CONTRATO_CASA(id_casa,tipo,fecha_inicio,primer_periodo,estado,creado_por) VALUES(?,'PROPIEDAD_PRIVADA',?,?,?,?)",[house.insertId,start,start,end?'CERRADO':'VIGENTE',actor.id_usuario]);
      const [rf]=await c.execute("INSERT INTO CASA_RESPONSABLE_FINANCIERO(id_casa,id_usuario,calidad,vigente_desde,vigente_hasta,creado_por) VALUES(?,?,'PROPIETARIO',?,?,?)",[house.insertId,u,start,end,actor.id_usuario]);
      const [v]=await c.execute('INSERT INTO CONTRATO_CASA_VERSION(id_contrato,id_casa,id_responsabilidad,vigente_desde,vigente_hasta,creado_por) VALUES(?,?,?,?,?,?)',[ct.insertId,house.insertId,rf.insertId,start,end,actor.id_usuario]);
      return {version:v.insertId,contract:ct.insertId,responsibility:rf.insertId};
    };
    const old=await addVersion(outgoing,prior,cutoff),next=await addVersion(incoming,cutoff,null);
    const [oldTitle]=await c.execute('INSERT INTO CASA_TITULARIDAD(id_casa,id_usuario,titular_empresa,vigente_desde,vigente_hasta,creado_por) VALUES(?,?,0,?,?,?)',[house.insertId,outgoing,prior,transfer,actor.id_usuario]);
    const [newTitle]=await c.execute('INSERT INTO CASA_TITULARIDAD(id_casa,id_usuario,titular_empresa,vigente_desde,creado_por) VALUES(?,?,0,?,?)',[house.insertId,incoming,transfer,actor.id_usuario]);
    await c.execute("INSERT INTO CASA_HABITANTE(id_casa,id_usuario,calidad,vigente_desde,vigente_hasta,creado_por) VALUES(?,?,'PROPIETARIO',?,?,?)",[house.insertId,outgoing,prior,transfer,actor.id_usuario]);
    await c.execute("INSERT INTO CASA_HABITANTE(id_casa,id_usuario,calidad,vigente_desde,creado_por) VALUES(?,?,'PROPIETARIO',?,?)",[house.insertId,incoming,transfer,actor.id_usuario]);
    const [quota]=await c.execute('INSERT INTO CUOTA(id_servicio,id_casa,monto,fecha_limite,id_responsable) VALUES(1,?,500,?,?)',[house.insertId,prior,outgoing]);
    if(!debt)await c.execute('INSERT INTO PAGO(id_cuota,monto_pagado,fecha_pago,id_actor) VALUES(?,500,?,?)',[quota.insertId,today,outgoing]);
    const [visitor]=await c.execute('INSERT INTO VISITANTE(nombre) VALUES(?)',['Visita legada conservada']);
    const [access]=await c.execute("INSERT INTO ACCESO(id_visitante,id_casa,id_usuario_autoriza,fecha,tipo_visita,estado_acceso,token_qr) VALUES(?,?,?,?,'VISITA','INGRESO_REGISTRADO',?)",[visitor.insertId,house.insertId,outgoing,prior,randomUUID()]);
    await c.execute("INSERT INTO REGISTRO_ACCESO(id_acceso,hora_ingreso) VALUES(?,'15:00')",[access.insertId]);
    return {c,schema,house:house.insertId,outgoing,incoming,old,next,quota:quota.insertId,transfer,cutoff,oldTitle:oldTitle.insertId,newTitle:newTitle.insertId};
  }catch(error){await c.end();throw error;}
}
async function payLegacy(f){await f.c.execute('INSERT INTO PAGO(id_cuota,monto_pagado,fecha_pago,id_actor) VALUES(?,500,?,?)',[f.quota,today,f.outgoing]);}
async function state(f){return(await f.c.execute('SELECT * FROM CONTRATO_CASA_VERSION WHERE id_version=?',[f.next.version]))[0][0];}
async function blocked(f,day=today){
  await migration.applyPropertyContractMigration(f.c);await sync(f.c,f.house,day);
  assert.equal(await owner(f.c,f.house),f.outgoing,'La venta no puede activarse con deuda');
  assert.equal((await state(f)).activacion_estado,'BLOQUEADA');
}
test.before(async()=>{
  admin=await user('admin','Admin final');await contracts.saveMaintenance({monto:'500',vigente_desde:first},admin);
  for(const [key,value]of Object.entries({visitas_hora_apertura:'00:00',visitas_hora_cierre:'23:59',visitas_duracion_maxima_horas:'12',visitas_activo:'true',visitas_dias_habilitados:'[0,1,2,3,4,5,6]'}))
    await query('INSERT INTO CONFIGURACION(clave,valor) VALUES(?,?) ON DUPLICATE KEY UPDATE valor=VALUES(valor)',[key,value]);
});
test.after(async()=>{await pool.end();});

test('R1-A venta 009 vencida con deuda conserva propietario, responsabilidad, habitantes e historia',async()=>{
  const f=await legacy();try{
    const before=await snapshot(f.c);await blocked(f);preserved(before,await snapshot(f.c));
    assert.equal((await state(f)).activacion_error,'VENTA_CON_DEUDA');
    assert.deepEqual((await f.c.execute('SELECT id_usuario FROM CASA_RESPONSABLE_FINANCIERO WHERE id_casa=? AND id_version_pendiente IS NULL AND vigente_hasta IS NULL',[f.house]))[0].map(r=>r.id_usuario),[f.outgoing]);
    assert.equal((await f.c.execute('SELECT vigente_hasta FROM CONTRATO_CASA_VERSION WHERE id_version=?',[f.old.version]))[0][0].vigente_hasta,null);
    assert.equal((await f.c.execute('SELECT estado FROM CONTRATO_CASA WHERE id_contrato=?',[f.old.contract]))[0][0].estado,'VIGENTE');
    assert.deepEqual((await f.c.execute('SELECT id_usuario FROM CASA_HABITANTE WHERE id_casa=? AND id_version_pendiente IS NULL AND vigente_hasta IS NULL',[f.house]))[0].map(r=>r.id_usuario),[f.outgoing]);
    await migration.applyPropertyContractMigration(f.c);assert.equal((await state(f)).activacion_estado,'BLOQUEADA');
  }finally{await f.c.end();}
});
test('R1-B pagar y reintentar activa una vez y conserva IDs, cuota y actor histórico',async()=>{
  const f=await legacy();try{
    await blocked(f);await payLegacy(f);await sync(f.c,f.house);await sync(f.c,f.house);await migration.applyPropertyContractMigration(f.c);
    assert.equal(await owner(f.c,f.house),f.incoming);assert.equal((await state(f)).activacion_estado,'ACTIVA');assert((await state(f)).activado_en);
    assert.equal((await f.c.execute('SELECT id_responsable FROM CUOTA WHERE id_cuota=?',[f.quota]))[0][0].id_responsable,f.outgoing);
    assert.equal((await f.c.execute('SELECT id_actor FROM PAGO WHERE id_cuota=?',[f.quota]))[0][0].id_actor,f.outgoing);
    assert.deepEqual((await f.c.execute('SELECT id_titularidad FROM CASA_TITULARIDAD WHERE id_casa=? ORDER BY 1',[f.house]))[0].map(t=>t.id_titularidad),[f.oldTitle,f.newTitle]);
    assert.equal((await f.c.execute("SELECT COUNT(*) n FROM AUDITORIA WHERE accion='PROPERTY_TRANSFER_ACTIVATED' AND entidad_id=?",[String(f.house)]))[0][0].n,1);
    assert.equal((await f.c.execute('SELECT vigente_hasta FROM CASA_RESPONSABLE_FINANCIERO WHERE id_responsabilidad=?',[f.old.responsibility]))[0][0].vigente_hasta,(await state(f)).vigente_desde);
  }finally{await f.c.end();}
});
test('R1-C tres conexiones activan una sola vez después de Q0',async()=>{
  const f=await legacy();try{
    await blocked(f);await payLegacy(f);
    await Promise.all([1,2,3].map(async()=>{const c=await connect(f.schema);try{await sync(c,f.house);}finally{await c.end();}}));
    assert.equal(await owner(f.c,f.house),f.incoming);
    assert.equal((await f.c.execute("SELECT COUNT(*) n FROM AUDITORIA WHERE accion='PROPERTY_TRANSFER_ACTIVATED' AND entidad_id=?",[String(f.house)]))[0][0].n,1);
  }finally{await f.c.end();}
});
test('R1-D venta histórica 009 completada se conserva sin reversión ni inventar activación',async()=>{
  const f=await legacy({completed:true,debt:0});try{
    const before=await snapshot(f.c,[...savedTables,'CONTRATO_CASA','CONTRATO_CASA_VERSION','CASA_TITULARIDAD','CASA_HABITANTE','CASA_RESPONSABLE_FINANCIERO']);
    await migration.applyPropertyContractMigration(f.c);await migration.applyPropertyContractMigration(f.c);preserved(before,await snapshot(f.c,Object.keys(before)));
    await sync(f.c,f.house);assert.equal(await owner(f.c,f.house),f.incoming);assert.equal((await state(f)).activacion_estado,'ACTIVA');
  }finally{await f.c.end();}
});
test('R1-E futura Q0 conserva Juan antes de fecha y activa María al llegar',async()=>{
  const f=await legacy({transfer:second,debt:0});try{
    await migration.applyPropertyContractMigration(f.c);await sync(f.c,f.house);assert.equal(await owner(f.c,f.house),f.outgoing);assert.equal((await state(f)).activacion_estado,'PENDIENTE');
    await sync(f.c,f.house,second);assert.equal(await owner(f.c,f.house),f.incoming);
  }finally{await f.c.end();}
});
test('R1-F futura Q0 que acumula deuda posterior conserva la protección H1',async()=>{
  const f=await legacy({transfer:second,debt:0});try{
    await migration.applyPropertyContractMigration(f.c);
    await f.c.execute('INSERT INTO CUOTA(id_servicio,id_casa,monto,fecha_limite,id_responsable) VALUES(1,?,500,?,?)',[f.house,first,f.outgoing]);
    await sync(f.c,f.house,second);assert.equal(await owner(f.c,f.house),f.outgoing);assert.equal((await state(f)).activacion_estado,'BLOQUEADA');
  }finally{await f.c.end();}
});
for(const mismatch of ['sin propietario','tercero'])test(`R1 ambigüedad ${mismatch} detiene migración sin cambios de datos`,async()=>{
  const f=await legacy();try{
    const [[thirdResident]]=await f.c.execute('SELECT id_residente FROM RESIDENTE WHERE id_usuario NOT IN (?,?) LIMIT 1',[f.outgoing,f.incoming]);
    await f.c.execute('UPDATE CASA SET id_residente=? WHERE id_casa=?',[mismatch==='tercero'?thirdResident.id_residente:null,f.house]);
    const before=await snapshot(f.c,[...savedTables,'CONTRATO_CASA','CASA_TITULARIDAD','CASA_HABITANTE','CASA_RESPONSABLE_FINANCIERO']);
    await assert.rejects(migration.applyPropertyContractMigration(f.c),e=>e.code==='LEGACY_TRANSFERS_REVIEW_REQUIRED');
    preserved(before,await snapshot(f.c,Object.keys(before)));
  }finally{await f.c.end();}
});
test('R1 titularidad sin versión conciliable detiene el arranque',async()=>{
  const f=await legacy();try{
    await f.c.execute('DELETE FROM CONTRATO_CASA_VERSION WHERE id_version=?',[f.next.version]);
    await assert.rejects(migration.applyPropertyContractMigration(f.c),e=>e.code==='LEGACY_TRANSFERS_REVIEW_REQUIRED');assert.equal(await owner(f.c,f.house),f.outgoing);
  }finally{await f.c.end();}
});
test('R1 responsabilidad contradictoria detiene la migración conservadora',async()=>{
  const f=await legacy();try{
    await f.c.execute('UPDATE CASA_RESPONSABLE_FINANCIERO SET id_usuario=? WHERE id_responsabilidad=?',[f.outgoing,f.next.responsibility]);
    await assert.rejects(migration.applyPropertyContractMigration(f.c),e=>e.code==='LEGACY_TRANSFERS_REVIEW_REQUIRED');assert.equal(await owner(f.c,f.house),f.outgoing);
  }finally{await f.c.end();}
});
test('R1 activación explícita ya completada no vuelve a clasificarse por un puntero antiguo',async()=>{
  const f=await legacy();try{
    for(const statement of migrationStatements(migration.PROPERTY_AUDIT_FIXES_MIGRATION_PATH))await f.c.query(statement);
    await f.c.execute('UPDATE CONTRATO_CASA_VERSION SET activado_en=UTC_TIMESTAMP() WHERE id_version=?',[f.next.version]);
    const before=await snapshot(f.c,['CONTRATO_CASA_VERSION','CASA_TITULARIDAD','CASA_RESPONSABLE_FINANCIERO']);
    await migration.applyPropertyContractMigration(f.c);assert.deepEqual(await snapshot(f.c,Object.keys(before)),before);
  }finally{await f.c.end();}
});
test('R1 arranque real rechaza titularidad ambigua antes de publicar la aplicación',async()=>{
  const f=await legacy();try{
    await f.c.execute('UPDATE CASA SET id_residente=NULL WHERE id_casa=?',[f.house]);const before=await snapshot(f.c);
    const server=spawnSync(process.execPath,['server.js'],{env:{...process.env,PHASE0_TEST_DATABASE:f.schema,DB_NAME:f.schema},windowsHide:true,encoding:'utf8',timeout:30000});
    assert.equal(server.status,1,server.stderr);assert.match(server.stderr,/LEGACY_TRANSFERS_REVIEW_REQUIRED/);assert.doesNotMatch(server.stdout,/Servidor corriendo/);
    preserved(before,await snapshot(f.c));
  }finally{await f.c.end();}
});

// Vigente ahora: HU-C06.6 rechaza inicios pasados y HU-C03.1 exige el DPI del visitante.
function visitWindow(){const now=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Guatemala',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());return [now,'23:59'];}
let visitDpiSeq=0;
async function visit(u,role,name,extra={}){
  const [start,end]=visitWindow();const dpi=`${Date.now()}`.slice(-9)+String(++visitDpiSeq).padStart(4,'0');
  return visits.createVisit(u,role,{nombre:name,dpi,fecha:today,hora_inicio:start,hora_fin:end,tipo_visita:'VISITA',...extra});
}
const range={desde:today,hasta:today};
async function listedAndExported(access){
  const [listed,exported]=await Promise.all([accesses.listAdminAccesses({},range),reports.rows('accesos',range)]);
  const a=listed.find(a=>a.id_acceso===access),b=exported.find(a=>a.id_acceso===access);
  assert(a,'El acceso debe aparecer en el listado');assert(b,'El acceso debe aparecer en exportación');assert.deepEqual(a,b);return a;
}
test('R3-A renta directa sin residente aparece con su actor en listado, export y XLSX',async()=>{
  const pedro=await user('inquilino','Pedro acceso final'),h=await configured(pedro,{tipo:'RENTA_DIRECTA',cuota_vivienda:'100',responsable_habita:true});
  assert.equal((await query('SELECT id_residente FROM CASA WHERE id_casa=?',[h]))[0].id_residente,null);
  const v=await visit(pedro,'inquilino','Renta directa final');await visits.registerQrEntry(v.token_qr);
  const row=await listedAndExported(v.id_acceso);assert.equal(row.autorizado_por,'Pedro acceso final');
  const workbook=new (require('exceljs').Workbook)();await workbook.xlsx.load(await reports.excel('accesos',[row],'Admin',range));
  assert(workbook.worksheets[0].getSheetValues().flat().includes('Autorizado por'));assert(workbook.worksheets[0].getSheetValues().flat().includes('Pedro acceso final'));
});
test('R3-B autor histórico sigue vendedor después del ingreso y de la venta',async()=>{
  const juan=await user('residente','Juan acceso final'),maria=await user('residente','María acceso final'),h=await configured(juan);
  const v=await visit(juan,'residente','Histórico final');await visits.registerQrEntry(v.token_qr);
  await contracts.configureHouse(h,body(maria,{version:1,fecha_efectiva:second}),admin);
  const c=await pool.getConnection();try{await sync(c,h,second);assert.equal(await owner(c,h),maria);}finally{c.release();}
  assert.equal((await listedAndExported(v.id_acceso)).autorizado_por,'Juan acceso final');
});
test('R3-C legado sin actor permanece y no hereda propietario actual',async()=>{
  const u=await user('residente','No debe atribuirse'),h=await configured(u),v=await visit(u,'residente','Sin actor final');
  await query('UPDATE ACCESO SET id_usuario_autoriza=NULL WHERE id_acceso=?',[v.id_acceso]);
  const row=await listedAndExported(v.id_acceso);assert.equal(row.autorizado_por,'Sin registro');assert.equal(row.casa_unidad,(await query('SELECT numero FROM CASA WHERE id_casa=?',[h]))[0].numero);
});
test('R3-D propiedad privada normal conserva creación, QR y salida',async()=>{
  const u=await user('residente','Privada normal final');await configured(u);const v=await visit(u,'residente','Privada final');
  await visits.registerQrEntry(v.token_qr);await visits.registerQrExit(v.token_qr);
  const row=await listedAndExported(v.id_acceso);assert.equal(row.autorizado_por,'Privada normal final');assert(row.hora_salida);
});
test('R3-E inquilino privado autorizado figura como actor real',async()=>{
  const u=await user('residente','Propietario no autor'),p=await user('inquilino','Inquilino autor final');await configured(u,{inquilino_privado:{id_usuario:p}});
  const v=await visit(p,'inquilino','Inquilino final');await visits.registerQrEntry(v.token_qr);assert.equal((await listedAndExported(v.id_acceso)).autorizado_por,'Inquilino autor final');
});
test('R3-F filtros equivalentes y exportación no duplican accesos',async()=>{
  const u=await user('residente','Filtros final'),h=await configured(u),tag=randomUUID().slice(0,8);
  const one=await visit(u,'residente',tag+' Uno',{placa:'FINAL123'}),two=await visit(u,'residente',tag+' Dos',{placa:'FINAL123',hora_fin:'23:58',confirmar_actualizacion:true});// HU-C03.3/C03.8: misma placa con confirmacion explicita y otra ventanaawait visits.registerQrEntry(one.token_qr);
  await query("UPDATE ACCESO SET estado_acceso='CANCELADA' WHERE id_acceso=?",[two.id_acceso]);
  const filters={...range,search:tag,house:(await query('SELECT numero FROM CASA WHERE id_casa=?',[h]))[0].numero,plate:'FINAL123',type:'VISITANTE'};
  const rows=await accesses.listAdminAccesses(filters,range);assert.deepEqual(rows,await reports.rows('accesos',filters));assert.deepEqual(new Set(rows.map(r=>r.id_acceso)),new Set([one.id_acceso,two.id_acceso]));assert.equal(rows.length,2);
  const approved=await accesses.listAdminAccesses({...filters,status:'APROBADO'},range);assert.equal(approved.length,1);assert.equal(approved[0].id_acceso,one.id_acceso);
});

test('Regresión financiera HTTP: siete roles, IDs manipulados, historial, recibo y checkout ajenos',async()=>{
  const ex=await user('residente','Ex HTTP final'),current=await user('residente','Nuevo HTTP final'),tenant=await user('inquilino','Privado HTTP final'),direct=await user('inquilino','Directo HTTP final'),other=await user('residente','Otra HTTP final'),guard=await user('guardia','Guardia HTTP final');
  const h=await configured(ex,{inquilino_privado:{id_usuario:tenant}}),currentMonth=today.slice(0,7)+'-01';
  await query('INSERT INTO TARIFA_MANTENIMIENTO(monto,vigente_desde,creado_por) VALUES(500,?,?)',[currentMonth,admin]);
  // Prepare an existing contract from the previous period, allowing a real sale today.
  await query('UPDATE CONTRATO_CASA_VERSION SET vigente_desde=? WHERE id_casa=?',[currentMonth,h]);await query('UPDATE CASA_RESPONSABLE_FINANCIERO SET vigente_desde=? WHERE id_casa=?',[currentMonth,h]);await query('UPDATE CONTRATO_CASA SET primer_periodo=? WHERE id_casa=?',[currentMonth,h]);
  const priorDay=new Date(new Date(today+'T12:00:00Z').getTime()-86400000).toISOString().slice(0,10);
  await query('UPDATE CASA_TITULARIDAD SET vigente_desde=? WHERE id_casa=?',[priorDay,h]);
  const bill=require('../../src/services/monthlyBillingService').__private__.billHouse,fees=h=>query('SELECT * FROM CUOTA WHERE id_casa=? ORDER BY id_cuota',[h]);
  await bill(h,currentMonth);const oldQ=(await fees(h))[0],payment=await require('../../src/services/simulatedPaymentsService').payObligation(ex,'residente',oldQ.id_cuota);
  // On day one, the prepared previous configuration must also precede this month.
  if(today.endsWith('-01')){const d=new Date(currentMonth+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()-1);const prior=d.toISOString().slice(0,10);await query('UPDATE CONTRATO_CASA_VERSION SET vigente_desde=? WHERE id_casa=?',[prior,h]);await query('UPDATE CASA_RESPONSABLE_FINANCIERO SET vigente_desde=? WHERE id_casa=?',[prior,h]);}
  await contracts.configureHouse(h,body(current,{version:1}),admin);await bill(h,first);const newQ=(await fees(h)).at(-1);assert.equal(Number(newQ.id_responsable),current);
  const directH=await configured(direct,{tipo:'RENTA_DIRECTA',cuota_vivienda:'100',responsable_habita:true});await bill(directH,first);const directIds=(await fees(directH)).map(q=>q.id_cuota);
  const otherH=await configured(other);await bill(otherH,first);const otherIds=(await fees(otherH)).map(q=>q.id_cuota);
  const checkoutService=require('../../src/services/recurrenteCheckoutService').createCheckoutService({client:{sandboxId:()=>require('./support/recurrenteWebhookFixtures').TEST_SANDBOX,createCheckout:async()=>{throw new Error('No debe contactar proveedor con cuota ajena');},getCheckout:async()=>{throw new Error('No debe contactar proveedor con checkout ajeno');}}});
  const request=require('supertest')(require('../../src/app').createApp({recurrenteCheckoutService:checkoutService}));
  const [foreignCheckout]=await query('SELECT referencia_local FROM CHECKOUT_RECURRENTE LIMIT 1');assert(foreignCheckout);
  const cases=[[ex,'residente',[oldQ.id_cuota]],[current,'residente',[newQ.id_cuota]],[tenant,'inquilino',[]],[direct,'inquilino',directIds],[other,'residente',otherIds],[guard,'guardia',[]],[admin,'admin',[]]];
  for(const [u,role,expected]of cases){
    const authorization='Bearer '+(await require('../../src/services/activeSessionsService').createActiveSession(u)).token,prefix=role==='inquilino'?'inquilino':'residente';
    const account=await request.get('/'+prefix+'/estado-cuenta').query({id_casa:h,id_usuario:current,id_cuota:newQ.id_cuota,role:'admin'}).set('Authorization',authorization);
    if(['guardia','admin'].includes(role))assert.equal(account.status,403);
    else{assert.equal(account.status,200);assert.deepEqual(account.body.cuotas.map(q=>q.id_cuota).sort((a,b)=>a-b),expected.sort((a,b)=>a-b));}
    const foreignQ=u===current?otherIds[0]:newQ.id_cuota;
    await request.post('/'+prefix+'/pagos-simulados').set('Authorization',authorization).send({id_cuota:foreignQ,id_casa:h,id_usuario:current,role:'residente'}).expect(403);
    await request.get('/'+prefix+'/pagos/'+payment.id_pago+'/comprobante').query({id_usuario:ex,id_casa:h}).set('Authorization',authorization).expect(u===ex?200:['guardia','admin'].includes(role)?403:404);
    await request.get('/'+prefix+'/pagos/recurrente/checkouts/'+foreignCheckout.referencia_local).query({id_usuario:3,id_casa:1}).set('Authorization',authorization).expect(['guardia','admin'].includes(role)?403:404);
    await request.post('/'+prefix+'/pagos/recurrente/checkout').set('Authorization',authorization).send({id_cuota:foreignQ,id_usuario:current,id_casa:h,role:'residente'}).expect(['guardia','admin'].includes(role)?403:400);
    await request.post('/'+prefix+'/pagos/recurrente/checkout').set('Authorization',authorization).send({id_cuota:foreignQ}).expect(403);
    await request.get('/admin/viviendas/'+h+'/contratos').set('Authorization',authorization).expect(role==='admin'?200:403);
  }
  assert.equal(Number((await query('SELECT COUNT(*) n FROM PAGO WHERE id_cuota=?',[newQ.id_cuota]))[0].n),0);
});
