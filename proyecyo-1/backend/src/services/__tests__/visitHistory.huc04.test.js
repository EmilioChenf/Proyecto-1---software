jest.mock("../../database/mysql", () => ({ query: jest.fn(), pool: { getConnection: jest.fn() } }));
jest.mock("../configurationService", () => ({ assertVisitTimesAllowed: jest.fn(), getVisitScheduleConfig: jest.fn() }));

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

describe("HU-C04.3 identidad historica", () => {
  const payload = { ...visit, nombre: "Nombre corregido", tipo_visita: "VISITA" };

  it("crear una visita con datos nuevos no modifica al visitante historico", async () => {
    connection.execute.mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ insertId: 10 }]).mockResolvedValueOnce([{ insertId: 42 }]);
    query.mockResolvedValueOnce([{ ...visit, id_acceso: 42, id_visitante: 10 }]);
    await visits.createVisit(1, "residente", payload);
    expect(connection.execute.mock.calls[0][1]).toEqual([payload.nombre, payload.dpi, payload.placa]);
    expect(connection.execute.mock.calls.some(([sql]) => /UPDATE VISITANTE/i.test(sql))).toBe(false);
    expect(connection.execute.mock.calls[2][1][0]).toBe(10);
  });

  it("editar una visita autorizada conserva la identidad de otras visitas", async () => {
    query.mockResolvedValueOnce([visit]).mockResolvedValueOnce([{ ...visit, nombre: payload.nombre, id_visitante: 10 }]);
    connection.execute.mockResolvedValueOnce([[visit]]).mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ insertId: 10 }]).mockResolvedValueOnce([{ affectedRows: 1 }]);
    await expect(visits.updateVisit(1, "residente", 41, payload)).resolves.toMatchObject({ id_visitante: 10 });
    expect(connection.execute.mock.calls.some(([sql]) => /UPDATE VISITANTE/i.test(sql))).toBe(false);
    expect(connection.execute.mock.calls[3][1][0]).toBe(10);
  });

  it("una entrada o cancelacion concurrente impide editar la evidencia", async () => {
    query.mockResolvedValueOnce([visit]);
    connection.execute.mockResolvedValueOnce([[{ ...visit, estado_acceso: "CANCELADA" }]]);
    await expect(visits.updateVisit(1, "residente", 41, payload)).rejects.toMatchObject({ status: 409 });
    expect(connection.execute).toHaveBeenCalledTimes(1);
    expect(connection.rollback).toHaveBeenCalled();
  });

  it("un registro historico impide editar aunque el estado sea AUTORIZADA", async () => {
    query.mockResolvedValueOnce([visit]);
    connection.execute.mockResolvedValueOnce([[visit]]).mockResolvedValueOnce([[{ id_registro: 70 }]]);
    await expect(visits.updateVisit(1, "residente", 41, payload)).rejects.toMatchObject({ code: "VISIT_HAS_HISTORY" });
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it("los accesos especiales tampoco reescriben visitantes anteriores", async () => {
    const { createSpecialAccess } = require("../specialAccessesService");
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...visit, id_acceso: 42 }]);
    connection.execute.mockResolvedValueOnce([[]]).mockResolvedValueOnce([{ insertId: 10 }])
      .mockResolvedValueOnce([{ insertId: 42 }]).mockResolvedValueOnce([[{ casa: "A-1" }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce([[]]);
    await createSpecialAccess(1, { ...payload, id_casa: 1, motivo_excepcion: "Servicio urgente" });
    expect(connection.execute.mock.calls[0][1]).toEqual([payload.nombre, payload.dpi, payload.placa]);
    expect(connection.execute.mock.calls.some(([sql]) => /UPDATE VISITANTE/i.test(sql))).toBe(false);
    expect(connection.execute.mock.calls[2][1][0]).toBe(10);
  });
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

describe("HU-C04.2 cancelacion logica", () => {
  it.each(["AUTORIZADA", "INGRESO_REGISTRADO", "SALIDA_REGISTRADA"])(
    "cancela desde %s conservando los movimientos y el estado anterior en auditoria", async (estado_acceso) => {
      const original = { ...visit, estado_acceso, hora_salida: "13:00" };
      connection.execute.mockResolvedValueOnce([[original]]).mockResolvedValue([{ affectedRows: 1 }]);
      // Notificacion a guardias, luego consulta de respuesta.
      query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...original, estado_acceso: "CANCELADA" }]);
      await expect(visits.cancelVisit(1, "residente", 41)).resolves.toMatchObject({
        id_acceso: 41, estado_acceso: "CANCELADA", hora_salida: "13:00",
      });
      const audit = connection.execute.mock.calls.find(([sql]) => sql.includes("INSERT INTO AUDITORIA"));
      expect(audit[1][1]).toBe("VISIT_CANCELLED");
      expect(JSON.parse(audit[1][4])).toMatchObject({ estado_acceso });
      expect(JSON.parse(audit[1][5])).toMatchObject({ estado_acceso: "CANCELADA" });
      expect(connection.execute.mock.calls.some(([sql]) => /DELETE|UPDATE REGISTRO_ACCESO|UPDATE VISITANTE/i.test(sql))).toBe(false);
      expect(connection.commit).toHaveBeenCalled();
    },
  );

  it("un error al auditar revierte la cancelacion", async () => {
    connection.execute.mockResolvedValueOnce([[visit]]).mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(visits.cancelVisit(1, "residente", 41)).rejects.toThrow("audit unavailable");
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it.each(["CANCELADA", "RECHAZADA"])("no reactiva ni vuelve a cancelar %s", async (estado_acceso) => {
    connection.execute.mockResolvedValueOnce([[{ ...visit, estado_acceso }]]);
    await expect(visits.cancelVisit(1, "residente", 41)).rejects.toMatchObject({ status: 409 });
    expect(connection.execute).toHaveBeenCalledTimes(1);
  });

  it("una cancelacion ajena no altera la visita", async () => {
    connection.execute.mockResolvedValueOnce([[]]);
    await expect(visits.cancelVisit(7, "inquilino", 41)).rejects.toMatchObject({ status: 404 });
    expect(connection.execute.mock.calls[0][1]).toEqual([41, 1, 7]);
    expect(connection.commit).not.toHaveBeenCalled();
  });
});
