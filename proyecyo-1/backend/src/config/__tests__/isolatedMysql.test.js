const { isolatedConfig, configureTestEnvironment } = require("../../../test/integration/support/isolatedMysql");
const originalEnv = { ...process.env };
beforeEach(() => {
  process.env.RUN_PHASE0_MYSQL_TESTS = "1";
  process.env.PHASE0_TEST_DATABASE = "nexus_phase0_test_20261001_1234abcd";
  process.env.PHASE0_TEST_PORT = "20378";
});
afterEach(() => { process.env = { ...originalEnv }; });

test("sin habilitacion explicita no acepta ni siquiera una base de pruebas", () => {
  delete process.env.RUN_PHASE0_MYSQL_TESTS;
  expect(() => isolatedConfig()).toThrow(/exclusivos de pruebas/);
});
test.each([undefined, "", "nexus_residencial", "nexus_phase0_test", "other_database"])("rechaza nombre de base no aislado: %s", (database) => {
  if (database === undefined) delete process.env.PHASE0_TEST_DATABASE;
  else process.env.PHASE0_TEST_DATABASE = database;
  expect(() => isolatedConfig()).toThrow(/sin valores por defecto|no hay valores por defecto/);
});
test.each([undefined, "0", "3306", "3308", "3318", "20378.5", "invalid"])("rechaza puerto no aislado: %s", (port) => {
  if (port === undefined) delete process.env.PHASE0_TEST_PORT;
  else process.env.PHASE0_TEST_PORT = port;
  expect(() => isolatedConfig()).toThrow(/exclusivos de pruebas/);
});
test("permite solamente nombres explicitos de validacion y restauracion", () => {
  const config = isolatedConfig();
  expect(config.host).toBe("127.0.0.1");
  expect(config.port).toBe(20378);
  expect(isolatedConfig(`${config.database}_restore`).database).toBe(`${config.database}_restore`);
});
test("configura el aislamiento antes de cargar la app y desactiva proveedores externos", () => {
  process.env.DB_NAME = "nexus_residencial";
  for (const key of ["RECURRENTE_SECRET_KEY", "RECURRENTE_WEBHOOK_SECRET", "RECURRENTE_SANDBOX_ID", "EMAIL_API_URL", "EMAIL_API_KEY", "SMTP_USER", "SMTP_PASS"]) process.env[key] = "fake-disabled-test-fixture";
  const config = configureTestEnvironment();
  expect(process.env.DB_NAME).toBe(config.database);
  expect(process.env.DB_HOST).toBe("127.0.0.1");
  expect(process.env.DB_PORT).toBe(String(config.port));
  for (const key of ["RECURRENTE_SECRET_KEY", "RECURRENTE_WEBHOOK_SECRET", "RECURRENTE_SANDBOX_ID", "EMAIL_API_URL", "EMAIL_API_KEY", "SMTP_USER", "SMTP_PASS"]) expect(process.env[key]).toBe("");
});
