jest.mock('../../database/mysql', () => ({ query: jest.fn() }));
const { query } = require('../../database/mysql');
const dashboard = require('../financialDashboardService');
beforeEach(() => query.mockReset().mockResolvedValue([{ cobrado: 0, devuelto: 0 }]));

test('HU28 consolida deuda actual y responsables históricos sin restringir abonos', async () => {
  query.mockResolvedValueOnce([{ pendiente: '102.35', mora: '80.10', responsables_morosos: 2, cuotas_sin_responsable: 1, sobrepago: null }]);
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

test('HU28 separa movimientos del rango de saldos actuales y permite neto negativo', async () => {
  query.mockResolvedValueOnce([{ pendiente: 10 }]).mockResolvedValueOnce([{ cobrado: '0.10', devuelto: '0.30', cantidad_pagos: 1 }]);
  const result = await dashboard.summary({ desde: '2026-09-01', hasta: '2026-09-30' });
  expect(result.movimientos).toEqual({ cobrado: 0.1, devuelto: 0.3, cantidad_pagos: 1, neto: -0.2 });
  expect(query.mock.calls[1][1]).toEqual(Array(3).fill(['2026-09-01', '2026-09-30']).flat());
  expect(query.mock.calls[1][0]).toContain("rr.estado='CONFIRMADO' AND rr.aplicado_en IS NOT NULL");
});

test.each([{ desde: ['2026-01-01'] }, { desde: '2026-02-29' }, { desde: '2026-02-01', hasta: '2026-01-01' },
  { desde: '2020-01-01', hasta: '2026-01-01' }])('HU28 rechaza período inválido antes de consultar %j', async input => {
  await expect(dashboard.summary(input)).rejects.toMatchObject({ status: 400 });
  expect(query).not.toHaveBeenCalled();
});
