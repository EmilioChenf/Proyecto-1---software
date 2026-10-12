const bcrypt = require("bcryptjs");

const { pool, query } = require("../database/mysql");
const { assignResidentToHouse, assignTenantToHouse, releaseResidentHouses } = require("./housesService");

const SALT_ROUNDS = 10;

const USER_HOUSE_SUBQUERY = `
  SELECT
    grouped_houses.id_usuario,
    SUBSTRING_INDEX(
      GROUP_CONCAT(grouped_houses.numero_casa ORDER BY grouped_houses.sort_key SEPARATOR '||'),
      '||',
      1
    ) AS numero_casa,
    NULLIF(
      SUBSTRING_INDEX(
        GROUP_CONCAT(COALESCE(grouped_houses.torre, '') ORDER BY grouped_houses.sort_key SEPARATOR '||'),
        '||',
        1
      ),
      ''
    ) AS torre,
    GROUP_CONCAT(DISTINCT grouped_houses.unidad ORDER BY grouped_houses.unidad SEPARATOR ', ') AS unidad,
    MIN(grouped_houses.sort_key) AS id_casa
  FROM (
    SELECT
      r.id_usuario,
      c.id_casa AS sort_key,
      c.numero AS numero_casa,
      c.torre,
      CONCAT(
        COALESCE(c.torre, ''),
        CASE WHEN c.torre IS NOT NULL AND c.torre <> '' THEN '-' ELSE '' END,
        c.numero
      ) AS unidad
    FROM RESIDENTE r
    INNER JOIN CASA c
      ON c.id_residente = r.id_residente

    UNION ALL

    SELECT
      i.id_usuario,
      c.id_casa AS sort_key,
      c.numero AS numero_casa,
      c.torre,
      CONCAT(
        COALESCE(c.torre, ''),
        CASE WHEN c.torre IS NOT NULL AND c.torre <> '' THEN '-' ELSE '' END,
        c.numero
      ) AS unidad
    FROM INQUILINO i
    INNER JOIN INQUILINO_CASA ic
      ON ic.id_inquilino = i.id_inquilino
    INNER JOIN CASA c
      ON c.id_casa = ic.id_casa
  ) grouped_houses
  GROUP BY grouped_houses.id_usuario
`;

function normalizeString(value) {
  return String(value || "").trim();
}

function validateEmail(email) {
  return /\S+@\S+\.\S+/.test(email);
}

function generateAutoDpi() {
  const timestamp = Date.now().toString().slice(-10);
  const random = Math.floor(Math.random() * 1000000)
    .toString()
    .padStart(6, "0");

  return `AUTO${timestamp}${random}`;
}

// La vivienda se elige en el mapa (id_casa). Ya no se escribe "numero/torre" a mano:
// el backend revalida la vivienda bajo bloqueo dentro de la transaccion.
function ensureHousePayloadForRole(roleName, payload) {
  if (roleName !== "residente" && roleName !== "inquilino") return null;
  const houseId = Number(payload.id_casa);
  if (!Number.isInteger(houseId) || houseId <= 0) {
    const error = new Error("Selecciona una vivienda en el mapa para residentes e inquilinos.");
    error.status = 400;
    throw error;
  }
  return houseId;
}

// Errores de concurrencia de MySQL se traducen a un conflicto entendible.
function mapConcurrencyError(error) {
  if (error?.code === "ER_LOCK_DEADLOCK" || error?.code === "ER_LOCK_WAIT_TIMEOUT") {
    return Object.assign(new Error("La vivienda cambio mientras se guardaba. Actualiza el mapa e intenta de nuevo."), { status: 409, code: "VIVIENDA_CONFLICTO" });
  }
  return error;
}

async function getUserTypeById(idTipoUsuario) {
  const rows = await query(
    `
      SELECT id_tipo_usuario AS id, nombre
      FROM TIPO_USUARIO
      WHERE id_tipo_usuario = ?
      LIMIT 1
    `,
    [idTipoUsuario],
  );

  return rows[0] || null;
}

async function getResidentIdByUserId(connection, userId) {
  const [rows] = await connection.execute(
    `
      SELECT id_residente
      FROM RESIDENTE
      WHERE id_usuario = ?
      LIMIT 1
    `,
    [userId],
  );

  return rows[0]?.id_residente ? Number(rows[0].id_residente) : null;
}

async function getInquilinoIdByUserId(connection, userId) {
  const [rows] = await connection.execute(
    `
      SELECT id_inquilino
      FROM INQUILINO
      WHERE id_usuario = ?
      LIMIT 1
    `,
    [userId],
  );

  return rows[0]?.id_inquilino ? Number(rows[0].id_inquilino) : null;
}

async function ensureResidentRecord(connection, userId) {
  await connection.execute(
    `
      INSERT INTO RESIDENTE (id_usuario)
      SELECT ?
      WHERE NOT EXISTS (
        SELECT 1 FROM RESIDENTE WHERE id_usuario = ?
      )
    `,
    [userId, userId],
  );

  const residentId = await getResidentIdByUserId(connection, userId);

  if (!residentId) {
    const error = new Error("No fue posible crear la relacion del residente.");
    error.status = 500;
    throw error;
  }

  return residentId;
}

async function ensureInquilinoRecord(connection, userId) {
  await connection.execute(
    `
      INSERT INTO INQUILINO (id_usuario, autorizado)
      SELECT ?, 1
      WHERE NOT EXISTS (
        SELECT 1 FROM INQUILINO WHERE id_usuario = ?
      )
    `,
    [userId, userId],
  );

  const inquilinoId = await getInquilinoIdByUserId(connection, userId);

  if (!inquilinoId) {
    const error = new Error("No fue posible crear la relacion del inquilino.");
    error.status = 500;
    throw error;
  }

  return inquilinoId;
}

async function removeTenantData(connection, userId) {
  await connection.execute(
    `
      DELETE FROM INQUILINO_CASA
      WHERE id_inquilino IN (
        SELECT id_inquilino
        FROM INQUILINO
        WHERE id_usuario = ?
      )
    `,
    [userId],
  );
  await connection.execute("DELETE FROM INQUILINO WHERE id_usuario = ?", [userId]);
}

// Ya no se borra CASA: la vivienda (y su historial) se conserva y queda DISPONIBLE.
// releaseResidentHouses bloquea si quedarian inquilinos huerfanos o historial financiero.
async function removeResidentData(connection, userId) {
  const residentId = await getResidentIdByUserId(connection, userId);
  if (!residentId) return;
  await releaseResidentHouses(connection, residentId);
  await connection.execute("DELETE FROM RESIDENTE WHERE id_usuario = ?", [userId]);
}

async function assignResidentHouse(connection, userId, houseId) {
  const residentId = await ensureResidentRecord(connection, userId);
  await assignResidentToHouse(connection, residentId, houseId);
}

async function assignTenantHouse(connection, userId, houseId) {
  const inquilinoId = await ensureInquilinoRecord(connection, userId);
  await assignTenantToHouse(connection, inquilinoId, houseId);
}

async function syncRoleRelations(connection, userId, roleName, houseId, previousRole = roleName) {
  const [contracts] = await connection.execute(`SELECT c.id_casa,u.id_tipo_usuario,t.nombre rol FROM CASA c
    JOIN USUARIO u ON u.id_usuario=? JOIN TIPO_USUARIO t ON t.id_tipo_usuario=u.id_tipo_usuario
    WHERE c.relaciones_confirmadas_en IS NOT NULL AND
      (c.id_casa=? OR EXISTS(SELECT 1 FROM CASA_RESPONSABLE_FINANCIERO rf WHERE rf.id_casa=c.id_casa AND rf.id_usuario=u.id_usuario)
      OR EXISTS(SELECT 1 FROM CASA_HABITANTE h WHERE h.id_casa=c.id_casa AND h.id_usuario=u.id_usuario))`,[userId,houseId]);
  if (contracts.length) {
    const [[linked]]=await connection.execute(`SELECT (EXISTS(SELECT 1 FROM CASA_RESPONSABLE_FINANCIERO WHERE id_usuario=?) OR EXISTS(SELECT 1 FROM CASA_HABITANTE WHERE id_usuario=?)) vinculado`,[userId,userId]);
    if (previousRole===roleName && Number(linked.vinculado) && contracts.some(c=>Number(c.id_casa)===Number(houseId)) && contracts.every(c=>c.rol===roleName)) return;
    throw Object.assign(new Error('Gestiona los cambios de vivienda o relación desde el asistente contractual.'),{status:409,code:'USAR_ASISTENTE_CONTRACTUAL'});
  }
  if (roleName === "residente") {
    await removeTenantData(connection, userId);
    await assignResidentHouse(connection, userId, houseId);
    return;
  }

  if (roleName === "inquilino") {
    await removeResidentData(connection, userId);
    await assignTenantHouse(connection, userId, houseId);
    return;
  }

  await removeTenantData(connection, userId);
  await removeResidentData(connection, userId);
}

function mapUser(row) {
  return {
    id_usuario: row.id_usuario,
    nombre: row.nombre,
    correo: row.correo,
    telefono: row.telefono,
    id_tipo_usuario: row.id_tipo_usuario,
    rol: row.rol,
    unidad: row.unidad || null,
    id_casa: row.id_casa ? Number(row.id_casa) : null,
    numero_casa: row.numero_casa || null,
    torre: row.torre || null,
  };
}

async function listUsers() {
  const rows = await query(
    `
      SELECT
        u.id_usuario,
        u.nombre,
        u.correo,
        u.telefono,
        u.id_tipo_usuario,
        tu.nombre AS rol,
        casa.unidad,
        casa.id_casa,
        casa.numero_casa,
        casa.torre
      FROM USUARIO u
      INNER JOIN TIPO_USUARIO tu
        ON tu.id_tipo_usuario = u.id_tipo_usuario
      LEFT JOIN (${USER_HOUSE_SUBQUERY}) casa
        ON casa.id_usuario = u.id_usuario
      ORDER BY u.id_usuario DESC
    `,
  );

  return rows.map(mapUser);
}

async function getUserById(id) {
  const rows = await query(
    `
      SELECT
        u.id_usuario,
        u.nombre,
        u.correo,
        u.telefono,
        u.id_tipo_usuario,
        tu.nombre AS rol,
        casa.unidad,
        casa.id_casa,
        casa.numero_casa,
        casa.torre
      FROM USUARIO u
      INNER JOIN TIPO_USUARIO tu
        ON tu.id_tipo_usuario = u.id_tipo_usuario
      LEFT JOIN (${USER_HOUSE_SUBQUERY}) casa
        ON casa.id_usuario = u.id_usuario
      WHERE u.id_usuario = ?
      LIMIT 1
    `,
    [id],
  );

  const user = rows[0];

  if (!user) {
    const error = new Error("Usuario no encontrado.");
    error.status = 404;
    throw error;
  }

  return mapUser(user);
}

async function createUser(payload) {
  const nombre = normalizeString(payload.nombre);
  const correo = normalizeString(payload.correo).toLowerCase();
  const telefono = normalizeString(payload.telefono);
  const password = normalizeString(payload.password);
  const idTipoUsuario = Number(payload.id_tipo_usuario);

  if (!nombre || !correo || !password || !idTipoUsuario) {
    const error = new Error("Nombre, correo, contrasena y tipo de usuario son obligatorios.");
    error.status = 400;
    throw error;
  }

  if (!validateEmail(correo)) {
    const error = new Error("El correo no es valido.");
    error.status = 400;
    throw error;
  }

  if (password.length < 4) {
    const error = new Error("La contrasena debe tener al menos 4 caracteres.");
    error.status = 400;
    throw error;
  }

  const userType = await getUserTypeById(idTipoUsuario);

  if (!userType) {
    const error = new Error("Tipo de usuario invalido.");
    error.status = 400;
    throw error;
  }

  const house = ensureHousePayloadForRole(userType.nombre, payload);
  const existingEmail = await query(
    "SELECT id_usuario FROM USUARIO WHERE correo = ? LIMIT 1",
    [correo],
  );

  if (existingEmail.length > 0) {
    const error = new Error("Ya existe un usuario con ese correo.");
    error.status = 409;
    throw error;
  }

  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [result] = await connection.execute(
      `
        INSERT INTO USUARIO (nombre, dpi, correo, telefono, password, activo, id_tipo_usuario)
        VALUES (?, ?, ?, ?, ?, 1, ?)
      `,
      [nombre, generateAutoDpi(), correo, telefono || null, hashedPassword, idTipoUsuario],
    );

    await syncRoleRelations(connection, result.insertId, userType.nombre, house);
    await connection.commit();

    return getUserById(result.insertId);
  } catch (error) {
    await connection.rollback();
    throw mapConcurrencyError(error);
  } finally {
    connection.release();
  }
}

async function updateUser(id, payload) {
  const originalUser = await getUserById(id);
  const nombre = normalizeString(payload.nombre);
  const correo = normalizeString(payload.correo).toLowerCase();
  const telefono = normalizeString(payload.telefono);
  const password = normalizeString(payload.password);
  const idTipoUsuario = Number(payload.id_tipo_usuario);

  if (!nombre || !correo || !idTipoUsuario) {
    const error = new Error("Nombre, correo y tipo de usuario son obligatorios.");
    error.status = 400;
    throw error;
  }

  if (!validateEmail(correo)) {
    const error = new Error("El correo no es valido.");
    error.status = 400;
    throw error;
  }

  const userType = await getUserTypeById(idTipoUsuario);

  if (!userType) {
    const error = new Error("Tipo de usuario invalido.");
    error.status = 400;
    throw error;
  }

  const relationshipChanged = userType.nombre !== originalUser.rol ||
    (Object.prototype.hasOwnProperty.call(payload, 'id_casa') && Number(payload.id_casa || 0) !== Number(originalUser.id_casa || 0));
  const house = relationshipChanged ? ensureHousePayloadForRole(userType.nombre, payload) : originalUser.id_casa;
  const existingEmail = await query(
    "SELECT id_usuario FROM USUARIO WHERE correo = ? AND id_usuario <> ? LIMIT 1",
    [correo, id],
  );

  if (existingEmail.length > 0) {
    const error = new Error("Ya existe un usuario con ese correo.");
    error.status = 409;
    throw error;
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    if (password) {
      if (password.length < 4) {
        const error = new Error("La contrasena debe tener al menos 4 caracteres.");
        error.status = 400;
        throw error;
      }

      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

      await connection.execute(
        `
          UPDATE USUARIO
          SET nombre = ?, correo = ?, telefono = ?, password = ?, id_tipo_usuario = ?
          WHERE id_usuario = ?
        `,
        [nombre, correo, telefono || null, hashedPassword, idTipoUsuario, id],
      );
    } else {
      await connection.execute(
        `
          UPDATE USUARIO
          SET nombre = ?, correo = ?, telefono = ?, id_tipo_usuario = ?
          WHERE id_usuario = ?
        `,
        [nombre, correo, telefono || null, idTipoUsuario, id],
      );
    }

    if (relationshipChanged) await syncRoleRelations(connection, id, userType.nombre, house, originalUser.rol);
    await connection.commit();

    return getUserById(id);
  } catch (error) {
    await connection.rollback();
    throw mapConcurrencyError(error);
  } finally {
    connection.release();
  }
}

async function deleteUser(id) {
  const user = await getUserById(id);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const [[references]] = await connection.execute(`SELECT
      (EXISTS(SELECT 1 FROM CASA_RESPONSABLE_FINANCIERO WHERE id_usuario=?) OR
       EXISTS(SELECT 1 FROM CASA_HABITANTE WHERE id_usuario=?) OR
       EXISTS(SELECT 1 FROM CASA_TITULARIDAD WHERE id_usuario=?) OR
       EXISTS(SELECT 1 FROM CUOTA WHERE id_responsable=?) OR
       EXISTS(SELECT 1 FROM PAGO WHERE id_actor=?)) historico`,[id,id,id,id,id]);
    if (Number(references.historico)) {
      await connection.execute('UPDATE USUARIO SET activo=0 WHERE id_usuario=?',[id]);
      await connection.commit();
      return {...user,activo:false};
    }

    // La vivienda NO se borra: queda DISPONIBLE (o se bloquea si tiene inquilinos o
    // historial financiero). Solo se eliminan las relaciones del usuario.
    await removeTenantData(connection, id);
    await removeResidentData(connection, id);
    await connection.execute("DELETE FROM USUARIO WHERE id_usuario = ?", [id]);

    await connection.commit();
    return user;
  } catch (error) {
    await connection.rollback();

    if (!error.status) {
      error.status = 409;
      error.message = "No fue posible eliminar el usuario porque tiene relaciones activas.";
    }

    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
};
