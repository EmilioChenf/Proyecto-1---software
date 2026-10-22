const { pool, query } = require("../database/mysql");
const { env } = require("../config/env");
const { createActiveSession } = require("./activeSessionsService");

async function comparePassword(plainPassword, storedPassword) {
  if (typeof storedPassword === "string" && storedPassword.startsWith("$2")) {
    const bcrypt = require("bcryptjs");
    return bcrypt.compare(plainPassword, storedPassword);
  }

  if (!env.USE_BCRYPT) {
    return plainPassword === storedPassword;
  }

  const bcrypt = require("bcryptjs");
  return bcrypt.compare(plainPassword, storedPassword);
}

// HU-C01 (C-1): la contrasena se verifica fuera de cualquier bloqueo (bcrypt es lento),
// pero la sesion solo se crea si, bajo un bloqueo compartido de la fila del usuario, el
// valor almacenado sigue siendo exactamente el verificado y la cuenta sigue activa.
// FOR SHARE es una lectura con bloqueo: espera a cualquier cambio/restablecimiento en
// curso (que tiene la fila con FOR UPDATE o UPDATE) y lee su valor confirmado, en
// cualquier nivel de aislamiento. Un INSERT ... SELECT no basta: en READ COMMITTED su
// SELECT es una lectura consistente sin bloqueo y crearia la sesion con la contrasena
// anterior. La comparacion es exacta en JS (la de SQL depende de la collation).
async function createSessionForVerifiedPassword(user, sessionMetadata) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      "SELECT password, activo FROM USUARIO WHERE id_usuario = ? FOR SHARE",
      [user.id],
    );
    const current = rows[0];
    if (!current || current.password !== user.password) {
      const error = new Error("Credenciales incorrectas.");
      error.status = 401;
      error.code = "INVALID_CREDENTIALS";
      throw error;
    }
    if (Number(current.activo) === 0) {
      const error = new Error("El usuario esta inactivo.");
      error.status = 403;
      throw error;
    }
    const session = await createActiveSession(user.id, sessionMetadata, (sql, params) => connection.execute(sql, params));
    await connection.commit();
    return session;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function loginUser({ email, password }, sessionMetadata = {}) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedPassword = String(password || "").trim();

  if (!normalizedEmail || !normalizedPassword) {
    const error = new Error("Correo y contrasena son obligatorios.");
    error.status = 400;
    throw error;
  }

  const rows = await query(
    `
      SELECT
        u.id_usuario AS id,
        u.correo AS email,
        tu.nombre AS role,
        u.password AS password,
        u.activo AS activo
      FROM USUARIO u
      INNER JOIN TIPO_USUARIO tu
        ON tu.id_tipo_usuario = u.id_tipo_usuario
      WHERE LOWER(u.correo) = ?
      LIMIT 1
    `,
    [normalizedEmail],
  );

  const user = rows[0];

  if (!user) {
    const error = new Error("Credenciales incorrectas.");
    error.status = 401;
    error.code = "INVALID_CREDENTIALS";
    throw error;
  }

  const passwordMatches = await comparePassword(normalizedPassword, user.password);

  if (!passwordMatches) {
    const error = new Error("Credenciales incorrectas.");
    error.status = 401;
    error.code = "INVALID_CREDENTIALS";
    throw error;
  }

  if (Number(user.activo) === 0) {
    const error = new Error("El usuario esta inactivo.");
    error.status = 403;
    throw error;
  }

  if(['residente','inquilino'].includes(user.role))await require('./contractHouseRelations').syncUserRelations(user.id);

  const session = await createSessionForVerifiedPassword(user, sessionMetadata);

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    token: session.token,
  };
}

// Devuelve el rol y estado actuales del usuario desde la base de datos.
// Permite al frontend refrescar los permisos sin depender de lo guardado al iniciar sesion.
async function getCurrentSession(userId, token) {
  const id = Number(userId);

  if (!Number.isInteger(id) || id <= 0) {
    const error = new Error("Sesion invalida.");
    error.status = 401;
    throw error;
  }

  const rows = await query(
    `
      SELECT
        u.id_usuario AS id,
        u.correo AS email,
        tu.nombre AS role,
        u.activo AS activo
      FROM USUARIO u
      INNER JOIN TIPO_USUARIO tu
        ON tu.id_tipo_usuario = u.id_tipo_usuario
      WHERE u.id_usuario = ?
      LIMIT 1
    `,
    [id],
  );

  const user = rows[0];

  if (!user) {
    const error = new Error("Sesion invalida.");
    error.status = 401;
    throw error;
  }

  if (Number(user.activo) === 0) {
    const error = new Error("El usuario esta inactivo.");
    error.status = 403;
    throw error;
  }

  if(['residente','inquilino'].includes(user.role))await require('./contractHouseRelations').syncUserRelations(user.id);
  return {id:user.id,email:user.email,role:user.role,...(token?{token}:{})};
}

module.exports = {
  comparePassword,
  loginUser,
  getCurrentSession,
};
