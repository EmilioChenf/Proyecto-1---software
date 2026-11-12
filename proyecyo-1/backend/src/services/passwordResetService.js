const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { logger } = require("../utils/safeLogger");

const { env } = require("../config/env");
const { pool, query } = require("../database/mysql");
const { sendPasswordResetEmail } = require("./emailService");
const { recordAudit } = require("./auditService");

const GENERIC_RESPONSE = {
  message: "Si el correo pertenece a una cuenta activa, enviaremos instrucciones para recuperar el acceso.",
};

function hashResetToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function validateNewPassword(password) {
  const value = String(password || "");
  if (value.length < 8 || value.length > 128 || !/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    const error = new Error("La contrasena debe tener entre 8 y 128 caracteres e incluir letras y numeros.");
    error.status = 400;
    throw error;
  }
  return value;
}

async function requestPasswordReset(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    const error = new Error("Ingresa un correo valido.");
    error.status = 400;
    throw error;
  }

  const users = await query(
    "SELECT id_usuario, nombre, correo FROM USUARIO WHERE LOWER(correo) = ? AND activo = TRUE LIMIT 1",
    [normalizedEmail],
  );
  const user = users[0];
  if (!user) return GENERIC_RESPONSE;

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashResetToken(token);
  const expiresAt = new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60 * 1000);

  await query(
    "UPDATE PASSWORD_RESET_TOKEN SET usado_en = NOW() WHERE id_usuario = ? AND usado_en IS NULL",
    [user.id_usuario],
  );
  await query(
    `
      INSERT INTO PASSWORD_RESET_TOKEN (id_usuario, token_hash, solicitado_en, expira_en)
      VALUES (?, ?, NOW(), ?)
    `,
    [user.id_usuario, tokenHash, expiresAt],
  );

  const resetUrl = `${env.FRONTEND_ORIGIN.replace(/\/$/, "")}/restablecer-contrasena?token=${encodeURIComponent(token)}`;
  try {
    await sendPasswordResetEmail({ to: user.correo, name: user.nombre, resetUrl });
  } catch (error) {
    logger.error("No fue posible enviar un correo de recuperacion.", error);
  }

  return GENERIC_RESPONSE;
}

async function resetPassword({ token, password }, metadata = {}) {
  const suppliedToken = String(token || "").trim();
  if (!/^[a-f0-9]{64}$/i.test(suppliedToken)) {
    const error = new Error("El enlace de recuperacion es invalido o ya expiro.");
    error.status = 400;
    throw error;
  }
  const validatedPassword = validateNewPassword(password);
  const passwordHash = await bcrypt.hash(validatedPassword, 12);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const [tokens] = await connection.execute(
      `
        SELECT id_token, id_usuario
        FROM PASSWORD_RESET_TOKEN
        WHERE token_hash = ? AND usado_en IS NULL AND expira_en > NOW()
        LIMIT 1
        FOR UPDATE
      `,
      [hashResetToken(suppliedToken)],
    );
    const record = tokens[0];
    if (!record) {
      const error = new Error("El enlace de recuperacion es invalido o ya expiro.");
      error.status = 400;
      throw error;
    }

    await connection.execute("UPDATE USUARIO SET password = ? WHERE id_usuario = ?", [passwordHash, record.id_usuario]);
    await connection.execute(
      "UPDATE PASSWORD_RESET_TOKEN SET usado_en = NOW() WHERE id_usuario = ? AND usado_en IS NULL",
      [record.id_usuario],
    );
    await connection.execute(
      "UPDATE SESION_ACTIVA SET revocada_en = NOW() WHERE id_usuario = ? AND revocada_en IS NULL",
      [record.id_usuario],
    );
    await recordAudit({
      userId: record.id_usuario,
      action: "PASSWORD_RESET",
      entity: "USUARIO",
      entityId: record.id_usuario,
      newData: { sesiones_revocadas: true },
      metadata,
    }, (sql, params) => connection.execute(sql, params));
    await connection.commit();
    return { message: "Contraseña actualizada. Ya puedes iniciar sesion." };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  GENERIC_RESPONSE,
  hashResetToken,
  requestPasswordReset,
  resetPassword,
  validateNewPassword,
};
