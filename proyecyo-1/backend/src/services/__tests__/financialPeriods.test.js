jest.mock("../../database/mysql", () => ({ query: jest.fn() }));
jest.mock('../contractFinancialAccount',()=>({...jest.requireActual('../contractFinancialAccount'),detail:jest.fn(async()=>null)}));
const { query } = require("../../database/mysql");
const { getFinancialDetail } = require("../residentFinancialDetailService");
const { listTenantAccountStatement } = require("../tenantAccountService");
const { getMonthlyFinancialReport, listDelinquentResidents } = require("../adminPaymentsService");
beforeEach(() => query.mockReset().mockResolvedValue([]));

test("detalle conserva saldo real con pagos anteriores y movimientos vacios", async () => {
  query.mockResolvedValueOnce([{ id_casa: 1, numero: "1" }])
    .mockResolvedValueOnce([{ id_cuota: 2, monto: "100", recargo: "15", pagado: "115", fecha_limite: "2025-01-01" },
      { id_cuota: 3, monto: "100", recargo: "0", pagado: "0", fecha_limite: "2025-01-01" }])
    .mockResolvedValueOnce([]).mockResolvedValueOnce([]);
  const result = await getFinancialDetail(1, { desde: "2026-08-01", hasta: "2026-08-31" });
  expect(result.resumen).toMatchObject({ saldo_pendiente: 100, total_pagado: 115, total_pagado_periodo: 0 });
  expect(result.cargos[0]).toMatchObject({ saldo: 0, estado: "PAGADA", pago_parcial: false });
  expect(result.pagos).toEqual([]);
  expect(query.mock.calls[1][1]).toEqual([1]);
  expect(query.mock.calls[1][0]).not.toContain("fecha_pago >=");
  expect(query.mock.calls[3][1]).toEqual([1, "2026-08-01", "2026-08-31"]);
});
test("saldo no cruza sobrepagos entre cuotas", async () => {
  query.mockResolvedValueOnce([{ id_casa: 1, numero: "1" }])
    .mockResolvedValueOnce([{ monto: 100, pagado: 120 }, { monto: 100, pagado: 0 }])
    .mockResolvedValueOnce([]).mockResolvedValueOnce([]);
  expect((await getFinancialDetail(1)).resumen).toMatchObject({ saldo_pendiente: 100, sobrepago: 20, requiere_revision: true });
});
test("inquilino mantiene cuotas y pagos acumulados aunque las fechas excluyan movimientos", async () => {
  query.mockResolvedValueOnce([{ id_casa: 1, numero: "1" }])
    .mockResolvedValueOnce([{ id_cuota: 2, monto: 100, recargo: 15, total_pagado: 115, fecha_limite: "2025-01-01" }])
    .mockResolvedValueOnce([]).mockResolvedValueOnce([]);
  const result = await listTenantAccountStatement(1, { desde: "2026-08-01", hasta: "2026-08-31" });
  expect(result.resumen.saldo_pendiente).toBe(0);
  expect(result.pagos).toEqual([]);
  expect(query.mock.calls[1][1]).toEqual([1]);
  expect(query.mock.calls[2][1]).toEqual([1, "2026-08-01", "2026-08-31"]);
});
test("reporte mensual distingue ingresos del mes de saldos y abonos acumulados", async () => {
  query.mockResolvedValueOnce([{ id_casa: 1, monto: 100, recargo: 15, pagado: 115, fecha_limite: "2025-01-01" }])
    .mockResolvedValueOnce([{ id_pago: 7, id_cuota: 4, id_casa: 2, monto_pagado: 20, fecha_pago: "2026-08-10" }]);
  const result = await getMonthlyFinancialReport(8, 2026);
  expect(result.detalle[0]).toMatchObject({ pendiente: 0, pagado: 115, estado: "PAGADO" });
  expect(result.resumen).toMatchObject({ total_cobrado: 20, total_pendiente: 0, cantidad_pagos: 1 });
  expect(query.mock.calls[0][1]).toEqual([]);
  expect(query.mock.calls[1][1]).toEqual(["2026-08-01", "2026-08-01"]);
});
test("administracion suma capital y recargos pendientes sin volver a cobrar recargos pagados", async () => {
  query.mockResolvedValueOnce([{ id_casa: 1, monto_pendiente: "65", recargo_aplicado: "15", recargo_pendiente: "0", estado: "PENDIENTE" }]);
  expect((await listDelinquentResidents())[0]).toMatchObject({ total_pendiente: 65, recargo_aplicado: 15, recargo_pendiente: 0 });
});

test('refund fuera del período reabre saldo pero no inventa movimientos del mes',async()=>{
 query.mockResolvedValueOnce([{id_casa:1}]).mockResolvedValueOnce([{id_cuota:2,monto:'5.00',recargo:'0.00',pagado:'5.00',total_reembolsado:'5.00'}]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
 const result=await getFinancialDetail(1,{desde:'2030-01-01',hasta:'2030-01-02'});
 expect(result.cargos[0]).toMatchObject({saldo:5,pagado:5,reembolsado:5,abono_neto:0,estado:'PENDIENTE'});expect(result.reembolsos).toEqual([]);
 expect(query.mock.calls[1][0]).not.toContain('fecha_contable>=');expect(query.mock.calls[4][1]).toEqual([1,'2030-01-01','2030-01-02']);
});
test('reporte bruto histórico se conserva y distingue devolución/neto del mes',async()=>{
 query.mockResolvedValueOnce([{monto:5,pagado:5,total_reembolsado:5,fecha_limite:'2030-01-01'}]).mockResolvedValueOnce([]).mockResolvedValueOnce([{monto_centavos:500,id_reembolso:1}]);
 const r=await getMonthlyFinancialReport(10,2026);expect(r.resumen).toMatchObject({total_cobrado:0,total_devuelto_periodo:5,cobrado_neto_periodo:-5,total_pendiente:5});
});
