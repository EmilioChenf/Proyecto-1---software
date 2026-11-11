const mysql = require("mysql2/promise");
function isolatedConfig(database = process.env.PHASE0_TEST_DATABASE) {
  const port = Number(process.env.PHASE0_TEST_PORT);
  if (process.env.RUN_PHASE0_MYSQL_TESTS !== "1" || !/^nexus_phase0_test_\d{8}_[a-f0-9]{8}(?:_run_[a-f0-9]{6})?(?:_restore(?:_[a-f0-9]{8})?)?$/.test(database || "")
    || !Number.isInteger(port) || port < 1024 || [3306, 3308, 3318].includes(port)) {
    throw new Error("Se requiere una base y puerto exclusivos de pruebas Fase 0; no hay valores por defecto.");
  }
  return { host: "127.0.0.1", port, user: "root", password: "", database, dateStrings: true, connectionLimit: 10 };
}
function configureTestEnvironment() {
  const config = isolatedConfig();
  Object.assign(process.env, { NODE_ENV: "test", DB_HOST: config.host, DB_PORT: String(config.port), DB_USER: config.user,
    DB_PASSWORD: "", DB_NAME: config.database, SESSION_SECRET: "phase0-isolated-test-only", USE_BCRYPT: "false",
    RECURRENTE_SECRET_KEY: "", RECURRENTE_WEBHOOK_SECRET: "", RECURRENTE_SANDBOX_ID: "", EMAIL_API_URL: "", EMAIL_API_KEY: "", SMTP_USER: "", SMTP_PASS: "", EMAIL_NOTIFICATIONS_ENABLED: "false" });
  return config;
}
async function connect(database, multipleStatements = false) {
  const config = isolatedConfig(database);
  const connection = await mysql.createConnection({ ...config, multipleStatements: multipleStatements === true });
  const [rows] = await connection.query("SELECT DATABASE() AS name");
  if (rows[0].name !== config.database) { await connection.end(); throw new Error("Base de pruebas inesperada."); }
  return connection;
}
module.exports = { isolatedConfig, configureTestEnvironment, connect };
