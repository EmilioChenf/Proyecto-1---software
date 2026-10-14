const test = require('node:test'), assert = require('node:assert/strict');
const { configureTestEnvironment, connect } = require('./support/isolatedMysql');
configureTestEnvironment(); require('./support/suiteIsolation').assertOwnedSuiteDatabase();
const { pool, query } = require('../../src/database/mysql');
const { summary } = require('../../src/services/financialDashboardService');
const { readSnapshot } = require('../../src/database/readSnapshot');
const f = require('./support/sprint9Fixtures');
const range = { desde: '2030-06-01', hasta: '2030-06-30' }, now = new Date('2030-06-15T12:00:00Z');
const delta = (a, b) => Math.round((a - b) * 100) / 100;
test.after(() => pool.end());

test('HU28 MySQL calcula centavos, mora histórica, recargos y sobrepagos sin filtrar el saldo por período', async () => {
  const before = await summary(range, now), old = await f.person(), current = await f.person(), house = await f.house(current);
  const q = await f.quota(house, { amount: '100.10', responsible: old });
  await query("INSERT INTO RECARGO_APLICADO(id_cuota,id_casa,tipo_regla,monto_original,monto_recargo,fecha_aplicacion) VALUES(?,?,'FIJO',100.10,5.25,'2030-06-01')", [q, house]);
  await f.payment(q, old, { amount: '30.10' });
  await f.quota(house, { amount: '10.20', responsible: old, deadline: '2030-07-01' });
  await f.quota(house, { amount: '30.30' });
  const overpaid = await f.quota(house, { amount: '10.00', responsible: old });
  await f.payment(overpaid, old, { amount: '12.20', date: '2030-05-31' });
  const after = await summary(range, now);
  assert.equal(delta(after.saldos.pendiente, before.saldos.pendiente), 115.75);
  assert.equal(delta(after.saldos.mora, before.saldos.mora), 105.55);
  assert.equal(after.saldos.cuotas_morosas - before.saldos.cuotas_morosas, 2);
  assert.equal(after.saldos.responsables_morosos - before.saldos.responsables_morosos, 1);
  assert.equal(after.saldos.cuotas_sin_responsable - before.saldos.cuotas_sin_responsable, 1);
  assert.equal(delta(after.saldos.sobrepago, before.saldos.sobrepago), 2.2);
  assert.equal(delta(after.movimientos.cobrado, before.movimientos.cobrado), 30.1);
  assert.equal(delta(after.recargos.registrado, before.recargos.registrado), 5.25);
  assert.equal(Math.round(after.serie.reduce((sum, day) => sum + day.cobrado, 0) * 100) / 100, after.movimientos.cobrado);
  assert.deepEqual((await summary({ desde: '2040-01-01', hasta: '2040-01-31' }, now)).saldos, after.saldos);
  await query('UPDATE CASA SET id_residente=NULL WHERE id_casa=?', [house]);
  assert.deepEqual((await summary(range, now)).saldos, after.saldos);
});

test('HU28 MySQL período vacío contiene ceros y serie diaria completa', async () => {
  const result = await summary({ desde: '2044-02-28', hasta: '2044-03-01' }, now);
  assert.deepEqual(result.movimientos, { cobrado: 0, cantidad_pagos: 0, devuelto: 0, neto: 0 });
  assert.deepEqual(result.serie.map(day => day.fecha), ['2044-02-28', '2044-02-29', '2044-03-01']);
  assert(result.serie.every(day => day.neto === 0));
});

test('HU28 MySQL la instantánea no mezcla un pago concurrente entre dos lecturas', async () => {
  const q = await f.quota(await f.house());
  const sql = 'SELECT COALESCE(SUM(monto_pagado),0) total FROM PAGO WHERE id_cuota=?';
  await readSnapshot(async read => {
    assert.equal(Number((await read(sql, [q]))[0].total), 0);
    await f.payment(q, null, { amount: '0.10' });
    assert.equal(Number((await read(sql, [q]))[0].total), 0);
  });
  assert.equal(Number((await query(sql, [q]))[0].total), 0.1);
});

test('HU28 MySQL contabiliza solo devoluciones confirmadas aplicadas y concilia la serie', async () => {
  const { paidFixture, mockClient, evidence } = require('./support/recurrenteRefundFixtures');
  const { createRefundService } = require('../../src/services/recurrenteRefundService');
  const { randomUUID } = require('node:crypto');
  const connection = await connect();
  const input = { desde: '2026-09-01', hasta: '2026-10-31' };
  try {
    const before = await summary(input, now);
    const paid = await paidFixture(connection);
    await createRefundService({ client: mockClient({ reply: evidence(500) }) }).request({ id: 1, role: 'admin' }, paid.transactions[0].id_transaccion,
      { motivo: 'Prueba financiera Sprint 9', idempotency_key: randomUUID() });
    const after = await summary(input, now);
    assert.equal(delta(after.movimientos.cobrado, before.movimientos.cobrado), 5);
    assert.equal(delta(after.movimientos.devuelto, before.movimientos.devuelto), 5);
    assert.equal(delta(after.movimientos.neto, before.movimientos.neto), 0);
    assert.equal(Math.round(after.serie.reduce((sum, day) => sum + day.devuelto, 0) * 100) / 100, after.movimientos.devuelto);
    const pending = await paidFixture(connection);
    await createRefundService({ client: mockClient({ reply: evidence(500, { status: 'pending' }) }) }).request({ id: 1, role: 'admin' }, pending.transactions[0].id_transaccion,
      { motivo: 'Devolución pendiente Sprint 9', idempotency_key: randomUUID() });
    const pendingSummary = await summary(input, now);
    assert.equal(pendingSummary.movimientos.devuelto, after.movimientos.devuelto);
    assert.equal(delta(pendingSummary.movimientos.neto, after.movimientos.neto), 5);
  } finally { await connection.end(); }
});
