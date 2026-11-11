const { pool, query } = require("../database/mysql");
const { ensureValidTime } = require("../utils/dateTimeValidation");
const { listAmenities, updateAmenitySchedule } = require("./amenitiesReservationsService");

// Catalogo de amenidades administrado por cada residencial (crear, editar, eliminar).
// El horario se valida con la misma regla de reservas (updateAmenitySchedule) para no
// dejar reservas futuras fuera de horario.

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
const text = (value) => String(value ?? "").trim();

function validateAmenity(payload = {}, { partial = false } = {}) {
  const data = {};
  if (!partial || payload.nombre !== undefined) {
    data.nombre = text(payload.nombre);
    if (data.nombre.length < 3 || data.nombre.length > 100) throw fail(400, "El nombre de la amenidad debe tener entre 3 y 100 caracteres.");
  }
  if (!partial || payload.descripcion !== undefined) {
    data.descripcion = text(payload.descripcion);
    if (data.descripcion.length > 200) throw fail(400, "La descripción admite hasta 200 caracteres.");
  }
  if (!partial || payload.reglas !== undefined) {
    data.reglas = text(payload.reglas);
    if (data.reglas.length > 500) throw fail(400, "Las reglas admiten hasta 500 caracteres.");
  }
  if (!partial || payload.foto_url !== undefined) {
    data.foto_url = text(payload.foto_url);
    if (data.foto_url && (data.foto_url.length > 255 || !/^https:\/\/[^\s"'<>]+$/i.test(data.foto_url))) {
      throw fail(400, "La foto debe ser una dirección https:// de hasta 255 caracteres.");
    }
  }
  return data;
}

async function findByName(nombre, exceptId = 0) {
  const rows = await query("SELECT id_amenidad FROM AMENIDAD WHERE LOWER(nombre) = LOWER(?) AND id_amenidad <> ? LIMIT 1", [nombre, exceptId]);
  return rows[0];
}

async function getAmenity(id) {
  const amenity = (await listAmenities()).find((item) => item.id_amenidad === Number(id));
  if (!amenity) throw fail(404, "Amenidad no encontrada.");
  return amenity;
}

async function createAmenity(payload = {}) {
  const data = validateAmenity(payload);
  const apertura = ensureValidTime(payload.hora_apertura || "08:00", "hora de apertura");
  const cierre = ensureValidTime(payload.hora_cierre || "22:00", "hora de cierre");
  const intervalo = Number(payload.intervalo_minutos || 60);
  if (await findByName(data.nombre)) throw fail(409, "Ya existe una amenidad con ese nombre.", "AMENIDAD_DUPLICADA");
  const result = await query(
    `INSERT INTO AMENIDAD (nombre, descripcion, reglas, foto_url, hora_apertura, hora_cierre, intervalo_minutos, activo)
     VALUES (?, ?, ?, ?, '08:00:00', '22:00:00', 60, ?)`,
    [data.nombre, data.descripcion || null, data.reglas || null, data.foto_url || null, payload.activo === false ? 0 : 1],
  );
  const id = Number(result.insertId);
  try {
    // Valida y guarda el horario con las mismas reglas de las reservas.
    await updateAmenitySchedule(id, { hora_apertura: apertura, hora_cierre: cierre, intervalo_minutos: intervalo, activo: payload.activo !== false, descripcion: data.descripcion || "" });
  } catch (error) {
    await query("DELETE FROM AMENIDAD WHERE id_amenidad = ?", [id]);
    throw error;
  }
  return getAmenity(id);
}

async function updateAmenity(id, payload = {}) {
  const current = await getAmenity(id);
  const data = validateAmenity(payload, { partial: true });
  if (data.nombre && await findByName(data.nombre, current.id_amenidad)) throw fail(409, "Ya existe una amenidad con ese nombre.", "AMENIDAD_DUPLICADA");
  const fields = Object.keys(data);
  if (fields.length) {
    await query(
      `UPDATE AMENIDAD SET ${fields.map((field) => `${field} = ?`).join(", ")} WHERE id_amenidad = ?`,
      [...fields.map((field) => data[field] || (field === "nombre" ? data[field] : null)), current.id_amenidad],
    );
  }
  const scheduleChanged = ["hora_apertura", "hora_cierre", "intervalo_minutos", "activo"].some((key) => payload[key] !== undefined);
  if (scheduleChanged) {
    await updateAmenitySchedule(current.id_amenidad, {
      hora_apertura: payload.hora_apertura ?? current.hora_apertura,
      hora_cierre: payload.hora_cierre ?? current.hora_cierre,
      intervalo_minutos: payload.intervalo_minutos ?? current.intervalo_minutos,
      activo: payload.activo ?? current.activo,
      descripcion: data.descripcion ?? current.descripcion,
    });
  }
  return getAmenity(current.id_amenidad);
}

/** Solo se elimina si nunca se reservó; con historial se desactiva para conservarlo. */
async function deleteAmenity(id) {
  const current = await getAmenity(id);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[usage]] = await connection.execute("SELECT COUNT(*) n FROM RESERVA WHERE id_amenidad = ?", [current.id_amenidad]);
    const [[total]] = await connection.execute("SELECT COUNT(*) n FROM AMENIDAD");
    if (Number(total.n) <= 1) throw fail(409, "Debe quedar al menos una amenidad; desactívala si no se usará.", "AMENIDAD_UNICA");
    if (Number(usage.n) > 0) {
      throw fail(409, `${current.nombre} tiene reservas registradas; desactívala para conservar su historial.`, "AMENIDAD_CON_HISTORIAL");
    }
    await connection.execute("DELETE FROM AMENIDAD WHERE id_amenidad = ?", [current.id_amenidad]);
    await connection.commit();
    return { id_amenidad: current.id_amenidad, eliminada: true };
  } catch (error) {
    await connection.rollback();
    if (String(error.code || "").startsWith("ER_ROW_IS_REFERENCED")) {
      throw fail(409, `${current.nombre} tiene registros relacionados; desactívala para conservar su historial.`, "AMENIDAD_CON_HISTORIAL");
    }
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { createAmenity, updateAmenity, deleteAmenity, validateAmenity };
