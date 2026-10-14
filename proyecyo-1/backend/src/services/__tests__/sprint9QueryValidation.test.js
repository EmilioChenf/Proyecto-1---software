jest.mock('../../database/mysql', () => ({ query: jest.fn() }));
const { query } = require('../../database/mysql');
const dashboard = require('../financialDashboardService');
const reports = require('../reportExportService');
const activity = require('../residentActivityService');
beforeEach(() => { query.mockReset(); });

test.each([{ userId: '99' }, { id_usuario: '99' }, { desde: ['2026-01-01'] }, { hasta: { x: '2026-02-01' } },
  { desde: null }, { unknown: '' }])('HU28/HU29/HU30 rechazan query ambiguo antes de SQL %j', async input => {
  await expect(dashboard.summary(input)).rejects.toMatchObject({ status: 400 });
  await expect(reports.rows('pagos', input)).rejects.toMatchObject({ status: 400 });
  await expect(activity.list(3, input)).rejects.toMatchObject({ status: 400 });
  expect(query).not.toHaveBeenCalled();
});
test('HU29 admite selectores de ruta pero rechaza filtros de otro módulo y objetos prototipo', () => {
  expect(reports.validateFilters({ reporte: 'pagos', formato: 'xlsx', origen: 'HISTORICO' }, 'pagos').origen).toBe('HISTORICO');
  expect(() => reports.validateFilters({ amenidad: 'Piscina' }, 'pagos')).toThrow();
  expect(() => reports.validateFilters(JSON.parse('{"__proto__":"x"}'), 'pagos')).toThrow();
});
