jest.mock("../../database/mysql", () => ({ query: jest.fn() }));
jest.mock('../contractFinancialAccount',()=>({detail:jest.fn(async()=>null)}));

const fs = require("node:fs");
const path = require("node:path");
const { query } = require("../../database/mysql");
const { getFinancialDetail } = require("../residentFinancialDetailService");

const RENT_EXCLUSION = "LOWER(COALESCE(srv.tipo_servicio, '')) <> 'alquiler'";

describe("HU32 coherencia Mis pagos / Cargos y pagos", () => {
  beforeEach(() => query.mockReset());

  it("Cargos y pagos excluye el alquiler del inquilino en cargos, recargos, pagos y reembolsos", async () => {
    query
      .mockResolvedValueOnce([{ id_casa: 5, numero: "302", torre: "B" }])
      .mockResolvedValue([]);
    await getFinancialDetail(3, {});
    const listQueries = query.mock.calls.slice(1).map(([sql]) => sql);
    expect(listQueries).toHaveLength(4);
    for (const sql of listQueries) {
      expect(sql).toContain(RENT_EXCLUSION);
      expect(sql).toContain("NOT LIKE '%renta%'");
    }
  });

  it("Mis pagos ya aplicaba la misma exclusión (política de referencia)", () => {
    const account = fs.readFileSync(path.resolve(__dirname, "../residentAccountService.js"), "utf8");
    expect(account).toContain("AND LOWER(COALESCE(srv.tipo_servicio, '')) <> 'alquiler'");
  });

  it("el arranque normal ya no crea la cuota de alquiler de Q2,200", () => {
    const server = fs.readFileSync(path.resolve(__dirname, "../../../server.js"), "utf8");
    const mysql = fs.readFileSync(path.resolve(__dirname, "../../database/mysql.js"), "utf8");
    expect(server).not.toContain("ensureTenantAccountSeed");
    expect(mysql).not.toMatch(/INSERT INTO CUOTA[\s\S]{0,120}2200\.00/);
    expect(mysql).not.toMatch(/DELETE FROM CUOTA|UPDATE CUOTA/);
  });
});
