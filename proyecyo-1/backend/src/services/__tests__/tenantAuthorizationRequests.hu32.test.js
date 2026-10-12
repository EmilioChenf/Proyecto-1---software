const mockConnection = {
  beginTransaction: jest.fn(),
  execute: jest.fn(),
  commit: jest.fn(),
  rollback: jest.fn(),
  release: jest.fn(),
};
jest.mock("../../database/mysql", () => ({ query: jest.fn(), pool: { getConnection: jest.fn(async () => mockConnection) } }));

const { query } = require("../../database/mysql");
const {
  listOwnerAuthorizationRequests,
  resolveOwnerAuthorizationRequest,
} = require("../tenantAuthorizationRequestsService");

const pendingRow = { id_solicitud: 4, estado: "PENDIENTE", accion: "Mudanza", id_inquilino_usuario: 21 };

describe("HU32 solicitudes de autorización del inquilino", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    query.mockReset();
    mockConnection.execute.mockReset();
  });

  it("lista solo solicitudes de casas cuyo propietario es el residente autenticado", async () => {
    query.mockResolvedValueOnce([]);
    await listOwnerAuthorizationRequests(3);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INNER JOIN CASA c ON c.id_casa = s.id_casa");
    expect(sql).toContain("LEFT JOIN RESIDENTE r ON r.id_residente = c.id_residente");
    expect(sql).toContain("WHERE r.id_usuario = ? AND s.estado = ?");
    expect(params).toEqual([3, "PENDIENTE"]);
  });

  it("rechaza estados de listado inventados", async () => {
    await expect(listOwnerAuthorizationRequests(3, { estado: "BORRADO" })).rejects.toMatchObject({ status: 400 });
  });

  it("aprueba una solicitud pendiente de su unidad en una transacción y notifica al inquilino", async () => {
    mockConnection.execute
      .mockResolvedValueOnce([[pendingRow]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ insertId: 99 }]);
    query.mockResolvedValueOnce([{ ...pendingRow, motivo: "m", estado: "APROBADO", respuesta: null, inquilino: "Ina", unidad: "B-302" }]);

    const result = await resolveOwnerAuthorizationRequest(3, "4", { decision: "aprobado" });

    expect(mockConnection.beginTransaction).toHaveBeenCalled();
    const [lockSql, lockParams] = mockConnection.execute.mock.calls[0];
    expect(lockSql).toContain("WHERE s.id_solicitud = ? AND r.id_usuario = ?");
    expect(lockSql).toContain("FOR UPDATE");
    expect(lockParams).toEqual([4, 3]);
    expect(mockConnection.execute.mock.calls[1][0]).toContain("WHERE id_solicitud = ? AND estado = 'PENDIENTE'");
    expect(mockConnection.execute.mock.calls[1][1]).toEqual(["APROBADO", null, 4]);
    expect(mockConnection.execute.mock.calls[2][0]).toContain("INSERT INTO NOTIFICACION");
    expect(mockConnection.execute.mock.calls[2][1][0]).toBe(21);
    expect(mockConnection.commit).toHaveBeenCalled();
    expect(mockConnection.release).toHaveBeenCalled();
    expect(result).toMatchObject({ id_solicitud: 4, estado: "APROBADO" });
  });

  it("una solicitud de otra unidad responde 404 y no modifica nada", async () => {
    mockConnection.execute.mockResolvedValueOnce([[]]);
    await expect(resolveOwnerAuthorizationRequest(3, 4, { decision: "APROBADO" })).rejects.toMatchObject({ status: 404 });
    expect(mockConnection.execute).toHaveBeenCalledTimes(1);
    expect(mockConnection.rollback).toHaveBeenCalled();
    expect(mockConnection.commit).not.toHaveBeenCalled();
  });

  it("no permite resolver dos veces (409)", async () => {
    mockConnection.execute.mockResolvedValueOnce([[{ ...pendingRow, estado: "APROBADO" }]]);
    await expect(resolveOwnerAuthorizationRequest(3, 4, { decision: "RECHAZADO", respuesta: "No" })).rejects.toMatchObject({ status: 409 });
    expect(mockConnection.rollback).toHaveBeenCalled();
  });

  it.each([
    [{ decision: "BORRAR" }, 400],
    [{ decision: "RECHAZADO" }, 400],
    [{ decision: "APROBADO", respuesta: "x".repeat(256) }, 400],
  ])("valida la decisión %j antes de abrir transacción", async (payload, status) => {
    await expect(resolveOwnerAuthorizationRequest(3, 4, payload)).rejects.toMatchObject({ status });
    expect(mockConnection.beginTransaction).not.toHaveBeenCalled();
  });

  it("rechaza ids inválidos", async () => {
    await expect(resolveOwnerAuthorizationRequest(3, "abc", { decision: "APROBADO" })).rejects.toMatchObject({ status: 400 });
  });
});
