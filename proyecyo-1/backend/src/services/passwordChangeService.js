const bcrypt = require("bcryptjs");

const { pool } = require("../database/mysql");
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

/**
 * HU-C01: el usuario autenticado cambia su propia contrasena. Todo ocurre en una
 * transaccion con la fila del usuario bloqueada: se verifica la contrasena actual,
 * se guarda el nuevo hash, se revocan TODAS sus sesiones (incluida la que hizo la
 * peticion) y se emite una sesion nueva para el dispositivo actual.
 */
async function changeOwnPassword(userId, payload, metadata = {}) {
  const { currentPassword, newPassword } = validateChangePayload(payload);
  const connection = await pool.getConnection();
  const execute = (sql, params) => connection.execute(sql, params);

  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `
        SELECT u.id_usuario AS id, u.correo AS email, u.password, u.activo, tu.nombre AS role
        FROM USUARIO u
        INNER JOIN TIPO_USUARIO tu ON tu.id_tipo_usuario = u.id_tipo_usuario
        WHERE u.id_usuario = ?
        LIMIT 1
        FOR UPDATE
      `,
      [userId],
    );
    const user = rows[0];
    if (!user || Number(user.activo) === 0) {
      const error = new Error("Sesion invalida.");
      error.status = 401;
      error.code = "SESSION_REQUIRED";
      throw error;
    }

    // Igual que el login: la contrasena recibida se compara recortada.
    if (!(await comparePassword(currentPassword.trim(), user.password))) {
      // 400 y no 401: la sesion sigue siendo valida y el frontend cierra sesion ante un 401.
      throw validationError("La contrasena actual es incorrecta.", "CURRENT_PASSWORD_INVALID",
        [{ field: "currentPassword", message: "La contrasena actual es incorrecta." }]);
    }
    if (await comparePassword(newPassword, user.password)) {
      const message = "La nueva contrasena debe ser diferente a la actual.";
      throw validationError(message, "PASSWORD_REUSED", [{ field: "newPassword", message }]);
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await connection.execute("UPDATE USUARIO SET password = ? WHERE id_usuario = ?", [passwordHash, user.id]);
    const [revoked] = await connection.execute(
      "UPDATE SESION_ACTIVA SET revocada_en = NOW() WHERE id_usuario = ? AND revocada_en IS NULL",
      [user.id],
    );
    // Los enlaces de recuperacion pendientes tambien dejan de servir.
    await connection.execute(
      "UPDATE PASSWORD_RESET_TOKEN SET usado_en = NOW() WHERE id_usuario = ? AND usado_en IS NULL",
      [user.id],
    );
    const session = await createActiveSession(user.id, metadata, execute);
    await recordAudit({
      userId: user.id,
      action: "PASSWORD_CHANGED",
      entity: "USUARIO",
      entityId: user.id,
      newData: { sesiones_revocadas: Number(revoked.affectedRows) },
      metadata,
    }, execute);
    await connection.commit();

    return {
      message: "Contrasena actualizada. Se cerraron tus demas sesiones.",
      id: user.id,
      email: user.email,
      role: user.role,
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
