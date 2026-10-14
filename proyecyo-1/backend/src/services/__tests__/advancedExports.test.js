jest.mock('../../database/mysql', () => ({ query: jest.fn() }));
const { query } = require('../../database/mysql');
const reports = require('../reportExportService');
const ExcelJS = require('exceljs');
beforeEach(() => { query.mockReset().mockResolvedValue([]); });

test('HU29 exporta pagos aplicados con titular histórico y sin ocupante actual', async () => {
  await reports.rows('pagos', { desde: '2026-10-01', hasta: '2026-10-14' });
  const [sql, params] = query.mock.calls[0];
  expect(sql).toContain('FROM PAGO pg');
  expect(sql).toContain('pg.titular_snapshot');
  expect(sql).not.toContain('id_residente');
  expect(params).toEqual(['2026-10-01', '2026-10-14']);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await reports.excel('pagos', [{ fecha: '2026-10-01', id_pago: 1, residente: '=CMD()', monto: '12.35' }], 1));
  expect(workbook.worksheets[0].getCell('C6').value).toBe("'=CMD()");
  expect(workbook.worksheets[0].getCell('F6').value).toBe(12.35);
  const pdf = await reports.pdf('pagos', [], 1);
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
});

test('HU29 filtra reservas antes del límite usando parámetros y registra filtros en Excel', async () => {
  await reports.rows('reservas', { estado: 'CONFIRMADA', amenidad: 'Salón', usuario: "Ana' OR 1=1 --" });
  const [sql, params] = query.mock.calls[0];
  expect(sql).toContain('reporte.estado = ? AND reporte.amenidad LIKE ? AND reporte.usuario LIKE ?');
  expect(sql).not.toContain("Ana'");
  expect(params).toEqual(['CONFIRMADA', '%Salón%', "%Ana' OR 1=1 --%"]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await reports.excel('reservas', [], 1, { estado: 'CONFIRMADA', amenidad: 'Salón' }));
  expect(workbook.worksheets[0].getCell('A4').value).toBe('Estado de reserva: CONFIRMADA');
  for (const input of [{ estado: 'APROBADA' }, { amenidad: ['A'] }, { usuario: 'a'.repeat(151) }])
    expect(() => reports.validateFilters(input, 'reservas')).toThrow();
});
