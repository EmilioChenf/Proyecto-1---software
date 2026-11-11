const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");

// Arranque de un residencial nuevo (una copia del sistema por cliente).
//
// Con las variables BOOTSTRAP_* definidas y una base de datos vacia, crea el esquema
// (sql/init.sql), elimina los datos de ejemplo, crea la cuenta de administrador y
// guarda el nombre del residencial. Es seguro dejar las variables puestas: si la base
// ya tiene datos reales no cambia nada.

const INIT_SQL_PATH = path.resolve(__dirname, "../../sql/init.sql");
const DEMO_EMAIL_SUFFIX = "@test.com";
// Catalogos que el sistema necesita para funcionar; todo lo demas es dato de ejemplo.
const CATALOG_TABLES = new Set(["TIPO_USUARIO", "PERMISO", "TIPO_USUARIO_PERMISO", "CONFIGURACION", "SERVICIO", "AMENIDAD"]);
const MIN_PASSWORD_LENGTH = 10;

function readBootstrapConfig(env = process.env) {
  const correo = String(env.BOOTSTRAP_ADMIN_CORREO || "").trim().toLowerCase();
  if (!correo) return null;
  const config = {
    residencial: String(env.BOOTSTRAP_RESIDENCIAL_NOMBRE || "").trim(),
    adminNombre: String(env.BOOTSTRAP_ADMIN_NOMBRE || "Administrador").trim(),
    adminCorreo: correo,
    adminPassword: String(env.BOOTSTRAP_ADMIN_PASSWORD || ""),
    adminTelefono: String(env.BOOTSTRAP_ADMIN_TELEFONO || "").trim() || null,
    contactoCorreo: String(env.BOOTSTRAP_CONTACTO_CORREO || correo).trim().toLowerCase(),
    contactoTelefono: String(env.BOOTSTRAP_CONTACTO_TELEFONO || "").trim(),
    direccion: String(env.BOOTSTRAP_DIRECCION || "").trim(),
    limpiarDemo: String(env.BOOTSTRAP_LIMPIAR_DEMO || "").trim().toLowerCase() === "si",
  };
  const problems = [];
  if (config.residencial.length < 3 || config.residencial.length > 120) problems.push("BOOTSTRAP_RESIDENCIAL_NOMBRE debe tener entre 3 y 120 caracteres");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.adminCorreo) || config.adminCorreo.endsWith(DEMO_EMAIL_SUFFIX)) problems.push("BOOTSTRAP_ADMIN_CORREO debe ser un correo real");
  if (config.adminPassword.length < MIN_PASSWORD_LENGTH) problems.push(`BOOTSTRAP_ADMIN_PASSWORD debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`);
  if (problems.length) {
    const error = new Error(`Configuración de arranque inválida: ${problems.join("; ")}.`);
    error.code = "BOOTSTRAP_INVALIDO";
    throw error;
  }
  return config;
}

function schemaSql() {
  // init.sql crea y selecciona su propia base; aqui se usa la base configurada.
  return fs.readFileSync(INIT_SQL_PATH, "utf8")
    .split("\n")
    .filter((line) => !/^\s*(CREATE DATABASE|USE)\s/i.test(line))
    .join("\n");
}

async function tableExists(connection, database, table) {
  const [rows] = await connection.execute(
    "SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1",
    [database, table],
  );
  return rows.length > 0;
}

async function bootstrapResidencial(config, db, log = console) {
  const connection = await mysql.createConnection({
    host: db.host, port: db.port, user: db.user, password: db.password, database: db.database,
    multipleStatements: true, charset: "utf8mb4",
  });
  try {
    let createdSchema = false;
    if (!(await tableExists(connection, db.database, "USUARIO"))) {
      log.log("Base de datos vacía: creando el esquema del residencial…");
      await connection.query(schemaSql());
      createdSchema = true;
    }

    const [users] = await connection.query("SELECT correo FROM USUARIO");
    const realUsers = users.filter((u) => !String(u.correo || "").toLowerCase().endsWith(DEMO_EMAIL_SUFFIX));
    if (realUsers.some((u) => String(u.correo).toLowerCase() === config.adminCorreo)) {
      return { estado: "YA_INICIALIZADO" };
    }
    if (realUsers.length > 0) {
      return { estado: "OMITIDO", motivo: "La base ya tiene usuarios reales; no se modificó nada." };
    }
    const hasDemo = users.length > 0;
    if (hasDemo && !createdSchema && !config.limpiarDemo) {
      return { estado: "OMITIDO", motivo: "La base tiene datos de ejemplo. Define BOOTSTRAP_LIMPIAR_DEMO=si para reemplazarlos." };
    }

    const [tables] = await connection.execute(
      "SELECT TABLE_NAME AS nombre FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'",
      [db.database],
    );
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");
    try {
      for (const { nombre } of tables) {
        if (!CATALOG_TABLES.has(nombre)) await connection.query(`TRUNCATE TABLE \`${nombre}\``);
      }
    } finally {
      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    }

    await connection.beginTransaction();
    try {
      const [[adminType]] = await connection.execute("SELECT id_tipo_usuario FROM TIPO_USUARIO WHERE nombre = 'admin' LIMIT 1");
      const hash = await bcrypt.hash(config.adminPassword, 10);
      await connection.execute(
        "INSERT INTO USUARIO (nombre, dpi, correo, telefono, password, activo, id_tipo_usuario) VALUES (?, ?, ?, ?, ?, TRUE, ?)",
        [config.adminNombre, `ADMIN${randomUUID().replace(/-/g, "").slice(0, 15)}`, config.adminCorreo, config.adminTelefono, hash, adminType.id_tipo_usuario],
      );
      for (const [clave, valor] of [
        ["residencial_nombre", config.residencial],
        ["residencial_correo_contacto", config.contactoCorreo],
        ["residencial_telefono_contacto", config.contactoTelefono],
        ["residencial_direccion", config.direccion],
      ]) {
        await connection.execute(
          "INSERT INTO CONFIGURACION (clave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)",
          [clave, valor],
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
    return { estado: "INICIALIZADO", esquemaCreado: createdSchema, datosDeEjemploEliminados: hasDemo };
  } finally {
    await connection.end();
  }
}

/** Se llama al iniciar el servidor; sin variables BOOTSTRAP_* no hace nada. */
async function bootstrapFromEnvironment(env, log = console, { strict = false } = {}) {
  let config;
  try {
    config = readBootstrapConfig(process.env);
  } catch (error) {
    // Una variable mal escrita no debe tumbar una copia que ya funciona.
    if (strict) throw error;
    log.error(error.message);
    return null;
  }
  if (!config) return null;
  const result = await bootstrapResidencial(config, {
    host: env.DB_HOST, port: env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
  }, log);
  if (result.estado === "INICIALIZADO") log.log(`Residencial "${config.residencial}" inicializado. Administrador: ${config.adminCorreo}.`);
  else if (result.estado === "OMITIDO") log.log(`Arranque de residencial omitido: ${result.motivo}`);
  return result;
}

module.exports = { readBootstrapConfig, bootstrapResidencial, bootstrapFromEnvironment, CATALOG_TABLES };
