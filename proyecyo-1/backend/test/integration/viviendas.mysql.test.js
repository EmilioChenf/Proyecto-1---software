const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { configureTestEnvironment, connect } = require("./support/isolatedMysql");

if (process.env.RUN_PHASE0_MYSQL_TESTS !== "1") test("Viviendas necesita el runner MySQL desechable", { skip: true }, () => {});
else {
  const isolation = require("./support/suiteIsolation");
  isolation.assertOwnedSuiteDatabase();
  configureTestEnvironment();
  const db = require("../../src/database/mysql");
  const houses = require("../../src/services/housesService");
  const users = require("../../src/services/usersService");
  const request = require("supertest");

  let conn;
  const tag = randomUUID().slice(0, 6).toUpperCase(); // torre unica por ejecucion
  const query = async (sql, params = []) => (await conn.query(sql, params))[0];
  const roleId = async (name) => (await query("SELECT id_tipo_usuario id FROM TIPO_USUARIO WHERE nombre=?", [name]))[0].id;
  const house = (numero, extra = {}) => houses.createHouse({ numero, torre: `T${tag}`, ...extra });
  const casa = async (id) => (await query("SELECT id_casa, id_residente, activo FROM CASA WHERE id_casa=?", [id]))[0];
  let seq = 0;
  const newUser = async (role, id_casa, extra = {}) => users.createUser({
    nombre: `Viv ${role} ${++seq}`, correo: `viv.${tag.toLowerCase()}.${seq}@test.invalid`, password: "clave1234",
    id_tipo_usuario: await roleId(role), ...(id_casa ? { id_casa } : {}), ...extra,
  });

  describe("Viviendas sobre CASA (SQL real, base desechable)", () => {
    before(async () => { conn = await connect(process.env.PHASE0_TEST_DATABASE); });
    after(async () => { await conn.end(); await db.pool.end(); });

    describe("Migracion aditiva", () => {
      test("CASA conserva sus datos y relaciones, y admite viviendas sin residente", async () => {
        const [legacy] = await query("SELECT id_casa, numero, torre, id_residente, activo, precio FROM CASA WHERE numero='302' AND torre='B'");
        assert.equal(legacy.id_casa, 1, "el id de la casa existente no cambia");
        assert.ok(legacy.id_residente, "la casa existente conserva su residente");
        assert.equal(legacy.activo, 1);
        assert.equal(legacy.precio, null, "los campos nuevos empiezan vacios: no se inventan datos");
        assert.ok((await query("SELECT COUNT(*) n FROM CUOTA WHERE id_casa=1"))[0].n > 0, "el historial financiero sigue apuntando a la misma casa");
        const [column] = await query(`SELECT IS_NULLABLE n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CASA' AND COLUMN_NAME='id_residente'`);
        assert.equal(column.n, "YES");
      });

      test("la migracion es reejecutable y no duplica columnas ni indices", async () => {
        const before = await query("SELECT COUNT(*) n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CASA'");
        await db.ensureHousesSchema();
        await db.ensureHousesSchema();
        const afterCols = await query("SELECT COUNT(*) n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CASA'");
        assert.equal(afterCols[0].n, before[0].n);
        const indexes = await query("SELECT DISTINCT INDEX_NAME i FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CASA' AND INDEX_NAME LIKE 'uq_casa%'");
        assert.deepEqual(indexes.map((r) => r.i).sort(), ["uq_casa_codigo", "uq_casa_mapa"]);
        // SELECT * (respaldos) no expone columnas ocultas de los indices funcionales.
        const [row] = await query("SELECT * FROM CASA LIMIT 1");
        assert.ok(Object.keys(row).every((k) => !k.startsWith("!")));
      });
    });

    describe("CRUD y validaciones", () => {
      test("crear vivienda: nace DISPONIBLE, activa y con precio DECIMAL exacto", async () => {
        const created = await house("101", { precio: "125000.10", area_terreno: "208", area_construccion: "128.5", habitaciones: 3, banos: "2.5", niveles: 2, modelo: "Jacaranda", mapa_fila: 1, mapa_columna: 1 });
        assert.equal(created.estado, "DISPONIBLE");
        assert.equal(created.activo, true);
        assert.equal(created.precio, 125000.1);
        assert.equal((await query("SELECT precio FROM CASA WHERE id_casa=?", [created.id_casa]))[0].precio, "125000.10");
        assert.equal(created.residente, null);
      });

      test("codigo y posicion duplicados se rechazan con 409", async () => {
        await assert.rejects(house("101"), { status: 409, code: "CODIGO_DUPLICADO" });
        await assert.rejects(house("102", { mapa_fila: 1, mapa_columna: 1 }), { status: 409, code: "POSICION_DUPLICADA" });
        // El mismo numero en otra torre si es valido.
        const other = await houses.createHouse({ numero: "101", torre: `U${tag}` });
        assert.equal(other.estado, "DISPONIBLE");
      });

      test("campos invalidos se rechazan con 400 sin escribir nada", async () => {
        const before = (await query("SELECT COUNT(*) n FROM CASA"))[0].n;
        for (const bad of [{ numero: "" }, { numero: "X1", precio: "-1" }, { numero: "X2", precio: "10.999" }, { numero: "X3", area_terreno: "-5" },
          { numero: "X4", habitaciones: -1 }, { numero: "X5", banos: "2.3" }, { numero: "X6", niveles: 0 }, { numero: "X7", niveles: 6 },
          { numero: "X8", mapa_fila: 2 }, { numero: "X9", mapa_fila: 0, mapa_columna: 1 }, { numero: "12345678901" }]) {
          await assert.rejects(houses.createHouse({ torre: `T${tag}`, ...bad }), { status: 400 }, JSON.stringify(bad));
        }
        assert.equal((await query("SELECT COUNT(*) n FROM CASA"))[0].n, before);
      });

      test("editar vivienda no toca la ocupacion ni el id", async () => {
        const created = await house("103");
        const updated = await houses.updateHouse(created.id_casa, { numero: "103", torre: `T${tag}`, modelo: "Ceiba", precio: "99000" });
        assert.equal(updated.id_casa, created.id_casa);
        assert.equal(updated.modelo, "Ceiba");
        assert.equal(updated.estado, "DISPONIBLE");
      });
    });

    describe("Residente", () => {
      test("asignar vivienda disponible la deja OCUPADA, en una sola transaccion", async () => {
        const target = await house("201");
        const user = await newUser("residente", target.id_casa);
        assert.equal(user.id_casa, target.id_casa);
        const detail = await houses.getHouseDetail(target.id_casa);
        assert.equal(detail.estado, "OCUPADA");
        assert.equal(detail.residente.correo, user.correo);
      });

      test("una vivienda ocupada no se asigna a otro residente y el usuario NO se crea (rollback)", async () => {
        const target = await house("202");
        await newUser("residente", target.id_casa);
        const correo = `viv.rollback.${tag.toLowerCase()}@test.invalid`;
        await assert.rejects(newUser("residente", target.id_casa, { correo }), { status: 409, code: "VIVIENDA_OCUPADA" });
        assert.equal((await query("SELECT COUNT(*) n FROM USUARIO WHERE correo=?", [correo]))[0].n, 0);
      });

      test("concurrencia: dos altas simultaneas sobre la misma vivienda, solo una gana", async () => {
        const target = await house("203");
        const results = await Promise.allSettled([newUser("residente", target.id_casa), newUser("residente", target.id_casa)]);
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        const rejected = results.find((r) => r.status === "rejected");
        assert.equal(rejected.reason.status, 409);
        const [row] = await query("SELECT COUNT(*) n FROM CASA c JOIN RESIDENTE r ON r.id_residente=c.id_residente WHERE c.id_casa=?", [target.id_casa]);
        assert.equal(row.n, 1);
      });

      test("cambiar la vivienda del residente libera la anterior y ocupa la nueva", async () => {
        const first = await house("204"), second = await house("205");
        const user = await newUser("residente", first.id_casa);
        await users.updateUser(user.id_usuario, { nombre: user.nombre, correo: user.correo, id_tipo_usuario: await roleId("residente"), id_casa: second.id_casa });
        assert.equal((await casa(first.id_casa)).id_residente, null);
        assert.ok((await casa(second.id_casa)).id_residente);
        assert.equal((await users.getUserById(user.id_usuario)).id_casa, second.id_casa);
      });

      test("vivienda inactiva o inexistente no se asigna", async () => {
        const inactive = await house("206");
        await houses.setHouseActive(inactive.id_casa, false);
        await assert.rejects(newUser("residente", inactive.id_casa), { status: 409, code: "VIVIENDA_INACTIVA" });
        await assert.rejects(newUser("residente", 999999), { status: 404 });
        await assert.rejects(newUser("residente", null), { status: 400 });
      });

      test("no se puede desactivar una vivienda ocupada", async () => {
        const target = await house("207");
        await newUser("residente", target.id_casa);
        await assert.rejects(houses.setHouseActive(target.id_casa, false), { status: 409, code: "VIVIENDA_OCUPADA" });
      });

      test("la casa con historial financiero no queda sin residente (HU13-HU19 intactas)", async () => {
        const [owner] = await query("SELECT u.id_usuario, u.nombre, u.correo FROM USUARIO u JOIN RESIDENTE r ON r.id_usuario=u.id_usuario JOIN CASA c ON c.id_residente=r.id_residente WHERE c.id_casa=1");
        const spare = await house("208");
        await assert.rejects(
          users.updateUser(owner.id_usuario, { nombre: owner.nombre, correo: owner.correo, id_tipo_usuario: await roleId("residente"), id_casa: spare.id_casa }),
          { status: 409, code: "USAR_ASISTENTE_CONTRACTUAL" },
        );
        assert.equal((await casa(1)).id_residente !== null, true);
        assert.equal((await casa(spare.id_casa)).id_residente, null, "rollback: la vivienda nueva no quedo ocupada");
      });

      test("eliminar un residente sin historial deja su vivienda DISPONIBLE (no se borra la casa)", async () => {
        const target = await house("209");
        const user = await newUser("residente", target.id_casa);
        await users.deleteUser(user.id_usuario);
        const row = await casa(target.id_casa);
        assert.ok(row, "la vivienda sigue existiendo");
        assert.equal(row.id_residente, null);
      });
    });

    describe("Inquilino", () => {
      test("solo se vincula a una vivienda OCUPADA y activa; no crea ni cambia la casa", async () => {
        const target = await house("301");
        await assert.rejects(newUser("inquilino", target.id_casa), { status: 409, code: "VIVIENDA_NO_ELEGIBLE" });
        const owner = await newUser("residente", target.id_casa);
        const casasBefore = (await query("SELECT COUNT(*) n FROM CASA"))[0].n;
        const tenant = await newUser("inquilino", target.id_casa);
        assert.equal(tenant.id_casa, target.id_casa);
        assert.equal((await query("SELECT COUNT(*) n FROM CASA"))[0].n, casasBefore);
        const detail = await houses.getHouseDetail(target.id_casa);
        assert.equal(detail.estado, "OCUPADA");
        assert.equal(detail.residente.correo, owner.correo, "el residente no cambia");
        assert.deepEqual(detail.inquilinos.map((i) => [i.correo, i.autorizado]), [[tenant.correo, true]]);
      });

      test("cambiar la vivienda del inquilino mueve INQUILINO_CASA sin tocar la ocupacion", async () => {
        const a = await house("302"), b = await house("303");
        await newUser("residente", a.id_casa); await newUser("residente", b.id_casa);
        const tenant = await newUser("inquilino", a.id_casa);
        await users.updateUser(tenant.id_usuario, { nombre: tenant.nombre, correo: tenant.correo, id_tipo_usuario: await roleId("inquilino"), id_casa: b.id_casa });
        const links = await query("SELECT ic.id_casa FROM INQUILINO_CASA ic JOIN INQUILINO i ON i.id_inquilino=ic.id_inquilino WHERE i.id_usuario=?", [tenant.id_usuario]);
        assert.deepEqual(links.map((l) => l.id_casa), [b.id_casa]);
        assert.ok((await casa(a.id_casa)).id_residente, "la vivienda anterior sigue ocupada por su residente");
      });

      test("un residente con inquilinos no puede dejar su vivienda (no quedan inquilinos huerfanos)", async () => {
        const target = await house("304"), spare = await house("305");
        const owner = await newUser("residente", target.id_casa);
        await newUser("inquilino", target.id_casa);
        await assert.rejects(
          users.updateUser(owner.id_usuario, { nombre: owner.nombre, correo: owner.correo, id_tipo_usuario: await roleId("residente"), id_casa: spare.id_casa }),
          { status: 409, code: "VIVIENDA_CON_INQUILINOS" },
        );
        assert.equal((await casa(spare.id_casa)).id_residente, null);
      });
    });

    describe("Seleccion para el formulario de usuario", () => {
      test("residente: solo disponibles (y la propia); inquilino: solo ocupadas y activas", async () => {
        const free = await house("401"), taken = await house("402"), off = await house("403");
        const owner = await newUser("residente", taken.id_casa);
        await houses.setHouseActive(off.id_casa, false);
        const pick = async (seleccion, id_usuario) => Object.fromEntries((await houses.listHouses({ seleccion, id_usuario })).viviendas
          .filter((h) => [free.id_casa, taken.id_casa, off.id_casa].includes(h.id_casa)).map((h) => [h.id_casa, h.elegible]));
        assert.deepEqual(await pick("residente"), { [free.id_casa]: true, [taken.id_casa]: false, [off.id_casa]: false });
        assert.deepEqual(await pick("residente", owner.id_usuario), { [free.id_casa]: true, [taken.id_casa]: true, [off.id_casa]: false });
        assert.deepEqual(await pick("inquilino"), { [free.id_casa]: false, [taken.id_casa]: true, [off.id_casa]: false });
        const summary = (await houses.listHouses({})).resumen;
        const [real] = await query("SELECT SUM(id_residente IS NULL) d, SUM(id_residente IS NOT NULL) o FROM CASA");
        assert.deepEqual([summary.disponibles, summary.ocupadas], [Number(real.d), Number(real.o)]);
      });
    });

    describe("HTTP: ADMIN requerido", () => {
      test("sin sesion 401, residente 403, admin 200; el residente no ve datos de otras viviendas", async () => {
        const { createApp } = require("../../src/app");
        const app = createApp();
        const sessions = require("../../src/services/activeSessionsService");
        const userBy = async (correo) => (await query("SELECT id_usuario FROM USUARIO WHERE correo=?", [correo]))[0].id_usuario;
        const admin = (await sessions.createActiveSession(await userBy("admin@test.com"))).token;
        const resident = (await sessions.createActiveSession(await userBy("residente@test.com"))).token;
        await request(app).get("/admin/viviendas").expect(401);
        await request(app).get("/admin/viviendas/1").set("Authorization", `Bearer ${resident}`).expect(403);
        await request(app).post("/admin/viviendas").set("Authorization", `Bearer ${resident}`).send({ numero: "999" }).expect(403);
        const list = await request(app).get("/admin/viviendas").set("Authorization", `Bearer ${admin}`).expect(200);
        assert.ok(list.body.resumen.total >= 1);
        const created = await request(app).post("/admin/viviendas").set("Authorization", `Bearer ${admin}`).send({ numero: "501", torre: `T${tag}` }).expect(201);
        await request(app).patch(`/admin/viviendas/${created.body.id_casa}/activo`).set("Authorization", `Bearer ${admin}`).send({ activo: "no" }).expect(400);
        const detail = await request(app).get("/admin/viviendas/1").set("Authorization", `Bearer ${admin}`).expect(200);
        assert.equal(detail.body.id_casa, 1);
        assert.equal(detail.body.residente.password, undefined, "sin datos sensibles");
        assert.equal(detail.body.residente.dpi, undefined);
      });
    });
  });
}
