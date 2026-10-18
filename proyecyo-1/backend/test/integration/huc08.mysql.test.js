const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { configureTestEnvironment, connect } = require("./support/isolatedMysql");

// HU-C08: perfiles individuales + informacion operativa compartida por rol dentro
// del residencial + auditoria del usuario ejecutor. Todo pasa por HTTP con
// sesiones reales (Bearer), igual que el frontend; nada usa cabeceras simuladas.
if (process.env.RUN_PHASE0_MYSQL_TESTS !== "1") test("HU-C08 necesita el runner MySQL desechable", { skip: true }, () => {});
else {
  const isolation = require("./support/suiteIsolation");
  isolation.assertOwnedSuiteDatabase();
  configureTestEnvironment();
  const db = require("../../src/database/mysql");
  const { createActiveSession } = require("../../src/services/activeSessionsService");
  const { guatemalaToday } = require("../../src/utils/guatemalaTime");
  const http = () => require("supertest")(require("../../src/app").createApp());

  let conn;
  const tag = `C08${randomUUID().slice(0, 6)}`;
  const today = guatemalaToday();
  const query = async (sql, params = []) => (await conn.query(sql, params))[0];
  const users = {};
  const auth = {};
  let dpiSeq = 0;
  const uniqueDpi = () => `${Date.now()}`.slice(-9) + String(++dpiSeq).padStart(4, "0");

  function guatemalaMinutesNow() {
    const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Guatemala", hour: "2-digit", minute: "2-digit", hour12: false })
      .format(new Date()).split(":").map(Number);
    return (h % 24) * 60 + m;
  }
  const hhmm = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  // Ventana vigente ahora mismo en Guatemala (QR VALID), dentro del horario configurado.
  function currentWindow() {
    const now = guatemalaMinutesNow();
    return { hora_inicio: hhmm(Math.max(0, now - 60)), hora_fin: hhmm(Math.min(23 * 60 + 59, now + 60)) };
  }

  async function createUser(key, role, { active = true } = {}) {
    const [{ id_tipo_usuario: typeId }] = await query("SELECT id_tipo_usuario FROM TIPO_USUARIO WHERE nombre=?", [role]);
    const id = (await query(
      "INSERT INTO USUARIO(nombre,dpi,correo,password,activo,id_tipo_usuario) VALUES(?,?,?,'x',?,?)",
      [`${tag} ${key}`, uniqueDpi(), `${tag.toLowerCase()}.${key}@test.invalid`, active, typeId],
    )).insertId;
    users[key] = id;
    auth[key] = `Bearer ${(await createActiveSession(id)).token}`;
    return id;
  }

  async function existingUser(key, correo) {
    const [{ id_usuario: id }] = await query("SELECT id_usuario FROM USUARIO WHERE correo=?", [correo]);
    users[key] = id;
    auth[key] = `Bearer ${(await createActiveSession(id)).token}`;
  }

  async function createVisitAs(key, name = `${tag} visitante`) {
    const response = await http().post("/visitas").set("Authorization", auth[key])
      .send({ nombre: name, dpi: uniqueDpi(), placa: "", fecha: today, tipo_visita: "VISITA", ...currentWindow() });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return response.body;
  }

  const guardList = async (key) => {
    const response = await http().get("/guardia/visitas").set("Authorization", auth[key]);
    assert.equal(response.status, 200);
    return response.body;
  };
  const entry = (key, visit) => http().post("/guardia/registrar-ingreso").set("Authorization", auth[key]).send({ qrToken: visit.qr_value });
  const exit = (key, visit) => http().post("/guardia/registrar-salida").set("Authorization", auth[key]).send({ qrToken: visit.qr_value });
  const auditFor = (action, accessId) => query(
    "SELECT id_usuario, entidad, entidad_id FROM AUDITORIA WHERE accion=? AND entidad='ACCESO' AND entidad_id=? ORDER BY id_auditoria",
    [action, String(accessId)],
  );

  describe("HU-C08 guardias y administradores comparten la operacion del residencial", () => {
    before(async () => {
      conn = await connect(process.env.PHASE0_TEST_DATABASE);
      // Horario de visitas amplio solo en esta base desechable, para que las visitas de prueba sean vigentes.
      for (const [clave, valor] of [["visitas_hora_apertura", "00:00"], ["visitas_hora_cierre", "23:59"],
        ["visitas_duracion_maxima_horas", "12"], ["visitas_activo", "true"]]) {
        await query("INSERT INTO CONFIGURACION(clave,valor) VALUES(?,?) ON DUPLICATE KEY UPDATE valor=VALUES(valor)", [clave, valor]);
      }
      await existingUser("residentA", "residente@test.com");
      await existingUser("tenant", "inquilino@test.com");
      await createUser("guardA", "guardia");
      await createUser("guardB", "guardia");
      await createUser("guardInactive", "guardia", { active: false });
      await createUser("adminA", "admin");
      await createUser("adminB", "admin");
      // Segundo residente con su propia vivienda: cuentas normales, sin vinculos especiales con guardias.
      await createUser("residentB", "residente");
      const residentB = (await query("INSERT INTO RESIDENTE(id_usuario) VALUES(?)", [users.residentB])).insertId;
      await query("INSERT INTO CASA(numero,torre,id_residente) VALUES(?, 'C8', ?)", [tag.slice(-6), residentB]);
    });
    after(async () => { await conn.end(); await db.pool.end(); });

    test("esquema aditivo: REGISTRO_ACCESO conserva el guardia ejecutor sin perder registros", async () => {
      const columns = await query(
        "SELECT COLUMN_NAME c, IS_NULLABLE n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='REGISTRO_ACCESO' AND COLUMN_NAME LIKE 'id_guardia_%' ORDER BY 1",
      );
      assert.deepEqual(columns, [{ c: "id_guardia_ingreso", n: "YES" }, { c: "id_guardia_salida", n: "YES" }]);
      const before = Number((await query("SELECT COUNT(*) n FROM REGISTRO_ACCESO"))[0].n);
      await db.ensureAccessGuardAuditSchema(); // Idempotente: reejecutar no altera ni borra datos.
      assert.equal(Number((await query("SELECT COUNT(*) n FROM REGISTRO_ACCESO"))[0].n), before);
    });

    test("A/C/D: visita de Residente visible para ambos guardias; A registra ingreso, B ve el estado y registra la salida", async () => {
      const visit = await createVisitAs("residentA");
      for (const guard of ["guardA", "guardB"]) {
        const seen = (await guardList(guard)).find((item) => item.id_acceso === visit.id_acceso);
        assert(seen, `${guard} debe ver la visita del residente`);
        assert.equal(seen.qr_status, "VALID");
      }

      const entered = await entry("guardA", visit);
      assert.equal(entered.status, 200, JSON.stringify(entered.body));
      assert.equal(entered.body.estado_acceso, "INGRESO_REGISTRADO");
      const seenByB = (await guardList("guardB")).find((item) => item.id_acceso === visit.id_acceso);
      assert.equal(seenByB.estado_acceso, "INGRESO_REGISTRADO");
      assert.equal(seenByB.qr_status, "USED");

      const exited = await exit("guardB", visit);
      assert.equal(exited.status, 200, JSON.stringify(exited.body));
      assert.equal(exited.body.estado_acceso, "SALIDA_REGISTRADA");

      const [record] = await query("SELECT id_guardia_ingreso, id_guardia_salida FROM REGISTRO_ACCESO WHERE id_acceso=?", [visit.id_acceso]);
      assert.deepEqual(record, { id_guardia_ingreso: users.guardA, id_guardia_salida: users.guardB });
      assert.deepEqual((await auditFor("VISIT_ENTRY_REGISTERED", visit.id_acceso)).map((r) => r.id_usuario), [users.guardA]);
      assert.deepEqual((await auditFor("VISIT_EXIT_REGISTERED", visit.id_acceso)).map((r) => r.id_usuario), [users.guardB]);

      // El historial de garita y la vista del administrador muestran al guardia ejecutor.
      const history = await http().get(`/guardia/historial-accesos?date=${today}`).set("Authorization", auth.guardA);
      const row = history.body.find((item) => item.id_acceso === visit.id_acceso);
      assert.equal(row.guardia_ingreso, `${tag} guardA`);
      assert.equal(row.guardia_salida, `${tag} guardB`);
      const adminRows = await http().get("/admin/accesos").set("Authorization", auth.adminB);
      assert.equal(adminRows.status, 200);
      const adminRow = adminRows.body.find((item) => item.id_acceso === visit.id_acceso);
      assert.equal(adminRow.guardia_ingreso, `${tag} guardA`);
      assert.equal(adminRow.guardia_salida, `${tag} guardB`);
    });

    test("B: visita creada por Inquilino visible para ambos guardias y operable por cualquiera", async () => {
      const visit = await createVisitAs("tenant", `${tag} visita inquilino`);
      for (const guard of ["guardA", "guardB"]) {
        assert((await guardList(guard)).some((item) => item.id_acceso === visit.id_acceso), `${guard} debe verla`);
      }
      assert.equal((await entry("guardB", visit)).status, 200);
      assert.deepEqual((await auditFor("VISIT_ENTRY_REGISTERED", visit.id_acceso)).map((r) => r.id_usuario), [users.guardB]);
    });

    test("visitas abiertas no quedan fuera por la ventana de 20 recientes", async () => {
      const pending = await createVisitAs("residentB", `${tag} pendiente temprana`);
      await query("UPDATE ACCESO SET hora_inicio='00:00:00' WHERE id_acceso=?", [pending.id_acceso]);
      const [{ id_visitante: visitor }] = await query("SELECT id_visitante FROM ACCESO WHERE id_acceso=?", [pending.id_acceso]);
      const [{ id_casa: house }] = await query("SELECT id_casa FROM ACCESO WHERE id_acceso=?", [pending.id_acceso]);
      for (let i = 0; i < 25; i++) {
        await query(
          "INSERT INTO ACCESO(id_visitante,id_casa,fecha,hora_inicio,hora_fin,tipo_visita,token_qr,estado_acceso) VALUES(?,?,?,'23:00:00','23:30:00','VISITA',?,'SALIDA_REGISTRADA')",
          [visitor, house, today, `${tag}${i}`.toLowerCase()],
        );
      }
      for (const guard of ["guardA", "guardB"]) {
        assert((await guardList(guard)).some((item) => item.id_acceso === pending.id_acceso), `${guard} debe ver la visita abierta`);
      }
    });

    test("K: dos guardias validando el mismo QR a la vez generan un solo ingreso", async () => {
      for (let round = 0; round < 5; round++) {
        const visit = await createVisitAs(round % 2 ? "tenant" : "residentA", `${tag} concurrente ${round}`);
        const results = await Promise.all([entry("guardA", visit), entry("guardB", visit)]);
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 409], JSON.stringify(results.map((r) => r.body)));
        const loser = results.find((r) => r.status === 409);
        assert.equal(loser.body.code, "QR_ALREADY_USED");
        const records = await query("SELECT id_guardia_ingreso FROM REGISTRO_ACCESO WHERE id_acceso=?", [visit.id_acceso]);
        assert.equal(records.length, 1);
        const audits = await auditFor("VISIT_ENTRY_REGISTERED", visit.id_acceso);
        assert.equal(audits.length, 1, "una sola auditoria de ingreso");
        assert.equal(audits[0].id_usuario, records[0].id_guardia_ingreso, "la auditoria nombra al guardia ganador");
        const [{ n }] = await query("SELECT COUNT(*) n FROM INTENTO_VALIDACION_QR WHERE id_acceso=? AND resultado='REUTILIZADO'", [visit.id_acceso]);
        assert.equal(Number(n), 1, "el intento perdedor queda auditado como reutilizado");

        const exits = await Promise.all([exit("guardA", visit), exit("guardB", visit)]);
        assert.deepEqual(exits.map((r) => r.status).sort(), [200, 409]);
        assert.equal((await auditFor("VISIT_EXIT_REGISTERED", visit.id_acceso)).length, 1);
      }
    });

    test("E/F: lo que crea y modifica Admin A lo ve Admin B, y la auditoria conserva a Admin A", async () => {
      const created = await http().post("/admin/viviendas").set("Authorization", auth.adminA).send({ numero: `${tag.slice(-6)}A`, torre: "C8" });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const houseId = created.body.id_casa;
      const updated = await http().put(`/admin/viviendas/${houseId}`).set("Authorization", auth.adminA)
        .send({ numero: `${tag.slice(-6)}A`, torre: "C8", modelo: "HU-C08" });
      assert.equal(updated.status, 200, JSON.stringify(updated.body));

      const detail = await http().get(`/admin/viviendas/${houseId}`).set("Authorization", auth.adminB);
      assert.equal(detail.status, 200);
      assert.equal(detail.body.modelo, "HU-C08");
      const list = await http().get(`/admin/viviendas?q=${tag.slice(-6)}A`).set("Authorization", auth.adminB);
      assert.equal(list.status, 200);
      const items = Array.isArray(list.body) ? list.body : list.body.items || list.body.viviendas || [];
      assert(items.some((house) => house.id_casa === houseId), "Admin B ve la vivienda creada por Admin A");

      for (const action of ["HOUSE_CREATED", "HOUSE_UPDATED"]) {
        const logs = await http().get(`/admin/auditoria?action=${action}`).set("Authorization", auth.adminB);
        assert.equal(logs.status, 200);
        const log = logs.body.find((row) => row.entidad === "CASA" && row.entidad_id === String(houseId));
        assert(log, `Admin B consulta la auditoria ${action}`);
        assert.equal(log.id_usuario, users.adminA, "el autor sigue siendo Admin A");
      }

      // Admin B tambien ve la operacion de garita y su auditoria individual.
      const guardLogs = await http().get("/admin/auditoria?action=VISIT_ENTRY_REGISTERED").set("Authorization", auth.adminB);
      assert.equal(guardLogs.status, 200);
      assert(guardLogs.body.some((row) => row.id_usuario === users.guardA));
    });

    test("G/H: Residentes e Inquilinos conservan su privacidad", async () => {
      const visitA = await createVisitAs("residentA", `${tag} privada residente`);
      const visitTenant = await createVisitAs("tenant", `${tag} privada inquilino`);

      const ofB = await http().get("/visitas").set("Authorization", auth.residentB);
      assert.equal(ofB.status, 200);
      assert(!ofB.body.some((v) => [visitA.id_acceso, visitTenant.id_acceso].includes(v.id_acceso)), "Residente B no ve visitas ajenas");
      assert.equal((await http().patch(`/visitas/${visitA.id_acceso}/cancelar`).set("Authorization", auth.residentB)).status, 404);
      assert.equal((await http().delete(`/visitas/${visitA.id_acceso}`).set("Authorization", auth.residentB)).status, 404);

      const ofTenant = await http().get("/visitas").set("Authorization", auth.tenant);
      assert(ofTenant.body.some((v) => v.id_acceso === visitTenant.id_acceso));
      assert(!ofTenant.body.some((v) => v.id_acceso === visitA.id_acceso), "El inquilino no ve visitas del residente de su misma casa");
      assert.equal((await http().patch(`/visitas/${visitA.id_acceso}/cancelar`).set("Authorization", auth.tenant)).status, 404);

      const ofA = await http().get("/visitas").set("Authorization", auth.residentA);
      assert(ofA.body.some((v) => v.id_acceso === visitA.id_acceso));
      assert.equal((await query("SELECT estado_acceso FROM ACCESO WHERE id_acceso=?", [visitA.id_acceso]))[0].estado_acceso, "AUTORIZADA");
    });

    test("I/HU-C08.18: la visibilidad compartida no se extiende a roles no autorizados", async () => {
      const visit = await createVisitAs("residentA", `${tag} autorizacion`);
      const guardRoutes = [
        ["get", "/guardia/visitas"], ["get", "/guardia/historial-accesos"],
        ["post", "/guardia/registrar-ingreso"], ["post", "/guardia/registrar-salida"], ["post", "/guardia/validar-qr"],
      ];
      for (const key of ["residentA", "residentB", "tenant", "adminA"]) {
        for (const [method, url] of guardRoutes) {
          const response = await http()[method](url).set("Authorization", auth[key]).send({ qrToken: visit.qr_value });
          assert.equal(response.status, 403, `${key} ${method.toUpperCase()} ${url}`);
        }
      }
      for (const key of ["residentA", "tenant", "guardA"]) {
        for (const url of ["/admin/viviendas", "/admin/auditoria", "/admin/accesos", "/usuarios"]) {
          assert.equal((await http().get(url).set("Authorization", auth[key])).status, 403, `${key} GET ${url}`);
        }
      }
      // Un guardia inactivo conserva su identidad pero no obtiene informacion operativa.
      assert.equal((await http().get("/guardia/visitas").set("Authorization", auth.guardInactive)).status, 403);
      assert.equal((await entry("guardInactive", visit)).status, 403);
      assert.equal((await http().get("/guardia/visitas")).status, 401);
      assert.equal((await query("SELECT estado_acceso FROM ACCESO WHERE id_acceso=?", [visit.id_acceso]))[0].estado_acceso, "AUTORIZADA",
        "ningun rol no autorizado pudo registrar el ingreso");
    });

    test("HU-C08.5/.11: cada guardia y administrador mantiene su propia cuenta y sesion", async () => {
      const ids = [users.guardA, users.guardB, users.adminA, users.adminB];
      assert.equal(new Set(ids).size, 4);
      const rows = await query("SELECT id_usuario, correo FROM USUARIO WHERE id_usuario IN (?)", [ids]);
      assert.equal(new Set(rows.map((r) => r.correo)).size, 4, "credenciales individuales");
      // Cada cuenta ve solo sus propias sesiones: compartir operacion no comparte identidad.
      for (const key of ["guardA", "guardB", "adminA", "adminB"]) {
        const sessions = await http().get("/auth/sessions").set("Authorization", auth[key]);
        assert.equal(sessions.status, 200);
        const ownIds = (await query("SELECT id_sesion FROM SESION_ACTIVA WHERE id_usuario=?", [users[key]])).map((r) => r.id_sesion);
        const listed = (sessions.body.sessions || sessions.body).map((item) => item.id_sesion || item.id);
        assert(listed.length > 0 && listed.every((id) => ownIds.includes(id)), key);
      }
    });
  });
}
