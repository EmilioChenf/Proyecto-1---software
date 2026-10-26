jest.mock("mysql2/promise", () => ({ createPool: jest.fn(() => ({ execute: jest.fn() })) }));
const { pool, ensureVisitHistoryRelations } = require("../mysql");

describe("HU-C04.6 relaciones de evidencia historica", () => {
  beforeEach(() => pool.execute.mockReset());

  it("no altera relaciones que ya impiden el borrado en cascada", async () => {
    pool.execute.mockResolvedValue([[{ name: "existing", delete_rule: "RESTRICT", update_rule: "NO ACTION" }]]);
    await ensureVisitHistoryRelations();
    expect(pool.execute).toHaveBeenCalledTimes(6);
    expect(pool.execute.mock.calls.every(([sql]) => sql.startsWith("SELECT"))).toBe(true);
  });

  it.each(["CASCADE", "SET NULL"])("reemplaza %s atomicamente sin modificar filas", async (delete_rule) => {
    pool.execute.mockImplementation(async (sql) => sql.startsWith("SELECT")
      ? [[{ name: "old_fk", delete_rule, update_rule: "RESTRICT" }]] : [{ affectedRows: 0 }]);
    await ensureVisitHistoryRelations();
    const alters = pool.execute.mock.calls.filter(([sql]) => sql.startsWith("ALTER"));
    expect(alters).toHaveLength(6);
    for (const [sql] of alters) {
      expect(sql).toContain("DROP FOREIGN KEY `old_fk`, ADD CONSTRAINT `old_fk`");
      expect(sql).toContain("ON DELETE RESTRICT ON UPDATE RESTRICT");
      expect(sql).not.toMatch(/DELETE FROM|DROP TABLE|TRUNCATE/);
    }
  });

  it("agrega relaciones faltantes y la segunda ejecucion no hace cambios", async () => {
    const relations = new Set();
    let key;
    pool.execute.mockImplementation(async (sql, params) => {
      if (sql.startsWith("SELECT")) {
        key = params.slice(1).join("/");
        return [relations.has(key) ? [{ name: key, delete_rule: "RESTRICT", update_rule: "RESTRICT" }] : []];
      }
      relations.add(key);
      return [{ affectedRows: 0 }];
    });
    await ensureVisitHistoryRelations();
    expect(relations.size).toBe(6);
    pool.execute.mockClear();
    await ensureVisitHistoryRelations();
    expect(pool.execute).toHaveBeenCalledTimes(6);
    expect(pool.execute.mock.calls.every(([sql]) => sql.startsWith("SELECT"))).toBe(true);
  });
});
