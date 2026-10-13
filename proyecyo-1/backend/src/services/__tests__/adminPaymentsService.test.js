jest.mock("../../database/mysql", () => ({
  query: jest.fn(),
}));

const { query } = require("../../database/mysql");
const { listDelinquentResidents } = require("../adminPaymentsService");

describe("adminPaymentsService.listDelinquentResidents", () => {
  beforeEach(() => {
    query.mockReset();
  });

  it("mapea las filas devueltas por la base de datos al formato esperado", async () => {
    query.mockResolvedValueOnce([
      {
        id_casa: "3",
        unidad: "A-101",
        propietario_nombre: "Juan Perez",
        propietario_correo: "juan@test.com",
        propietario_actual:null,id_responsable:null,
        monto_pendiente: "1200.50",
        fecha_limite: "2026-01-15",
        estado: "MOROSO",
      },
    ]);

    const result = await listDelinquentResidents();

    expect(result).toEqual([
      {
        id_casa: 3,
        unidad: "A-101",
        propietario_nombre: "Juan Perez",
        propietario_correo: "juan@test.com",
        monto_pendiente: 1200.5,
        propietario_actual:null,id_responsable:null,
        recargo_aplicado: 0,
        recargo_pendiente: 0, sobrepago: 0, requiere_revision: false,
        total_pendiente: 1200.5,
        fecha_limite: "2026-01-15",
        estado: "MOROSO",
      },
    ]);
  });

  it("no agrega condiciones extra al WHERE cuando no hay filtros", async () => {
    query.mockResolvedValueOnce([]);

    await listDelinquentResidents({});

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("WHERE 1 = 1");
    expect(params).toEqual([]);
  });

  it("agrega el filtro de busqueda sobre nombre, correo historico y unidad", async () => {
    query.mockResolvedValueOnce([]);

    await listDelinquentResidents({ search: "Perez" });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("resumen.propietario_nombre");
    expect(sql).toContain("resumen.propietario_correo");
    expect(sql).toContain("resumen.unidad");
    expect(params).toEqual(["%perez%", "%perez%", "%perez%"]);
  });

  it("agrega el filtro de estado cuando es valido", async () => {
    query.mockResolvedValueOnce([]);

    await listDelinquentResidents({ estado: "moroso" });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("resumen.estado = ?");
    expect(params).toEqual(["MOROSO"]);
  });

  it("ignora el filtro de estado cuando viene TODOS", async () => {
    query.mockResolvedValueOnce([]);

    await listDelinquentResidents({ estado: "TODOS" });

    const [, params] = query.mock.calls[0];
    expect(params).toEqual([]);
  });

  it("lanza un error 400 cuando el filtro de estado es invalido", async () => {
    await expect(listDelinquentResidents({ estado: "INVALIDO" })).rejects.toMatchObject({
      status: 400,
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("agrega el filtro de fecha limite cuando tiene formato valido", async () => {
    query.mockResolvedValueOnce([]);

    await listDelinquentResidents({ date: "2026-03-01" });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("resumen.fecha_limite = ?");
    expect(params).toEqual(["2026-03-01"]);
  });

  it("ignora fechas con formato invalido", async () => {
    query.mockResolvedValueOnce([]);

    await listDelinquentResidents({ date: "01-03-2026" });

    const [, params] = query.mock.calls[0];
    expect(params).toEqual([]);
  });
});
