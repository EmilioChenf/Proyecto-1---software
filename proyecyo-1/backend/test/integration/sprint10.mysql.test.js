const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { configureTestEnvironment, connect } = require("./support/isolatedMysql");

// Sprint 10 (HU-C03, HU-C04, HU-C05): flujo completo Frontend -> API -> MySQL con
// sesiones Bearer reales sobre una base TEST desechable. Nada usa cabeceras simuladas.
if (process.env.RUN_PHASE0_MYSQL_TESTS !== "1") test("Sprint 10 necesita el runner MySQL desechable", { skip: true }, () => {});
else {
  const isolation = require("./support/suiteIsolation");
  isolation.assertOwnedSuiteDatabase();
  configureTestEnvironment();
  const db = require("../../src/database/mysql");
  const { createActiveSession } = require("../../src/services/activeSessionsService");
  const { guatemalaToday } = require("../../src/utils/guatemalaTime");
  const http = () => require("supertest")(require("../../src/app").createApp());

  let conn;
  const tag = `S10${randomUUID().slice(0, 6)}`;
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
  // Vigente ahora en Guatemala; el inicio no queda en el pasado (HU-C06.6).
  const currentWindow = () => {
    const now = guatemalaMinutesNow();
    return { hora_inicio: hhmm(now), hora_fin: hhmm(Math.min(23 * 60 + 59, now + 60)) };
  };
  function futureDate(days) {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  async function createUser(key, role) {
    const [{ id_tipo_usuario: typeId }] = await query("SELECT id_tipo_usuario FROM TIPO_USUARIO WHERE nombre=?", [role]);
    const id = (await query(
      "INSERT INTO USUARIO(nombre,dpi,correo,password,activo,id_tipo_usuario) VALUES(?,?,?,'x',TRUE,?)",
      [`${tag} ${key}`, uniqueDpi(), `${tag.toLowerCase()}.${key}@test.invalid`, typeId],
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
  const as = (key) => ({ Authorization: auth[key] });
  const postVisit = (key, body) => http().post("/visitas").set(as(key))
    .send({ placa: "", fecha: today, tipo_visita: "VISITA", ...currentWindow(), ...body });
  const entry = (key, visit) => http().post("/guardia/registrar-ingreso").set(as(key)).send({ qrToken: visit.qr_value });
  const exit = (key, visit) => http().post("/guardia/registrar-salida").set(as(key)).send({ qrToken: visit.qr_value });
  const validate = (key, qrValue) => http().post("/guardia/validar-qr").set(as(key)).send({ qrToken: qrValue });

  describe("Sprint 10: visitantes, accesos con historial y reservas", () => {
    before(async () => {
      conn = await connect(process.env.PHASE0_TEST_DATABASE);
      for (const [clave, valor] of [["visitas_hora_apertura", "00:00"], ["visitas_hora_cierre", "23:59"],
        ["visitas_duracion_maxima_horas", "12"], ["visitas_activo", "true"]]) {
        await query("INSERT INTO CONFIGURACION(clave,valor) VALUES(?,?) ON DUPLICATE KEY UPDATE valor=VALUES(valor)", [clave, valor]);
      }
      await existingUser("resident", "residente@test.com");
      await existingUser("tenant", "inquilino@test.com");
      await createUser("guard", "guardia");
      await createUser("adminA", "admin");
      await createUser("adminB", "admin");
      // Segundo residente con su vivienda, para reservar el horario liberado.
      await createUser("residentB", "residente");
      const residentB = (await query("INSERT INTO RESIDENTE(id_usuario) VALUES(?)", [users.residentB])).insertId;
      await query("INSERT INTO CASA(numero,torre,id_residente) VALUES(?, 'S10', ?)", [tag.slice(-6), residentB]);
      // Cuentas sin reservas previas: las cuentas demo pueden tener el limite de 3 activas.
      await createUser("residentC", "residente");
      const residentC = (await query("INSERT INTO RESIDENTE(id_usuario) VALUES(?)", [users.residentC])).insertId;
      await query("INSERT INTO CASA(numero,torre,id_residente) VALUES(?, 'S10C', ?)", [tag.slice(-6), residentC]);
      await createUser("tenantB", "inquilino");
      // Las reservas no deben quedar bloqueadas por sanciones de otras suites.
      await query("UPDATE SANCION SET estado='PAGADA' WHERE estado='PENDIENTE'").catch(() => {});
    });
    after(async () => { await conn.end(); await db.pool.end(); });

    // ---------------------------------------------------------------- HU-C03
    test("HU-C03.1: una visita personal sin DPI o con DPI invalido se rechaza sin crear registros", async () => {
      const before = Number((await query("SELECT COUNT(*) n FROM ACCESO"))[0].n);
      const missing = await postVisit("resident", { nombre: `${tag} sin dpi`, dpi: "" });
      assert.equal(missing.status, 400);
      assert.equal(missing.body.code, "VISITOR_DOCUMENT_REQUIRED");
      assert.deepEqual(missing.body.errores.map((item) => item.field), ["dpi"]);
      const invalid = await postVisit("resident", { nombre: `${tag} dpi corto`, dpi: "12345" });
      assert.equal(invalid.status, 400);
      assert.equal(invalid.body.code, "INVALID_DPI");
      assert.equal(Number((await query("SELECT COUNT(*) n FROM ACCESO"))[0].n), before);
    });

    test("HU-C03.2/C03.3: un DPI existente con otro nombre no sobrescribe en silencio y devuelve el visitante", async () => {
      const dpi = uniqueDpi();
      const first = await postVisit("resident", { nombre: `${tag} Ana Original`, dpi });
      assert.equal(first.status, 201, JSON.stringify(first.body));

      const conflict = await postVisit("resident", { nombre: `${tag} Ana Cambiada`, dpi, fecha: futureDate(1), hora_inicio: "10:00", hora_fin: "11:00" });
      assert.equal(conflict.status, 409);
      assert.equal(conflict.body.code, "VISITOR_DATA_CONFLICT");
      assert.equal(conflict.body.existing.nombre, `${tag} Ana Original`);
      assert.equal(conflict.body.existing.dpi, dpi);
      const [stored] = await query("SELECT nombre FROM VISITANTE WHERE dpi=?", [dpi]);
      assert.equal(stored.nombre, `${tag} Ana Original`, "sin confirmacion no se cambian los datos");

      const confirmed = await postVisit("resident", {
        nombre: `${tag} Ana Cambiada`, dpi, fecha: futureDate(1), hora_inicio: "10:00", hora_fin: "11:00", confirmar_actualizacion: true,
      });
      assert.equal(confirmed.status, 201, JSON.stringify(confirmed.body));
      assert.equal((await query("SELECT nombre FROM VISITANTE WHERE dpi=?", [dpi]))[0].nombre, `${tag} Ana Cambiada`);
      assert.equal(Number((await query("SELECT COUNT(*) n FROM VISITANTE WHERE dpi=?", [dpi]))[0].n), 1);
    });

    test("HU-C03.8-C03.10: una visita equivalente se rechaza con mensaje claro y nunca emite dos QR validos", async () => {
      const dpi = uniqueDpi();
      const body = { nombre: `${tag} Duplicado`, dpi, fecha: futureDate(2), hora_inicio: "09:00", hora_fin: "10:00" };
      const first = await postVisit("resident", body);
      assert.equal(first.status, 201, JSON.stringify(first.body));
      const second = await postVisit("resident", body);
      assert.equal(second.status, 409);
      assert.equal(second.body.code, "DUPLICATE_VISIT");
      assert.match(second.body.message, /Ya existe una visita autorizada/);

      // Envio simultaneo con un DPI nuevo: el bloqueo por vivienda deja un unico QR.
      const fresh = { nombre: `${tag} Simultaneo`, dpi: uniqueDpi(), fecha: futureDate(2), hora_inicio: "12:00", hora_fin: "13:00" };
      const results = await Promise.all([postVisit("resident", fresh), postVisit("resident", fresh), postVisit("resident", fresh)]);
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409], JSON.stringify(results.map((r) => r.body)));
      const valid = await query(
        "SELECT COUNT(*) n FROM ACCESO a JOIN VISITANTE v ON v.id_visitante=a.id_visitante WHERE v.dpi=? AND a.estado_acceso='AUTORIZADA' AND a.token_qr IS NOT NULL",
        [fresh.dpi],
      );
      assert.equal(Number(valid[0].n), 1);
      assert.equal(Number((await query("SELECT COUNT(*) n FROM VISITANTE WHERE dpi=?", [fresh.dpi]))[0].n), 1);
    });

    test("HU-C03.4/C03.5: edicion explicita del visitante frecuente con DPI obligatorio y unico; la lista incluye la vivienda", async () => {
      const dpi = uniqueDpi();
      const created = await postVisit("tenant", { nombre: `${tag} Frecuente Inq`, dpi });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const list = await http().get("/visitantes-frecuentes").set(as("tenant"));
      const frequent = list.body.find((item) => item.dpi === dpi);
      assert(frequent, "el inquilino ve a su visitante frecuente");
      assert.equal(frequent.casa, created.body.casa, "HU-C03.5: la vivienda se muestra al confirmar el acceso rapido");

      const renamed = await http().patch(`/visitantes-frecuentes/${frequent.id_visitante}`).set(as("tenant")).send({ nombre: `${tag} Frecuente Editado` });
      assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
      assert.equal(renamed.body.dpi, dpi);
      const cleared = await http().patch(`/visitantes-frecuentes/${frequent.id_visitante}`).set(as("tenant")).send({ dpi: "" });
      assert.equal(cleared.status, 400);
      assert.equal(cleared.body.code, "VISITOR_DOCUMENT_REQUIRED");
      const otherDpi = (await query("SELECT dpi FROM VISITANTE WHERE dpi IS NOT NULL AND id_visitante<>? LIMIT 1", [frequent.id_visitante]))[0].dpi;
      const taken = await http().patch(`/visitantes-frecuentes/${frequent.id_visitante}`).set(as("tenant")).send({ dpi: otherDpi });
      assert.equal(taken.status, 409);
      assert.equal(taken.body.code, "VISITOR_DPI_IN_USE");
      assert.equal((await query("SELECT dpi FROM VISITANTE WHERE id_visitante=?", [frequent.id_visitante]))[0].dpi, dpi);
    });

    test("HU-C03.6/C03.7: con historial el visitante se desactiva, conserva sus visitas y se reactiva al autorizarlo de nuevo", async () => {
      const dpi = uniqueDpi();
      const created = await postVisit("resident", { nombre: `${tag} Con Historial`, dpi });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.equal((await entry("guard", created.body)).status, 200);
      assert.equal((await exit("guard", created.body)).status, 200);

      const removed = await http().delete(`/visitantes-frecuentes/${created.body.id_visitante}`).set(as("resident"));
      assert.equal(removed.status, 200, JSON.stringify(removed.body));
      assert.equal(removed.body.desactivado, true);
      const [visitor] = await query("SELECT activo FROM VISITANTE WHERE id_visitante=?", [created.body.id_visitante]);
      assert.equal(Number(visitor.activo), 0);
      const [access] = await query(
        "SELECT a.estado_acceso, ra.hora_ingreso IS NOT NULL ingreso, ra.hora_salida IS NOT NULL salida FROM ACCESO a JOIN REGISTRO_ACCESO ra ON ra.id_acceso=a.id_acceso WHERE a.id_acceso=?",
        [created.body.id_acceso],
      );
      assert.deepEqual({ ...access, ingreso: Number(access.ingreso), salida: Number(access.salida) }, { estado_acceso: "SALIDA_REGISTRADA", ingreso: 1, salida: 1 });
      const frequent = await http().get("/visitantes-frecuentes").set(as("resident"));
      assert(!frequent.body.some((item) => item.id_visitante === created.body.id_visitante));

      const again = await postVisit("resident", { nombre: `${tag} Con Historial`, dpi, fecha: futureDate(3), hora_inicio: "08:00", hora_fin: "09:00" });
      assert.equal(again.status, 201, JSON.stringify(again.body));
      assert.equal(again.body.id_visitante, created.body.id_visitante);
      assert.equal(Number((await query("SELECT activo FROM VISITANTE WHERE id_visitante=?", [created.body.id_visitante]))[0].activo), 1);
    });

    // ---------------------------------------------------------------- HU-C04
    test("HU-C04.1/C04.7 antes del ingreso: sin movimientos ni lecturas la visita se elimina fisicamente", async () => {
      const created = await postVisit("resident", { nombre: `${tag} Sin Uso`, dpi: uniqueDpi(), fecha: futureDate(4), hora_inicio: "10:00", hora_fin: "11:00" });
      assert.equal(created.status, 201);
      const removed = await http().delete(`/visitas/${created.body.id_acceso}`).set(as("resident"));
      assert.equal(removed.status, 200, JSON.stringify(removed.body));
      assert.equal(removed.body.desactivada, false);
      assert.equal((await query("SELECT COUNT(*) n FROM ACCESO WHERE id_acceso=?", [created.body.id_acceso]))[0].n, 0);
    });

    test("HU-C04.1-C04.3/C04.7 durante y despues: con el visitante adentro no se elimina; tras la salida se retira conservando todo", async () => {
      const created = await postVisit("resident", { nombre: `${tag} Movimientos`, dpi: uniqueDpi() });
      assert.equal(created.status, 201);
      assert.equal((await entry("guard", created.body)).status, 200);

      const inside = await http().delete(`/visitas/${created.body.id_acceso}`).set(as("resident"));
      assert.equal(inside.status, 409);
      assert.equal(inside.body.code, "VISIT_IN_PROGRESS");
      const cancelInside = await http().patch(`/visitas/${created.body.id_acceso}/cancelar`).set(as("resident"));
      assert.equal(cancelInside.status, 409);

      assert.equal((await exit("guard", created.body)).status, 200);
      const cancelFinished = await http().patch(`/visitas/${created.body.id_acceso}/cancelar`).set(as("resident"));
      assert.equal(cancelFinished.status, 409);
      assert.equal(cancelFinished.body.code, "VISIT_ALREADY_FINISHED");

      const before = (await query(
        "SELECT a.id_visitante, a.id_casa, a.fecha, a.hora_inicio, a.hora_fin, ra.hora_ingreso, ra.hora_salida, ra.id_guardia_ingreso, ra.id_guardia_salida FROM ACCESO a JOIN REGISTRO_ACCESO ra ON ra.id_acceso=a.id_acceso WHERE a.id_acceso=?",
        [created.body.id_acceso],
      ))[0];
      const removed = await http().delete(`/visitas/${created.body.id_acceso}`).set(as("resident"));
      assert.equal(removed.status, 200, JSON.stringify(removed.body));
      assert.equal(removed.body.desactivada, true);

      const afterRow = (await query(
        "SELECT a.id_visitante, a.id_casa, a.fecha, a.hora_inicio, a.hora_fin, ra.hora_ingreso, ra.hora_salida, ra.id_guardia_ingreso, ra.id_guardia_salida FROM ACCESO a JOIN REGISTRO_ACCESO ra ON ra.id_acceso=a.id_acceso WHERE a.id_acceso=?",
        [created.body.id_acceso],
      ))[0];
      assert.deepEqual(afterRow, before, "visitante, vivienda, timestamps y guardias se conservan");
      const [flags] = await query("SELECT estado_acceso, eliminado_en IS NOT NULL eliminado, id_usuario_elimina FROM ACCESO WHERE id_acceso=?", [created.body.id_acceso]);
      assert.deepEqual({ ...flags, eliminado: Number(flags.eliminado) }, { estado_acceso: "SALIDA_REGISTRADA", eliminado: 1, id_usuario_elimina: users.resident });
      assert.equal((await query("SELECT COUNT(*) n FROM AUDITORIA WHERE accion='VISIT_ARCHIVED' AND entidad_id=? AND id_usuario=?", [String(created.body.id_acceso), users.resident]))[0].n, 1);

      const residentList = await http().get("/visitas").set(as("resident"));
      assert(!residentList.body.some((item) => item.id_acceso === created.body.id_acceso), "se retira de la lista del residente");
      const adminList = await http().get("/admin/accesos").set(as("adminA"));
      const adminRow = adminList.body.find((item) => item.id_acceso === created.body.id_acceso);
      assert(adminRow, "el administrador conserva el acceso en el historial");
      assert.equal(adminRow.estado_detalle, "SALIDA_REGISTRADA");
      assert.equal(adminRow.eliminado_por_residente, true);
      assert(adminRow.hora_ingreso && adminRow.hora_salida);
    });

    test("HU-C04.4/C04.5: una visita cancelada no reutiliza su QR, registra quien la cancelo y conserva las lecturas", async () => {
      const created = await postVisit("tenant", { nombre: `${tag} Cancelada`, dpi: uniqueDpi() });
      assert.equal(created.status, 201);
      const cancelled = await http().patch(`/visitas/${created.body.id_acceso}/cancelar`).set(as("tenant"));
      assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
      assert.equal(cancelled.body.qr_status, "CANCELLED");
      const [row] = await query("SELECT estado_acceso, id_usuario_cancela, cancelado_en IS NOT NULL cancelado FROM ACCESO WHERE id_acceso=?", [created.body.id_acceso]);
      assert.deepEqual({ ...row, cancelado: Number(row.cancelado) }, { estado_acceso: "CANCELADA", id_usuario_cancela: users.tenant, cancelado: 1 });

      const validation = await validate("guard", created.body.qr_value);
      assert.equal(validation.status, 410);
      assert.equal(validation.body.code, "ACCESS_CANCELLED");
      assert.equal((await entry("guard", created.body)).status, 410);
      assert.equal((await query("SELECT COUNT(*) n FROM REGISTRO_ACCESO WHERE id_acceso=?", [created.body.id_acceso]))[0].n, 0);

      const adminList = await http().get("/admin/accesos").set(as("adminB"));
      const adminRow = adminList.body.find((item) => item.id_acceso === created.body.id_acceso);
      assert.equal(adminRow.estado_detalle, "CANCELADA");
      assert.equal(adminRow.cancelado_por, "Inquilino Demo");

      // Hubo lecturas de QR: eliminarla solo la retira de la lista; los intentos conservan su acceso.
      const attempts = Number((await query("SELECT COUNT(*) n FROM INTENTO_VALIDACION_QR WHERE id_acceso=?", [created.body.id_acceso]))[0].n);
      assert(attempts >= 2);
      const removed = await http().delete(`/visitas/${created.body.id_acceso}`).set(as("tenant"));
      assert.equal(removed.body.desactivada, true);
      assert.equal(Number((await query("SELECT COUNT(*) n FROM INTENTO_VALIDACION_QR WHERE id_acceso=?", [created.body.id_acceso]))[0].n), attempts);
    });

    test("HU-C04.4/C04.5: una visita vencida no permite usar su QR y se muestra como vencida", async () => {
      const dpi = uniqueDpi();
      const visitorId = (await query("INSERT INTO VISITANTE(nombre,dpi,activo) VALUES(?,?,TRUE)", [`${tag} Vencida`, dpi])).insertId;
      const [{ id_casa: houseId }] = await query(
        "SELECT c.id_casa FROM CASA c JOIN RESIDENTE r ON r.id_residente=c.id_residente WHERE r.id_usuario=? LIMIT 1", [users.resident]);
      const token = randomUUID().replace(/-/g, "");
      const accessId = (await query(
        // Hoy con un horario que ya termino (el panel admin muestra los accesos del dia).
        "INSERT INTO ACCESO(id_visitante,id_casa,id_usuario_autoriza,fecha,hora_inicio,hora_fin,tipo_visita,token_qr,estado_acceso) VALUES(?,?,?,?,'00:00','00:01','VISITA',?,'AUTORIZADA')",
        [visitorId, houseId, users.resident, today, token],
      )).insertId;
      const validation = await validate("guard", `NEXUSVISIT:${token}`);
      assert.equal(validation.status, 410);
      assert.equal(validation.body.code, "QR_EXPIRED");
      const entered = await http().post("/guardia/registrar-ingreso").set(as("guard")).send({ qrToken: `NEXUSVISIT:${token}` });
      assert.equal(entered.status, 410);
      assert.equal((await query("SELECT estado_acceso FROM ACCESO WHERE id_acceso=?", [accessId]))[0].estado_acceso, "AUTORIZADA");
      const adminList = await http().get("/admin/accesos").set(as("adminA"));
      assert.equal(adminList.body.find((item) => item.id_acceso === accessId).estado_detalle, "VENCIDA");
      const residentList = await http().get("/visitas").set(as("resident"));
      const mine = residentList.body.find((item) => item.id_acceso === accessId);
      assert.equal(mine.qr_status, "EXPIRED");
      assert.equal(mine.qr_value, null);
    });

    test("HU-C04.6: ninguna relacion borra en cascada accesos, movimientos ni intentos", async () => {
      const rows = await query(
        `SELECT TABLE_NAME t, CONSTRAINT_NAME c, DELETE_RULE r FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
          WHERE CONSTRAINT_SCHEMA=DATABASE() AND (REFERENCED_TABLE_NAME IN ('ACCESO','VISITANTE','REGISTRO_ACCESO','RESERVA')
            OR TABLE_NAME IN ('ACCESO','REGISTRO_ACCESO','INTENTO_VALIDACION_QR','HISTORIAL_RESERVA','RESERVA'))`,
      );
      assert(rows.length > 0);
      assert.deepEqual(rows.filter((row) => row.r === "CASCADE"), []);
      // Borrar un usuario autor no puede llevarse la evidencia: sus referencias quedan en NULL o bloquean.
      const auditRefs = rows.filter((row) => ["fk_acceso_usuario_cancela", "fk_acceso_usuario_elimina", "fk_reserva_creada_por", "fk_reserva_cancelada_por"].includes(row.c));
      assert.deepEqual(auditRefs.map((row) => row.r), ["SET NULL", "SET NULL", "SET NULL", "SET NULL"]);
      await db.ensureAccessHistoryPreservationSchema(); // Idempotente.
      await db.ensureReservationAuditSchema();
    });

    // ---------------------------------------------------------------- HU-C05
    async function firstAmenity() {
      const list = await http().get("/admin/amenidades").set(as("adminA"));
      assert.equal(list.status, 200);
      return list.body.find((item) => item.activo && item.intervalo_minutos === 60);
    }
    const keyOf = (reservation) => reservation.reservation_key;

    test("HU-C05.1/C05.2: reservar en el pasado responde 400 con codigo y campo, y no guarda nada", async () => {
      const amenity = await firstAmenity();
      const before = Number((await query("SELECT COUNT(*) n FROM RESERVA"))[0].n);
      const past = await http().post("/reservas/amenidades").set(as("resident"))
        .send({ id_amenidad: amenity.id_amenidad, fecha: futureDate(-1), hora_inicio: amenity.hora_apertura, hora_fin: hhmm(Number(amenity.hora_apertura.slice(0, 2)) * 60 + 60) });
      assert.equal(past.status, 400);
      assert.equal(past.body.code, "RESERVATION_IN_PAST");
      assert.equal(past.body.errores[0].field, "fecha");
      assert.equal(Number((await query("SELECT COUNT(*) n FROM RESERVA"))[0].n), before);
    });

    test("HU-C05.3-C05.12: modificar registra el cambio; admin cancela con motivo, se audita, se notifica y libera el horario", async () => {
      const amenity = await firstAmenity();
      const fecha = futureDate(5);
      const open = Number(amenity.hora_apertura.slice(0, 2)) * 60;
      const slot = (offset) => ({ hora_inicio: hhmm(open + offset * 60), hora_fin: hhmm(open + offset * 60 + 60) });
      await query("DELETE FROM RESERVA WHERE id_amenidad=? AND fecha=?", [amenity.id_amenidad, fecha]);

      const created = await http().post("/reservas/amenidades").set(as("residentB")).send({ id_amenidad: amenity.id_amenidad, fecha, ...slot(1) });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const moved = await http().patch(`/reservas/amenidades/${encodeURIComponent(keyOf(created.body))}`).set(as("residentB"))
        .send({ id_amenidad: amenity.id_amenidad, fecha, ...slot(2) });
      assert.equal(moved.status, 200, JSON.stringify(moved.body));
      const [change] = await query("SELECT accion, detalle, realizado_por, realizado_por_rol FROM HISTORIAL_RESERVA WHERE id_usuario=? AND accion='MODIFICACION' ORDER BY id_historial DESC LIMIT 1", [users.residentB]);
      assert.equal(change.realizado_por, users.residentB);
      assert.match(change.detalle, new RegExp(`horario ${slot(1).hora_inicio}-${slot(1).hora_fin} -> ${slot(2).hora_inicio}-${slot(2).hora_fin}`));

      // HU-C05.12: solo un administrador activo cancela reservas ajenas.
      const path = `/admin/reservas/amenidades/${encodeURIComponent(keyOf(moved.body))}/cancelar`;
      for (const key of ["resident", "tenant", "guard"]) {
        const denied = await http().patch(path).set(as(key)).send({ motivo: "intento" });
        assert.equal(denied.status, 403, `${key} no puede cancelar como administrador`);
      }
      assert.equal((await http().patch(path).send({})).status, 401);
      const otherResident = await http().patch(`/reservas/amenidades/${encodeURIComponent(keyOf(moved.body))}/cancelar`).set(as("residentC"));
      assert.equal(otherResident.status, 404, "un residente no cancela la reserva de otro");
      assert.equal((await query("SELECT estado FROM RESERVA WHERE id_usuario=? AND id_amenidad=? AND fecha=?", [users.residentB, amenity.id_amenidad, fecha]))[0].estado, "CONFIRMADA");

      const cancelled = await http().patch(path).set(as("adminA")).send({ motivo: "Mantenimiento de la amenidad" });
      assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
      assert.equal(cancelled.body.estado, "CANCELADA");
      const [stored] = await query("SELECT estado, cancelada_por, cancelada_en IS NOT NULL cuando, motivo_cancelacion FROM RESERVA WHERE id_usuario=? AND id_amenidad=? AND fecha=?", [users.residentB, amenity.id_amenidad, fecha]);
      assert.deepEqual({ ...stored, cuando: Number(stored.cuando) }, { estado: "CANCELADA", cancelada_por: users.adminA, cuando: 1, motivo_cancelacion: "Mantenimiento de la amenidad" });
      assert.equal((await http().patch(path).set(as("adminB")).send({})).status, 409, "cancelar dos veces no duplica el registro");

      // HU-C05.6: el residente lo ve de inmediato en su historial y en sus notificaciones.
      const history = await http().get("/reservas/amenidades/historial").set(as("residentB"));
      const entryRow = history.body.find((row) => row.accion === "CANCELACION_ADMIN");
      assert(entryRow, JSON.stringify(history.body.slice(0, 3)));
      assert.equal(entryRow.motivo, "Mantenimiento de la amenidad");
      assert.equal(entryRow.realizado_por_rol, "admin");
      assert.equal((await query("SELECT COUNT(*) n FROM NOTIFICACION WHERE id_usuario=? AND tipo='RESERVA_CANCELADA'", [users.residentB]))[0].n > 0, true);
      assert.equal((await query("SELECT COUNT(*) n FROM AUDITORIA WHERE accion='RESERVATION_CANCELLED' AND id_usuario=?", [users.adminA]))[0].n, 1);

      // HU-C05.7/C05.8: el calendario no cuenta la cancelada como ocupada y el horario queda libre.
      const availability = await http().get(`/admin/reservas/amenidades/disponibilidad?id_amenidad=${amenity.id_amenidad}&fecha=${fecha}`).set(as("adminB"));
      const freed = availability.body.slots.find((item) => item.hora_inicio === slot(2).hora_inicio);
      assert.equal(freed.disponible, true);
      const adminCalendar = await http().get(`/admin/reservas/amenidades?from=${fecha}&to=${fecha}&id_amenidad=${amenity.id_amenidad}`).set(as("adminB"));
      const listed = adminCalendar.body.find((row) => row.id_usuario === users.residentB);
      assert.equal(listed.estado_actual, "CANCELADA");
      assert.equal(listed.cancelada_por_nombre, `${tag} adminA`);
      const rebooked = await http().post("/reservas/amenidades").set(as("residentC")).send({ id_amenidad: amenity.id_amenidad, fecha, ...slot(2) });
      assert.equal(rebooked.status, 201, JSON.stringify(rebooked.body));
    });

    test("HU-C05.9/C05.11 y HU-C08.16: admin A reserva en nombre de un usuario; admin B lo ve con su autor y queda auditado", async () => {
      const amenity = await firstAmenity();
      const fecha = futureDate(6);
      const open = Number(amenity.hora_apertura.slice(0, 2)) * 60;
      await query("DELETE FROM RESERVA WHERE id_amenidad=? AND fecha=?", [amenity.id_amenidad, fecha]);
      const created = await http().post("/admin/reservas/amenidades").set(as("adminA"))
        .send({ id_usuario: users.tenantB, id_amenidad: amenity.id_amenidad, fecha, hora_inicio: hhmm(open), hora_fin: hhmm(open + 60) });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.equal(created.body.creada_por_admin, true);
      assert.equal((await query("SELECT creada_por FROM RESERVA WHERE id_usuario=? AND id_amenidad=? AND fecha=?", [users.tenantB, amenity.id_amenidad, fecha]))[0].creada_por, users.adminA);

      const seenByB = await http().get(`/admin/reservas/amenidades?from=${fecha}&to=${fecha}`).set(as("adminB"));
      const row = seenByB.body.find((item) => item.id_usuario === users.tenantB && item.id_amenidad === amenity.id_amenidad);
      assert.equal(row.creada_por_nombre, `${tag} adminA`);
      assert.equal(row.creada_por_admin, true);
      const [history] = await query("SELECT accion, realizado_por FROM HISTORIAL_RESERVA WHERE id_usuario=? AND accion='CREACION_ADMIN' ORDER BY id_historial DESC LIMIT 1", [users.tenantB]);
      assert.deepEqual(history, { accion: "CREACION_ADMIN", realizado_por: users.adminA });
      const [audit] = await query("SELECT id_usuario, datos_nuevos FROM AUDITORIA WHERE accion='RESERVATION_CREATED' AND id_usuario=? ORDER BY id_auditoria DESC LIMIT 1", [users.adminA]);
      assert.equal(audit.id_usuario, users.adminA);
      const data = typeof audit.datos_nuevos === "string" ? JSON.parse(audit.datos_nuevos) : audit.datos_nuevos;
      assert.equal(data.en_nombre_de_otro, true);
    });
  });
}
