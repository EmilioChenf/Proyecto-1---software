jest.mock('../../database/mysql', () => ({ query: jest.fn() }));
const { query } = require('../../database/mysql');
const dashboard = require('../financialDashboardService');
beforeEach(() => query.mockReset());

test('HU28 consolida deuda actual y responsables históricos sin restringir abonos', async () => {
  query.mockResolvedValue([{ pendiente: '102.35', mora: '80.10', responsables_morosos: 2, cuotas_sin_responsable: 1, sobrepago: null }]);
  const result = await dashboard.summary({}, new Date('2026-10-14T02:00:00Z'));
  expect(result.fecha_corte).toBe('2026-10-13');
  expect(result.saldos).toMatchObject({ pendiente: 102.35, mora: 80.1, responsables_morosos: 2, sobrepago: 0 });
  const [sql, params] = query.mock.calls[0];
  expect(params).toEqual(Array(4).fill('2026-10-13'));
  expect(sql).toContain('COUNT(DISTINCT CASE');
  expect(sql).toContain('total_reembolsado');
  expect(sql).not.toContain('id_residente');
  expect(sql).not.toMatch(/fecha_pago\s*[<>]/);
});
