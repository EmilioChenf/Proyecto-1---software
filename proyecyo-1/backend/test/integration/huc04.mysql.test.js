const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

// RUN_HUC04_MYSQL_TESTS=1 HUC04_MYSQL_PORT=<puerto MySQL desechable> npm run test:huc04:mysql
// Crea su propia base aleatoria; nunca adopta ni elimina una base preexistente.
if (process.env.RUN_HUC04_MYSQL_TESTS !== "1") {
  test("HU-C04 requiere MySQL desechable y habilitacion explicita", { skip: true }, () => {});
} else {
  const port = Number(process.env.HUC04_MYSQL_PORT);
  assert(Number.isInteger(port) && port >= 1024 && ![3306, 3308, 3318].includes(port), "Puerto exclusivo de pruebas requerido");
  const owner = randomUUID();
  const name = `nexus_phase0_test_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}_${owner.slice(0, 8)}`;
  Object.assign(process.env, {
    RUN_PHASE0_MYSQL_TESTS: "1", PHASE0_TEST_DATABASE: name, PHASE0_TEST_PORT: String(port),
  });
  const { configureTestEnvironment, connect, isolatedConfig } = require("./support/isolatedMysql");
  configureTestEnvironment();
  const mysql = require("mysql2/promise");
  const db = require("../../src/database/mysql");
  const { createActiveSession } = require("../../src/services/activeSessionsService");
  const { guatemalaToday } = require("../../src/utils/guatemalaTime");
  const http = () => require("supertest")(require("../../src/app").createApp());
  let server, conn, created = false, sequence = 0;
  const users = {}, auth = {};
  const query = async (sql, params = []) => (await conn.execute(sql, params))[0];
  function currentWindow() {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Guatemala", hour: "2-digit", minute: "2-digit", hour12: false })
      .format(new Date()).split(":").map(Number);
    const now = (parts[0] % 24) * 60 + parts[1];
    const time = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    return { hora_inicio: time(Math.max(0, now - 60)), hora_fin: time(Math.min(1439, now + 60)) };
  }

  async function asUser(key, email) {
    const [row] = await query("SELECT id_usuario FROM USUARIO WHERE correo=?", [email]);
    users[key] = row.id_usuario;
    auth[key] = `Bearer ${(await createActiveSession(row.id_usuario)).token}`;
  }
  async function newVisit(payload = {}) {
    const response = await http().post("/visitas").set("Authorization", auth.resident).send({
      nombre: `HU-C04 visitante ${++sequence}`, dpi: `9404${String(sequence).padStart(9, "0")}`,
      placa: "P-123ABC", fecha: guatemalaToday(), ...currentWindow(),
      tipo_visita: "VISITA", ...payload,
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return response.body;
  }
  const enter = (visit) => http().post("/guardia/registrar-ingreso").set("Authorization", auth.guard).send({ qrToken: visit.qr_value });
  const exit = (visit) => http().post("/guardia/registrar-salida").set("Authorization", auth.guard).send({ qrToken: visit.qr_value });
  const cancel = (visit) => http().patch(`/visitas/${visit.id_acceso}/cancelar`).set("Authorization", auth.resident);
  const remove = (visit) => http().delete(`/visitas/${visit.id_acceso}`).set("Authorization", auth.resident);
  const movement = async (visit) => (await query("SELECT * FROM REGISTRO_ACCESO WHERE id_acceso=?", [visit.id_acceso]))[0];
  const assertStatus = (response, status) => assert.equal(response.status, status, JSON.stringify(response.body));

  describe("HU-C04 preservacion real del historial", () => {
    before(async () => {
      const { database, ...config } = isolatedConfig();
      server = await mysql.createConnection(config);
      await server.query(`CREATE DATABASE \`${database}\``);
      created = true;
      conn = await connect();
      await query("CREATE TABLE NEXUS_TEST_RUN_OWNER (run_token CHAR(36) PRIMARY KEY)");
      await query("INSERT INTO NEXUS_TEST_RUN_OWNER VALUES (?)", [owner]);
      await require("./support/initializeTestSchema").initializeTestSchema();
      for (const [key, ensure] of Object.entries(db)) if (key.startsWith("ensure")) await ensure();
      await require("../../src/database/propertyContractMigration").applyPropertyContractMigration(conn);
      for (const [key, value] of [["visitas_hora_apertura", "00:00"], ["visitas_hora_cierre", "23:59"],
        ["visitas_duracion_maxima_horas", "12"], ["visitas_activo", "true"], ["visitas_dias_habilitados", "[0,1,2,3,4,5,6]"]]) {
        await query("INSERT INTO CONFIGURACION(clave,valor) VALUES(?,?) ON DUPLICATE KEY UPDATE valor=VALUES(valor)", [key, value]);
      }
      await asUser("resident", "residente@test.com");
      await asUser("tenant", "inquilino@test.com");
      await asUser("guard", "guardia@test.com");
      await asUser("admin", "admin@test.com");
    });

    after(async () => {
      await db.pool.end();
      if (created) {
        const [rows] = await server.execute(`SELECT run_token FROM \`${name}\`.NEXUS_TEST_RUN_OWNER`);
        assert.equal(rows[0]?.run_token, owner, "Solo eliminar la base propiedad de esta ejecucion");
        await conn?.end();
        await server.query(`DROP DATABASE \`${name}\``);
      }
      await server?.end();
    });

    test("antes del ingreso se puede eliminar; cancelar invalida el QR sin borrar la visita", async () => {
      const removable = await newVisit();
      assertStatus(await remove(removable), 200);
      assert.equal((await query("SELECT * FROM ACCESO WHERE id_acceso=?", [removable.id_acceso])).length, 0);
      const visit = await newVisit();
      assertStatus(await cancel(visit), 200);
      assertStatus(await enter(visit), 410);
      assert.equal((await query("SELECT estado_acceso FROM ACCESO WHERE id_acceso=?", [visit.id_acceso]))[0].estado_acceso, "CANCELADA");
      assert.equal(await movement(visit), undefined);
    });

    test("con entrada: impide borrar, cancela y conserva exactamente el registro y el guardia", async () => {
      const visit = await newVisit();
      assertStatus(await enter(visit), 200);
      const before = await movement(visit);
      assert.equal(before.id_guardia_ingreso, users.guard);
      assertStatus(await remove(visit), 409);
      const frequent = await http().delete(`/visitantes-frecuentes/${visit.id_visitante}`).set("Authorization", auth.resident);
      assertStatus(frequent, 409);
      assertStatus(await cancel(visit), 200);
      assert.deepEqual(await movement(visit), before);
      assertStatus(await enter(visit), 410);
      assertStatus(await exit(visit), 410);
      assertStatus(await remove(visit), 409);
      const [audit] = await query("SELECT datos_anteriores, datos_nuevos FROM AUDITORIA WHERE accion='VISIT_CANCELLED' AND entidad_id=?", [String(visit.id_acceso)]);
      const previous = typeof audit.datos_anteriores === "string" ? JSON.parse(audit.datos_anteriores) : audit.datos_anteriores;
      assert.equal(previous.estado_acceso, "INGRESO_REGISTRADO");
    });

    test("con salida: cancelada sigue visible al residente, guardia y administrador con sus movimientos", async () => {
      const visit = await newVisit();
      assertStatus(await enter(visit), 200);
      assertStatus(await exit(visit), 200);
      const before = await movement(visit);
      const cancelled = await cancel(visit);
      assertStatus(cancelled, 200);
      assert.equal(cancelled.body.qr_status, "CANCELLED");
      assert(cancelled.body.hora_ingreso);
      assert(cancelled.body.hora_salida);
      assert.deepEqual(await movement(visit), before);
      assertStatus(await remove(visit), 409);
      const resident = await http().get("/visitas").set("Authorization", auth.resident);
      assertStatus(resident, 200);
      assert.equal(resident.body.find((row) => row.id_acceso === visit.id_acceso).estado_acceso, "CANCELADA");
      const guard = await http().get(`/guardia/historial-accesos?date=${guatemalaToday()}&status=CANCELADA`).set("Authorization", auth.guard);
      assertStatus(guard, 200);
      const record = guard.body.find((row) => row.id_acceso === visit.id_acceso);
      assert.equal(record.estado, "CANCELADA");
      assert(record.hora_ingreso && record.hora_salida && record.guardia_ingreso && record.guardia_salida);
      const admin = await http().get("/admin/accesos").set("Authorization", auth.admin);
      assertStatus(admin, 200);
      const access = admin.body.find((row) => row.id_acceso === visit.id_acceso);
      assert.equal(access.estado_visita, "CANCELADA");
      assert(access.hora_salida && access.guardia_ingreso && access.guardia_salida);
    });

    test("crear o corregir con el mismo DPI y placa conserva el visitante historico", async () => {
      const visit = await newVisit();
      assertStatus(await enter(visit), 200);
      const [original] = await query("SELECT * FROM VISITANTE WHERE id_visitante=?", [visit.id_visitante]);
      const changed = await newVisit({ dpi: visit.dpi, nombre: "Datos nuevos" });
      assert.notEqual(changed.id_visitante, visit.id_visitante);
      const update = await http().patch(`/visitas/${changed.id_acceso}`).set("Authorization", auth.resident).send({
        ...changed, nombre: "Correccion posterior", placa: "P-456DEF",
      });
      assertStatus(update, 200);
      assert.deepEqual((await query("SELECT * FROM VISITANTE WHERE id_visitante=?", [visit.id_visitante]))[0], original);
      const unauthorized = await http().patch(`/visitas/${visit.id_acceso}/cancelar`).set("Authorization", auth.tenant);
      assertStatus(unauthorized, 404);
    });

    test("un QR vencido no registra ingreso y su visita permanece visible", async () => {
      const visit = await newVisit();
      await query("UPDATE ACCESO SET fecha='2000-01-01' WHERE id_acceso=?", [visit.id_acceso]);
      const response = await enter(visit);
      assertStatus(response, 410);
      assert.equal(response.body.code, "QR_EXPIRED");
      assert.equal(await movement(visit), undefined);
      const history = await http().get("/guardia/historial-accesos?date=2000-01-01&status=VENCIDA").set("Authorization", auth.guard);
      assertStatus(history, 200);
      assert.equal(history.body.find((row) => row.id_acceso === visit.id_acceso).estado, "VENCIDA");
    });

    test("MySQL impide borrar los padres del historial y migrar no altera registros", async () => {
      const visit = await newVisit();
      assertStatus(await enter(visit), 200);
      assertStatus(await exit(visit), 200);
      const before = await movement(visit);
      const [{ id_casa }] = await query("SELECT id_casa FROM ACCESO WHERE id_acceso=?", [visit.id_acceso]);
      for (const [table, key, id] of [["ACCESO", "id_acceso", visit.id_acceso], ["VISITANTE", "id_visitante", visit.id_visitante],
        ["CASA", "id_casa", id_casa], ["USUARIO", "id_usuario", users.guard]]) {
        await assert.rejects(query(`DELETE FROM ${table} WHERE ${key}=?`, [id]), (error) => error.code === "ER_ROW_IS_REFERENCED_2");
      }
      // Simula una instalacion antigua con SET NULL y comprueba su actualizacion real.
      await query("ALTER TABLE REGISTRO_ACCESO DROP FOREIGN KEY fk_registro_acceso_id_guardia_ingreso, ADD CONSTRAINT legacy_huc04_guard_ingreso FOREIGN KEY(id_guardia_ingreso) REFERENCES USUARIO(id_usuario) ON DELETE SET NULL");
      await db.ensureVisitHistoryRelations();
      await db.ensureVisitHistoryRelations();
      await db.ensureAccessGuardAuditSchema();
      const rules = await query("SELECT DELETE_RULE FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=? AND TABLE_NAME='REGISTRO_ACCESO'", [name]);
      assert.equal(rules.length, 3, "Reiniciar no debe duplicar las relaciones de guardias");
      assert(rules.every((row) => row.DELETE_RULE === "RESTRICT" || row.DELETE_RULE === "NO ACTION"));
      assert.deepEqual(await movement(visit), before);
    });

    test("cancelacion concurrente con ingreso conserva cualquier movimiento confirmado", async () => {
      for (let round = 0; round < 3; round++) {
        const visit = await newVisit();
        const [entry, cancellation] = await Promise.all([enter(visit), cancel(visit)]);
        assertStatus(cancellation, 200);
        assert([200, 409, 410].includes(entry.status), JSON.stringify(entry.body));
        const record = await movement(visit);
        if (entry.status === 200) assert.equal(record.id_guardia_ingreso, users.guard);
        else assert.equal(record, undefined);
        assert.equal((await query("SELECT estado_acceso FROM ACCESO WHERE id_acceso=?", [visit.id_acceso]))[0].estado_acceso, "CANCELADA");
        assertStatus(await enter(visit), 410);
      }
    });

    test("eliminacion concurrente con ingreso nunca borra un movimiento confirmado", async () => {
      for (let round = 0; round < 3; round++) {
        const visit = await newVisit();
        const [entry, deletion] = await Promise.all([enter(visit), remove(visit)]);
        if (entry.status === 200) {
          assertStatus(deletion, 409);
          assert.equal((await movement(visit)).id_guardia_ingreso, users.guard);
        } else {
          assert([404, 410].includes(entry.status), JSON.stringify(entry.body));
          assertStatus(deletion, 200);
          assert.equal(await movement(visit), undefined);
        }
      }
    });
  });
}
