// HU-C06.9: registro de proveedores por rol, identificador, fechas pasadas y QR.
jest.mock("../../database/mysql", () => ({ query: jest.fn(), pool: { getConnection: jest.fn() } }));
jest.mock("../configurationService", () => ({ assertVisitTimesAllowed: jest.fn(async () => ({})) }));
jest.mock("../auditService", () => ({ recordAudit: jest.fn() }));

const { pool, query } = require("../../database/mysql");
const { registerProvider } = require("../tenantProvidersService");
const { getVisitById } = require("../visitsService");
const { approveSpecialAccess, createSpecialAccess } = require("../specialAccessesService");

const FUTURE_DATE = "2099-05-10";

const houseRow = { id_casa: 4, numero: "12", torre: "A", id_residente: 2, propietario_usuario_id: 30, propietario_nombre: "Dueno" };

function accessRow(overrides = {}) {
  return {
    id_acceso: 77,
    id_visitante: 5,
    nombre: "Electricidad Lopez",
    dpi: null,
    placa: "P-123ABC",
    foto: null,
    fecha: FUTURE_DATE,
    hora_inicio: "09:00",
    hora_fin: "11:00",
    hora_salida: null,
    tipo_visita: "PROVEEDOR",
    motivo_servicio: "Electricidad",
    observaciones: null,
    token_qr: "token-proveedor",
    estado_acceso: "AUTORIZADA",
    casa: "A-12",
    ...overrides,
  };
}

/** query falso: responde segun el SQL, como lo haria MySQL para cada consulta. */
function routeQueries({ role = "inquilino", ownerHouses = [houseRow] } = {}) {
  query.mockImplementation(async (sql) => {
    if (sql.includes("FROM INQUILINO i")) return [houseRow];
    if (sql.includes("FROM RESIDENTE r") && sql.includes("ORDER BY c.torre")) return ownerHouses;
    if (sql.includes("FROM CASA c") && sql.includes("WHERE c.id_casa = ?")) return [houseRow];
    if (sql.includes("FROM USUARIO u")) return [{ id_usuario: 21, nombre: "Usuario Prueba", rol: role }];
    if (sql.includes("INSERT INTO HISTORIAL_CAMBIO_PROVEEDOR")) return { insertId: 1 };
    if (sql.includes("FROM CASA_SERVICIO cs")) {
      return [{ id_servicio: 3, id_casa: 4, nombre: "Electricidad Lopez", activo: 1, estado_validacion: role === "inquilino" ? "PENDIENTE" : "VALIDADO", numero: "12", torre: "A" }];
    }
    if (sql.includes("FROM ACCESO a")) return [accessRow()];
    throw new Error(`Consulta no esperada: ${sql.slice(0, 80)}`);
  });
}

function fakeConnection() {
  const connection = {
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
    execute: jest.fn(async (sql) => {
      if (sql.includes("FROM SERVICIO")) return [[]];
      if (sql.includes("INSERT INTO SERVICIO")) return [{ insertId: 3 }];
      if (sql.includes("FROM CASA_SERVICIO")) return [[]];
      if (sql.includes("INSERT INTO CASA_SERVICIO")) return [{ affectedRows: 1 }];
      if (sql.includes("FROM VISITANTE")) return [[]];
      if (sql.includes("INSERT INTO VISITANTE")) return [{ insertId: 5 }];
      if (sql.includes("SELECT id_acceso FROM ACCESO")) return [[]];
      if (sql.includes("INSERT INTO ACCESO")) return [{ insertId: 77 }];
      throw new Error(`SQL no esperado: ${sql.slice(0, 80)}`);
    }),
  };
  pool.getConnection.mockResolvedValue(connection);
  return connection;
}

function providerPayload(overrides = {}) {
  return {
    nombre: "Electricidad Lopez",
    motivo_servicio: "Electricidad",
    medio_ingreso: "VEHICULO",
    placa: "p 123 abc",
    dpi: "",
    fecha: FUTURE_DATE,
    hora_inicio: "09:00",
    hora_fin: "11:00",
    ...overrides,
  };
}

function executedSql(connection, fragment) {
  return connection.execute.mock.calls.find(([sql]) => sql.includes(fragment));
}

beforeEach(() => {
  query.mockReset();
  pool.getConnection.mockReset();
});

describe("HU-C06.1/C06.2 registro de proveedores por rol", () => {
  it.each([
    ["inquilino", "PENDIENTE"],
    ["residente", "VALIDADO"],
    ["admin", "VALIDADO"],
  ])("%s registra el proveedor y su acceso con QR (%s)", async (role, expectedStatus) => {
    routeQueries({ role });
    const connection = fakeConnection();

    const result = await registerProvider({ id: 21, role }, providerPayload({ id_casa: role === "admin" ? 4 : undefined }));

    const link = executedSql(connection, "INSERT INTO CASA_SERVICIO");
    expect(link[1]).toEqual([4, 3, expectedStatus]);
    const access = executedSql(connection, "INSERT INTO ACCESO");
    expect(access[0]).toContain("'PROVEEDOR'");
    expect(access[1].slice(0, 7)).toEqual([5, 4, 21, FUTURE_DATE, "09:00:00", "11:00:00", "Electricidad"]);
    expect(access[1][8]).toMatch(/^[a-f0-9]{36}$/);
    expect(connection.commit).toHaveBeenCalled();
    expect(result.acceso).toMatchObject({ id_acceso: 77, tipo_visita: "PROVEEDOR", medio_ingreso: "VEHICULO" });
    expect(result.acceso.qr_value).toBe("NEXUSVISIT:token-proveedor");
  });

  it("rechaza roles sin permiso (guardia) antes de consultar la base", async () => {
    await expect(registerProvider({ id: 8, role: "guardia" }, providerPayload())).rejects.toMatchObject({ status: 403 });
    expect(query).not.toHaveBeenCalled();
  });

  it("el administrador debe indicar la casa", async () => {
    routeQueries({ role: "admin" });
    await expect(registerProvider({ id: 1, role: "admin" }, providerPayload())).rejects.toMatchObject({
      status: 400,
      message: "Debe seleccionar una casa valida.",
    });
  });

  it("el residente no registra proveedores en una casa ajena", async () => {
    routeQueries({ role: "residente" });
    await expect(
      registerProvider({ id: 30, role: "residente" }, providerPayload({ id_casa: 99 })),
    ).rejects.toMatchObject({ status: 403 });
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  it("no sobrescribe un visitante existente sin confirmacion (HU-C03)", async () => {
    routeQueries();
    const connection = fakeConnection();
    const baseExecute = connection.execute.getMockImplementation();
    connection.execute.mockImplementation(async (sql, params) =>
      sql.includes("FROM VISITANTE")
        ? [[{ id_visitante: 5, nombre: "Otro Nombre", dpi: null, placa: "P-123ABC" }]]
        : baseExecute(sql, params),
    );

    await expect(registerProvider({ id: 21, role: "inquilino" }, providerPayload())).rejects.toMatchObject({
      status: 409,
      code: "VISITOR_DATA_CONFLICT",
    });
    expect(connection.rollback).toHaveBeenCalled();
    expect(executedSql(connection, "INSERT INTO ACCESO")).toBeUndefined();
  });
});

describe("HU-C06.3 a C06.5 identificador valido", () => {
  it.each([
    [{ medio_ingreso: "VEHICULO", placa: "" }, "PROVIDER_PLATE_REQUIRED"],
    [{ medio_ingreso: "PEATONAL", placa: "", dpi: "" }, "PROVIDER_DOCUMENT_REQUIRED"],
    [{ medio_ingreso: "PEATONAL", placa: "", dpi: "12345" }, "INVALID_DPI"],
    [{ medio_ingreso: "AVION" }, "INVALID_ENTRY_MODE"],
    [{ medio_ingreso: "", placa: "", dpi: "" }, "PROVIDER_DOCUMENT_REQUIRED"],
  ])("rechaza %j con %s sin tocar la base", async (overrides, code) => {
    await expect(registerProvider({ id: 21, role: "inquilino" }, providerPayload(overrides))).rejects.toMatchObject({
      status: 400,
      code,
    });
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  it("a pie acepta el DPI como identificador alternativo", async () => {
    routeQueries();
    const connection = fakeConnection();
    await registerProvider(
      { id: 21, role: "inquilino" },
      providerPayload({ medio_ingreso: "PEATONAL", placa: "", dpi: "1234 5678 90123" }),
    );
    expect(executedSql(connection, "INSERT INTO VISITANTE")[1]).toEqual(["Electricidad Lopez", "1234567890123", null]);
  });
});

describe("HU-C06.6/C06.7 fechas pasadas y QR vencido", () => {
  it("bloquea una fecha pasada antes de generar un QR", async () => {
    await expect(
      registerProvider({ id: 21, role: "inquilino" }, providerPayload({ fecha: "2000-01-01" })),
    ).rejects.toMatchObject({ status: 400, code: "VISIT_DATE_IN_PAST" });
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  it("el acceso especial del administrador tambien bloquea fechas pasadas", async () => {
    await expect(
      createSpecialAccess(1, {
        tipo_visita: "PROVEEDOR",
        nombre: "Jardineria",
        motivo_servicio: "Jardin",
        placa: "P-123ABC",
        fecha: "2000-01-01",
        hora_inicio: "09:00",
        hora_fin: "10:00",
        id_casa: 4,
        motivo_excepcion: "Urgente",
      }),
    ).rejects.toMatchObject({ code: "VISIT_DATE_IN_PAST" });
  });

  it("el acceso especial de un proveedor exige su identificador", async () => {
    await expect(
      createSpecialAccess(1, {
        tipo_visita: "PROVEEDOR",
        nombre: "Jardineria",
        medio_ingreso: "VEHICULO",
        placa: "",
        fecha: FUTURE_DATE,
        hora_inicio: "09:00",
        hora_fin: "10:00",
        id_casa: 4,
        motivo_excepcion: "Urgente",
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_PLATE_REQUIRED" });
  });

  it("no entrega qr_value de un acceso vencido", async () => {
    query.mockResolvedValueOnce([accessRow({ fecha: "2000-01-01" })]);
    const expired = await getVisitById(77);
    expect(expired.qr_status).toBe("EXPIRED");
    expect(expired.qr_value).toBeNull();

    query.mockResolvedValueOnce([accessRow()]);
    expect((await getVisitById(77)).qr_value).toBe("NEXUSVISIT:token-proveedor");
  });

  it("aprobar tarde una solicitud vencida no genera QR", async () => {
    query.mockResolvedValueOnce([
      { id_acceso: 9, estado_acceso: "PENDIENTE_APROBACION", fecha: "2000-01-01", hora_inicio: "22:00:00", hora_fin: "23:00:00", visitante: "X", casa: "A-12" },
    ]);
    await expect(approveSpecialAccess(1, 9)).rejects.toMatchObject({ status: 409, code: "QR_WINDOW_EXPIRED" });
    expect(pool.getConnection).not.toHaveBeenCalled();
  });
});
