const { pool, query } = require("../database/mysql");

// Reportes de fallas y mantenimiento ("se fundió la lámpara del parqueo").
// El residente o inquilino reporta con foto; la administración cambia estado,
// prioridad y responde; cada cambio queda en el historial y avisa a quien reportó.

const CATEGORIES = ["ELECTRICIDAD", "AGUA_PLOMERIA", "AREAS_COMUNES", "SEGURIDAD", "JARDINERIA", "LIMPIEZA", "OTRO"];
const PRIORITIES = ["BAJA", "MEDIA", "ALTA", "URGENTE"];
const STATUSES = ["ABIERTO", "EN_PROCESO", "RESUELTO", "CERRADO"];
const STATUS_LABELS = { ABIERTO: "Abierto", EN_PROCESO: "En proceso", RESUELTO: "Resuelto", CERRADO: "Cerrado" };
const MAX_PHOTO_CHARS = 1_500_000; // ~1.1 MB de imagen; el navegador la reduce antes de enviarla

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
const text = (value) => String(value ?? "").trim();

function validatePhoto(value) {
  const photo = text(value);
  if (!photo) return null;
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo)) throw fail(400, "La foto debe ser una imagen JPG, PNG o WEBP.");
  if (photo.length > MAX_PHOTO_CHARS) throw fail(413, "La foto es demasiado grande; usa una de menor tamaño.");
  return photo;
}

function validateTicket(payload = {}) {
  const titulo = text(payload.titulo);
  const descripcion = text(payload.descripcion);
  const categoria = text(payload.categoria).toUpperCase() || "OTRO";
  const ubicacion = text(payload.ubicacion);
  if (titulo.length < 4 || titulo.length > 120) throw fail(400, "Describe la falla en un título de 4 a 120 caracteres.");
  if (descripcion.length > 1000) throw fail(400, "La descripción admite hasta 1000 caracteres.");
  if (ubicacion.length > 120) throw fail(400, "La ubicación admite hasta 120 caracteres.");
  if (!CATEGORIES.includes(categoria)) throw fail(400, "Selecciona una categoría válida.");
  return { titulo, descripcion, categoria, ubicacion: ubicacion || null, foto: validatePhoto(payload.foto) };
}

const TICKET_SELECT = `
  SELECT t.id_ticket, t.titulo, t.descripcion, t.categoria, t.prioridad, t.estado, t.ubicacion,
    t.id_usuario, u.nombre AS reportado_por, t.id_casa,
    CONCAT(COALESCE(c.torre, ''), CASE WHEN c.torre IS NOT NULL AND c.torre <> '' THEN '-' ELSE '' END, c.numero) AS casa,
    DATE_FORMAT(t.creado_en, '%Y-%m-%d %H:%i') AS creado_en,
    DATE_FORMAT(t.actualizado_en, '%Y-%m-%d %H:%i') AS actualizado_en,
    DATE_FORMAT(t.resuelto_en, '%Y-%m-%d %H:%i') AS resuelto_en,
    (t.foto IS NOT NULL) AS tiene_foto,
    (SELECT COUNT(*) FROM TICKET_COMENTARIO tc WHERE tc.id_ticket = t.id_ticket) AS comentarios
  FROM TICKET t
  JOIN USUARIO u ON u.id_usuario = t.id_usuario
  LEFT JOIN CASA c ON c.id_casa = t.id_casa`;

function mapTicket(row) {
  return {
    id_ticket: Number(row.id_ticket), titulo: row.titulo || row.categoria || "Reporte", descripcion: row.descripcion || "",
    categoria: row.categoria || "OTRO", prioridad: row.prioridad || "MEDIA", estado: row.estado || "ABIERTO",
    ubicacion: row.ubicacion || "", id_usuario: Number(row.id_usuario), reportado_por: row.reportado_por,
    casa: row.casa || null, creado_en: row.creado_en, actualizado_en: row.actualizado_en, resuelto_en: row.resuelto_en,
    tiene_foto: Boolean(Number(row.tiene_foto)), comentarios: Number(row.comentarios || 0),
  };
}

async function notify(connection, userIds, idTicket, titulo, mensaje) {
  for (const userId of new Set(userIds)) {
    await connection.execute(
      "INSERT INTO NOTIFICACION (id_usuario, tipo, titulo, mensaje, leido) VALUES (?, 'TICKET', ?, ?, FALSE)",
      [userId, titulo.slice(0, 150), mensaje.slice(0, 255)],
    );
  }
}

async function createTicket(userId, role, payload) {
  const data = validateTicket(payload);
  const { getHouseByUserId } = require("./visitsService").__private__;
  const house = await getHouseByUserId(userId, role).catch(() => null);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `INSERT INTO TICKET (id_usuario, id_casa, titulo, descripcion, categoria, ubicacion, foto, prioridad, estado, fecha_creacion, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'MEDIA', 'ABIERTO', CURDATE(), UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [userId, house?.id_casa ?? null, data.titulo, data.descripcion || null, data.categoria, data.ubicacion, data.foto],
    );
    const [admins] = await connection.execute("SELECT u.id_usuario FROM USUARIO u JOIN TIPO_USUARIO tu ON tu.id_tipo_usuario = u.id_tipo_usuario WHERE tu.nombre = 'admin' AND u.activo = TRUE");
    const unit = house ? ` (casa ${house.torre ? `${house.torre}-` : ""}${house.numero})` : "";
    await notify(connection, admins.map((a) => a.id_usuario), result.insertId, `Nuevo reporte: ${data.titulo}`, `Reporte #${result.insertId}${unit}${data.ubicacion ? ` en ${data.ubicacion}` : ""}. ${data.descripcion}`.trim());
    await connection.commit();
    return getTicket(result.insertId, { userId, admin: false });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function listTickets({ userId = null, estado = "", categoria = "", search = "" } = {}) {
  const where = [], params = [];
  if (userId) { where.push("t.id_usuario = ?"); params.push(userId); }
  if (estado && STATUSES.includes(estado)) { where.push("t.estado = ?"); params.push(estado); }
  if (categoria && CATEGORIES.includes(categoria)) { where.push("t.categoria = ?"); params.push(categoria); }
  if (text(search)) { where.push("(LOWER(t.titulo) LIKE ? OR LOWER(t.ubicacion) LIKE ? OR LOWER(u.nombre) LIKE ?)"); const term = `%${text(search).toLowerCase()}%`; params.push(term, term, term); }
  const rows = await query(`${TICKET_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY FIELD(t.estado, 'ABIERTO', 'EN_PROCESO', 'RESUELTO', 'CERRADO'), FIELD(t.prioridad, 'URGENTE', 'ALTA', 'MEDIA', 'BAJA'), t.id_ticket DESC LIMIT 300`, params);
  return rows.map(mapTicket);
}

async function getTicket(id, { userId = null, admin = false } = {}) {
  const [row] = await query(`${TICKET_SELECT} WHERE t.id_ticket = ?`, [Number(id)]);
  if (!row || (!admin && Number(row.id_usuario) !== Number(userId))) throw fail(404, "Reporte no encontrado.");
  const [photo] = await query("SELECT foto FROM TICKET WHERE id_ticket = ?", [Number(id)]);
  const comments = await query(
    `SELECT tc.id_comentario, tc.comentario, tc.estado_nuevo, u.nombre AS autor, tu.nombre AS rol,
       DATE_FORMAT(tc.creado_en, '%Y-%m-%d %H:%i') AS creado_en
     FROM TICKET_COMENTARIO tc JOIN USUARIO u ON u.id_usuario = tc.id_usuario JOIN TIPO_USUARIO tu ON tu.id_tipo_usuario = u.id_tipo_usuario
     WHERE tc.id_ticket = ? ORDER BY tc.creado_en, tc.id_comentario`, [Number(id)]);
  return { ...mapTicket(row), foto: photo?.foto || null, historial: comments.map((c) => ({ ...c, id_comentario: Number(c.id_comentario), es_administracion: c.rol === "admin" })) };
}

/** La administración cambia estado o prioridad y/o responde. */
async function updateTicket(id, actorId, payload = {}) {
  const current = await getTicket(id, { admin: true });
  const estado = payload.estado ? text(payload.estado).toUpperCase() : current.estado;
  const prioridad = payload.prioridad ? text(payload.prioridad).toUpperCase() : current.prioridad;
  const comentario = text(payload.comentario);
  if (!STATUSES.includes(estado)) throw fail(400, "Estado inválido.");
  if (!PRIORITIES.includes(prioridad)) throw fail(400, "Prioridad inválida.");
  if (comentario.length > 1000) throw fail(400, "La respuesta admite hasta 1000 caracteres.");
  const statusChanged = estado !== current.estado;
  if (!statusChanged && prioridad === current.prioridad && !comentario) throw fail(400, "No hay cambios para guardar.");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `UPDATE TICKET SET estado = ?, prioridad = ?, actualizado_en = UTC_TIMESTAMP(),
         resuelto_en = CASE WHEN ? IN ('RESUELTO','CERRADO') THEN COALESCE(resuelto_en, UTC_TIMESTAMP()) ELSE NULL END
       WHERE id_ticket = ?`, [estado, prioridad, estado, current.id_ticket]);
    if (comentario || statusChanged) {
      await connection.execute("INSERT INTO TICKET_COMENTARIO (id_ticket, id_usuario, comentario, estado_nuevo) VALUES (?, ?, ?, ?)",
        [current.id_ticket, actorId, comentario || `Estado cambiado a ${STATUS_LABELS[estado]}.`, statusChanged ? estado : null]);
      const title = statusChanged ? `Tu reporte está ${STATUS_LABELS[estado].toLowerCase()}` : "La administración respondió tu reporte";
      await notify(connection, [current.id_usuario], current.id_ticket, title, `Reporte #${current.id_ticket} · ${current.titulo}${comentario ? `: ${comentario}` : "."}`);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return getTicket(current.id_ticket, { admin: true });
}

/** Quien reportó puede agregar información; si estaba resuelto, se reabre. */
async function addReporterComment(id, userId, payload = {}) {
  const current = await getTicket(id, { userId });
  const comentario = text(payload.comentario);
  if (comentario.length < 2 || comentario.length > 1000) throw fail(400, "Escribe un comentario de 2 a 1000 caracteres.");
  const reopen = payload.reabrir === true && ["RESUELTO", "CERRADO"].includes(current.estado);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute("INSERT INTO TICKET_COMENTARIO (id_ticket, id_usuario, comentario, estado_nuevo) VALUES (?, ?, ?, ?)",
      [current.id_ticket, userId, comentario, reopen ? "ABIERTO" : null]);
    await connection.execute(`UPDATE TICKET SET actualizado_en = UTC_TIMESTAMP()${reopen ? ", estado = 'ABIERTO', resuelto_en = NULL" : ""} WHERE id_ticket = ?`, [current.id_ticket]);
    const [admins] = await connection.execute("SELECT u.id_usuario FROM USUARIO u JOIN TIPO_USUARIO tu ON tu.id_tipo_usuario = u.id_tipo_usuario WHERE tu.nombre = 'admin' AND u.activo = TRUE");
    await notify(connection, admins.map((a) => a.id_usuario), current.id_ticket, reopen ? `Reporte reabierto: ${current.titulo}` : `Nuevo comentario: ${current.titulo}`, `Reporte #${current.id_ticket}: ${comentario}`);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return getTicket(current.id_ticket, { userId });
}

async function ticketSummary() {
  const rows = await query("SELECT estado, COUNT(*) n FROM TICKET GROUP BY estado");
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const row of rows) counts[row.estado || "ABIERTO"] = Number(row.n);
  const [avg] = await query("SELECT ROUND(AVG(TIMESTAMPDIFF(HOUR, creado_en, resuelto_en)), 1) horas FROM TICKET WHERE resuelto_en IS NOT NULL AND creado_en >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 90 DAY)");
  return { ...counts, horas_promedio_resolucion: avg?.horas == null ? null : Number(avg.horas) };
}

module.exports = { CATEGORIES, PRIORITIES, STATUSES, createTicket, listTickets, getTicket, updateTicket, addReporterComment, ticketSummary, validateTicket };
