const test = require('node:test'), assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { configureTestEnvironment } = require('./support/isolatedMysql');
configureTestEnvironment(); require('./support/suiteIsolation').assertOwnedSuiteDatabase();
const { pool, query } = require('../../src/database/mysql');
const reports = require('../../src/services/reportExportService');
const f = require('./support/sprint9Fixtures');
const http = require('supertest')(require('../../src/app').createApp());
let actor, current, admin;
test.before(async () => { actor = await f.person(); current = await f.person(); admin = await f.person('admin'); });
test.after(() => pool.end());

test('HU29 MySQL filtra pagos por snapshot histórico sin confundir al ocupante actual', async () => {
  const house = await f.house(current), q = await f.quota(house, { responsible: current });
  const payment = await f.payment(q, actor, { amount: '12.35', date: '2036-01-01', snapshot: { id_usuario: actor.id, nombre: 'Titular archivado S9' } });
  await query("INSERT INTO PAGO_ORIGEN(id_pago,id_cuota,origen,ambiente) VALUES(?,?,'HISTORICO','historical')", [payment, q]);
  const [{ numero }] = await query('SELECT numero FROM CASA WHERE id_casa=?', [house]);
  const filters = { responsable: 'Titular archivado S9', unidad: numero, origen: 'HISTORICO', desde: '2036-01-01', hasta: '2036-01-01' };
  const rows = await reports.rows('pagos', filters);
  assert.equal(rows.length, 1); assert.equal(rows[0].id_pago, payment); assert.equal(Number(rows[0].monto), 12.35);
  assert.deepEqual(await reports.rows('pagos', { ...filters, responsable: current.name }), []);
  assert.deepEqual(await reports.rows('pagos', { ...filters, responsable: "' OR 1=1 --" }), []);
  await query('UPDATE CASA SET id_residente=NULL WHERE id_casa=?', [house]);
  assert.deepEqual(await reports.rows('pagos', filters), rows);
});

test('HU29 MySQL filtros de reservas y sanciones seleccionan exactamente el módulo solicitado', async () => {
  await query("INSERT INTO RESERVA(id_usuario,id_amenidad,fecha,hora_inicio,hora_fin,estado) VALUES(?,1,'2036-01-02','10:00','11:00','CANCELADA')", [actor.id]);
  const [amenity] = await query('SELECT nombre FROM AMENIDAD WHERE id_amenidad=1');
  const reservations = await reports.rows('reservas', { desde: '2036-01-02', hasta: '2036-01-02', estado: 'CANCELADA', usuario: actor.name, amenidad: amenity.nombre });
  assert.equal(reservations.length, 1); assert.equal(reservations[0].estado, 'CANCELADA');
  const house = await f.house(current), q = await f.quota(house, { responsible: actor });
  await query("INSERT INTO SANCION(id_casa,id_cuota,codigo_regla,motivo,detalle,monto,estado,fecha_incumplimiento,fecha_generacion,creado_por) VALUES(?,?,'S9_EXPORT','Exportación','Detalle',7.25,'ANULADA','2036-01-02','2036-01-02 10:00:00',1)", [house, q]);
  const [{ numero }] = await query('SELECT numero FROM CASA WHERE id_casa=?', [house]);
  const sanctions = await reports.rows('sanciones', { estado: 'ANULADA', regla: 'S9_EXPORT', unidad: numero });
  assert.equal(sanctions.length, 1); assert.equal(sanctions[0].residente, actor.name);
  assert.deepEqual(await reports.rows('sanciones', { estado: 'PAGADA', regla: 'S9_EXPORT', unidad: numero }), []);
});

test('HU29 HTTP catálogo y archivos requieren admin real y conservan formato y cabeceras', async () => {
  await http.get('/admin/reportes/catalogo').set('Authorization', actor.auth).expect(403);
  const catalog = await http.get('/admin/reportes/catalogo').set('Authorization', admin.auth).expect(200);
  assert(catalog.body.some(item => item.id === 'pagos'));
  for (const format of ['pdf', 'xlsx']) {
    const response = await http.get('/admin/reportes/exportar').query({ reporte: 'pagos', formato: format, desde: '2036-01-01', hasta: '2036-01-01' }).set('Authorization', admin.auth).expect(200);
    assert.match(response.headers['content-disposition'], new RegExp(`pagos.*${format}`));
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.match(response.headers['content-type'], format === 'pdf' ? /application\/pdf/ : /spreadsheetml/);
  }
});

test('HU29 MySQL exporta 10000 filas completas y rechaza 10001 sin truncamiento', async () => {
  const q = await f.quota(await f.house(), { amount: '1000.00', responsible: actor });
  const connection = await pool.getConnection();
  try {
    for (let batch = 0; batch < 10; batch++) {
      await connection.query('INSERT INTO PAGO(id_cuota,monto_pagado,fecha_pago,id_actor) VALUES ?',
        [Array.from({ length: 1000 }, () => [q, '0.01', '2037-02-01', actor.id])]);
    }
  } finally { connection.release(); }
  const range = { desde: '2037-02-01', hasta: '2037-02-01' };
  const rows = await reports.rows('pagos', range); assert.equal(rows.length, 10000);
  assert.equal(new Set(rows.map(row => row.id_pago)).size, 10000);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(await reports.excel('pagos', rows, admin.id, range));
  assert.equal(book.worksheets[0].rowCount, 10005);
  await f.payment(q, actor, { amount: '0.01', date: '2037-02-01' });
  await assert.rejects(reports.rows('pagos', range), { status: 400 });
});
