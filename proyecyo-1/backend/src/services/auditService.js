const { query } = require("../database/mysql");
const { guatemalaDayRangeUtc } = require("../utils/guatemalaTime");

const SENSITIVE_KEY = /password|contrasena|token|secret|authorization|cookie|api[_-]?key/i;
const ALLOWED_ACTIONS = [
  'PROPERTY_CONTRACT_CONFIGURED',
  'PROPERTY_TRANSFERRED',
  'PROPERTY_TRANSFER_SCHEDULED',
  'PROPERTY_TRANSFER_BLOCKED',
  'PROPERTY_TRANSFER_ACTIVATED',
  'TENANT_OPERATIONAL_RECONCILED',
  'MAINTENANCE_TARIFF_CREATED',
  'MONTHLY_PROPERTY_BILLED',
  "USER_CREATED",
  "USER_UPDATED",
  "USER_DELETED",
  "SESSION_REVOKED",
  "PASSWORD_RESET",
  "PASSWORD_CHANGED",
  "VISIT_SCHEDULE_UPDATED",
  "GENERAL_CONFIGURATION_UPDATED",
  "HOUSE_CREATED",
  "HOUSE_UPDATED",
  "HOUSE_ACTIVATED",
  "HOUSE_DEACTIVATED",
  "VISIT_ENTRY_REGISTERED",
  "VISIT_EXIT_REGISTERED",
  // HU-C04: cancelacion y eliminacion logica de visitas.
  "VISIT_CANCELLED",
  "VISIT_ARCHIVED",
  // HU-C05: auditoria de reservas de amenidades.
  "RESERVATION_CREATED",
  "RESERVATION_UPDATED",
  "RESERVATION_CANCELLED",
];

function sanitizeAuditData(value, depth = 0) {
  if (value === null || value === undefined) return null;
  if (depth > 5) return "[OMITIDO]";
  if (Array.isArray(value)) return value.map((item) => sanitizeAuditData(item, depth + 1));
  if (typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_KEY.test(key))
      .map(([key, item]) => [key, sanitizeAuditData(item, depth + 1)]),
  );
}

function getRequestMetadata(req) {
  return {
    ipAddress: String(req.ip || req.socket?.remoteAddress || "").replace(/^::ffff:/, "").slice(0, 45) || null,
    userAgent: String(req.header?.("user-agent") || "").slice(0, 500) || null,
  };
}

async function recordAudit({ userId, action, entity, entityId, previousData, newData, metadata = {} }, execute = query) {
  if (!ALLOWED_ACTIONS.includes(action)) {
    throw new Error(`Accion de auditoria no definida: ${action}`);
  }
  const previous = previousData === undefined ? null : JSON.stringify(sanitizeAuditData(previousData));
  const next = newData === undefined ? null : JSON.stringify(sanitizeAuditData(newData));
  await execute(
    `
      INSERT INTO AUDITORIA (
        id_usuario, accion, entidad, entidad_id, datos_anteriores, datos_nuevos,
        direccion_ip, user_agent, creado_en
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `,
    [userId || null, action, entity, entityId == null ? null : String(entityId), previous, next, metadata.ipAddress || null, metadata.userAgent || null],
  );
}

function ensureDate(value, field) {
  if (!value) return null;
  const normalized = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00Z`))) {
    const error = new Error(`${field} debe tener formato AAAA-MM-DD.`);
    error.status = 400;
    throw error;
  }
  return normalized;
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
}

async function listAuditLogs(filters = {}) {
  const conditions = [];
  const params = [];
  if (filters.userId) {
    const userId = Number(filters.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      const error = new Error("El usuario del filtro no es valido.");
      error.status = 400;
      throw error;
    }
    conditions.push("a.id_usuario = ?");
    params.push(userId);
  }
  if (filters.action) {
    const action = String(filters.action).trim().toUpperCase();
    if (!ALLOWED_ACTIONS.includes(action)) {
      const error = new Error("La accion del filtro no es valida.");
      error.status = 400;
      throw error;
    }
    conditions.push("a.accion = ?");
    params.push(action);
  }
  const from = ensureDate(filters.from, "La fecha inicial");
  const to = ensureDate(filters.to, "La fecha final");
  // creado_en es un instante UTC; los dias del filtro son dias calendario de Guatemala.
  if (from) { conditions.push("a.creado_en >= ?"); params.push(guatemalaDayRangeUtc(from).start); }
  if (to) { conditions.push("a.creado_en < ?"); params.push(guatemalaDayRangeUtc(to).end); }
  if (from && to && from > to) {
    const error = new Error("La fecha inicial no puede ser posterior a la fecha final.");
    error.status = 400;
    throw error;
  }
  const rows = await query(
    `
      SELECT a.id_auditoria, a.id_usuario, u.nombre AS usuario_nombre, u.correo AS usuario_correo,
        a.accion, a.entidad, a.entidad_id, a.datos_anteriores, a.datos_nuevos,
        a.direccion_ip, DATE_FORMAT(a.creado_en, '%Y-%m-%d %H:%i:%s') AS creado_en
      FROM AUDITORIA a
      LEFT JOIN USUARIO u ON u.id_usuario = a.id_usuario
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY a.creado_en DESC, a.id_auditoria DESC
      LIMIT 100
    `,
    params,
  );
  return rows.map((row) => ({
    ...row,
    datos_anteriores: parseJson(row.datos_anteriores),
    datos_nuevos: parseJson(row.datos_nuevos),
  }));
}

module.exports = {
  ALLOWED_ACTIONS,
  getRequestMetadata,
  listAuditLogs,
  recordAudit,
  sanitizeAuditData,
};
