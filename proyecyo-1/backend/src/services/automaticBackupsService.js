const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { pool, query } = require("../database/mysql");
const { BACKUP_TABLES, REQUIRED_FINANCIAL_TABLES, NOTIFICATION_TABLES, PROPERTY_TABLES } = require("../database/backupTables");
const { sanitizeText } = require("../utils/safeLogger");

const FREQUENCIES = new Set(["DIARIO", "SEMANAL", "MENSUAL"]);
const TABLES = BACKUP_TABLES;
let running = false;
let scheduler = null;

function validateConfig(input = {}) {
  const frequency = String(input.frecuencia || "").toUpperCase();
  const hour = String(input.hora || "");
  const retention = Number(input.retencion);
  if (!FREQUENCIES.has(frequency)) throw Object.assign(new Error("Frecuencia no permitida."), { status: 400 });
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hour)) throw Object.assign(new Error("Hora invalida."), { status: 400 });
  if (!Number.isInteger(retention) || retention < 1 || retention > 30) throw Object.assign(new Error("La retencion debe estar entre 1 y 30."), { status: 400 });
  if (typeof input.activo !== "boolean") throw Object.assign(new Error("El estado activo debe ser booleano."), { status: 400 });
  return { activo: input.activo, frecuencia: frequency, hora: hour, retencion: retention };
}

function backupDirectory() {
  return path.resolve(process.env.BACKUP_DIR || path.join(os.tmpdir(), "nexus-residencial-backups"));
}

function resolveKnownFile(fileKey) {
  if (!/^[A-Za-z0-9_.-]+\.sql$/.test(fileKey || "") || path.basename(fileKey) !== fileKey) {
    throw Object.assign(new Error("Archivo de respaldo invalido."), { status: 400 });
  }
  const root = backupDirectory();
  const target = path.resolve(root, fileKey);
  if (path.dirname(target) !== root) throw Object.assign(new Error("Ruta de respaldo invalida."), { status: 400 });
  return target;
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (Buffer.isBuffer(value)) return `X'${value.toString("hex")}'`;
  if (value instanceof Date) return `'${value.toISOString().slice(0, 19).replace("T", " ")}'`;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === 'object') value = JSON.stringify(value);
  return `'${String(value).replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
}

async function generateSql() {
  const statements = ["-- NexusResidencial: respaldo de datos compatible con restauracion HU5"];
  const connection = await pool.getConnection();
  try {
    await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    for (const table of TABLES) {
      let rows;
      try { [rows] = await connection.query({ sql: `SELECT * FROM \`${table}\``, dateStrings: true }); }
      catch (error) {
        // Legacy optional tables may be absent, but never silently omit payment metadata.
        if (error.code === "ER_NO_SUCH_TABLE" && ![...REQUIRED_FINANCIAL_TABLES,...NOTIFICATION_TABLES,...PROPERTY_TABLES].includes(table)) continue;
        throw error;
      }
      for (const row of rows) {
        const columns = Object.keys(row);
        if (!columns.length) continue;
        statements.push(`INSERT INTO \`${table}\` (${columns.map((c) => `\`${c}\``).join(",")}) VALUES (${columns.map((c) => sqlValue(row[c])).join(",")}) ON DUPLICATE KEY UPDATE \`${columns[0]}\`=VALUES(\`${columns[0]}\`);`);
      }
    }
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  return `${statements.join("\n")}\n`;
}

async function getConfig() {
  const rows = await query("SELECT clave, valor FROM CONFIGURACION WHERE clave LIKE 'respaldos_%'");
  const values = Object.fromEntries(rows.map((row) => [row.clave, row.valor]));
  return { activo: values.respaldos_activo === "true", frecuencia: values.respaldos_frecuencia || "DIARIO", hora: values.respaldos_hora || "02:00", retencion: Number(values.respaldos_retencion || 7) };
}

async function saveConfig(input) {
  const config = validateConfig(input);
  for (const [key, value] of Object.entries(config)) {
    await query("INSERT INTO CONFIGURACION (clave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)", [`respaldos_${key}`, String(value)]);
  }
  return config;
}

async function listBackups() {
  return query("SELECT id_respaldo, nombre_archivo, tipo, estado, tamano_bytes, duracion_ms, mensaje, iniciado_en, finalizado_en FROM RESPALDO_AUTOMATICO ORDER BY id_respaldo DESC LIMIT 50");
}

async function enforceRetention(retention) {
  const safeRetention = Math.min(30, Math.max(1, Number(retention) || 7));
  const old = await query(`SELECT id_respaldo, archivo_clave FROM RESPALDO_AUTOMATICO WHERE estado='COMPLETADO' ORDER BY id_respaldo DESC LIMIT 100 OFFSET ${safeRetention}`);
  for (const item of old) {
    if (item.archivo_clave) await fs.unlink(resolveKnownFile(item.archivo_clave)).catch(() => {});
    await query("DELETE FROM RESPALDO_AUTOMATICO WHERE id_respaldo=?", [item.id_respaldo]);
  }
}

async function executeBackup(userId = null, type = "MANUAL", generator = generateSql) {
  if (running) throw Object.assign(new Error("Ya existe un respaldo en ejecucion."), { status: 409 });
  running = true;
  const started = Date.now();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileKey = `nexus-${stamp}.sql`;
  const inserted = await query("INSERT INTO RESPALDO_AUTOMATICO (nombre_archivo,tipo,estado,creado_por) VALUES (?,?,'EN_PROCESO',?)", [fileKey, type, userId]);
  try {
    const content = await generator();
    if (Buffer.byteLength(content) > 2 * 1024 * 1024) throw new Error("El respaldo supera el limite compatible de 2 MB.");
    await fs.mkdir(backupDirectory(), { recursive: true });
    await fs.writeFile(resolveKnownFile(fileKey), content, { flag: "wx" });
    const size = Buffer.byteLength(content);
    await query("UPDATE RESPALDO_AUTOMATICO SET estado='COMPLETADO',tamano_bytes=?,duracion_ms=?,archivo_clave=?,mensaje='Respaldo completado.',finalizado_en=NOW() WHERE id_respaldo=?", [size, Date.now() - started, fileKey, inserted.insertId]);
    await enforceRetention((await getConfig()).retencion);
    return { id_respaldo: Number(inserted.insertId), estado: "COMPLETADO", nombre_archivo: fileKey, tamano_bytes: size };
  } catch (error) {
    await query("UPDATE RESPALDO_AUTOMATICO SET estado='FALLIDO',duracion_ms=?,mensaje=?,finalizado_en=NOW() WHERE id_respaldo=?", [Date.now() - started, sanitizeText(error.message).slice(0, 255), inserted.insertId]).catch(() => {});
    throw error;
  } finally { running = false; }
}

async function getDownload(id) {
  const rows = await query("SELECT nombre_archivo, archivo_clave FROM RESPALDO_AUTOMATICO WHERE id_respaldo=? AND estado='COMPLETADO'", [id]);
  if (!rows.length || !rows[0].archivo_clave) throw Object.assign(new Error("Respaldo no encontrado."), { status: 404 });
  const filePath = resolveKnownFile(rows[0].archivo_clave);
  await fs.access(filePath).catch(() => { throw Object.assign(new Error("El archivo ya no esta disponible."), { status: 404 }); });
  return { filePath, filename: rows[0].nombre_archivo };
}

function startScheduler() {
  if (scheduler) return scheduler;
  scheduler = setInterval(async () => {
    const config = await getConfig().catch(() => null);
    const now = new Date();
    const dueFrequency = config?.frecuencia === "DIARIO"
      || (config?.frecuencia === "SEMANAL" && now.getDay() === 1)
      || (config?.frecuencia === "MENSUAL" && now.getDate() === 1);
    if (!config?.activo || !dueFrequency || config.hora !== now.toTimeString().slice(0, 5)) return;
    const recent = await query("SELECT id_respaldo FROM RESPALDO_AUTOMATICO WHERE tipo='AUTOMATICO' AND iniciado_en >= CURDATE() LIMIT 1").catch(() => []);
    if (!recent.length) await executeBackup(null, "AUTOMATICO").catch(() => {});
  }, 60_000);
  scheduler.unref?.();
  return scheduler;
}

module.exports = { validateConfig, resolveKnownFile, getConfig, saveConfig, listBackups, executeBackup, getDownload, startScheduler, generateSql };
