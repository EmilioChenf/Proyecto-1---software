jest.mock("../../database/mysql", () => ({ query: jest.fn(), pool: { getConnection: jest.fn() } }));
const houses = require("../housesService");
const { validateHousePayload, selectionEligibility, duplicateError } = houses.__private__;

// Conexion simulada: responde segun el SQL ejecutado (sin MySQL real).
function connection(handlers) {
  const calls = [];
  return {
    calls,
    execute: jest.fn(async (sql, params) => {
      calls.push([sql.replace(/\s+/g, " ").trim(), params]);
      for (const [pattern, result] of handlers) if (pattern.test(sql)) return typeof result === "function" ? result(params) : result;
      return [[]];
    }),
  };
}

describe("validateHousePayload", () => {
  test("normaliza y guarda el precio como DECIMAL exacto (centavos), no float", () => {
    expect(validateHousePayload({ numero: " 302 ", torre: " B ", precio: "125000.1", banos: "2.5", niveles: "2", mapa_fila: "1", mapa_columna: "3" }))
      .toMatchObject({ numero: "302", torre: "B", precio: "125000.10", banos: "2.50", niveles: 2, mapa_fila: 1, mapa_columna: 3, modelo: null, habitaciones: null });
  });

  test.each([
    [{ numero: "" }, /obligatorio/],
    [{ numero: "1", precio: "-1" }, /mayor o igual a 0/],
    [{ numero: "1", precio: "1.234" }, /2 decimales/],
    [{ numero: "1", area_construccion: "abc" }, /area de construccion/],
    [{ numero: "1", habitaciones: "2.5" }, /entero/],
    [{ numero: "1", banos: "1.3" }, /medios/],
    [{ numero: "1", niveles: 9 }, /entre 1 y 5/],
    [{ numero: "1", mapa_fila: 1 }, /fila y columna/],
    [{ numero: "1", mapa_fila: 0, mapa_columna: 1 }, /entre 1 y 30/],
    [{ numero: "12345678901" }, /10 caracteres/],
  ])("rechaza %j", (payload, message) => {
    expect(() => validateHousePayload(payload)).toThrow(message);
    try { validateHousePayload(payload); } catch (error) { expect(error.status).toBe(400); }
  });
});

describe("estado y elegibilidad", () => {
  test("una sola regla: OCUPADA con residente, DISPONIBLE sin residente", () => {
    expect(houses.houseStatus({ id_residente: 4 })).toBe("OCUPADA");
    expect(houses.houseStatus({ id_residente: null })).toBe("DISPONIBLE");
  });

  const free = { activo: true, estado: "DISPONIBLE", residente: null };
  const taken = { activo: true, estado: "OCUPADA", residente: { id_usuario: 7 } };
  test("residente: disponibles y su propia vivienda; nunca inactivas", () => {
    expect(selectionEligibility(free, "residente", {}).elegible).toBe(true);
    expect(selectionEligibility(taken, "residente", {})).toEqual({ elegible: false, motivo: "Ocupada por otro residente." });
    expect(selectionEligibility(taken, "residente", { residentUserId: 7 }).elegible).toBe(true);
    expect(selectionEligibility({ ...free, activo: false }, "residente", {}).elegible).toBe(false);
  });
  test("inquilino: solo ocupadas y activas", () => {
    expect(selectionEligibility(taken, "inquilino", {}).elegible).toBe(true);
    expect(selectionEligibility(free, "inquilino", {}).motivo).toMatch(/ocupada/);
    expect(selectionEligibility({ ...taken, activo: false }, "inquilino", {}).elegible).toBe(false);
  });
});

describe("asignacion bajo bloqueo (el backend es la autoridad)", () => {
  const lockRow = (row) => [/FROM CASA WHERE id_casa = \? FOR UPDATE/, [[{ id_casa: 5, numero: "1", torre: "A", activo: 1, ...row }]]];

  test("vivienda disponible: bloquea, revalida y ocupa con UPDATE condicional", async () => {
    const conn = connection([lockRow({ id_residente: null }), [/UPDATE CASA SET id_residente = \?/, [{ affectedRows: 1 }]]]);
    await houses.assignResidentToHouse(conn, 9, 5);
    expect(conn.calls[0][0]).toMatch(/FOR UPDATE/);
    expect(conn.calls.at(-1)[0]).toMatch(/WHERE id_casa = \? AND id_residente IS NULL/);
  });

  test("ocupada por otro (aunque el mapa la mostro libre): 409 VIVIENDA_OCUPADA sin escribir", async () => {
    const conn = connection([lockRow({ id_residente: 3 })]);
    await expect(houses.assignResidentToHouse(conn, 9, 5)).rejects.toMatchObject({ status: 409, code: "VIVIENDA_OCUPADA" });
    expect(conn.calls.some(([sql]) => /^UPDATE CASA/.test(sql))).toBe(false);
  });

  test("si otra transaccion gana la carrera (0 filas afectadas): 409", async () => {
    const conn = connection([lockRow({ id_residente: null }), [/UPDATE CASA SET id_residente = \?/, [{ affectedRows: 0 }]]]);
    await expect(houses.assignResidentToHouse(conn, 9, 5)).rejects.toMatchObject({ status: 409, code: "VIVIENDA_OCUPADA" });
  });

  test("inactiva o inexistente no se asigna", async () => {
    await expect(houses.assignResidentToHouse(connection([lockRow({ id_residente: null, activo: 0 })]), 9, 5)).rejects.toMatchObject({ code: "VIVIENDA_INACTIVA" });
    await expect(houses.assignResidentToHouse(connection([]), 9, 5)).rejects.toMatchObject({ status: 404 });
    await expect(houses.assignResidentToHouse(connection([]), 9, "x")).rejects.toMatchObject({ status: 400 });
  });

  test("al mudarse, la vivienda anterior con historial financiero no se libera", async () => {
    const conn = connection([
      lockRow({ id_residente: null }),
      [/WHERE id_residente = \? AND id_casa <> \?/, [[{ id_casa: 1, numero: "302", torre: "B" }]]],
      [/FROM CUOTA/, [[{ n: 3 }]]],
    ]);
    await expect(houses.assignResidentToHouse(conn, 9, 5)).rejects.toMatchObject({ status: 409, code: "USAR_ASISTENTE_CONTRACTUAL" });
  });

  test("al mudarse, la vivienda anterior con inquilinos no se libera", async () => {
    const conn = connection([
      lockRow({ id_residente: null }),
      [/WHERE id_residente = \? AND id_casa <> \?/, [[{ id_casa: 1, numero: "302", torre: "B" }]]],
      [/FROM CUOTA/, [[{ n: 0 }]]],
      [/FROM INQUILINO_CASA WHERE id_casa/, [[{ n: 1 }]]],
    ]);
    await expect(houses.assignResidentToHouse(conn, 9, 5)).rejects.toMatchObject({ code: "VIVIENDA_CON_INQUILINOS" });
  });

  test("inquilino: solo a vivienda ocupada; reemplaza su vinculo anterior sin crear casas", async () => {
    await expect(houses.assignTenantToHouse(connection([lockRow({ id_residente: null })]), 4, 5)).rejects.toMatchObject({ code: "VIVIENDA_NO_ELEGIBLE" });
    const conn = connection([lockRow({ id_residente: 3 })]);
    await houses.assignTenantToHouse(conn, 4, 5);
    const sql = conn.calls.map(([s]) => s);
    expect(sql.some((s) => /DELETE FROM INQUILINO_CASA WHERE id_inquilino = \? AND id_casa <> \?/.test(s))).toBe(true);
    expect(sql.some((s) => /INSERT IGNORE INTO INQUILINO_CASA/.test(s))).toBe(true);
    expect(sql.some((s) => /INSERT INTO CASA|UPDATE CASA/.test(s))).toBe(false);
  });
});

describe("errores de unicidad", () => {
  test("ER_DUP_ENTRY se traduce a 409 con el motivo", () => {
    expect(duplicateError({ code: "ER_DUP_ENTRY", message: "Duplicate entry for key 'CASA.uq_casa_mapa'" })).toMatchObject({ status: 409, code: "POSICION_DUPLICADA" });
    expect(duplicateError({ code: "ER_DUP_ENTRY", message: "Duplicate entry for key 'CASA.uq_casa_codigo'" })).toMatchObject({ status: 409, code: "CODIGO_DUPLICADO" });
    const other = new Error("x");
    expect(duplicateError(other)).toBe(other);
  });
});

describe("usersService con viviendas", () => {
  const { query } = require("../../database/mysql");
  const users = require("../usersService");
  beforeEach(() => query.mockReset());

  test("residente o inquilino sin id_casa: 400 antes de tocar la BD", async () => {
    query.mockResolvedValueOnce([{ id: 3, nombre: "residente" }]);
    await expect(users.createUser({ nombre: "A", correo: "a@b.co", password: "1234", id_tipo_usuario: 3, numero_casa: "302", torre: "B" }))
      .rejects.toMatchObject({ status: 400, message: expect.stringMatching(/Selecciona una vivienda/) });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
