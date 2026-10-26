jest.mock("../../database/mysql", () => ({ query: jest.fn() }));

const { query } = require("../../database/mysql");
const { listGuardDailyAccessHistory, mapGuardHistoryStatus } = require("../sprintStoriesService");

describe("HU32 historial de garita", () => {
  beforeEach(() => query.mockReset());

  it.each([
    [{ estado_acceso: "AUTORIZADA" }, "PENDIENTE"],
    [{ estado_acceso: null }, "PENDIENTE"],
    [{ estado_acceso: "RECHAZADA" }, "RECHAZADA"],
    [{ estado_acceso: "PENDIENTE_APROBACION" }, "PENDIENTE_APROBACION"],
    [{ estado_acceso: "CANCELADA" }, "CANCELADA"],
    [{ estado_acceso: "CANCELADA", hora_ingreso: "09:00", hora_salida: "10:00" }, "CANCELADA"],
    [{ estado_acceso: "AUTORIZADA", vencida: 1 }, "VENCIDA"],
    [{ estado_acceso: "INGRESO_REGISTRADO", hora_ingreso: "09:00" }, "INGRESO"],
    [{ estado_acceso: "SALIDA_REGISTRADA", hora_ingreso: "09:00", hora_salida: "10:00" }, "SALIDA"],
  ])("mapea %j como %s (solo AUTORIZADA sin ingreso es pendiente)", (row, expected) => {
    expect(mapGuardHistoryStatus(row)).toBe(expected);
  });

  it.each([
    ["CANCELADA", "a.estado_acceso = 'CANCELADA'"],
    ["RECHAZADA", "a.estado_acceso = 'RECHAZADA'"],
    ["PENDIENTE_APROBACION", "a.estado_acceso = 'PENDIENTE_APROBACION'"],
    ["PENDIENTE", "COALESCE(a.estado_acceso, 'AUTORIZADA') = 'AUTORIZADA'"],
    ["SALIDA", "ra.hora_salida IS NOT NULL"],
    ["VENCIDA", "TIMESTAMP(a.fecha, COALESCE(a.hora_fin, '23:59:59'))"],
  ])("el filtro %s se aplica en el backend", async (status, fragment) => {
    query.mockResolvedValueOnce([]);
    await listGuardDailyAccessHistory({ date: "2026-10-04", status });
    expect(query.mock.calls[0][0]).toContain(fragment);
    expect(query.mock.calls[0][1]).toEqual(["2026-10-04"]);
  });

  it("devuelve horas de ingreso y salida convertidas desde UTC a Guatemala", async () => {
    query.mockResolvedValueOnce([]);
    await listGuardDailyAccessHistory({ date: "2026-10-04" });
    expect(query.mock.calls[0][0]).toContain("CONVERT_TZ(TIMESTAMP('2000-01-01', ra.hora_ingreso), '+00:00', '-06:00')");
    expect(query.mock.calls[0][0]).toContain("CONVERT_TZ(TIMESTAMP('2000-01-01', ra.hora_salida), '+00:00', '-06:00')");
  });

  it("sin fecha usa el dia de Guatemala, no el dia UTC", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-05T05:30:00Z")); // 23:30 del 4 en Guatemala
    try {
      query.mockResolvedValueOnce([]);
      await listGuardDailyAccessHistory({});
      expect(query.mock.calls[0][1]).toEqual(["2026-10-04"]);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("HU32 visitas recientes de garita", () => {
  const { getGuardShiftVisits } = require("../visitsService");
  beforeEach(() => query.mockReset());

  it("no incluye fechas futuras y usa el dia de Guatemala", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-05T05:30:00Z")); // 23:30 del 4 en Guatemala
    try {
      query.mockResolvedValue([]);
      await getGuardShiftVisits();
      // HU-C08: abiertas del turno (sin limite) + ventana de 20 recientes; ninguna futura.
      expect(query).toHaveBeenCalledTimes(2);
      for (const [sql, params] of query.mock.calls) {
        expect(sql).toContain("WHERE a.fecha <= ?");
        expect(params[0]).toBe("2026-10-04");
      }
      expect(query.mock.calls[1][0]).toContain("LIMIT 20");
      expect(query.mock.calls[0][0]).not.toContain("LIMIT 20");
      // Los guardias ejecutores se muestran sin filtrar por cuenta/autorizador.
      expect(query.mock.calls[0][0]).not.toMatch(/(?:a\.id_usuario_autoriza|ra\.id_guardia_ingreso|ra\.id_guardia_salida)\s*=\s*\?/);
    } finally {
      jest.useRealTimers();
    }
  });
});
