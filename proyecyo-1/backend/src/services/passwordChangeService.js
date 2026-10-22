const bcrypt = require("bcryptjs");

const { pool, query } = require("../database/mysql");
const { comparePassword } = require("./authService");
const { createActiveSession } = require("./activeSessionsService");
const { recordAudit } = require("./auditService");
const { validateNewPassword } = require("./passwordResetService");

// Mismo costo que la recuperacion de contrasena (passwordResetService).
const BCRYPT_ROUNDS = 12;

function validationError(message, code, errores) {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  if (errores) error.errores = errores;
  return error;
}

function validateChangePayload(payload = {}) {
  const fields = {
    currentPassword: "Ingresa tu contrasena actual.",
    newPassword: "Ingresa la nueva contrasena.",
    confirmPassword: "Confirma la nueva contrasena.",
  };
  const missing = Object.entries(fields)
    .filter(([field]) => typeof payload[field] !== "string" || payload[field] === "")
    .map(([field, message]) => ({ field, message }));
  if (missing.length) {
    throw validationError("Completa la contrasena actual, la nueva y su confirmacion.", "PASSWORD_FIELDS_REQUIRED", missing);
  }

  const { currentPassword, newPassword, confirmPassword } = payload;
  if (newPassword !== confirmPassword) {
    throw validationError("La confirmacion no coincide con la nueva contrasena.", "PASSWORD_CONFIRMATION_MISMATCH",
      [{ field: "confirmPassword", message: "La confirmacion no coincide con la nueva contrasena." }]);
  }
  try {
    validateNewPassword(newPassword);
  } catch (error) {
    throw validationError(error.message, "PASSWORD_POLICY", [{ field: "newPassword", message: error.message }]);
  }
  // El login recorta espacios de la contrasena recibida: una contrasena con espacios
  // al inicio o al final nunca coincidiria despues y dejaria la cuenta bloqueada.
  if (newPassword !== newPassword.trim()) {
    const message = "La contrasena no puede iniciar ni terminar con espacios.";
    throw validationError(message, "PASSWORD_POLICY", [{ field: "newPassword", message }]);
  }
  return { currentPassword, newPassword };
}

function httpError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

/**
 * HU-C01: el usuario autenticado cambia su propia contrasena.
 *
 * 1. Fuera de cualquier bloqueo (bcrypt es lento): lee el estado actual, verifica la
 *    contrasena actual, descarta reutilizarla y calcula el hash nuevo.
 * 2. En una transaccion corta, con la fila del usuario bloqueada (FOR UPDATE), vuelve a
 *    comprobar que la cuenta sigue activa, que la sesion que hace la peticion sigue
 *    activa (C-1/M-1: una sesion revocada mientras tanto no puede completar el cambio)
 *    y que la contrasena almacenada es exactamente la verificada en el paso 1.
 * 3. Solo entonces guarda el hash, revoca TODAS las sesiones del usuario, invalida los
 *    enlaces de recuperacion, crea la sesion nueva y audita, todo o nada.
 *
 * Un login concurrente con la contrasena anterior no puede dejar una sesion valida:
 * crea su sesion bajo FOR SHARE de la misma fila (authService), asi que o termina antes
 * de este bloqueo (y su sesion se revoca aqui) o espera al commit y ve el hash nuevo.
 */
async function changeOwnPassword(userId, sessionId, payload, metadata = {}) {
  const { currentPassword, newPassword } = validateChangePayload(payload);
  if (!sessionId) throw httpError(401, "Sesion invalida.", "SESSION_REQUIRED");

  const [snapshot] = await query(
    `
      SELECT u.id_usuario AS id, u.correo AS email, u.password, u.activo, tu.nombre AS role
      FROM USUARIO u
      INNER JOIN TIPO_USUARIO tu ON tu.id_tipo_usuario = u.id_tipo_usuario
      WHERE u.id_usuario = ?
      LIMIT 1
    `,
    [userId],
  );
  if (!snapshot || Number(snapshot.activo) === 0) throw httpError(401, "Sesion invalida.", "SESSION_REQUIRED");

  // Igual que el login: la contrasena recibida se compara recortada.
  if (!(await comparePassword(currentPassword.trim(), snapshot.password))) {
    // 400 y no 401: la sesion sigue siendo valida y el frontend cierra sesion ante un 401.
    throw validationError("La contrasena actual es incorrecta.", "CURRENT_PASSWORD_INVALID",
      [{ field: "currentPassword", message: "La contrasena actual es incorrecta." }]);
  }
  if (await comparePassword(newPassword, snapshot.password)) {
    const message = "La nueva contrasena debe ser diferente a la actual.";
    throw validationError(message, "PASSWORD_REUSED", [{ field: "newPassword", message }]);
  }
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  const connection = await pool.getConnection();
  const execute = (sql, params) => connection.execute(sql, params);
  try {
    await connection.beginTransaction();
    const [[locked]] = await connection.execute(
      "SELECT password, activo FROM USUARIO WHERE id_usuario = ? FOR UPDATE",
      [snapshot.id],
    );
    if (!locked || Number(locked.activo) === 0) throw httpError(401, "Sesion invalida.", "SESSION_REQUIRED");
    const [[activeSession]] = await connection.execute(
      `
        SELECT id_sesion
        FROM SESION_ACTIVA
        WHERE id_sesion = ? AND id_usuario = ? AND revocada_en IS NULL AND expira_en > NOW()
        FOR UPDATE
      `,
      [sessionId, snapshot.id],
    );
    if (!activeSession) throw httpError(401, "La sesion fue cerrada o expiro.", "SESSION_REVOKED");
    // La contrasena cambio entre la verificacion y el bloqueo (otro flujo): no se aplica.
    if (locked.password !== snapshot.password) {
      throw httpError(409, "La contrasena cambio mientras se procesaba la solicitud. Intenta de nuevo.", "PASSWORD_CHANGED_CONCURRENTLY");
    }

    await connection.execute("UPDATE USUARIO SET password = ? WHERE id_usuario = ?", [passwordHash, snapshot.id]);
    const [revoked] = await connection.execute(
      "UPDATE SESION_ACTIVA SET revocada_en = NOW() WHERE id_usuario = ? AND revocada_en IS NULL",
      [snapshot.id],
    );
    // Los enlaces de recuperacion pendientes tambien dejan de servir.
    await connection.execute(
      "UPDATE PASSWORD_RESET_TOKEN SET usado_en = NOW() WHERE id_usuario = ? AND usado_en IS NULL",
      [snapshot.id],
    );
    const session = await createActiveSession(snapshot.id, metadata, execute);
    await recordAudit({
      userId: snapshot.id,
      action: "PASSWORD_CHANGED",
      entity: "USUARIO",
      entityId: snapshot.id,
      newData: { sesiones_revocadas: Number(revoked.affectedRows) },
      metadata,
    }, execute);
    await connection.commit();

    return {
      message: "Contrasena actualizada. Se cerraron tus demas sesiones.",
      id: snapshot.id,
      email: snapshot.email,
      role: snapshot.role,
      token: session.token,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { changeOwnPassword, validateChangePayload };
