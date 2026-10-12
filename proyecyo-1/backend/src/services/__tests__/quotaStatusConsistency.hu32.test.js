// HU32: una misma cuota no puede aparecer "Vencida" en Mis pagos y "Pendiente" en
// Cargos y pagos. Ambas vistas (y la cuenta del inquilino) usan quotaStatus.
jest.mock("../../database/mysql", () => ({ query: jest.fn() }));
jest.mock('../contractFinancialAccount',()=>({account:jest.fn(async()=>null),detail:jest.fn(async()=>null)}));
const { query } = require("../../database/mysql");
const { listResidentAccountStatement } = require("../residentAccountService");
const { getFinancialDetail } = require("../residentFinancialDetailService");
const tenant = require("../tenantAccountService").__private__;
const { getQuotaStatus } = require("../quotaStatus");

// 05:30 UTC del 2026-10-05 = 23:30 del 2026-10-04 en Guatemala: "hoy" es el 04.
const NOW = new Date("2026-10-05T05:30:00Z");
const TODAY_GT = "2026-10-04";

// Misma cuota, mismos datos; cada vista la recibe con la forma de su SQL.
const QUOTAS = [
  { id_cuota: 1, caso: "pendiente con vencimiento futuro", monto: "100.00", recargo: "0", pagado: "0", fecha_limite: "2026-10-31", esperado: "PENDIENTE" },
  { id_cuota: 2, caso: "vence hoy en Guatemala (ya es manana en UTC)", monto: "100.00", recargo: "0", pagado: "0", fecha_limite: TODAY_GT, esperado: "PENDIENTE" },
  { id_cuota: 3, caso: "pendiente vencida", monto: "100.00", recargo: "0", pagado: "0", fecha_limite: "2026-09-30", esperado: "VENCIDA" },
  { id_cuota: 4, caso: "pagada aunque su fecha ya paso", monto: "100.00", recargo: "0", pagado: "100.00", fecha_limite: "2026-09-01", esperado: "PAGADA" },
  { id_cuota: 5, caso: "vencida con recargo aplicado", monto: "400.00", recargo: "20.00", pagado: "0", fecha_limite: "2026-09-25", esperado: "VENCIDA" },
  { id_cuota: 6, caso: "con recargo, el pago no cubre capital + recargo", monto: "100.00", recargo: "10.00", pagado: "100.00", fecha_limite: "2026-09-01", esperado: "VENCIDA" },
  { id_cuota: 7, caso: "capital y recargo pagados", monto: "100.00", recargo: "10.00", pagado: "110.00", fecha_limite: "2026-09-01", esperado: "PAGADA" },
  { id_cuota: 8, caso: "abono parcial con vencimiento futuro", monto: "100.00", recargo: "0", pagado: "40.00", fecha_limite: "2026-10-31", esperado: "PENDIENTE" },
];

const accountRows = () => QUOTAS.map(({ caso, esperado, pagado, ...row }) => ({
  ...row, id_casa: 1, numero: "101", torre: "H", servicio: caso, tipo_servicio: "Mantenimiento", total_pagado: pagado, total_reembolsado: "0",
}));
const detailRows = () => QUOTAS.map(({ caso, esperado, ...row }) => ({ ...row, servicio: caso, reembolsado: "0" }));

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] }).setSystemTime(NOW);
  query.mockReset().mockResolvedValue([]);
});
afterEach(() => jest.useRealTimers());

async function statusesByView() {
  query.mockResolvedValueOnce(accountRows());
  const account = await listResidentAccountStatement(1);
  query.mockReset().mockResolvedValue([])
    .mockResolvedValueOnce([{ id_casa: 1, numero: "101", torre: "H" }])
    .mockResolvedValueOnce(detailRows());
  const detail = await getFinancialDetail(1);
  const by = (list) => Object.fromEntries(list.map((q) => [Number(q.id_cuota), q]));
  return { account: by(account.cuotas), detail: by(detail.cargos) };
}

describe("HU32 estado de cuota coherente entre Mis pagos y Cargos y pagos", () => {
  test.each(QUOTAS)("cuota $id_cuota ($caso): ambas vistas muestran $esperado", async ({ id_cuota, esperado }) => {
    const { account, detail } = await statusesByView();
    expect(account[id_cuota].estado).toBe(esperado);
    expect(detail[id_cuota].estado).toBe(esperado);
    expect(detail[id_cuota].saldo).toBe(account[id_cuota].saldo_pendiente);
  });

  test("el recargo no reclasifica la cuota: solo el saldo y la fecha de Guatemala deciden", async () => {
    const { account, detail } = await statusesByView();
    // Pagado = monto base, pero con recargo queda saldo (el pago cubre primero el
    // recargo, regla canonica): no puede figurar como pagada.
    expect([account[6].estado, detail[6].estado]).toEqual(["VENCIDA", "VENCIDA"]);
    expect(detail[6]).toMatchObject({ saldo: 10, recargo_pendiente: 0, capital_pendiente: 10, pago_parcial: true });
    // Cubierto capital + recargo: pagada en ambas.
    expect([account[7].estado, detail[7].estado]).toEqual(["PAGADA", "PAGADA"]);
  });

  test("el abono parcial es un dato aparte y no sustituye el estado", async () => {
    const { detail } = await statusesByView();
    expect(detail[8]).toMatchObject({ estado: "PENDIENTE", pago_parcial: true });
    expect(detail[3]).toMatchObject({ estado: "VENCIDA", pago_parcial: false });
  });

  test("la cuenta del inquilino aplica la misma regla", () => {
    for (const { id_cuota, esperado, pagado, ...row } of QUOTAS) {
      expect([id_cuota, tenant.getQuotaStatus({ ...row, total_pagado: pagado }, TODAY_GT)]).toEqual([id_cuota, esperado]);
    }
  });

  test("la fecha de negocio es la de Guatemala, no la fecha UTC", () => {
    expect(getQuotaStatus({ saldo: 100, fecha_limite: TODAY_GT })).toBe("PENDIENTE");
    // Si se usara la fecha UTC (2026-10-05) la cuota que vence "hoy" saldria vencida.
    expect(getQuotaStatus({ saldo: 100, fecha_limite: TODAY_GT }, "2026-10-05")).toBe("VENCIDA");
  });

  test("sin fecha limite no se clasifica como vencida", () => {
    expect(getQuotaStatus({ saldo: 5, fecha_limite: null }, TODAY_GT)).toBe("PENDIENTE");
    expect(getQuotaStatus({ saldo: 0, fecha_limite: null }, TODAY_GT)).toBe("PAGADA");
  });
});
