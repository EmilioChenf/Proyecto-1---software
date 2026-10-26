jest.mock("../../database/mysql", () => ({ query: jest.fn(), pool: { getConnection: jest.fn() } }));
jest.mock("../configurationService", () => ({ assertVisitTimesAllowed: jest.fn() }));

const { query, pool } = require("../../database/mysql");
const visits = require("../visitsService");

const visit = {
  id_acceso: 41, id_visitante: 9, nombre: "Visitante original", dpi: "1234567890101",
  placa: "P-123ABC", casa: "A-1", fecha: "2026-10-26", hora_inicio: "08:00", hora_fin: "18:00",
  token_qr: "qr-history", estado_acceso: "AUTORIZADA",
};
let connection;
beforeEach(() => {
  jest.resetAllMocks();
  jest.useFakeTimers().setSystemTime(new Date("2026-10-26T18:00:00Z"));
  connection = {
    execute: jest.fn(), beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
  };
  pool.getConnection.mockResolvedValue(connection);
  query.mockResolvedValueOnce([{ id_casa: 1 }]);
});
afterEach(() => jest.useRealTimers());

describe("HU-C04.1 eliminacion fisica", () => {
  it.each(["AUTORIZADA", "INGRESO_REGISTRADO", "SALIDA_REGISTRADA", "CANCELADA"])(
    "conserva registros incluso cuando el estado es %s", async (estado_acceso) => {
      connection.execute.mockResolvedValueOnce([[{ ...visit, estado_acceso }]])
        .mockResolvedValueOnce([[{ id_registro: 70 }]]);
      await expect(visits.deleteVisit(1, "residente", 41)).rejects.toMatchObject({ status: 409, code: "VISIT_HAS_HISTORY" });
      expect(connection.execute.mock.calls.some(([sql]) => /DELETE/i.test(sql))).toBe(false);
      expect(connection.execute.mock.calls[0][0]).toContain("FOR UPDATE");
      expect(connection.rollback).toHaveBeenCalled();
      expect(connection.release).toHaveBeenCalled();
    },
  );

  it("permite eliminar antes de registrar movimientos", async () => {
    connection.execute.mockResolvedValueOnce([[visit]]).mockResolvedValueOnce([[]])
      .mockResolvedValue([{ affectedRows: 1 }]);
    await expect(visits.deleteVisit(1, "residente", 41)).resolves.toMatchObject({ id_acceso: 41 });
    expect(connection.commit).toHaveBeenCalled();
    expect(connection.execute.mock.calls.some(([sql]) => /DELETE FROM REGISTRO_ACCESO/i.test(sql))).toBe(false);
  });

  it("eliminar un frecuente no permite borrar indirectamente el historial", async () => {
    query.mockResolvedValueOnce([{ id_visitante: 9, nombre: visit.nombre }]);
    connection.execute.mockResolvedValueOnce([[visit]])
      .mockResolvedValueOnce([[{ id_registro: 70 }]]);
    await expect(visits.deleteFrequentVisitor(1, "inquilino", 9)).rejects.toMatchObject({ code: "VISIT_HAS_HISTORY" });
    expect(connection.execute.mock.calls[0][1]).toEqual([9, 1, 1]);
    expect(connection.execute.mock.calls.some(([sql]) => /DELETE/i.test(sql))).toBe(false);
  });

  it("no elimina visitas de otra vivienda o autorizador", async () => {
    connection.execute.mockResolvedValueOnce([[]]);
    await expect(visits.deleteVisit(7, "inquilino", 41)).rejects.toMatchObject({ status: 404 });
    expect(connection.execute.mock.calls[0][1]).toEqual([41, 1, 7]);
    expect(connection.commit).not.toHaveBeenCalled();
  });
});
