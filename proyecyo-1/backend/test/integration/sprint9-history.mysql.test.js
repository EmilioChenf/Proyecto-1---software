const test = require('node:test'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
const { configureTestEnvironment } = require('./support/isolatedMysql');
configureTestEnvironment(); require('./support/suiteIsolation').assertOwnedSuiteDatabase();
const { pool, query } = require('../../src/database/mysql');
const activity = require('../../src/services/residentActivityService');
const f = require('./support/sprint9Fixtures');
const http = require('supertest')(require('../../src/app').createApp());
let old, current, third;
const ids = async (user, filters = {}) => (await activity.list(user.id, filters)).items.map(item => item.id);
test.before(async () => { old = await f.person(); current = await f.person(); third = await f.person(); });
test.after(() => pool.end());

test('HU30 MySQL consolida cuatro módulos sin transferirlos al nuevo ocupante', async () => {
  const house = await f.house(current), q = await f.quota(house, { responsible: old });
  const payment = await f.payment(q, old);
  const visitor = (await query('INSERT INTO VISITANTE(nombre,dpi) VALUES(?,?)', ['Visita privada', 'documento-privado'])).insertId;
  const visit = (await query("INSERT INTO ACCESO(id_visitante,id_casa,id_usuario_autoriza,fecha,hora_inicio,tipo_visita,token_qr) VALUES(?,?,?,'2030-06-05','08:00','VISITA',?)", [visitor, house, old.id, randomUUID()])).insertId;
  await query("INSERT INTO RESERVA(id_usuario,id_amenidad,fecha,hora_inicio,hora_fin,estado) VALUES(?,1,'2030-06-05','09:00','10:00','CONFIRMADA')", [old.id]);
  const sanction = (await query("INSERT INTO SANCION(id_casa,id_cuota,codigo_regla,motivo,detalle,monto,estado,fecha_incumplimiento,creado_por) VALUES(?,?,'S9','Sanción privada','Detalle privado de la sanción',10,'PENDIENTE','2030-06-05',1)", [house, q])).insertId;
  const expected = await ids(old);
  assert(expected.includes(`pago:${payment}`)); assert(expected.includes(`visita:${visit}`)); assert(expected.includes(`sancion:${sanction}`));
  assert(expected.some(id => id.startsWith(`reserva:${old.id}:`)));
  for (const occupant of [current, third, null]) {
    await query('UPDATE CASA SET id_residente=? WHERE id_casa=?', [occupant?.resident || null, house]);
    assert.deepEqual(await ids(old), expected);
    for (const other of [current, third]) assert(!(await ids(other)).some(id => expected.includes(id)));
  }
  const response = await http.get('/residente/actividad').set('Authorization', old.auth).expect(200);
  assert(!JSON.stringify(response.body).match(/token_qr|documento-privado|dpi/));
});

test('HU30 MySQL un pagador distinto prevalece sobre el responsable de la cuota', async () => {
  const q = await f.quota(await f.house(third), { responsible: old });
  const payment = await f.payment(q, current);
  assert((await ids(current)).includes(`pago:${payment}`));
  assert(!(await ids(old)).includes(`pago:${payment}`));
  assert(!(await ids(third)).includes(`pago:${payment}`));
});

test('HU30 MySQL snapshot y transacción legada son evidencia; ocupación sola no lo es', async () => {
  const house = await f.house(current), q = await f.quota(house);
  const snapshot = await f.payment(q, null, { snapshot: { id_usuario: old.id, nombre: old.name } });
  const legacy = await f.payment(q, null);
  await query("INSERT INTO TRANSACCION_SIMULADA(id_pago,id_usuario,id_casa,rol,concepto,monto,estado) VALUES(?,?,?,'residente','Legado',10,'APROBADA')", [legacy, old.id, house]);
  const unknown = await f.payment(await f.quota(house), null);
  assert((await ids(old)).includes(`pago:${snapshot}`)); assert((await ids(old)).includes(`pago:${legacy}`));
  for (const user of [old, current, third]) assert(!(await ids(user)).includes(`pago:${unknown}`));
  assert(!(await ids(current)).includes(`pago:${snapshot}`)); assert(!(await ids(current)).includes(`pago:${legacy}`));
});

test('HU30 MySQL orden estable entre páginas, fechas inclusivas y fechas NULL al final', async () => {
  const user = await f.person(), q = await f.quota(await f.house());
  for (let index = 0; index < 6; index++) await f.payment(q, user, { date: '2030-06-05', amount: '0.10' });
  const undated = await f.payment(q, user, { date: null });
  const all = await ids(user, { tipo: 'pago', limit: '100' });
  assert.equal(all.at(-1), `pago:${undated}`);
  const collected = [];
  for (let page = 1; page <= 4; page++) collected.push(...await ids(user, { tipo: 'pago', limit: '2', page: String(page) }));
  assert.deepEqual(collected, all); assert.equal(new Set(collected).size, 7);
  assert.equal((await ids(user, { desde: '2030-06-05', hasta: '2030-06-05' })).length, 6);
  assert.deepEqual(await ids(user, { desde: '2030-06-06' }), []);
});

test('HU30 HTTP autentica sesiones reales y rechaza IDOR por query', async () => {
  await http.get('/residente/actividad').expect(401);
  for (const role of ['admin', 'inquilino', 'guardia']) {
    const user = await f.person(role);
    await http.get('/residente/actividad').set('Authorization', user.auth).expect(403);
  }
  for (const name of ['id_usuario', 'userId', 'residente']) {
    await http.get('/residente/actividad').query({ [name]: current.id }).set('Authorization', old.auth).expect(400);
  }
  const response = await http.get('/residente/actividad?tipo=pago').set('Authorization', old.auth).expect(200);
  assert(response.body.items.every(item => item.tipo === 'pago'));
  assert.equal(response.headers['cache-control'], 'no-store');
});
