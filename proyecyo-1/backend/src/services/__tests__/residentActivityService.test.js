jest.mock('../../database/mysql', () => ({ query: jest.fn() }));
const { query } = require('../../database/mysql');
const activity = require('../residentActivityService');
beforeEach(() => { query.mockReset().mockResolvedValue([]); });

test('HU30 consulta pagos usando evidencia histórica y únicamente el usuario autenticado', async () => {
  query.mockResolvedValue([{ id: 'pago:1', tipo: 'pago', monto: '12.35', fecha: null }]);
  const result = await activity.list(3);
  expect(result.items[0]).toMatchObject({ monto: 12.35, fecha: null });
  const [sql, params] = query.mock.calls[0];
  expect(params).toEqual([3]);
  expect(sql).toContain('pg.id_actor');
  expect(sql).toContain('pg.titular_snapshot');
  expect(sql).toContain('viewer.user_id');
  expect(sql).not.toContain('id_residente');
  expect(sql).toContain('ORDER BY fecha DESC, hora DESC, id DESC');
});
test.each([null, 0, -1, '3', NaN])('HU30 rechaza identidad de servicio inválida %s', async id => {
  await expect(activity.list(id)).rejects.toMatchObject({ status: 401 });
  expect(query).not.toHaveBeenCalled();
});
