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

test('HU30 incorpora sanciones solo con responsable de cuota o snapshot confirmado', async () => {
  await activity.list(9);
  const [sql, params] = query.mock.calls[0];
  expect(sql).toContain('FROM SANCION s JOIN CUOTA cu ON cu.id_cuota=s.id_cuota');
  expect(sql).toContain('WHERE COALESCE(cu.id_responsable,');
  expect(sql).toContain("JSON_EXTRACT(cu.responsable_snapshot,'$.id_usuario')");
  expect(sql).not.toContain('JOIN CASA');
  expect(params.every(id => id === 9)).toBe(true);
});

test('HU30 filtra antes de paginar, consulta solo el tipo pedido y detecta página siguiente', async () => {
  query.mockResolvedValue(Array.from({ length: 3 }, (_, index) => ({ id: `pago:${index}`, monto: 1 })));
  const result = await activity.list(7, { tipo: 'pago', desde: '2026-09-01', hasta: '2026-09-30', page: '2', limit: '2' });
  expect(result).toMatchObject({ page: 2, limit: 2, hasMore: true });
  expect(result.items).toHaveLength(2);
  const [sql, params] = query.mock.calls[0];
  expect(sql).not.toContain('UNION ALL');
  expect(sql).toContain('WHERE fecha>=? AND fecha<=?');
  expect(sql).toContain('LIMIT 3 OFFSET 2');
  expect(params).toEqual([7, '2026-09-01', '2026-09-30']);
});

test.each([{ tipo: 'constructor' }, { tipo: ['pago'] }, { desde: '2026-02-29' }, { page: '0' }, { page: '1.5' },
  { limit: '101' }, { userId: '99' }, { id_usuario: '99' }, { desde: '2026-12-01', hasta: '2026-01-01' }])
('HU30 rechaza filtros inválidos o identidad externa %j', async input => {
  await expect(activity.list(7, input)).rejects.toMatchObject({ status: 400 });
  expect(query).not.toHaveBeenCalled();
});
test.each([null, 0, -1, '3', NaN])('HU30 rechaza identidad de servicio inválida %s', async id => {
  await expect(activity.list(id)).rejects.toMatchObject({ status: 401 });
  expect(query).not.toHaveBeenCalled();
});
