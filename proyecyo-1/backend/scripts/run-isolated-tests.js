const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { openSuiteDatabase, prepareSuiteDatabase, closeSuiteDatabase } = require("../test/integration/support/suiteIsolation");

const suite = process.argv[2];
const sprint9Suites = ['sprint9-finance', 'sprint9-history', 'sprint9-exports'];
const repeatArg = process.argv.slice(3);
const repeat = repeatArg.length === 0 ? 1 : repeatArg.length === 1 && repeatArg[0] === "--repeat=2" ? 2 : 0;
const suites = new Set(["property", "postaudit", "finalaudit", "n1", "n2", "n2a1", "phase0", "hu13", "hu14", "hu15", "hu16", "hu17", "hu18", "hu19", "hu32", "viviendas", "correlation", "precision", "functional", "backend", "tarea5", "integration", "regression"]);

function execute() {
  let executable = process.execPath;
  let args = ["--test", "--test-concurrency=1", `test/integration/${suite === "phase0" ? "phase0" : suite}.mysql.test.js`];
  if (["tarea5", "integration", "regression"].includes(suite)) {
    args = ["--test", "--test-concurrency=1", "--test-reporter=tap",
      ...(suite === "integration" ? ["--test-name-pattern=^INT-"] : suite === "regression" ? ["--test-name-pattern=^REG-"] : []),
      "test/integration/tarea5.mysql.test.js"];
  }
  if (suite === "functional") args = ["scripts/test-phase0-functional.js"];
  if (suite === "backend") {
    if (process.env.npm_execpath) args = [process.env.npm_execpath, "test"];
    else if (process.platform === "win32") { executable = "cmd.exe"; args = ["/d", "/s", "/c", "npm.cmd test"]; }
    else { executable = "npm"; args = ["test"]; }
  }
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: path.resolve(__dirname, ".."), env: process.env, stdio: "inherit", windowsHide: true });
    child.once("error", reject); child.once("exit", (code) => resolve(code ?? 1));
  });
}

async function main() {
  for (const name of sprint9Suites) suites.add(name);
  if (!suites.has(suite) || !repeat) throw new Error("Suite u opciones inválidas.");
  let context, backupDir;
  try {
    context = await openSuiteDatabase();
    backupDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-suite-backups-"));
    process.env.BACKUP_DIR = backupDir;
    await prepareSuiteDatabase(context);
    for (let iteration = 1; iteration <= repeat; iteration++) {
      console.log(JSON.stringify({ suite, iteration, database: context.name, sharedDatabaseReadOnly: true }));
      const code = await execute();
      if (code) { process.exitCode = code; break; }
    }
  } finally {
    const db = require.cache[require.resolve("../src/database/mysql")]?.exports;
    if (db) await db.pool.end();
    if (context) {
      const removed = await closeSuiteDatabase(context);
      console.log(JSON.stringify({ suite, temporaryDatabasesRemoved: removed, sharedCountsAndEvidenceUnchanged: true }));
    }
    if (backupDir) {
      const resolved = path.resolve(backupDir), expectedParent = path.resolve(os.tmpdir());
      if (path.dirname(resolved) !== expectedParent || !path.basename(resolved).startsWith("nexus-suite-backups-")) throw new Error("Directorio de pruebas inesperado; no se elimina.");
      await fs.rm(resolved, { recursive: true }); // Exclusively the directory created by mkdtemp above.
    }
  }
}
main().catch((error) => {
  // Do not log configuration, query payloads, credentials or arbitrary causes.
  console.error(`Falló runner TEST aislado (${error.code || error.name}).`);
  process.exitCode = 1;
});
