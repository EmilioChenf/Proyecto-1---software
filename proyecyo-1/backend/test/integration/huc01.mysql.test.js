const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { configureTestEnvironment, connect } = require("./support/isolatedMysql");

// HU-C01: cambio de contrasena propia, revocacion de sesiones y rate limiting,
// todo por HTTP con sesiones reales (login + Bearer) sobre una base desechable.
if (process.env.RUN_PHASE0_MYSQL_TESTS !== "1") test("HU-C01 necesita el runner MySQL desechable", { skip: true }, () => {});
else {
  const isolation = require("./support/suiteIsolation");
  isolation.assertOwnedSuiteDatabase();
  configureTestEnvironment();
  const bcrypt = require("bcryptjs");
  const supertest = require("supertest");
  const db = require("../../src/database/mysql");
  const { createApp } = require("../../src/app");
  const { SECURITY_RATE_LIMITS } = require("../../src/middlewares/securityRateLimits");

  let conn;
  const tag = `c01${randomUUID().slice(0, 6)}`;
  const query = async (sql, params = []) => (await conn.query(sql, params))[0];
  const users = {};
  let seq = 0;

  // Contrasenas de prueba generadas para esta base desechable; no son credenciales reales.
  const OLD = "Inicial123";
  const NEW = "Renovada456";

  async function createUser(key, role, { password = OLD, hashed = true } = {}) {
    const [{ id_tipo_usuario: typeId }] = await query("SELECT id_tipo_usuario FROM TIPO_USUARIO WHERE nombre=?", [role]);
    const email = `${tag}.${key}@test.invalid`;
    const stored = hashed ? await bcrypt.hash(password, 4) : password;
    const id = (await query(
      "INSERT INTO USUARIO(nombre,dpi,correo,password,activo,id_tipo_usuario) VALUES(?,?,?,?,1,?)",
      [`${tag} ${key}`, `${Date.now()}`.slice(-9) + String(++seq).padStart(4, "0"), email, stored, typeId],
    )).insertId;
    users[key] = { id, email };
    return users[key];
  }

  // Cada prueba usa su propia app: los contadores de rate limit no se mezclan.
  const login = async (app, key, password = OLD, agent = "Pruebas HU-C01") => {
    const response = await supertest(app).post("/login").set("User-Agent", agent).send({ email: users[key].email, password });
    return response;
  };
  const tokenFor = async (app, key, password, agent) => {
    const response = await login(app, key, password, agent);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return `Bearer ${response.body.token}`;
  };
  const change = (app, auth, body) => {
    const call = supertest(app).post("/auth/password/change");
    return (auth ? call.set("Authorization", auth) : call).send(body);
  };
  const sessionStatus = async (app, auth) => (await supertest(app).get("/auth/session").set("Authorization", auth));
  const storedPassword = async (key) => (await query("SELECT password FROM USUARIO WHERE id_usuario=?", [users[key].id]))[0].password;
  const activeSessions = async (key) => Number((await query(
    "SELECT COUNT(*) n FROM SESION_ACTIVA WHERE id_usuario=? AND revocada_en IS NULL", [users[key].id]))[0].n);
  const valid = (current = OLD, next = NEW) => ({ currentPassword: current, newPassword: next, confirmPassword: next });

  describe("HU-C01 autenticacion y seguridad (MySQL real)", () => {
    before(async () => {
      conn = await connect(process.env.PHASE0_TEST_DATABASE);
      await createUser("residente", "residente");
      await createUser("guardia", "guardia");
      await createUser("admin", "admin");
      await createUser("otro", "residente");
      await createUser("errores", "inquilino");
      await createUser("limite", "guardia");
      await createUser("limiteVecino", "guardia");
      await createUser("legado", "residente", { password: "1234", hashed: false });
    });
    after(async () => { await conn.end(); await db.pool.end(); });

    test("1/5/6/9: cambia su propia contrasena, revoca sus sesiones previas y conserva las de otros", async () => {
      const app = createApp();
      const deviceA = await tokenFor(app, "residente", OLD, "Navegador A");
      const deviceB = await tokenFor(app, "residente", OLD, "Navegador B");
      const otherUser = await tokenFor(app, "otro", OLD);
      assert.equal(await activeSessions("residente"), 2);

      const response = await change(app, deviceA, { ...valid(), id_usuario: users.otro.id });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.headers["cache-control"], "no-store");
      assert.deepEqual(Object.keys(response.body).sort(), ["email", "id", "message", "role", "token"]);
      assert.equal(response.body.id, users.residente.id, "el id sale de la sesion, no del cuerpo");
      assert.doesNotMatch(JSON.stringify(response.body), /\$2[aby]\$|Inicial123|Renovada456/, "sin hash ni contrasenas en la respuesta");

      // 5: los tokens anteriores (incluido el que hizo la peticion) quedan revocados.
      for (const old of [deviceA, deviceB]) {
        const revoked = await sessionStatus(app, old);
        assert.equal(revoked.status, 401);
        assert.deepEqual(revoked.body, { message: "La sesion fue cerrada o expiro.", code: "SESSION_REVOKED" });
      }
      // 6: la sesion nueva emitida en la respuesta funciona.
      const fresh = `Bearer ${response.body.token}`;
      assert.equal((await sessionStatus(app, fresh)).status, 200);
      assert.equal(await activeSessions("residente"), 1);

      // La contrasena anterior ya no sirve y la nueva si; se guarda como hash bcrypt.
      assert.equal((await login(app, "residente", OLD)).status, 401);
      assert.equal((await login(app, "residente", NEW)).status, 200);
      const stored = await storedPassword("residente");
      assert.match(stored, /^\$2[aby]\$12\$/);
      assert.equal(await bcrypt.compare(NEW, stored), true);

      // 9: el otro usuario conserva su sesion y su contrasena.
      assert.equal((await sessionStatus(app, otherUser)).status, 200);
      assert.equal((await login(app, "otro", OLD)).status, 200);

      const [audit] = await query("SELECT id_usuario, datos_nuevos FROM AUDITORIA WHERE accion='PASSWORD_CHANGED' AND entidad_id=?", [String(users.residente.id)]);
      assert.equal(audit.id_usuario, users.residente.id);
      const auditData = typeof audit.datos_nuevos === "string" ? JSON.parse(audit.datos_nuevos) : audit.datos_nuevos;
      assert.equal(auditData.sesiones_revocadas, 2);
      assert.doesNotMatch(JSON.stringify(auditData), /Inicial123|Renovada456|\$2/);
    });

    test("2: contrasena actual incorrecta: 400 sin cerrar la sesion ni cambiar nada", async () => {
      const app = createApp();
      const auth = await tokenFor(app, "guardia");
      const before = await storedPassword("guardia");
      const response = await change(app, auth, valid("Equivocada999"));
      assert.equal(response.status, 400);
      assert.equal(response.body.code, "CURRENT_PASSWORD_INVALID");
      assert.equal(response.body.message, "La contrasena actual es incorrecta.");
      assert.deepEqual(response.body.errores, [{ field: "currentPassword", message: "La contrasena actual es incorrecta." }]);
      assert.equal(await storedPassword("guardia"), before);
      assert.equal((await sessionStatus(app, auth)).status, 200, "la sesion sigue activa");
    });

    // Son 7 errores de formulario seguidos (mas que el limite de 5): no deben bloquear al usuario.
    test("3/4: confirmacion distinta, politica, reutilizacion y campos faltantes no cambian la contrasena", async () => {
      const app = createApp();
      const auth = await tokenFor(app, "errores");
      const before = await storedPassword("errores");
      const cases = [
        [{ currentPassword: OLD, newPassword: NEW, confirmPassword: "Otra456789" }, "PASSWORD_CONFIRMATION_MISMATCH"],
        [valid(OLD, "corta1"), "PASSWORD_POLICY"],
        [valid(OLD, "sinnumerosaqui"), "PASSWORD_POLICY"],
        [valid(OLD, " Espacio123"), "PASSWORD_POLICY"],
        [valid(OLD, OLD), "PASSWORD_REUSED"],
        [{ currentPassword: OLD }, "PASSWORD_FIELDS_REQUIRED"],
        [{}, "PASSWORD_FIELDS_REQUIRED"],
      ];
      for (const [body, code] of cases) {
        const response = await change(app, auth, body);
        assert.equal(response.status, 400, code);
        assert.equal(response.body.code, code);
        assert.ok(response.body.message && Array.isArray(response.body.errores) && response.body.errores.length > 0);
        assert.doesNotMatch(JSON.stringify(response.body), /Inicial123|Renovada456|\$2/);
      }
      assert.equal(await storedPassword("errores"), before);
      assert.equal((await sessionStatus(app, auth)).status, 200);
    });

    test("8: sin sesion, con sesion revocada o con cabeceras simuladas no se cambia ninguna contrasena", async () => {
      const app = createApp();
      const before = await storedPassword("admin");
      const anonymous = await change(app, null, { ...valid(), id_usuario: users.admin.id });
      assert.equal(anonymous.status, 401);
      assert.equal(anonymous.body.code, "SESSION_REQUIRED");

      const simulated = await supertest(app).post("/auth/password/change")
        .set("x-user-id", String(users.admin.id)).set("x-user-role", "admin").send(valid());
      assert.equal(simulated.status, 401);

      const auth = await tokenFor(app, "admin");
      assert.equal((await supertest(app).post("/auth/logout").set("Authorization", auth)).status, 200);
      const revoked = await change(app, auth, valid());
      assert.equal(revoked.status, 401);
      assert.equal(revoked.body.code, "SESSION_REVOKED");
      assert.equal(await storedPassword("admin"), before);
    });

    test("compatibilidad: una cuenta heredada con contrasena sin hash puede cambiarla y queda con bcrypt", async () => {
      const app = createApp();
      const auth = await tokenFor(app, "legado", "1234");
      const response = await change(app, auth, valid("1234", NEW));
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.match(await storedPassword("legado"), /^\$2[aby]\$12\$/);
      assert.equal((await login(app, "legado", "1234")).status, 401);
      assert.equal((await login(app, "legado", NEW)).status, 200);
    });

    test("dos cambios simultaneos con la misma contrasena actual: solo uno se aplica", async () => {
      const app = createApp();
      await createUser("carrera", "residente");
      const auth = await tokenFor(app, "carrera");
      const results = await Promise.all([change(app, auth, valid(OLD, "Carrera111")), change(app, auth, valid(OLD, "Carrera222"))]);
      const statuses = results.map((r) => r.status).sort();
      assert.equal(statuses[0], 200);
      assert.ok([400, 401].includes(statuses[1]), `el perdedor no se aplica (${statuses[1]})`);
      const stored = await storedPassword("carrera");
      const matches = await Promise.all(["Carrera111", "Carrera222"].map((candidate) => bcrypt.compare(candidate, stored)));
      assert.equal(matches.filter(Boolean).length, 1, "queda exactamente una de las dos contrasenas nuevas");
      assert.equal(await activeSessions("carrera"), 1);
    });

    test("7: el cambio de contrasena se limita por usuario en el servidor, sin afectar a otros usuarios", async () => {
      const app = createApp();
      const auth = await tokenFor(app, "limite");
      const { limit } = SECURITY_RATE_LIMITS.passwordChange;
      for (let attempt = 1; attempt <= limit; attempt++) {
        assert.equal((await change(app, auth, valid("Equivocada999"))).status, 400, `intento ${attempt}`);
      }
      const blocked = await change(app, auth, valid());
      assert.equal(blocked.status, 429);
      assert.equal(blocked.body.code, "RATE_LIMITED");
      assert.equal(await bcrypt.compare(OLD, await storedPassword("limite")), true, "bloqueado aun con la contrasena correcta");

      // Mismo origen, otro usuario: su propio contador sigue disponible.
      const neighbour = await tokenFor(app, "limiteVecino");
      assert.equal((await change(app, neighbour, valid())).status, 200);
    });

    test("7: el login tambien se limita en el servidor tras intentos fallidos repetidos", async () => {
      const app = createApp();
      const { limit } = SECURITY_RATE_LIMITS.login;
      for (let attempt = 1; attempt <= limit; attempt++) {
        const failed = await login(app, "otro", "Equivocada999");
        assert.equal(failed.status, 401);
        assert.equal(failed.body.code, "INVALID_CREDENTIALS");
      }
      const blocked = await login(app, "otro", OLD);
      assert.equal(blocked.status, 429);
      assert.equal(blocked.body.code, "RATE_LIMITED");
    });
  });
}
