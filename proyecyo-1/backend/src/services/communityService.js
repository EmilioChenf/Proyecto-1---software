const { pool, query } = require("../database/mysql");

const DOC_CATEGORIES = ["REGLAMENTO", "ACTA", "FINANZAS", "AVISO", "OTRO"];
const CONTACT_CATEGORIES = ["EMERGENCIA", "ADMINISTRACION", "JUNTA", "SERVICIOS"];
const MIME_TYPES = {
  "application/pdf": "PDF",
  "image/jpeg": "Imagen", "image/png": "Imagen",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
};
const MAX_DOC_BYTES = 3 * 1024 * 1024;

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const text = (value) => String(value ?? "").trim();
const pad = (value) => String(value).padStart(2, "0");
const formatDateTime = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

async function notifyCommunity(connection, titulo, mensaje) {
  const [users] = await connection.execute(
    `SELECT u.id_usuario FROM USUARIO u JOIN TIPO_USUARIO t ON t.id_tipo_usuario = u.id_tipo_usuario
      WHERE u.activo = 1 AND t.nombre IN ('residente', 'inquilino')`,
  );
  for (const { id_usuario: id } of users) {
    await connection.execute("INSERT INTO NOTIFICACION (id_usuario, tipo, titulo, mensaje, leido) VALUES (?, 'COMUNIDAD', ?, ?, FALSE)", [id, titulo.slice(0, 150), mensaje.slice(0, 255)]);
  }
}

async function houseOf(userId, role) {
  const { getHouseByUserId } = require("./visitsService").__private__;
  return getHouseByUserId(userId, role).catch(() => null);
}

// ---------- Votaciones ----------
function validatePoll(payload, now = new Date()) {
  const titulo = text(payload.titulo);
  if (titulo.length < 5 || titulo.length > 150) throw fail("La pregunta debe tener entre 5 y 150 caracteres.");
  const descripcion = text(payload.descripcion);
  if (descripcion.length > 1000) throw fail("La descripción admite hasta 1000 caracteres.");
  const opciones = (Array.isArray(payload.opciones) ? payload.opciones : []).map(text).filter(Boolean);
  if (opciones.length < 2 || opciones.length > 8) throw fail("Agrega entre 2 y 8 opciones de respuesta.");
  if (opciones.some((option) => option.length > 120)) throw fail("Cada opción admite hasta 120 caracteres.");
  if (new Set(opciones.map((o) => o.toLowerCase())).size !== opciones.length) throw fail("Las opciones no se pueden repetir.");
  const cierre = new Date(String(payload.fecha_cierre || "").replace(" ", "T"));
  if (Number.isNaN(cierre.getTime()) || cierre <= now) throw fail("La fecha de cierre debe ser futura.");
  return { titulo, descripcion: descripcion || null, opciones, cierre, resultados_visibles: payload.resultados_visibles !== false };
}

async function createPoll(adminId, payload) {
  const data = validatePoll(payload);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      "INSERT INTO VOTACION (titulo, descripcion, fecha_cierre, resultados_visibles, creada_por) VALUES (?, ?, ?, ?, ?)",
      [data.titulo, data.descripcion, data.cierre, data.resultados_visibles ? 1 : 0, adminId],
    );
    for (const [index, option] of data.opciones.entries()) {
      await connection.execute("INSERT INTO VOTACION_OPCION (id_votacion, texto, orden) VALUES (?, ?, ?)", [result.insertId, option, index]);
    }
    await notifyCommunity(connection, `Nueva votación: ${data.titulo}`, `Vota antes del ${formatDateTime(data.cierre)}. Un voto por vivienda.`);
    await connection.commit();
    return getPoll(result.insertId, { admin: true });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function listPolls({ userId = null, role = null, admin = false } = {}) {
  const ids = await query("SELECT id_votacion FROM VOTACION ORDER BY (cerrada_en IS NULL AND fecha_cierre > NOW()) DESC, fecha_cierre DESC LIMIT 50");
  const house = !admin && userId ? await houseOf(userId, role) : null;
  const result = [];
  for (const { id_votacion: id } of ids) result.push(await getPoll(id, { admin, house, role }));
  return result;
}

async function getPoll(id, { admin = false, house = null, role = null } = {}) {
  const [poll] = await query("SELECT * FROM VOTACION WHERE id_votacion = ?", [Number(id)]);
  if (!poll) throw fail("La votación no existe.", 404);
  const options = await query(
    `SELECT o.id_opcion, o.texto, COUNT(v.id_casa) votos FROM VOTACION_OPCION o
       LEFT JOIN VOTO v ON v.id_opcion = o.id_opcion WHERE o.id_votacion = ? GROUP BY o.id_opcion ORDER BY o.orden`,
    [poll.id_votacion],
  );
  const [houses] = await query("SELECT COUNT(*) n FROM CASA");
  const open = !poll.cerrada_en && new Date(poll.fecha_cierre) > new Date();
  const total = options.reduce((sum, option) => sum + Number(option.votos), 0);
  let myVote = null;
  if (house) {
    const [vote] = await query("SELECT id_opcion FROM VOTO WHERE id_votacion = ? AND id_casa = ?", [poll.id_votacion, house.id_casa]);
    myVote = vote ? Number(vote.id_opcion) : null;
  }
  const showResults = admin || !open || (Number(poll.resultados_visibles) === 1 && myVote !== null);
  return {
    id_votacion: Number(poll.id_votacion), titulo: poll.titulo, descripcion: poll.descripcion,
    fecha_cierre: formatDateTime(poll.fecha_cierre), abierta: open, resultados_visibles: Number(poll.resultados_visibles) === 1,
    total_votos: total, viviendas: Number(houses.n), participacion: houses.n ? Math.round((total / houses.n) * 1000) / 10 : 0,
    opciones: options.map((option) => ({ id_opcion: Number(option.id_opcion), texto: option.texto, votos: showResults ? Number(option.votos) : null })),
    mostrar_resultados: showResults, mi_voto: myVote,
    puede_votar: !admin && open && role === "residente" && Boolean(house) && myVote === null,
    sin_vivienda: !admin && role === "residente" && !house,
  };
}

async function vote(pollId, userId, role, optionId) {
  if (role !== "residente") throw fail("Solo el propietario o residente responsable vota por la vivienda.", 403);
  const house = await houseOf(userId, role);
  if (!house) throw fail("Tu usuario no tiene una vivienda asignada para votar.", 409);
  const [poll] = await query("SELECT fecha_cierre, cerrada_en FROM VOTACION WHERE id_votacion = ?", [Number(pollId)]);
  if (!poll) throw fail("La votación no existe.", 404);
  if (poll.cerrada_en || new Date(poll.fecha_cierre) <= new Date()) throw fail("La votación ya cerró.", 409);
  const [option] = await query("SELECT id_opcion FROM VOTACION_OPCION WHERE id_opcion = ? AND id_votacion = ?", [Number(optionId), Number(pollId)]);
  if (!option) throw fail("Elige una de las opciones de la votación.");
  try {
    await query("INSERT INTO VOTO (id_votacion, id_casa, id_opcion, id_usuario) VALUES (?, ?, ?, ?)", [Number(pollId), house.id_casa, Number(optionId), userId]);
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") throw fail("Tu vivienda ya votó en esta votación.", 409);
    throw error;
  }
  return getPoll(pollId, { house, role });
}

async function closePoll(pollId) {
  const result = await query("UPDATE VOTACION SET cerrada_en = NOW() WHERE id_votacion = ? AND cerrada_en IS NULL", [Number(pollId)]);
  if (!result.affectedRows) throw fail("La votación no existe o ya estaba cerrada.", 409);
  return getPoll(pollId, { admin: true });
}

async function deletePoll(pollId) {
  const poll = await getPoll(pollId, { admin: true });
  if (poll.total_votos > 0 && poll.abierta) throw fail("La votación ya tiene votos: ciérrala en lugar de eliminarla.", 409);
  await query("DELETE FROM VOTACION WHERE id_votacion = ?", [Number(pollId)]);
  return { id_votacion: poll.id_votacion, eliminada: true };
}

// ---------- Documentos ----------
function parseDocument(payload) {
  const titulo = text(payload.titulo);
  if (titulo.length < 3 || titulo.length > 150) throw fail("El título debe tener entre 3 y 150 caracteres.");
  const categoria = text(payload.categoria || "OTRO").toUpperCase();
  if (!DOC_CATEGORIES.includes(categoria)) throw fail("Categoría de documento inválida.");
  const nombre = text(payload.nombre_archivo).replace(/[\\/]/g, "_").slice(0, 180);
  const match = String(payload.archivo || "").match(/^data:([\w.+/-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!nombre || !match) throw fail("Adjunta el archivo del documento.");
  if (!MIME_TYPES[match[1]]) throw fail("Solo se aceptan PDF, Word, Excel o imágenes.");
  const bytes = Math.floor((match[2].length * 3) / 4);
  if (bytes > MAX_DOC_BYTES) throw fail("El archivo supera 3 MB. Comprímelo o divídelo.");
  return { titulo, categoria, nombre, mime: match[1], bytes, contenido: match[2] };
}

async function createDocument(adminId, payload) {
  const doc = parseDocument(payload);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      "INSERT INTO DOCUMENTO_COMUNIDAD (titulo, categoria, nombre_archivo, tipo_mime, tamano, contenido, subido_por) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [doc.titulo, doc.categoria, doc.nombre, doc.mime, doc.bytes, doc.contenido, adminId],
    );
    if (payload.notificar !== false) await notifyCommunity(connection, `Nuevo documento: ${doc.titulo}`, "La administración compartió un documento. Puedes descargarlo en Comunidad.");
    await connection.commit();
    return (await listDocuments()).find((item) => item.id_documento === result.insertId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function listDocuments() {
  const rows = await query(
    `SELECT d.id_documento, d.titulo, d.categoria, d.nombre_archivo, d.tipo_mime, d.tamano, d.creado_en, u.nombre subido_por
       FROM DOCUMENTO_COMUNIDAD d JOIN USUARIO u ON u.id_usuario = d.subido_por ORDER BY d.creado_en DESC, d.id_documento DESC`,
  );
  return rows.map((row) => ({ ...row, id_documento: Number(row.id_documento), tamano: Number(row.tamano), tipo: MIME_TYPES[row.tipo_mime] || "Archivo", creado_en: formatDateTime(row.creado_en) }));
}

async function getDocumentFile(id) {
  const [row] = await query("SELECT nombre_archivo, tipo_mime, contenido FROM DOCUMENTO_COMUNIDAD WHERE id_documento = ?", [Number(id)]);
  if (!row) throw fail("El documento no existe.", 404);
  return { nombre: row.nombre_archivo, mime: row.tipo_mime, buffer: Buffer.from(row.contenido, "base64") };
}

async function deleteDocument(id) {
  const result = await query("DELETE FROM DOCUMENTO_COMUNIDAD WHERE id_documento = ?", [Number(id)]);
  if (!result.affectedRows) throw fail("El documento no existe.", 404);
  return { id_documento: Number(id), eliminado: true };
}

// ---------- Directorio ----------
function validateContact(payload) {
  const nombre = text(payload.nombre);
  if (nombre.length < 2 || nombre.length > 120) throw fail("El nombre debe tener entre 2 y 120 caracteres.");
  const categoria = text(payload.categoria || "SERVICIOS").toUpperCase();
  if (!CONTACT_CATEGORIES.includes(categoria)) throw fail("Categoría de contacto inválida.");
  const telefono = text(payload.telefono);
  const correo = text(payload.correo).toLowerCase();
  if (!telefono && !correo) throw fail("Agrega un teléfono o un correo.");
  if (telefono && !/^[0-9+()\-\s]{3,30}$/.test(telefono)) throw fail("El teléfono solo admite números, espacios, +, - y paréntesis.");
  if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw fail("El correo no es válido.");
  const nota = text(payload.nota);
  if (nota.length > 200) throw fail("La nota admite hasta 200 caracteres.");
  return { nombre, categoria, telefono: telefono || null, correo: correo || null, nota: nota || null, orden: Number.isInteger(Number(payload.orden)) ? Number(payload.orden) : 0 };
}

async function listContacts() {
  const rows = await query("SELECT * FROM DIRECTORIO_CONTACTO ORDER BY FIELD(categoria, 'EMERGENCIA', 'ADMINISTRACION', 'JUNTA', 'SERVICIOS'), orden, nombre");
  return rows.map((row) => ({ ...row, id_contacto: Number(row.id_contacto), orden: Number(row.orden) }));
}

async function saveContact(id, payload) {
  const c = validateContact(payload);
  if (id) {
    const result = await query("UPDATE DIRECTORIO_CONTACTO SET nombre=?, categoria=?, telefono=?, correo=?, nota=?, orden=? WHERE id_contacto=?", [c.nombre, c.categoria, c.telefono, c.correo, c.nota, c.orden, Number(id)]);
    if (!result.affectedRows) throw fail("El contacto no existe.", 404);
    return (await listContacts()).find((item) => item.id_contacto === Number(id));
  }
  const result = await query("INSERT INTO DIRECTORIO_CONTACTO (nombre, categoria, telefono, correo, nota, orden) VALUES (?, ?, ?, ?, ?, ?)", [c.nombre, c.categoria, c.telefono, c.correo, c.nota, c.orden]);
  return (await listContacts()).find((item) => item.id_contacto === result.insertId);
}

async function deleteContact(id) {
  const result = await query("DELETE FROM DIRECTORIO_CONTACTO WHERE id_contacto = ?", [Number(id)]);
  if (!result.affectedRows) throw fail("El contacto no existe.", 404);
  return { id_contacto: Number(id), eliminado: true };
}

module.exports = {
  DOC_CATEGORIES, CONTACT_CATEGORIES, validatePoll, createPoll, listPolls, getPoll, vote, closePoll, deletePoll,
  createDocument, listDocuments, getDocumentFile, deleteDocument, listContacts, saveContact, deleteContact,
};
