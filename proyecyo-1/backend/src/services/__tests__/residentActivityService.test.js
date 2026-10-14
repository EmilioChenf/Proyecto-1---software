jest.mock('../../database/mysql', () => ({ query: jest.fn() }));
const { query } = require('../../database/mysql');
const activity = require('../residentActivityService');
beforeEach(() => { query.mockReset().mockResolvedValue([]); });

test('HU30 consulta pagos usando evidencia histórica y únicamente el usuario autenticado', async () => {
  query.mockResolvedValue([{ id: 'pago:1', tipo: 'pago', monto: '12.35', fecha: null }]);
  const result = await activity.list(3);
  expect(result.items[0]).toMatchObject({ monto: 12.35, fecha: null });
  const [sql, params] = query.mock.calls[0];
  expect(params.length).toBeGreaterThan(0);
  expect(params.every(id => id === 3)).toBe(true);
  expect(sql).toContain('pg.id_actor');
  expect(sql).toContain('pg.titular_snapshot');
  expect(sql).toContain('viewer.user_id');
  expect(sql).not.toContain('id_residente');
  expect(sql).toContain('ORDER BY fecha DESC, hora DESC, id DESC');
});
test('HU30 integra reservas con identidad compuesta y sin asociarlas a la vivienda actual', async () => {
  query.mockResolvedValue([{ id: 'reserva:3:2:2026-10-14:08:00:00', tipo: 'reserva', monto: null }]);
  const result = await activity.list(3);
  expect(result.items[0].monto).toBeNull();
  const [sql, params] = query.mock.calls[0];
  expect(sql).toContain('WHERE r.id_usuario=?');
  expect(sql).toContain("r.id_amenidad,':',r.fecha,':',r.hora_inicio");
  expect(sql).not.toContain('r.id_reserva');
  expect(params.every(id => id === 3)).toBe(true);
});

test('HU30 muestra solo visitas autorizadas por el residente sin credenciales QR ni documentos', async () => {
  await activity.list(12);
  const [sql, params] = query.mock.calls[0];
  expect(sql).toContain('WHERE a.id_usuario_autoriza=?');
  expect(sql).toContain('a.estado_acceso estado');
  expect(sql).not.toMatch(/token_qr|\bdpi\b|motivo_excepcion|observaciones/);
  expect(params.every(id => id === 12)).toBe(true);
});
test.each([null, 0, -1, '3', NaN])('HU30 rechaza identidad de servicio inválida %s', async id => {
  await expect(activity.list(id)).rejects.toMatchObject({ status: 401 });
  expect(query).not.toHaveBeenCalled();
});
