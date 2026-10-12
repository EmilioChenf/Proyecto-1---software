const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const ExcelJS = require('exceljs');
const { configureTestEnvironment } = require('./support/isolatedMysql');
const { assertOwnedSuiteDatabase } = require('./support/suiteIsolation');
configureTestEnvironment();
assertOwnedSuiteDatabase();
const { pool, query } = require('../../src/database/mysql');
const contracts = require('../../src/services/propertyContractsService');
const { syncHouseRelations } = require('../../src/services/contractHouseRelations');
const { billHouse } = require('../../src/services/monthlyBillingService').__private__;
const { payObligation } = require('../../src/services/simulatedPaymentsService');
const history = require('../../src/services/sanctionHistoryService');
const adminSanctions = require('../../src/services/adminSanctionsService');
const reports = require('../../src/services/reportExportService');
const today = require('../../src/utils/guatemalaTime').guatemalaToday();
const first = contracts.__private__.nextPeriod(today), second = contracts.__private__.nextPeriod(first);
const UNKNOWN = 'Responsable no confirmado';
let admin;

async function user(role, name) {
  const [type] = await query('SELECT id_tipo_usuario FROM TIPO_USUARIO WHERE nombre=?', [role]);
  return (await query('INSERT INTO USUARIO(nombre,dpi,correo,password,activo,id_tipo_usuario) VALUES(?,?,?,?,1,?)',
    [name, randomUUID().slice(0,12), randomUUID()+'@n1.test', 'test-only', type.id_tipo_usuario])).insertId;
}
async function resident(person) {
  await query('INSERT INTO RESIDENTE(id_usuario) VALUES(?) ON DUPLICATE KEY UPDATE id_usuario=VALUES(id_usuario)', [person]);
  return (await query('SELECT id_residente FROM RESIDENTE WHERE id_usuario=?', [person]))[0].id_residente;
}
async function house(person = null) {
  return (await query('INSERT INTO CASA(numero,id_residente,activo) VALUES(?,?,1)',
    [randomUUID().slice(0,8), person == null ? null : await resident(person)])).insertId;
}
function body(person, extra = {}) {
  return {id_operacion:randomUUID(), version:0, tipo:'PROPIEDAD_PRIVADA', fecha_efectiva:today,
    cuota_vivienda:'0', meses_financiamiento:null, responsable:{id_usuario:person},
    responsable_habita:false, inquilino_privado:null, confirmado:true, ...extra};
}
async function configured(person, extra = {}) {
  const id = await house();
  await contracts.configureHouse(id, body(person, extra), admin);
  return id;
}
async function quota(id, person = null, snapshot = null) {
  return (await query('INSERT INTO CUOTA(id_casa,id_servicio,monto,fecha_limite,id_responsable,responsable_snapshot) VALUES(?,1,500,?,?,?)',
    [id, today, person, snapshot == null ? null : JSON.stringify(snapshot)])).insertId;
}
async function sanction(id, q = null, date = today+' 10:00:00', rule = 'N1') {
  const motive = 'N1 '+randomUUID();
  const sid = (await query("INSERT INTO SANCION(id_casa,id_cuota,motivo,codigo_regla,detalle,fecha_incumplimiento,fecha_generacion,monto,estado,creado_por) VALUES(?,?,?,?,?, ?,?,10,'PENDIENTE',?)",
    [id,q,motive,rule,'Prueba histórica N1',today,date,admin])).insertId;
  await query("INSERT INTO SANCION_HISTORIAL(id_sancion,accion,estado_nuevo,detalle,realizado_por) VALUES(?,'GENERACION_AUTOMATICA','PENDIENTE','Prueba histórica N1',?)", [sid,admin]);
  return {id:sid, motive};
}
async function exported(s) {
  const matches = (await reports.rows('sanciones')).filter(row => row.motivo === s.motive);
  assert.equal(matches.length, 1, 'La exportación debe conservar exactamente una fila por sanción');
  return matches[0];
}
async function representations(s) {
  const detail = await history.detail(s.id);
  const listed = (await history.list({limit:100})).items.filter(row => row.id_sancion === s.id);
  const adminList = (await adminSanctions.listSanctions()).filter(row => row.id_sancion === s.id);
  const events = (await adminSanctions.listSanctionHistory()).filter(row => row.id_sancion === s.id);
  for (const rows of [listed,adminList,events]) assert.equal(rows.length, 1, 'Conservar la sanción en cada listado');
  return [detail.residente,listed[0].residente,adminList[0].residente,events[0].residente,(await exported(s)).residente];
}
async function activate(id, day) {
  const c = await pool.getConnection();
  try {await c.beginTransaction(); await syncHouseRelations(c,id,day); await c.commit();}
  catch (error) {await c.rollback(); throw error;} finally {c.release();}
}
test.before(async () => {
  admin = await user('admin','Administrador N1');
  await contracts.saveMaintenance({monto:'500',vigente_desde:first},admin);
});
test.after(async () => {await pool.end();});

test('N1-A legado desconocido conserva incertidumbre al cambiar Juan por María', async t => {
  const juan = await user('residente','Juan N1-A'), maria = await user('residente','María N1-A');
  const id = await house(juan), q = await quota(id), s = await sanction(id,q);
  const before = (await exported(s)).residente;
  await query('UPDATE CASA SET id_residente=? WHERE id_casa=?', [await resident(maria),id]);
  const after = (await exported(s)).residente;
  const detail = (await history.detail(s.id)).residente;
  t.diagnostic(JSON.stringify({case:'N1-A',exportBefore:before,exportAfter:after,historicalDetail:detail}));
  assert.deepEqual([before,after,detail], [UNKNOWN,UNKNOWN,UNKNOWN]);
  assert.deepEqual(await representations(s), Array(5).fill(UNKNOWN));
  const [stored] = await query('SELECT id_responsable,responsable_snapshot FROM CUOTA WHERE id_cuota=?',[q]);
  assert.deepEqual(stored, {id_responsable:null,responsable_snapshot:null}, 'No inventar un backfill');
});

test('N1-B venta real Q0 a María conserva a Juan como responsable histórico', async () => {
  const juan = await user('residente','Juan N1-B'), maria = await user('residente','María N1-B');
  const id = await configured(juan);
  await billHouse(id,first);
  const [q] = await query('SELECT * FROM CUOTA WHERE id_casa=? ORDER BY id_cuota',[id]);
  await payObligation(juan,'residente',q.id_cuota);
  const s = await sanction(id,q.id_cuota), before = await representations(s);
  await contracts.configureHouse(id,body(maria,{version:1,fecha_efectiva:second}),admin);
  await activate(id,second);
  const [owner] = await query('SELECT r.id_usuario FROM CASA c JOIN RESIDENTE r ON r.id_residente=c.id_residente WHERE c.id_casa=?',[id]);
  assert.equal(Number(owner.id_usuario),maria, 'La venta debe haberse activado');
  assert.deepEqual(before,Array(5).fill('Juan N1-B'));
  assert.deepEqual(await representations(s),before);
});

test('N1-C renta directa con responsable conocido y CASA.id_residente NULL aparece', async () => {
  const pedro = await user('inquilino','Pedro N1-C');
  const id = await configured(pedro,{tipo:'RENTA_DIRECTA',cuota_vivienda:'100'});
  await billHouse(id,first);
  const [q] = await query('SELECT id_cuota FROM CUOTA WHERE id_casa=? ORDER BY id_cuota',[id]);
  const s = await sanction(id,q.id_cuota);
  assert.equal((await query('SELECT id_residente FROM CASA WHERE id_casa=?',[id]))[0].id_residente,null);
  assert.deepEqual(await representations(s),Array(5).fill('Pedro N1-C'));
});

test('N1-D renta directa desconocida conserva filas con cuota sin actor o sin cuota', async () => {
  const pedro = await user('inquilino','Pedro N1-D');
  const id = await configured(pedro,{tipo:'RENTA_DIRECTA',cuota_vivienda:'100'});
  assert.equal((await query('SELECT id_residente FROM CASA WHERE id_casa=?',[id]))[0].id_residente,null);
  for (const q of [await quota(id),null]) {
    const s = await sanction(id,q);
    assert.deepEqual(await representations(s),Array(5).fill(UNKNOWN));
  }
});

test('N1-E detalle, ambos listados, historial de eventos y exportación concuerdan', async () => {
  const juan = await user('residente','Juan N1-E'), maria = await user('residente','María N1-E');
  const id = await house(juan);
  const fixtures = [
    [await sanction(id,await quota(id)),UNKNOWN],
    [await sanction(id,await quota(id,juan)),'Juan N1-E'],
    [await sanction(id,await quota(id,juan,{nombre:'Juan histórico N1-E'})),'Juan histórico N1-E'],
    [await sanction(id,null),UNKNOWN],
  ];
  for (const [s,name] of fixtures) assert.deepEqual(await representations(s),Array(5).fill(name));
  await query('UPDATE CASA SET id_residente=? WHERE id_casa=?',[await resident(maria),id]);
  for (const [s,name] of fixtures) assert.deepEqual(await representations(s),Array(5).fill(name));
});

test('N1-F filtros, paginación y XLSX/PDF conservan identidad y cardinalidad', async () => {
  const juan = await user('residente','Juan N1-F'), id = await house(juan), rule = 'N1F'+randomUUID().slice(0,8);
  const a = await sanction(id,await quota(id),'2025-02-01 08:00:00',rule);
  const b = await sanction(id,null,'2025-02-02 09:00:00',rule);
  const excluded = await sanction(id,null,'2025-03-01 10:00:00',rule);
  const filters = {desde:'2025-02-01',hasta:'2025-02-02'};
  const expected = [a.motive,b.motive].sort();
  const rows = (await reports.rows('sanciones',filters)).filter(row=>[...expected,excluded.motive].includes(row.motivo));
  assert.deepEqual(rows.map(row=>row.motivo).sort(),expected);
  assert(rows.every(row=>row.residente===UNKNOWN));
  const pages = await Promise.all([1,2].map(page=>history.list({...filters,regla:rule,limit:1,page})));
  assert(pages.every(page=>page.total===2 && page.pages===2));
  assert.deepEqual(pages.flatMap(page=>page.items.map(row=>row.id_sancion)).sort((a,b)=>a-b),[a.id,b.id]);
  for (const s of [a,b]) {
    assert.equal((await adminSanctions.listSanctions({search:UNKNOWN})).filter(row=>row.id_sancion===s.id).length,1);
    assert.equal((await adminSanctions.listSanctionHistory({search:UNKNOWN})).filter(row=>row.id_sancion===s.id).length,1);
    assert.equal((await adminSanctions.listSanctions({search:'Juan N1-F'})).filter(row=>row.id_sancion===s.id).length,0);
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await reports.excel('sanciones',rows,admin,filters));
  const exportedRows = [];
  workbook.worksheets[0].eachRow(row=>{if(expected.includes(row.getCell(4).value))exportedRows.push([row.getCell(4).value,row.getCell(3).value]);});
  assert.deepEqual(exportedRows.sort(),expected.map(motive=>[motive,UNKNOWN]));
  const pdf = await reports.pdf('sanciones',rows,admin,filters);
  const { inflateSync } = require('node:zlib');
  const streams = [...pdf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
    .map(match=>inflateSync(Buffer.from(match[1],'latin1')).toString('latin1')).join('\n');
  // PDFKit encodes text into hex chunks separated by kerning adjustments.
  const text = [...streams.matchAll(/<([a-f\d]+)>/gi)].map(match=>Buffer.from(match[1],'hex').toString('latin1')).join('');
  assert.equal((text.match(/Responsable no confirmado/g)||[]).length,2);
});

test('N1 snapshot tiene prioridad tras renombrar/desactivar al usuario histórico', async () => {
  const person = await user('residente','Nombre actual N1'), id = await house(person);
  const s = await sanction(id,await quota(id,person,{nombre:'Nombre histórico N1'}));
  await query("UPDATE USUARIO SET nombre='Nombre modificado N1',activo=0 WHERE id_usuario=?",[person]);
  assert.deepEqual(await representations(s),Array(5).fill('Nombre histórico N1'));
  assert((await adminSanctions.listSanctions({search:'Nombre histórico N1'})).some(row=>row.id_sancion===s.id));
  assert((await adminSanctions.listSanctionHistory({search:'Nombre histórico N1'})).some(row=>row.id_sancion===s.id));
});

test('N1 responsable almacenado sin snapshot permanece tras cambiar residente actual', async () => {
  const juan = await user('residente','Juan almacenado N1'), maria = await user('residente','María actual N1');
  const id = await house(juan), s = await sanction(id,await quota(id,juan));
  await query('UPDATE CASA SET id_residente=? WHERE id_casa=?',[await resident(maria),id]);
  assert.deepEqual(await representations(s),Array(5).fill('Juan almacenado N1'));
});
