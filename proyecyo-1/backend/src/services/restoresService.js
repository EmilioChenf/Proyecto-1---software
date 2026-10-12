const { pool, query } = require("../database/mysql");
const { FINANCIAL_TABLES, NOTIFICATION_TABLES, PROPERTY_TABLES } = require("../database/backupTables");
const { sanitizeText } = require("../utils/safeLogger");

const MAX_BACKUP_SIZE_BYTES = 2 * 1024 * 1024;
const RESTORABLE_TABLES = new Set([
  "ACCESO", "ACCESO_EXCEPCION", "AMENIDAD", "CASA", "CASA_SERVICIO",
  "COMUNICADO", "COMUNICADO_USUARIO", "CONFIGURACION", "CUOTA",
  "HISTORIAL_CAMBIO_PROVEEDOR", "HISTORIAL_RESERVA", "INQUILINO",
  "INQUILINO_CASA", "NOTIFICACION", "PAGO", "PERMISO", "PERMISO_INQUILINO",
  "REGISTRO_ACCESO", "REGLAMENTO", "RESERVA", "RESIDENTE", "SERVICIO",
  "SOLICITUD_AUTORIZACION_DIGITAL", "TICKET", "TIPO_USUARIO",
  "TIPO_USUARIO_PERMISO", "USUARIO", "VISITANTE",
  "RECARGO_APLICADO", "TRANSACCION_SIMULADA", ...FINANCIAL_TABLES, ...NOTIFICATION_TABLES,...PROPERTY_TABLES,
]);
const DISALLOWED_PATTERNS = [
  /\bDROP\s+DATABASE\b/i,
  /\bCREATE\s+DATABASE\b/i,
  /\bUSE\s+[`"\w-]+\b/i,
  /\bSOURCE\b/i,
  /\bLOAD\s+DATA\b/i,
  /\bINTO\s+OUTFILE\b/i,
  /\bINTO\s+DUMPFILE\b/i,
];

function normalizeString(value) {
  return String(value || "").trim();
}

function getBackupPayload(payload = {}) {
  return {
    filename: normalizeString(payload.filename),
    content: String(payload.content || ""),
  };
}

function ensureSqlFile(filename) {
  if (!filename.toLowerCase().endsWith(".sql")) {
    const error = new Error("Selecciona un archivo de respaldo con extension .sql.");
    error.status = 400;
    throw error;
  }
}

function stripLineComment(line) {
  const trimmed = line.trimStart();

  if (trimmed.startsWith("--") || trimmed.startsWith("#")) {
    return "";
  }

  return line;
}

function removeSqlComments(sql) {
  return sql
    .replace(/\/\*![\s\S]*?\*\//g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map(stripLineComment)
    .join("\n");
}

function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let quote = null;
  let escaped = false;

  for (const char of sql) {
    current += char;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }

    if (char === ";") {
      const statement = current.trim();

      if (statement) {
        statements.push(statement.slice(0, -1).trim());
      }

      current = "";
    }
  }

  const remaining = current.trim();

  if (remaining) {
    statements.push(remaining);
  }

  return statements.filter(Boolean);
}

function getAffectedTables(statements) {
  const tables = new Set();

  for (const statement of statements) {
    const match = statement.match(
      /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|TRUNCATE\s+TABLE)\s+`?([A-Za-z0-9_]+)`?/i,
    );

    if (match?.[1]) {
      tables.add(match[1].toUpperCase());
    }
  }

  return [...tables].sort();
}

function ensureSafeDataStatements(statements) {
  for (const statement of statements) {
    const match = statement.match(
      /^\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+`?([A-Za-z0-9_]+)`?/i,
    );
    const table = match?.[1]?.toUpperCase();

    // Data restores must stay in the selected application database.
    // Do not accept qualified targets such as USUARIO.other_table.
    const qualifiedTarget = /^\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+`?[A-Za-z0-9_]+`?\s*\./i.test(statement);

    if (!table || !RESTORABLE_TABLES.has(table) || qualifiedTarget) {
      const error = new Error(
        "El respaldo solo puede modificar datos de tablas autorizadas mediante INSERT, UPDATE o DELETE.",
      );
      error.status = 400;
      throw error;
    }
  }
}

function validateBackupPayload(payload = {}) {
  const { filename, content } = getBackupPayload(payload);
  ensureSqlFile(filename);

  const size = Buffer.byteLength(content, "utf8");

  if (!content.trim()) {
    const error = new Error("El archivo de respaldo esta vacio.");
    error.status = 400;
    throw error;
  }

  if (size > MAX_BACKUP_SIZE_BYTES) {
    const error = new Error("El respaldo supera el tamano maximo permitido de 2 MB.");
    error.status = 400;
    throw error;
  }

  for (const pattern of DISALLOWED_PATTERNS) {
    if (pattern.test(content)) {
      const error = new Error("El respaldo contiene instrucciones no permitidas para restauracion.");
      error.status = 400;
      throw error;
    }
  }

  const cleanedSql = removeSqlComments(content);
  const statements = splitSqlStatements(cleanedSql);

  if (!statements.length) {
    const error = new Error("No se encontraron sentencias SQL validas en el respaldo.");
    error.status = 400;
    throw error;
  }

  ensureSafeDataStatements(statements);
  const tables = getAffectedTables(statements);

  return {
    filename,
    size,
    statements,
    tables,
    preview: statements.slice(0, 3).map((statement) => statement.slice(0, 120)),
  };
}

async function validateBackup(payload = {}) {
  const result = validateBackupPayload(payload);

  return {
    filename: result.filename,
    size: result.size,
    total_sentencias: result.statements.length,
    tablas_afectadas: result.tables,
    vista_previa: result.preview,
    valido: true,
    mensaje: "El respaldo puede ser restaurado.",
  };
}

async function listRestoreHistory() {
  const rows = await query(`
    SELECT
      id_restauracion,
      nombre_archivo,
      estado,
      total_sentencias,
      tablas_afectadas,
      mensaje,
      DATE_FORMAT(creado_en, '%Y-%m-%d %H:%i:%s') AS creado_en,
      DATE_FORMAT(finalizado_en, '%Y-%m-%d %H:%i:%s') AS finalizado_en
    FROM HISTORIAL_RESTAURACION
    ORDER BY creado_en DESC, id_restauracion DESC
    LIMIT 10
  `);

  return rows.map((row) => ({
    id_restauracion: Number(row.id_restauracion),
    nombre_archivo: row.nombre_archivo,
    estado: row.estado,
    total_sentencias: Number(row.total_sentencias),
    tablas_afectadas: row.tablas_afectadas ? row.tablas_afectadas.split(",") : [],
    mensaje: row.mensaje,
    creado_en: row.creado_en,
    finalizado_en: row.finalizado_en,
  }));
}

async function verifyRestoredReferences(connection, affectedTables) {
  const [keys] = await connection.query(`
    SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME,
      REFERENCED_COLUMN_NAME, ORDINAL_POSITION
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
    ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`);
  const groups = new Map();
  for (const key of keys) {
    if (!affectedTables.includes(key.TABLE_NAME) && !affectedTables.includes(key.REFERENCED_TABLE_NAME)) continue;
    const name = `${key.TABLE_NAME}:${key.CONSTRAINT_NAME}`;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(key);
  }
  const identifier = (name) => `\`${String(name).replaceAll("`", "``")}\``;
  for (const columns of groups.values()) {
    const key = columns[0];
    const present = columns.map((c) => `child.${identifier(c.COLUMN_NAME)} IS NOT NULL`).join(" AND ");
    const matches = columns.map((c) => `parent.${identifier(c.REFERENCED_COLUMN_NAME)} = child.${identifier(c.COLUMN_NAME)}`).join(" AND ");
    const [orphans] = await connection.query(`SELECT 1 FROM ${identifier(key.TABLE_NAME)} child
      WHERE ${present} AND NOT EXISTS (SELECT 1 FROM ${identifier(key.REFERENCED_TABLE_NAME)} parent WHERE ${matches}) LIMIT 1`);
    if (orphans.length) throw Object.assign(new Error("El respaldo deja referencias sin su registro padre."), { code: "RESTORE_REFERENTIAL_INTEGRITY" });
  }
}

async function restoreBackup(userId, payload = {}) {
  const validation = validateBackupPayload(payload);
  const tables = validation.tables.join(",");
  const insertResult = await query(
    `
      INSERT INTO HISTORIAL_RESTAURACION (
        nombre_archivo,
        estado,
        total_sentencias,
        tablas_afectadas,
        mensaje,
        realizado_por
      )
      VALUES (?, 'EN_PROCESO', ?, ?, 'Restauracion iniciada.', ?)
    `,
    [validation.filename, validation.statements.length, tables, userId],
  );

  const restoreId = Number(insertResult.insertId);
  const connection = await pool.getConnection();

  try {
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");
    await connection.beginTransaction();

    for (const statement of validation.statements) {
      await connection.query(statement);
    }

    // MySQL does not retroactively validate rows when FK checks are re-enabled.
    // Validate affected parent/child relations, including composite financial keys, BEFORE commit.
    await verifyRestoredReferences(connection, validation.tables);
    await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    await connection.commit();
    await query(
      `
        UPDATE HISTORIAL_RESTAURACION
        SET estado = 'COMPLETADA',
            mensaje = 'Restauracion completada correctamente.',
            finalizado_en = CURRENT_TIMESTAMP
        WHERE id_restauracion = ?
      `,
      [restoreId],
    );

    return {
      id_restauracion: restoreId,
      estado: "COMPLETADA",
      total_sentencias: validation.statements.length,
      tablas_afectadas: validation.tables,
      mensaje: "Restauracion completada correctamente.",
    };
  } catch (error) {
    await connection.rollback();
    await connection.query("SET FOREIGN_KEY_CHECKS = 1");

    try {
      await query(
        `
          UPDATE HISTORIAL_RESTAURACION
          SET estado = 'FALLIDA',
              mensaje = ?,
              finalizado_en = CURRENT_TIMESTAMP
          WHERE id_restauracion = ?
        `,
        [sanitizeText(error.message || "No fue posible restaurar el respaldo.").slice(0, 255), restoreId],
      );
    } catch {
      // El respaldo podria haber alterado la tabla de historial antes de fallar.
    }

    const restoreError = new Error(
      "No fue posible restaurar el respaldo. Verifica que corresponda a esta base de datos.",
    );
    restoreError.status = 400;
    throw restoreError;
  } finally {
    connection.release();
  }
}

module.exports = {
  validateBackup,
  restoreBackup,
  listRestoreHistory,
  validateBackupPayload,
  verifyRestoredReferences,
};
