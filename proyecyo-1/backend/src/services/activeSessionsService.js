const crypto = require("crypto");

const { query } = require("../database/mysql");
const { TOKEN_TTL_SECONDS, createSessionToken } = require("./sessionTokenService");

function normalizeIp(value) {
  return String(value || "").replace(/^::ffff:/, "").slice(0, 45) || null;
}

function describeDevice(userAgent) {
  const value = String(userAgent || "Dispositivo desconocido").slice(0, 500);
  const platform = /android/i.test(value) ? "Android"
    : /iphone|ipad/i.test(value) ? "iOS"
      : /windows/i.test(value) ? "Windows"
        : /macintosh|mac os/i.test(value) ? "macOS"
          : /linux/i.test(value) ? "Linux" : "Dispositivo";
  const browser = /edg\//i.test(value) ? "Edge"
    : /chrome\//i.test(value) ? "Chrome"
      : /firefox\//i.test(value) ? "Firefox"
        : /safari\//i.test(value) ? "Safari" : "Navegador";
  return { userAgent: value, deviceName: `${browser} en ${platform}` };
}

// execute permite crear la sesion dentro de una transaccion existente (HU-C01).
async function createActiveSession(userId, metadata = {}, execute = query) {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000);
  const { userAgent, deviceName } = describeDevice(metadata.userAgent);
  await execute(
    `
      INSERT INTO SESION_ACTIVA (
        id_sesion, id_usuario, dispositivo, user_agent, direccion_ip, creada_en, ultima_actividad_en, expira_en
      ) VALUES (?, ?, ?, ?, ?, NOW(), NOW(), ?)
    `,
    [sessionId, userId, deviceName, userAgent, normalizeIp(metadata.ipAddress), expiresAt],
  );
  return { sessionId, token: createSessionToken(userId, sessionId) };
}

async function assertActiveSession(userId, sessionId) {
  if (!sessionId) {
    const error = new Error("Sesion invalida.");
    error.status = 401;
    error.code = "SESSION_REQUIRED";
    throw error;
  }
  const rows = await query(
    `
      SELECT id_sesion
      FROM SESION_ACTIVA
      WHERE id_sesion = ?
        AND id_usuario = ?
        AND revocada_en IS NULL
        AND expira_en > NOW()
      LIMIT 1
    `,
    [sessionId, userId],
  );
  if (!rows[0]) {
    const error = new Error("La sesion fue cerrada o expiro.");
    error.status = 401;
    error.code = "SESSION_REVOKED";
    throw error;
  }
  await query("UPDATE SESION_ACTIVA SET ultima_actividad_en = NOW() WHERE id_sesion = ?", [sessionId]);
}

async function listActiveSessions(userId, currentSessionId) {
  const rows = await query(
    `
      SELECT
        id_sesion,
        dispositivo,
        direccion_ip,
        DATE_FORMAT(creada_en, '%Y-%m-%d %H:%i:%s') AS creada_en,
        DATE_FORMAT(ultima_actividad_en, '%Y-%m-%d %H:%i:%s') AS ultima_actividad_en,
        DATE_FORMAT(expira_en, '%Y-%m-%d %H:%i:%s') AS expira_en
      FROM SESION_ACTIVA
      WHERE id_usuario = ?
        AND revocada_en IS NULL
        AND expira_en > NOW()
      ORDER BY ultima_actividad_en DESC
    `,
    [userId],
  );
  return rows.map((row) => ({ ...row, actual: row.id_sesion === currentSessionId }));
}

async function revokeSession(userId, sessionId) {
  const result = await query(
    `
      UPDATE SESION_ACTIVA
      SET revocada_en = NOW()
      WHERE id_sesion = ? AND id_usuario = ? AND revocada_en IS NULL
    `,
    [sessionId, userId],
  );
  if (!result.affectedRows) {
    const error = new Error("Sesion activa no encontrada.");
    error.status = 404;
    throw error;
  }
  return { id_sesion: sessionId, cerrada: true };
}

async function revokeAllUserSessions(userId) {
  await query(
    "UPDATE SESION_ACTIVA SET revocada_en = NOW() WHERE id_usuario = ? AND revocada_en IS NULL",
    [userId],
  );
}

module.exports = {
  assertActiveSession,
  createActiveSession,
  describeDevice,
  listActiveSessions,
  revokeAllUserSessions,
  revokeSession,
};
