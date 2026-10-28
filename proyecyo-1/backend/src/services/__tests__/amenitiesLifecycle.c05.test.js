const mockConnection = {
  beginTransaction: jest.fn(), execute: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
};
jest.mock("../../database/mysql", () => ({
  query: jest.fn(), pool: { getConnection: jest.fn(async () => mockConnection) },
}));
jest.mock("../auditService", () => ({ recordAudit: jest.fn(async () => {}) }));
const { recordAudit } = require("../auditService");
const { createAmenityReservation, adminCancelAmenityReservation, cancelAmenityReservation } = require("../amenitiesReservationsService");

const current = {
  id_usuario: 7, id_amenidad: 2, amenidad_nombre: "Piscina", usuario_nombre: "Ana",
  fecha: "2099-01-10", hora_inicio: "10:00", hora_fin: "11:00", estado: "CONFIRMADA",
};
const payload = { id_amenidad: 2, fecha: current.fecha, hora_inicio: "10:00", hora_fin: "11:00" };
beforeEach(() => {
  jest.clearAllMocks();
  mockConnection.execute.mockImplementation(async (sql, params) => {
    if (sql.includes("FROM USUARIO u")) return [[{ id_usuario: 7, nombre: "Ana", rol: "inquilino", unidad: "B-302" }]];
    if (sql.includes("FROM AMENIDAD") && sql.includes("WHERE id_amenidad")) return [[{
      id_amenidad: 2, nombre: "Piscina", hora_apertura: "08:00", hora_cierre: "20:00", intervalo_minutos: 60, activo: 1,
    }]];
    if (sql.includes("FROM RESERVA r") && sql.includes("r.id_usuario = ?")) {
      // Simulate the owner predicate used by the real change query.
      return [params.length === 5 && params[4] !== 7 ? [] : [current]];
    }
    if (sql.includes("SELECT nombre FROM USUARIO")) return [[{ nombre: "Admin" }]];
    if (sql.includes("UPDATE RESERVA")) return [{ affectedRows: 1 }];
    return [[]];
  });
});

test.each(["residente", "inquilino"])("HU-C05.11 registra también la creación propia de %s", async (role) => {
  await createAmenityReservation({ id: 7, role }, payload);
  const history = mockConnection.execute.mock.calls.find(([sql]) => sql.includes("INSERT INTO HISTORIAL_RESERVA"));
  expect(history).toBeDefined();
  expect(history[1][11]).toBe("CREACION");
  expect(history[1][14]).toBe(7);
  expect(history[1][16]).toBe(role);
  expect(history[1][9]).toBeNull();
  expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "RESERVATION_CREATED", userId: 7 }), expect.any(Function));
  expect(mockConnection.commit).toHaveBeenCalledTimes(1);
});

test("HU-C05.5 la respuesta de cancelación incluye el instante guardado en MySQL", async () => {
  mockConnection.execute.mockImplementation(async (sql) => {
    if (sql.includes("FROM RESERVA r")) return [[current]];
    if (sql.includes("SELECT nombre FROM USUARIO")) return [[{ nombre: "Admin" }]];
    if (sql.includes("UPDATE RESERVA")) return [{ affectedRows: 1 }];
    if (sql.includes("FROM RESERVA") && sql.includes("cancelada_en")) return [[{ cancelada_en: "2026-10-27 18:00:00" }]];
    return [[]];
  });
  const result = await adminCancelAmenityReservation({ id: 1, role: "admin" }, "7-2-2099-01-10-10:00", { motivo: "Mantenimiento" });
  expect(result).toMatchObject({ estado: "CANCELADA", cancelada_en: "2026-10-27 18:00:00", motivo_cancelacion: "Mantenimiento" });
});

test.each(["residente", "inquilino"])("HU-C05.12 %s no cancela la reserva ajena ni escribe historial", async (role) => {
  await expect(cancelAmenityReservation({ id: 99, role }, "7-2-2099-01-10-10:00")).rejects.toMatchObject({ status: 404 });
  expect(mockConnection.execute.mock.calls.some(([sql]) => sql.includes("UPDATE RESERVA"))).toBe(false);
  expect(recordAudit).not.toHaveBeenCalled();
  expect(mockConnection.rollback).toHaveBeenCalledTimes(1);
});

test("HU-C05.11 un fallo de auditoría revierte la creación y no confirma", async () => {
  recordAudit.mockRejectedValueOnce(new Error("Audit unavailable"));
  await expect(createAmenityReservation({ id: 7, role: "residente" }, payload)).rejects.toThrow("Audit unavailable");
  expect(mockConnection.rollback).toHaveBeenCalledTimes(1);
  expect(mockConnection.commit).not.toHaveBeenCalled();
  expect(mockConnection.release).toHaveBeenCalledTimes(1);
});
