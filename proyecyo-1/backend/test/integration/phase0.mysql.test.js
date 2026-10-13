const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { fork } = require("node:child_process");
const { isolatedConfig, configureTestEnvironment, connect } = require("./support/isolatedMysql");

if (process.env.RUN_PHASE0_MYSQL_TESTS !== "1") {
  test("MySQL Fase 0 requiere infraestructura aislada explicita", { skip: true }, () => {});
} else {
  require("./support/suiteIsolation").assertOwnedSuiteDatabase();
  configureTestEnvironment();
  const db = require("../../src/database/mysql");
  const { applyRecurrentePreparation, applyRecurrenteCheckoutMigration, applyRecurrenteConfirmationMigration, applyRecurrenteAttemptsMigration } = require("../../src/database/recurrenteMigration");
  const { FINANCIAL_TABLES, BACKUP_TABLES } = require("../../src/database/backupTables");
  const { QUOTA_BALANCES_SQL, calculateBalance } = require("../../src/services/financialBalance");
  const { payObligation } = require("../../src/services/simulatedPaymentsService");
  const { applyPartialFixture, confirmFixture } = require("./support/financialFixtures");
  let connection;
  const prefix = `TEST-${randomUUID()}`;
  async function query(sql, params = []) { const [rows] = await connection.query(sql, params); return rows; }
  async function quota(monto = "100.00", recargo = "15.00") {
    const result = await query("INSERT INTO CUOTA(id_servicio,id_casa,monto,fecha_limite) VALUES(1,1,?,'2025-01-10')", [monto]);
    if (Number(recargo)) await query(`INSERT INTO RECARGO_APLICADO(id_cuota,id_casa,tipo_regla,monto_original,monto_recargo,fecha_aplicacion)
      VALUES(?,1,'FIJO',?,?,'2025-01-15')`, [result.insertId, monto, recargo]);
    return result.insertId;
  }
  async function payment(id, amount, date = "2025-02-01") {
    // These personal-account cases explicitly model payer 3. Occupancy alone
    // cannot establish a payer; actorless legacy cases are covered by N2.
    return (await query("INSERT INTO PAGO(id_cuota,monto_pagado,fecha_pago,id_actor) VALUES(?,?,?,3)", [id, amount, date])).insertId;
  }
  async function balance(id) { return (await query(`SELECT * FROM (${QUOTA_BALANCES_SQL}) balances WHERE id_cuota=?`, [id]))[0]; }
  async function checkout(id, changes = {}) {
    const row = { referencia_local: randomUUID(), id_externo: `${prefix}-${randomUUID()}`, idempotency_key: randomUUID(),
      id_cuota: id, id_usuario: 3, id_residente: 1, id_casa: 1, monto_centavos: 11500, capital_centavos: 10000,
      recargo_centavos: 1500, moneda: "GTQ", ambiente: "sandbox", ...changes };
    const result = await query("INSERT INTO CHECKOUT_RECURRENTE SET ?", row);
    return { ...row, id_checkout: result.insertId };
  }
  async function transaction(checkoutRow, changes = {}) {
    const row = { id_checkout: checkoutRow.id_checkout, id_externo: `${prefix}-${randomUUID()}`, idempotency_key: randomUUID(),
      id_cuota: checkoutRow.id_cuota, id_usuario: checkoutRow.id_usuario, id_casa: checkoutRow.id_casa,
      monto_centavos: checkoutRow.monto_centavos, moneda: checkoutRow.moneda, ambiente: checkoutRow.ambiente, ...changes };
    const result = await query("INSERT INTO TRANSACCION_RECURRENTE SET ?", row);
    return { ...row, id_transaccion: result.insertId };
  }
  async function event(changes = {}) {
    return query("INSERT INTO EVENTO_RECURRENTE SET ?", { svix_id: randomUUID(), ambiente: "sandbox",
      tipo_evento: "payment_intent.succeeded", hash_body: "a".repeat(64), ...changes });
  }
  async function refund(trans, changes = {}) {
    return query("INSERT INTO REEMBOLSO_RECURRENTE SET ?", { id_transaccion: trans.id_transaccion,
      id_externo: `${prefix}-${randomUUID()}`, idempotency_key: randomUUID(), id_usuario_solicitante: 1,
      monto_centavos: 500, moneda: trans.moneda, ambiente: trans.ambiente, tipo: "PARCIAL", ...changes });
  }
  function expectCode(promise, code) { return assert.rejects(promise, (error) => error.code === code); }
  async function snapshot(table) { return query(`SELECT * FROM \`${table}\` ORDER BY 1,2`); }
  function worker(file, env = {}) {
    const child = fork(path.join(__dirname, "support", file), [], { env: { ...process.env, ...env }, stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true });
    let completed = false;
    const ready = new Promise((resolve, reject) => {
      child.on("message", (message) => { if (message.ready) resolve(); });
      child.once("error", reject); child.once("exit", (code) => { if (!completed && code) reject(new Error(`TEST worker exit ${code}`)); });
    });
    const result = new Promise((resolve, reject) => {
      child.on("message", (message) => {
        if (message.result) { completed = true; resolve(message.result); }
        if (message.error) { completed = true; reject(Object.assign(new Error(message.error.message), { code: message.error.code })); }
      });
      child.once("error", reject);
      child.once("exit", (code) => { if (!completed) reject(new Error(`TEST worker exit ${code}`)); });
    });
    return { ready, result, send: (message) => child.send(message) };
  }

  describe("Fase 0 — MySQL real aislado", { concurrency: false }, () => {
    before(async () => {
      await require("./support/initializeTestSchema").initializeTestSchema();
      connection = await connect();
      const version = (await query("SELECT VERSION() version, DATABASE() name"))[0];
      assert.match(version.version, /^8\.4\./);
      assert.equal(version.name, isolatedConfig().database);
      for (const [name, ensure] of Object.entries(db)) if (name.startsWith("ensure")) await ensure();
      await applyRecurrentePreparation(connection);
      await applyRecurrenteCheckoutMigration(connection);
      await applyRecurrenteConfirmationMigration(connection); await applyRecurrenteAttemptsMigration(connection);
    });
    after(async () => { await connection?.end(); await db.pool.end(); });

    test("migracion aditiva repetible conserva filas previas y clasifica historicos/simulados", async () => {
      const histQuota = await quota(), simQuota = await quota();
      const histPay = await payment(histQuota, 10), simPay = await payment(simQuota, 10);
      await query(`INSERT INTO TRANSACCION_SIMULADA(id_pago,id_usuario,id_casa,rol,concepto,monto,estado)
        VALUES(?,3,1,'residente',?,10,'APROBADA')`, [simPay, prefix]);
      const tables = ["USUARIO", "RESIDENTE", "CASA", "CUOTA", "PAGO", "TRANSACCION_SIMULADA"];
      const beforeRows = await Promise.all(tables.map(snapshot));
      await applyRecurrentePreparation(connection); await applyRecurrentePreparation(connection);
      assert.deepEqual(await Promise.all(tables.map(snapshot)), beforeRows);
      assert.deepEqual(await query("SELECT origen,ambiente FROM PAGO_ORIGEN WHERE id_pago IN (?,?) ORDER BY id_pago", [histPay, simPay]),
        [{ origen: "HISTORICO", ambiente: "historical" }, { origen: "SIMULADO", ambiente: "academic" }]);
      assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "../../sql/migrations/001_recurrente_preparation.sql"), "utf8"), /\bDROP\s+TABLE/i);
    });
    test("cinco tablas: PK, FK, UNIQUE y tipos DECIMAL/centavos", async () => {
      for (const table of FINANCIAL_TABLES) {
        const keys = await query("SELECT CONSTRAINT_TYPE type FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?", [table]);
        assert(keys.some((k) => k.type === "PRIMARY KEY"), table);
        assert(keys.some((k) => k.type === "UNIQUE"), table);
        assert(keys.some((k) => k.type === "CHECK"), table);
        if (table !== "EVENTO_RECURRENTE") assert(keys.some((k) => k.type === "FOREIGN KEY"), table);
      }
      const columns = await query("SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE,NUMERIC_SCALE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND (COLUMN_NAME='monto_pagado' OR COLUMN_NAME='monto_centavos')");
      assert(columns.some((c) => c.TABLE_NAME === "PAGO" && c.DATA_TYPE === "decimal" && c.NUMERIC_SCALE === 2));
      for (const table of ["CHECKOUT_RECURRENTE", "TRANSACCION_RECURRENTE", "REEMBOLSO_RECURRENTE"]) assert(columns.some((c) => c.TABLE_NAME === table && c.DATA_TYPE === "bigint"));
    });
    test("checkout: IDs externos, referencia e idempotencia unicos", async () => {
      const id = await quota(), row = await checkout(id);
      for (const field of ["id_externo", "idempotency_key", "referencia_local"]) await expectCode(checkout(id, { [field]: row[field] }), "ER_DUP_ENTRY");
      await checkout(id, { id_externo: row.id_externo, idempotency_key: row.idempotency_key, ambiente: "production" });
    });
    test("transaccion: IDs externos e idempotencia unicos por ambiente", async () => {
      const id = await quota(), co = await checkout(id), row = await transaction(co);
      await expectCode(transaction(co, { id_externo: row.id_externo }), "ER_DUP_ENTRY");
      await expectCode(transaction(co, { idempotency_key: row.idempotency_key }), "ER_DUP_ENTRY");
      const production = await checkout(id, { ambiente: "production" });
      await transaction(production, { id_externo: row.id_externo, idempotency_key: row.idempotency_key });
    });
    test("evento: svix-id unico por ambiente y sensible a mayusculas", async () => {
      const id = `${prefix}-Case`;
      await event({ svix_id: id }); await expectCode(event({ svix_id: id }), "ER_DUP_ENTRY");
      await event({ svix_id: id, ambiente: "production" }); await event({ svix_id: `${prefix}-case` });
    });
    test("reembolso: IDs externos e idempotencia unicos; parcial y total", async () => {
      const co = await checkout(await quota()), trans = await transaction(co), key = randomUUID(), ext = randomUUID();
      await refund(trans, { id_externo: ext, idempotency_key: key });
      await expectCode(refund(trans, { id_externo: ext }), "ER_DUP_ENTRY");
      await expectCode(refund(trans, { idempotency_key: key }), "ER_DUP_ENTRY");
      await refund(trans, { tipo: "TOTAL", monto_centavos: 11500 });
      const prod = await transaction(await checkout(co.id_cuota, { ambiente: "production" }));
      await refund(prod, { id_externo: ext, idempotency_key: key });
    });
    test("FK rechazan cuota/casa, usuario, checkout, ambiente y moneda incoherentes", async () => {
      const id = await quota(), co = await checkout(id), trans = await transaction(co);
      await expectCode(checkout(id, { id_casa: 999999 }), "ER_NO_REFERENCED_ROW_2");
      await expectCode(checkout(999999), "ER_NO_REFERENCED_ROW_2");
      await expectCode(checkout(id, { id_usuario: 999999 }), "ER_NO_REFERENCED_ROW_2");
      await expectCode(transaction(co, { id_usuario: 4 }), "ER_NO_REFERENCED_ROW_2");
      await expectCode(transaction(co, { moneda: "USD" }), "ER_NO_REFERENCED_ROW_2");
      await expectCode(transaction(co, { ambiente: "production" }), "ER_NO_REFERENCED_ROW_2");
      await expectCode(refund(trans, { ambiente: "production" }), "ER_NO_REFERENCED_ROW_2");
      await expectCode(refund(trans, { moneda: "USD" }), "ER_NO_REFERENCED_ROW_2");
    });
    test("no se vinculan abonos academicos/historicos ni de otra cuota a una operacion real", async () => {
      const id = await quota(), co = await checkout(id), pay = await payment(id, 5);
      await query("INSERT INTO PAGO_ORIGEN VALUES(?,?,'SIMULADO','academic',NOW(6))", [pay, id]);
      await expectCode(transaction(co, { id_pago: pay, estado: "CONFIRMADA" }), "ER_NO_REFERENCED_ROW_2");
      const otherId = await quota(), otherPay = await payment(otherId, 5);
      await query("INSERT INTO PAGO_ORIGEN VALUES(?,?,'RECURRENTE','sandbox',NOW(6))", [otherPay, otherId]);
      await expectCode(transaction(co, { id_pago: otherPay, estado: "CONFIRMADA" }), "ER_NO_REFERENCED_ROW_2");
      const realQuota = await quota(), realCheckout = await checkout(realQuota), realPay = await payment(realQuota, 115);
      await query("INSERT INTO PAGO_ORIGEN VALUES(?,?,'RECURRENTE','sandbox',NOW(6))", [realPay, realQuota]);
      await transaction(realCheckout, { id_pago: realPay, estado: "CONFIRMADA" });
      await expectCode(transaction(realCheckout, { id_pago: realPay, estado: "CONFIRMADA" }), "ER_DUP_ENTRY");
      await expectCode(query("INSERT INTO PAGO_ORIGEN VALUES(?,?,'HISTORICO','historical',NOW(6))", [realPay, realQuota]), "ER_DUP_ENTRY");
      await expectCode(query("INSERT INTO PAGO_ORIGEN VALUES(?,?,'HISTORICO','production',NOW(6))", [await payment(id, 1), id]), "ER_CHECK_CONSTRAINT_VIOLATED");
    });
    test("CHECK rechaza centavos negativos/cero, moneda invalida y sumas incoherentes", async () => {
      const id = await quota();
      await expectCode(checkout(id, { monto_centavos: 0, capital_centavos: 0, recargo_centavos: 0 }), "ER_CHECK_CONSTRAINT_VIOLATED");
      await expectCode(checkout(id, { monto_centavos: 999 }), "ER_CHECK_CONSTRAINT_VIOLATED");
      await expectCode(checkout(id, { moneda: "123" }), "ER_CHECK_CONSTRAINT_VIOLATED");
      await assert.rejects(checkout(id, { monto_centavos: -1 }));
      const row = await checkout(id, { monto_centavos: 12345, capital_centavos: 12000, recargo_centavos: 345 });
      assert.equal(row.monto_centavos, 12345);
    });
    test("dos pagos simulados simultaneos producen exactamente un abono", async () => {
      const id = await quota(), results = await Promise.allSettled([payObligation(3, "residente", id), payObligation(3, "residente", id)]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(results.find((r) => r.status === "rejected").reason.status, 409);
      assert.equal((await query("SELECT COUNT(*) n FROM PAGO WHERE id_cuota=?", [id]))[0].n, 1);
      assert.equal(Number((await balance(id)).saldo_pendiente), 0);
    });
    test("dos conexiones insertando el mismo svix-id guardan un solo evento", async () => {
      const a = await connect(), b = await connect(), id = randomUUID();
      const sql = "INSERT INTO EVENTO_RECURRENTE(svix_id,ambiente,tipo_evento,hash_body) VALUES(?,'sandbox','payment_intent.succeeded',?)";
      try {
        const results = await Promise.allSettled([a.execute(sql, [id, "b".repeat(64)]), b.execute(sql, [id, "b".repeat(64)])]);
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        assert.equal(results.find((r) => r.status === "rejected").reason.code, "ER_DUP_ENTRY");
        assert.equal((await query("SELECT COUNT(*) n FROM EVENTO_RECURRENTE WHERE ambiente='sandbox' AND svix_id=?", [id]))[0].n, 1);
      } finally { await a.end(); await b.end(); }
    });
    test("dos procesos confirman una transaccion TEST una sola vez", async () => {
      const id = await quota(), trans = await transaction(await checkout(id));
      const a = worker("confirmationWorker.js"), b = worker("confirmationWorker.js");
      await Promise.all([a.ready, b.ready]); a.send({ transactionId: trans.id_transaccion }); b.send({ transactionId: trans.id_transaccion });
      const results = await Promise.all([a.result, b.result]);
      assert.equal(results.filter((r) => r.applied).length, 1);
      assert.equal(results[0].paymentId, results[1].paymentId);
      assert.equal((await query("SELECT COUNT(*) n FROM PAGO WHERE id_cuota=?", [id]))[0].n, 1);
      assert.equal(Number((await balance(id)).saldo_pendiente), 0);
    });
    test("abonos concurrentes Q10 + Q50: recargos Q0, capital Q55", async () => {
      const id = await quota(); await Promise.all([applyPartialFixture(id, 10), applyPartialFixture(id, 50)]);
      const row = await balance(id);
      assert.equal(Number(row.total_pagado), 60); assert.equal(Number(row.recargo_pendiente), 0);
      assert.equal(Number(row.capital_pendiente), 55); assert.equal(Number(row.saldo_pendiente), 55);
    });
    test("abonos concurrentes que excederian saldo: un rechazo sin saldo negativo", async () => {
      const id = await quota(), results = await Promise.allSettled([applyPartialFixture(id, 80), applyPartialFixture(id, 80)]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(results.find((r) => r.status === "rejected").reason.status, 409);
      const row = await balance(id); assert.equal(Number(row.total_pagado), 80); assert.equal(Number(row.saldo_pendiente), 35);
    });
    test("fallo tras PAGO revierte confirmacion TEST; reintento aplica una vez", async () => {
      const id = await quota(), trans = await transaction(await checkout(id));
      await assert.rejects(confirmFixture(trans.id_transaccion, true), /TEST failure/);
      assert.equal((await query("SELECT COUNT(*) n FROM PAGO WHERE id_cuota=?", [id]))[0].n, 0);
      assert.equal((await query("SELECT COUNT(*) n FROM PAGO_ORIGEN WHERE id_cuota=?", [id]))[0].n, 0);
      assert.equal((await query("SELECT estado FROM TRANSACCION_RECURRENTE WHERE id_transaccion=?", [trans.id_transaccion]))[0].estado, "PENDIENTE");
      await confirmFixture(trans.id_transaccion); await confirmFixture(trans.id_transaccion);
      assert.equal((await query("SELECT COUNT(*) n FROM PAGO WHERE id_cuota=?", [id]))[0].n, 1);
    });
    test("error SQL de origen revierte PAGO y TRANSACCION_SIMULADA reales", async () => {
      const id = await quota(), original = db.pool.getConnection.bind(db.pool);
      const beforeSim = await snapshot("TRANSACCION_SIMULADA"), beforeOrigin = await snapshot("PAGO_ORIGEN");
      db.pool.getConnection = async () => {
        const conn = await original(), execute = conn.execute.bind(conn);
        conn.execute = (sql, params) => sql.startsWith("INSERT INTO PAGO_ORIGEN")
          ? execute("INSERT INTO PAGO_ORIGEN(id_pago,id_cuota,origen,ambiente) VALUES(?,?,'SIMULADO','production')", params)
          : execute(sql, params);
        const release = conn.release.bind(conn); conn.release = () => { conn.execute = execute; conn.release = release; release(); };
        return conn;
      };
      try { await expectCode(payObligation(3, "residente", id), "ER_CHECK_CONSTRAINT_VIOLATED"); }
      finally { db.pool.getConnection = original; }
      assert.equal((await query("SELECT COUNT(*) n FROM PAGO WHERE id_cuota=?", [id]))[0].n, 0);
      assert.deepEqual(await snapshot("TRANSACCION_SIMULADA"), beforeSim);
      assert.deepEqual(await snapshot("PAGO_ORIGEN"), beforeOrigin);
      assert.equal(Number((await balance(id)).saldo_pendiente), 115);
    });
    for (const [paid, capital, surcharge, pending] of [[10, 100, 5, 105], [50, 65, 0, 65], [115, 0, 0, 0]]) {
      test(`Q100 + Q15 - Q${paid}: capital Q${capital}, recargo Q${surcharge}, saldo Q${pending}`, async () => {
        const id = await quota(); await payment(id, paid); const row = await balance(id);
        assert.equal(Number(row.capital_pendiente), capital); assert.equal(Number(row.recargo_pendiente), surcharge);
        assert.equal(Number(row.saldo_pendiente), pending);
        assert.equal(calculateBalance({ monto: row.monto, recargo: row.recargo, pagado: row.total_pagado }).saldo, pending);
      });
    }
    test("DECIMAL exacto: Q0.30 + Q0.10 - Q0.20 = Q0.20", async () => {
      const id = await quota("0.30", "0.10"); await payment(id, "0.20");
      assert.equal(Number((await balance(id)).saldo_pendiente), 0.2);
    });
    test("sobrepago Q120: saldo Q0 y exceso Q5; cobro adicional rechazado", async () => {
      const id = await quota(); await payment(id, 120);
      const row = await balance(id); assert.equal(Number(row.saldo_pendiente), 0); assert.equal(Number(row.sobrepago), 5);
      await assert.rejects(payObligation(3, "residente", id), { status: 409, code: "FINANCIAL_OVERPAYMENT" });
    });
    test("pagos fuera del periodo reducen saldo; solo movimientos dentro se muestran", async () => {
      const id = await quota(); await payment(id, 100, "2025-02-01"); const inPeriod = await payment(id, 15, "2026-08-15");
      const fullyOutside = await quota(); await payment(fullyOutside, 115, "2025-02-01");
      const detail = await require("../../src/services/residentFinancialDetailService").getFinancialDetail(3, { desde: "2026-08-01", hasta: "2026-08-31" });
      assert.equal(detail.cargos.find((q) => q.id_cuota === id).saldo, 0);
      assert.deepEqual(detail.pagos.filter((p) => p.id_cuota === id).map((p) => p.id_pago), [inPeriod]);
      assert.equal(detail.cargos.find((q) => q.id_cuota === fullyOutside).saldo, 0);
      assert.equal(detail.pagos.filter((p) => p.id_cuota === fullyOutside).length, 0);
      const tenant = await require("../../src/services/tenantAccountService").listTenantAccountStatement(4, { desde: "2026-08-01", hasta: "2026-08-31" });
      assert.equal(tenant.resumen.saldo_pendiente, 0);
      assert(!tenant.cuotas.some(q=>q.id_cuota===id || q.id_cuota===fullyOutside));
      const report = await require("../../src/services/adminPaymentsService").getMonthlyFinancialReport(8, 2026);
      assert.equal(report.pagos.filter((p) => p.id_cuota === id).length, 1);
      assert.equal(report.pagos.filter((p) => p.id_cuota === fullyOutside).length, 0);
    });
    test("consultas reales de administracion, morosos, cuentas y recibos funcionan", async () => {
      const admin = await require("../../src/services/adminPaymentsService").listDelinquentResidents(); assert(admin.length);
      const account = await require("../../src/services/residentAccountService").listResidentAccountStatement(3); assert(account.cuotas.length);
      const rows = await require("../../src/services/reportExportService").rows("morosos", { desde: "2099-01-01" }); assert(Array.isArray(rows));
      const id = await quota(), pay = await payment(id, 10);
      const receipt = await require("../../src/services/paymentReceiptService").getPaymentReceipt(3, "residente", pay);
      assert.equal(receipt.monto_pagado, 10);
    });
    test("backup y restore real conservan las cinco tablas y referencias compuestas", async () => {
      await applyRecurrentePreparation(connection);
      const content = await require("../../src/services/automaticBackupsService").generateSql();
      assert(content.trim().length > 0, "Respaldo generado no vacío");
      assert.doesNotMatch(content, /RECURRENTE_SECRET_KEY|RECURRENTE_WEBHOOK_SECRET|whsec_|X-SECRET-KEY/i);
      const { validateBackupPayload, verifyRestoredReferences } = require("../../src/services/restoresService");
      const validation = validateBackupPayload({ filename: "fixture.sql", content });
      const expectedRows = new Map(await Promise.all(BACKUP_TABLES.map(async (table) => [table, await snapshot(table)])));
      // An empty append-only audit table has no INSERT to export. The dedicated
      // recovery suite exercises its populated round trip; keep exact row counts here.
      for (const table of FINANCIAL_TABLES) {
        assert(BACKUP_TABLES.includes(table),table);
        assert.equal(validation.tables.includes(table),expectedRows.get(table).length>0,table);
      }
      const expectedStatements = [...expectedRows.values()].reduce((total, rows) => total + rows.length, 0);
      assert.equal(validation.statements.length, expectedStatements, "Exportar exactamente cada registro esperado, sin omisiones");
      for (const [table, rows] of expectedRows) if (rows.length) assert(validation.tables.includes(table), table);
      // Empty owned destination: never reuse previous restore data or alter the shared TEST database.
      const targetName = await require("./support/suiteIsolation").createOwnedRestoreDatabase(connection);
      const target = await connect(targetName);
      try {
        const tables = await query("SELECT TABLE_NAME name FROM information_schema.tables WHERE table_schema=DATABASE() ORDER BY TABLE_NAME");
        await target.query("SET FOREIGN_KEY_CHECKS=0");
        for (const { name } of tables) {
          const show = await query(`SHOW CREATE TABLE \`${name}\``);
          await target.query(show[0]["Create Table"].replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS"));
        }
        await target.query("SET FOREIGN_KEY_CHECKS=1");
        await applyRecurrenteCheckoutMigration(target);
        await applyRecurrenteConfirmationMigration(target); await applyRecurrenteAttemptsMigration(target);
        for (const table of BACKUP_TABLES) assert.equal((await target.query(`SELECT COUNT(*) n FROM \`${table}\``))[0][0].n, 0, `${table}: destino inicialmente vacío`);
        const types = await query("SELECT * FROM TIPO_USUARIO WHERE id_tipo_usuario=(SELECT id_tipo_usuario FROM USUARIO WHERE id_usuario=1)");
        const admin = await query("SELECT * FROM USUARIO WHERE id_usuario=1");
        await target.query("INSERT INTO TIPO_USUARIO SET ? ON DUPLICATE KEY UPDATE id_tipo_usuario=VALUES(id_tipo_usuario)", types[0]);
        await target.query("INSERT INTO USUARIO SET ? ON DUPLICATE KEY UPDATE id_usuario=VALUES(id_usuario)", admin[0]);
        const restore = worker("restoreWorker.js", { PHASE0_TEST_DATABASE: targetName });
        await restore.ready; restore.send({ content });
        assert.equal((await restore.result).estado, "COMPLETADA");
        for (const table of BACKUP_TABLES) {
          const [restored] = await target.query(`SELECT * FROM \`${table}\` ORDER BY 1,2`);
          assert.equal(restored.length, expectedRows.get(table).length, `${table}: conteo restaurado`);
          assert.deepEqual(restored, expectedRows.get(table), `${table}: todos los datos restaurados`);
        }
        await verifyRestoredReferences(target, BACKUP_TABLES);
        const constraints = async (conn) => (await conn.query("SELECT TABLE_NAME,CONSTRAINT_NAME,CONSTRAINT_TYPE FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,CONSTRAINT_NAME"))[0];
        assert.deepEqual(await constraints(target), await constraints(connection), "Conservar PK, FK, UNIQUE y CHECK");
        console.log(JSON.stringify({ backupBytes: Buffer.byteLength(content), exportedRows: expectedStatements, allTablesRestored: true, referentialIntegrity: true }));
      } finally { await target.end(); }
    });
    test("restore con FK huerfana revierte todo y restablece FOREIGN_KEY_CHECKS", async () => {
      const id = randomUUID(), service = `rollback-${id}`;
      const restore = require("../../src/services/restoresService");
      await assert.rejects(restore.restoreBackup(1, { filename: "bad-test.sql", content:
        `INSERT INTO SERVICIO(nombre,tipo_servicio) VALUES('${service}','General'); INSERT INTO PAGO_ORIGEN(id_pago,id_cuota,origen,ambiente) VALUES(99999999,99999999,'HISTORICO','historical');` }), { status: 400 });
      assert.equal((await query("SELECT COUNT(*) n FROM SERVICIO WHERE nombre=?", [service]))[0].n, 0);
      const conn = await db.pool.getConnection();
      try { const [rows] = await conn.query("SELECT @@FOREIGN_KEY_CHECKS enabled"); assert.equal(rows[0].enabled, 1); }
      finally { conn.release(); }
    });
  });
}
