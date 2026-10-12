const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { connect, isolatedConfig, configureTestEnvironment } = require("./isolatedMysql");

const BASE_NAME = /^nexus_phase0_test_\d{8}_[a-f0-9]{8}$/;
const OWNER_TABLE = "NEXUS_TEST_RUN_OWNER";

function runName(base, token) {
  assert(BASE_NAME.test(base), "Se exige la base TEST original, nunca una base normal o restaurada.");
  assert(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(token), "Propietario TEST inválido.");
  // 46 characters, leaving room for the 17-character restore suffix in MySQL's 64-character limit.
  return `${base}_run_${token.slice(0, 6)}`;
}

function assertOwnedSuiteDatabase(env = process.env) {
  const expected = runName(env.PHASE0_TEST_BASE_DATABASE || "", env.PHASE0_TEST_RUN_TOKEN || "");
  assert(env.PHASE0_TEST_DATABASE === expected || new RegExp(`^${expected}_restore_[a-f0-9]{8}$`).test(env.PHASE0_TEST_DATABASE || ""),
    "Ejecuta las suites mediante npm run test:*:mysql; no pueden escribir en la base compartida.");
  return expected;
}

async function markDatabase(connection, base, token) {
  await connection.query(`CREATE TABLE ${OWNER_TABLE} (id TINYINT PRIMARY KEY, base_name VARCHAR(35) NOT NULL, run_token CHAR(36) NOT NULL)`);
  await connection.execute(`INSERT INTO ${OWNER_TABLE}(id,base_name,run_token) VALUES(1,?,?)`, [base, token]);
}

async function assertOwner(connection, name, base, token) {
  const expected = runName(base, token);
  assert(name === expected || new RegExp(`^${expected}_restore_[a-f0-9]{8}$`).test(name), "Nunca eliminar la base original ni destinos ajenos.");
  const [[owner]] = await connection.execute(`SELECT base_name,run_token FROM \`${name}\`.${OWNER_TABLE} WHERE id=1`);
  assert(owner && owner.base_name === base && owner.run_token === token, "La base no pertenece a esta ejecución; no se elimina.");
}

async function createOwnedRestoreDatabase(connection) {
  const source = assertOwnedSuiteDatabase();
  await assertOwner(connection, source, process.env.PHASE0_TEST_BASE_DATABASE, process.env.PHASE0_TEST_RUN_TOKEN);
  const name = `${source}_restore_${randomUUID().slice(0, 8)}`;
  await connection.query(`CREATE DATABASE \`${name}\``); // Never adopt an existing database.
  const target = await connect(name);
  try { await markDatabase(target, process.env.PHASE0_TEST_BASE_DATABASE, process.env.PHASE0_TEST_RUN_TOKEN); }
  finally { await target.end(); }
  return name;
}

async function protectedSnapshot(source) {
  const result = {};
  for (const [table, column, ids] of [["CUOTA", "id_cuota", "171,998"], ["PAGO", "id_cuota", "171,998"],
    ["PAGO_ORIGEN", "id_cuota", "171,998"], ["RECARGO_APLICADO", "id_cuota", "171,998"],
    ["CHECKOUT_RECURRENTE", "id_cuota", "171,998"], ["TRANSACCION_RECURRENTE", "id_cuota", "171,998"],
    ["EVENTO_RECURRENTE", "id_evento", "348,349,859,860,1072,1073,1074,1075"]]) {
    const protectedIds=column==='id_cuota' ? '171,998,1210' : ids;
    result[table] = (await source.query(`SELECT * FROM ${table} WHERE ${column} IN (${protectedIds}) ORDER BY 1`))[0];
  }
  return result;
}

async function copyReceiptEvidence(source, target, snapshot) {
  // Read the approved manual evidence; all writes go to the disposable copy.
  const dependencies = [
    ["TIPO_USUARIO", "SELECT t.* FROM TIPO_USUARIO t JOIN USUARIO u ON u.id_tipo_usuario=t.id_tipo_usuario JOIN RESIDENTE r ON r.id_usuario=u.id_usuario JOIN CASA c ON c.id_residente=r.id_residente WHERE c.id_casa IN (SELECT id_casa FROM CUOTA WHERE id_cuota IN(171,998,1210)) GROUP BY t.id_tipo_usuario"],
    ["USUARIO", "SELECT u.* FROM USUARIO u JOIN RESIDENTE r ON r.id_usuario=u.id_usuario JOIN CASA c ON c.id_residente=r.id_residente WHERE c.id_casa IN (SELECT id_casa FROM CUOTA WHERE id_cuota IN(171,998,1210)) GROUP BY u.id_usuario"],
    ["RESIDENTE", "SELECT r.* FROM RESIDENTE r JOIN CASA c ON c.id_residente=r.id_residente WHERE c.id_casa IN (SELECT id_casa FROM CUOTA WHERE id_cuota IN(171,998,1210)) GROUP BY r.id_residente"],
    ["CASA", "SELECT * FROM CASA WHERE id_casa IN(SELECT id_casa FROM CUOTA WHERE id_cuota IN(171,998,1210))"],
    ["SERVICIO", "SELECT * FROM SERVICIO WHERE id_servicio IN(SELECT id_servicio FROM CUOTA WHERE id_cuota IN(171,998,1210))"],
  ];
  await target.beginTransaction();
  try {
    // Events reference checkouts; transactions reference both checkouts and events.
    const financialOrder = ["CUOTA", "PAGO", "PAGO_ORIGEN", "RECARGO_APLICADO", "CHECKOUT_RECURRENTE", "EVENTO_RECURRENTE", "TRANSACCION_RECURRENTE"];
    const rows = [...await Promise.all(dependencies.map(async ([table, sql]) => [table, (await source.query(sql))[0]])),
      ...financialOrder.map((table) => [table, snapshot[table]])];
    for (const [table, records] of rows) for (const row of records) {
      const updates = Object.keys(row).map((column) => `\`${column}\`=VALUES(\`${column}\`)`).join(",");
      await target.query(`INSERT INTO \`${table}\` SET ? ON DUPLICATE KEY UPDATE ${updates}`, row);
    }
    await target.commit();
  } catch (error) { await target.rollback(); throw error; }
}

async function tableCounts(connection) {
  const { BACKUP_TABLES } = require("../../../src/database/backupTables");
  const entries=[];
  for (const table of BACKUP_TABLES) {
    try { entries.push([table,Number((await connection.query(`SELECT COUNT(*) n FROM \`${table}\``))[0][0].n)]); }
    catch(error) {
      if(error.code!=='ER_NO_SUCH_TABLE' || !['INTENTO_RECURRENTE','REVISION_EVENTO_RECURRENTE','REPARACION_REVISION_RECURRENTE','CICLO_NOTIFICACION_CUOTA','ENTREGA_NOTIFICACION_FINANCIERA'].includes(table)) throw error;
      entries.push([table,null]); // Shared manual DB may intentionally await migration 006.
    }
  }
  return Object.fromEntries(entries);
}

async function openSuiteDatabase() {
  const base = isolatedConfig().database;
  assert(BASE_NAME.test(base), "El runner debe recibir la base TEST original.");
  const source = await connect(base);
  const token = randomUUID(), name = runName(base, token);
  const snapshot = await protectedSnapshot(source), counts = await tableCounts(source);
  await source.query(`CREATE DATABASE \`${name}\``);
  Object.assign(process.env, { PHASE0_TEST_BASE_DATABASE: base, PHASE0_TEST_DATABASE: name, PHASE0_TEST_RUN_TOKEN: token });
  configureTestEnvironment();
  const target = await connect(name);
  const context = { base, token, name, source, snapshot, counts };
  try { await markDatabase(target, base, token); }
  finally { await target.end(); }
  return context;
}

async function prepareSuiteDatabase(context) {
  assertOwnedSuiteDatabase();
  await require("./initializeTestSchema").initializeTestSchema();
  const db = require("../../../src/database/mysql");
  for (const [name, ensure] of Object.entries(db)) if (name.startsWith("ensure")) await ensure();
  // HU32: el alquiler de Q2,200 ya no se siembra al arrancar; las suites lo reciben como fixture explicito.
  await require("./tenantAccountFixture").seedTenantAccountFixture(db.query);
  const target = await connect(context.name);
  try {
    const migrations = require("../../../src/database/recurrenteMigration");
    for (const apply of [migrations.applyRecurrentePreparation, migrations.applyRecurrenteCheckoutMigration,
      migrations.applyRecurrenteConfirmationMigration, migrations.applyRecurrenteAttemptsMigration]) await apply(target);
    await require('../../../src/database/propertyContractMigration').applyPropertyContractMigration(target);
    await copyReceiptEvidence(context.source, target, context.snapshot);
    // The financial copy intentionally contains only the established receipt cases.
    const copied=await protectedSnapshot(target);
    for(const table of Object.keys(copied)) assert.deepEqual(copied[table],context.snapshot[table],"La copia de evidencia debe conservar todos los datos.");
    await migrations.applyRecurrenteRefundsMigration(target);
    await migrations.applyRecurrenteIntentHistoryMigration(target);
    await migrations.applyRecurrenteReviewPrecisionMigration(target);
    await migrations.applyFinancialNotificationsMigration(target);
    await require('../../../src/database/propertyContractMigration').applyPropertyContractMigration(target);
  } finally { await target.end(); }
}

async function closeSuiteDatabase(context) {
  const { base, name, token, source } = context;
  try {
    assert.deepEqual(await protectedSnapshot(source), context.snapshot, "Evidencia original modificada.");
    assert.deepEqual(await tableCounts(source), context.counts, "Las suites no deben acumular datos en la base compartida.");
    const escaped = name.replace(/[!_%]/g, (c) => `!${c}`);
    const [schemas] = await source.execute("SELECT SCHEMA_NAME name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=? OR SCHEMA_NAME LIKE ? ESCAPE '!' ORDER BY SCHEMA_NAME DESC", [name, `${escaped}!_restore!_%`]);
    // Validate ALL candidates before deleting any. Full UUID ownership matters,
    // even if a database name has the same six-character prefix.
    for (const row of schemas) await assertOwner(source, row.name, base, token);
    for (const row of schemas) await source.query(`DROP DATABASE \`${row.name}\``);
    const [remaining] = await source.execute("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=? OR SCHEMA_NAME LIKE ? ESCAPE '!'", [name, `${escaped}!_restore!_%`]);
    assert.equal(remaining.length, 0, "No dejar bases propias acumuladas.");
    return schemas.length;
  } finally { await source.end(); }
}

module.exports = { runName, assertOwnedSuiteDatabase, assertOwner, createOwnedRestoreDatabase,
  protectedSnapshot, tableCounts, openSuiteDatabase, prepareSuiteDatabase, closeSuiteDatabase };
