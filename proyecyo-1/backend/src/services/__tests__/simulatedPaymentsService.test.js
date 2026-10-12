const mockConnection = { beginTransaction: jest.fn(), execute: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn() };
jest.mock("../../database/mysql", () => ({ pool: { getConnection: jest.fn(async () => mockConnection) } }));
const { payObligation } = require("../simulatedPaymentsService");

const quota = { id_cuota: 3, id_casa: 8, monto: "100.00", recargo: "15.00", pagado: "0", concepto: "Mantenimiento", fecha_limite: "2026-08-31" };

beforeEach(() => { jest.clearAllMocks(); mockConnection.execute.mockReset(); });

function successfulPayment() {
  mockConnection.execute
    .mockResolvedValueOnce([[quota]])
    .mockResolvedValueOnce([[{ recargo: quota.recargo, pagado: quota.pagado }]])
    .mockResolvedValueOnce([[]])
    .mockResolvedValueOnce([{ insertId: 21 }])
    .mockResolvedValueOnce([{ affectedRows:1 }])
    .mockResolvedValueOnce([{ insertId: 31 }])
    .mockResolvedValueOnce([{ affectedRows: 1 }]);
}

test("registra un pago residente con monto y recargo calculados en backend", async () => {
  successfulPayment();
  const result = await payObligation(4, "residente", 3);
  expect(result).toMatchObject({ id_pago: 21, total: 115, recargo: 15, estado: "APROBADA" });
  expect(mockConnection.execute.mock.calls[3][1]).toEqual([3, 115]);
  expect(mockConnection.execute.mock.calls[4][0]).toContain('titular_snapshot');
  expect(mockConnection.execute.mock.calls[5][1]).toEqual([21, 4, 8, "residente", "Mantenimiento", 115]);
  expect(mockConnection.execute.mock.calls[6][0]).toContain("'SIMULADO', 'academic'");
  expect(mockConnection.commit).toHaveBeenCalledTimes(1);
});

test("un inquilino autorizado reutiliza el mismo flujo", async () => {
  successfulPayment();
  const result = await payObligation(9, "inquilino", 3);
  expect(result.estado).toBe("APROBADA");
  expect(mockConnection.execute.mock.calls[0][0]).toContain('cu.id_responsable=actor.id_usuario');
  expect(mockConnection.execute.mock.calls[5][1][3]).toBe("inquilino");
});

test("rechaza al inquilino sin relación autorizada", async () => {
  mockConnection.execute.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[{ id_cuota: 3 }]]);
  await expect(payObligation(9, "inquilino", 3)).rejects.toMatchObject({ status: 403 });
});

test("rechaza un cargo inexistente", async () => {
  mockConnection.execute.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]]);
  await expect(payObligation(4, "residente", 99)).rejects.toMatchObject({ status: 404 });
  expect(mockConnection.rollback).toHaveBeenCalled();
});

test("rechaza un cargo de otra vivienda", async () => {
  mockConnection.execute.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[{ id_cuota: 3 }]]);
  await expect(payObligation(4, "residente", 3)).rejects.toMatchObject({ status: 403 });
});

test("rechaza un cargo pagado y un segundo intento", async () => {
  mockConnection.execute.mockResolvedValue([[{ ...quota, pagado: "115.00" }]]);
  await expect(payObligation(4, "residente", 3)).rejects.toMatchObject({ status: 409 });
  await expect(payObligation(4, "residente", 3)).rejects.toMatchObject({ status: 409 });
});

test("un error de persistencia revierte la transacción sin confirmarla", async () => {
  mockConnection.execute.mockResolvedValueOnce([[quota]]).mockResolvedValueOnce([[{ recargo: 15, pagado: 0 }]])
    .mockResolvedValueOnce([[]])
    .mockResolvedValueOnce([{ insertId: 21 }]).mockRejectedValueOnce(new Error("db"));
  await expect(payObligation(4, "residente", 3)).rejects.toThrow("db");
  expect(mockConnection.rollback).toHaveBeenCalledTimes(1);
  expect(mockConnection.commit).not.toHaveBeenCalled();
});

test("rechaza un sobrepago previo sin modificar el historial", async () => {
  mockConnection.execute.mockResolvedValueOnce([[quota]]).mockResolvedValueOnce([[{ recargo: 15, pagado: 120 }]]);
  await expect(payObligation(4, "residente", 3)).rejects.toMatchObject({ status: 409, code: "FINANCIAL_OVERPAYMENT" });
  expect(mockConnection.execute).toHaveBeenCalledTimes(2);
  expect(mockConnection.commit).not.toHaveBeenCalled();
});
test("cobra solo el saldo pendiente despues de aplicar abonos a recargos", async () => {
  mockConnection.execute.mockResolvedValueOnce([[quota]]).mockResolvedValueOnce([[{ recargo: 15, pagado: 50 }]])
    .mockResolvedValueOnce([[]])
    .mockResolvedValueOnce([{ insertId: 21 }]).mockResolvedValueOnce([{ insertId: 31 }]).mockResolvedValueOnce([{ affectedRows: 1 }]);
  expect((await payObligation(4, "residente", 3)).total).toBe(65);
});
test("fallo al registrar el origen revierte tambien PAGO y la simulacion", async () => {
  mockConnection.execute.mockResolvedValueOnce([[quota]])
    .mockResolvedValueOnce([[{ recargo: 15, pagado: 0 }]])
    .mockResolvedValueOnce([[]])
    .mockResolvedValueOnce([{ insertId: 21 }]).mockResolvedValueOnce([{ insertId: 31 }])
    .mockRejectedValueOnce(new Error("origin failure"));
  await expect(payObligation(4, "residente", 3)).rejects.toThrow("origin failure");
  expect(mockConnection.rollback).toHaveBeenCalledTimes(1);
  expect(mockConnection.commit).not.toHaveBeenCalled();
});

test("lee abonos despues de bloquear la cuota para evitar agregados obsoletos", async () => {
  successfulPayment();
  await payObligation(4, "residente", 3);
  expect(mockConnection.execute.mock.calls[0][0]).toContain("FOR UPDATE");
  expect(mockConnection.execute.mock.calls[0][0]).not.toContain("SUM(monto_pagado)");
  expect(mockConnection.execute.mock.calls[1][0]).toContain("SUM(monto_pagado)");
});

test.each(["CREADO", "PENDIENTE", "INCIERTO"])("bloquea la simulacion con checkout %s antes de insertar PAGO", async (estado) => {
  mockConnection.execute.mockResolvedValueOnce([[quota]])
    .mockResolvedValueOnce([[{ recargo: 15, pagado: 0 }]])
    .mockResolvedValueOnce([[{ id_checkout: 1, estado }]]);
  await expect(payObligation(4, "residente", 3)).rejects.toMatchObject({ code: "CHECKOUT_SIMULATION_BLOCKED", status: 409 });
  expect(mockConnection.execute.mock.calls.some(([sql]) => /INSERT INTO PAGO/.test(sql))).toBe(false);
  expect(mockConnection.rollback).toHaveBeenCalled();
});
