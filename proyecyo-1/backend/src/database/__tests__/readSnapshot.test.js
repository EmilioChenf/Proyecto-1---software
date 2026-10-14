jest.mock('../mysql', () => ({ pool: { getConnection: jest.fn() } }));
const { pool } = require('../mysql');
const { readSnapshot } = require('../readSnapshot');
let connection;
beforeEach(() => {
  connection = { query: jest.fn().mockResolvedValue([]), execute: jest.fn().mockResolvedValue([[{ total: 5 }]]),
    commit: jest.fn(), rollback: jest.fn(), release: jest.fn() };
  pool.getConnection.mockReset().mockResolvedValue(connection);
});
test('HU28 usa una sola conexión y una instantánea de solo lectura para todos los agregados', async () => {
  const result = await readSnapshot(async query => { await query('SELECT uno', [1]); return query('SELECT dos', [2]); });
  expect(result).toEqual([{ total: 5 }]);
  expect(pool.getConnection).toHaveBeenCalledTimes(1);
  expect(connection.query.mock.calls).toEqual([['SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'], ['START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY']]);
  expect(connection.execute.mock.calls).toEqual([['SELECT uno', [1]], ['SELECT dos', [2]]]);
  expect(connection.commit).toHaveBeenCalledTimes(1);
  expect(connection.rollback).not.toHaveBeenCalled();
  expect(connection.release).toHaveBeenCalledTimes(1);
});
test('HU28 revierte y devuelve la conexión al fallar un agregado', async () => {
  connection.execute.mockRejectedValue(new Error('database failure'));
  await expect(readSnapshot(query => query('SELECT uno'))).rejects.toThrow('database failure');
  expect(connection.commit).not.toHaveBeenCalled();
  expect(connection.rollback).toHaveBeenCalledTimes(1);
  expect(connection.release).toHaveBeenCalledTimes(1);
});
