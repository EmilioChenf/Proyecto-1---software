const { query } = require("../database/mysql");
const { guatemalaToday, sqlUtcTimeToGuatemala } = require("../utils/guatemalaTime");

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeDate(value) {
  const normalized = normalizeString(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

async function getTenantHouse(userId) {
  const rows = await query(
    `
      SELECT
        c.id_casa,
        c.numero,
        c.torre,
        propietario.id_usuario AS propietario_usuario_id,
        propietario.nombre AS propietario_nombre
      FROM INQUILINO i
      INNER JOIN INQUILINO_CASA ic ON ic.id_inquilino = i.id_inquilino
      INNER JOIN CASA c ON c.id_casa = ic.id_casa
      LEFT JOIN RESIDENTE r ON r.id_residente = c.id_residente
      LEFT JOIN USUARIO propietario ON propietario.id_usuario = r.id_usuario
      WHERE i.id_usuario = ?
        AND i.autorizado = TRUE
      LIMIT 1
    `,
    [userId],
  );

  if (!rows[0]) {
    const error = new Error("No se encontro una unidad autorizada para este inquilino.");
    error.status = 404;
    throw error;
  }

  return rows[0];
}

// Permisos historicos que prometen capacidades que el backend NO ofrece al
// inquilino (las reservas de amenidades exigen requireResident). Los registros
// se conservan; solo dejan de mostrarse como capacidades vigentes.
const UNSUPPORTED_TENANT_PERMISSIONS = ["Reservas de amenidades"];

async function listTenantPermissions(userId) {
  const rows = await query(
    `
      SELECT
        id_permiso_inquilino,
        nombre,
        descripcion,
        restriccion,
        DATE_FORMAT(fecha_inicio, '%Y-%m-%d') AS fecha_inicio,
        DATE_FORMAT(fecha_fin, '%Y-%m-%d') AS fecha_fin,
        estado
      FROM PERMISO_INQUILINO
      WHERE id_usuario = ?
        AND nombre NOT IN (${UNSUPPORTED_TENANT_PERMISSIONS.map(() => "?").join(", ")})
      ORDER BY estado ASC, fecha_fin ASC, nombre ASC
    `,
    [userId, ...UNSUPPORTED_TENANT_PERMISSIONS],
  );

  return rows.map((row) => ({
    id_permiso: Number(row.id_permiso_inquilino),
    nombre: row.nombre,
    descripcion: row.descripcion,
    restriccion: row.restriccion || "Sin restricciones adicionales",
    fecha_inicio: row.fecha_inicio,
    fecha_fin: row.fecha_fin,
    estado: row.estado || "ACTIVO",
  }));
}

async function listTenantAuthorizationRequests(userId) {
  const rows = await query(
    `
      SELECT
        id_solicitud,
        accion,
        motivo,
        estado,
        respuesta,
        DATE_FORMAT(creado_en, '%Y-%m-%d %H:%i:%s') AS creado_en,
        DATE_FORMAT(actualizado_en, '%Y-%m-%d %H:%i:%s') AS actualizado_en
      FROM SOLICITUD_AUTORIZACION_DIGITAL
      WHERE id_inquilino_usuario = ?
      ORDER BY creado_en DESC, id_solicitud DESC
      LIMIT 20
    `,
    [userId],
  );

  return rows.map((row) => ({
    id_solicitud: Number(row.id_solicitud),
    accion: row.accion,
    motivo: row.motivo,
    estado: row.estado,
    respuesta: row.respuesta || null,
    creado_en: row.creado_en,
    actualizado_en: row.actualizado_en,
  }));
}

async function createTenantAuthorizationRequest(userId, payload = {}) {
  const accion = normalizeString(payload.accion);
  const motivo = normalizeString(payload.motivo);

  if (!accion) {
    const error = new Error("La accion restringida es obligatoria.");
    error.status = 400;
    throw error;
  }

  if (!motivo) {
    const error = new Error("El motivo de la solicitud es obligatorio.");
    error.status = 400;
    throw error;
  }

  const house = await getTenantHouse(userId);
  const userRows = await query("SELECT nombre FROM USUARIO WHERE id_usuario = ? LIMIT 1", [userId]);
  const tenantName = userRows[0]?.nombre || "Inquilino";
  const result = await query(
    `
      INSERT INTO SOLICITUD_AUTORIZACION_DIGITAL (
        id_inquilino_usuario,
        id_propietario_usuario,
        id_casa,
        accion,
        motivo,
        estado
      )
      VALUES (?, ?, ?, ?, ?, 'PENDIENTE')
    `,
    [userId, house.propietario_usuario_id, house.id_casa, accion, motivo],
  );

  const unit = `${house.torre ? `${house.torre}-` : ""}${house.numero}`;
  const recipients = house.propietario_usuario_id ? [{id_usuario:house.propietario_usuario_id}] : await query("SELECT u.id_usuario FROM USUARIO u JOIN TIPO_USUARIO t ON t.id_tipo_usuario=u.id_tipo_usuario WHERE u.activo=1 AND t.nombre='admin'");
  for (const recipient of recipients) await query(
    `
      INSERT INTO NOTIFICACION (id_usuario, tipo, titulo, mensaje, leido)
      VALUES (?, 'SOLICITUD_AUTORIZACION', 'Solicitud digital de autorizacion', ?, FALSE)
    `,
    [
      recipient.id_usuario,
      `${tenantName} solicito autorizacion para "${accion}" en la unidad ${unit}. Motivo: ${motivo}`,
    ],
  );

  const requests = await listTenantAuthorizationRequests(userId);
  return requests.find((item) => item.id_solicitud === Number(result.insertId)) || requests[0];
}

async function listResidentRegulations(filters = {}) {
  const search = normalizeString(filters.search).toLowerCase();
  const category = normalizeString(filters.category).toLowerCase();
  const sqlFilters = ["activo = TRUE"];
  const params = [];

  if (search) {
    sqlFilters.push("(LOWER(titulo) LIKE ? OR LOWER(contenido) LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }

  if (category) {
    sqlFilters.push("LOWER(categoria) = ?");
    params.push(category);
  }

  const rows = await query(
    `
      SELECT
        id_reglamento,
        categoria,
        titulo,
        contenido,
        DATE_FORMAT(actualizado_en, '%Y-%m-%d %H:%i:%s') AS actualizado_en
      FROM REGLAMENTO
      WHERE ${sqlFilters.join(" AND ")}
      ORDER BY categoria ASC, titulo ASC
    `,
    params,
  );

  return rows.map((row) => ({
    id_reglamento: Number(row.id_reglamento),
    categoria: row.categoria,
    titulo: row.titulo,
    contenido: row.contenido,
    actualizado_en: row.actualizado_en,
  }));
}

// Estado operativo para garita a partir de los estados reales de ACCESO:
// AUTORIZADA, INGRESO_REGISTRADO, SALIDA_REGISTRADA, CANCELADA,
// PENDIENTE_APROBACION y RECHAZADA. Solo AUTORIZADA sin ingreso es PENDIENTE.
function mapGuardHistoryStatus(row) {
  if (row.hora_salida) return "SALIDA";
  if (row.hora_ingreso) return "INGRESO";
  const accessStatus = String(row.estado_acceso || "AUTORIZADA").toUpperCase();
  if (accessStatus === "CANCELADA") return "CANCELADA";
  if (accessStatus === "RECHAZADA") return "RECHAZADA";
  if (accessStatus === "PENDIENTE_APROBACION") return "PENDIENTE_APROBACION";
  if (accessStatus === "SALIDA_REGISTRADA") return "SALIDA";
  if (accessStatus === "INGRESO_REGISTRADO") return "INGRESO";
  return "PENDIENTE";
}

async function listGuardDailyAccessHistory(filters = {}) {
  const date = normalizeDate(filters.date) || guatemalaToday();
  const status = normalizeString(filters.status).toUpperCase();
  const search = normalizeString(filters.search).toLowerCase();
  const sqlFilters = ["a.fecha = ?"];
  const params = [date];

  // Los filtros usan las mismas reglas que mapGuardHistoryStatus para que
  // frontend, backend y KPIs del dashboard coincidan.
  if (status === "INGRESO") {
    sqlFilters.push("ra.hora_ingreso IS NOT NULL AND ra.hora_salida IS NULL");
  } else if (status === "SALIDA") {
    sqlFilters.push("ra.hora_salida IS NOT NULL");
  } else if (status === "PENDIENTE") {
    sqlFilters.push("ra.hora_ingreso IS NULL AND COALESCE(a.estado_acceso, 'AUTORIZADA') = 'AUTORIZADA'");
  } else if (status === "CANCELADA") {
    sqlFilters.push("ra.hora_ingreso IS NULL AND a.estado_acceso = 'CANCELADA'");
  } else if (status === "RECHAZADA") {
    sqlFilters.push("ra.hora_ingreso IS NULL AND a.estado_acceso = 'RECHAZADA'");
  } else if (status === "PENDIENTE_APROBACION") {
    sqlFilters.push("ra.hora_ingreso IS NULL AND a.estado_acceso = 'PENDIENTE_APROBACION'");
  }

  if (search) {
    sqlFilters.push("(LOWER(v.nombre) LIKE ? OR LOWER(CONCAT(COALESCE(c.torre, ''), c.numero)) LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }

  const rows = await query(
    `
      SELECT
        a.id_acceso,
        v.nombre AS visitante,
        v.placa,
        CONCAT(COALESCE(c.torre, ''), CASE WHEN c.torre IS NOT NULL AND c.torre <> '' THEN '-' ELSE '' END, c.numero) AS casa,
        a.tipo_visita,
        a.estado_acceso,
        TIME_FORMAT(a.hora_inicio, '%H:%i') AS hora_programada,
        TIME_FORMAT(${sqlUtcTimeToGuatemala("ra.hora_ingreso")}, '%H:%i') AS hora_ingreso,
        TIME_FORMAT(${sqlUtcTimeToGuatemala("ra.hora_salida")}, '%H:%i') AS hora_salida,
        gi.nombre AS guardia_ingreso,
        gs.nombre AS guardia_salida
      FROM ACCESO a
      INNER JOIN VISITANTE v ON v.id_visitante = a.id_visitante
      INNER JOIN CASA c ON c.id_casa = a.id_casa
      LEFT JOIN REGISTRO_ACCESO ra ON ra.id_acceso = a.id_acceso
      -- HU-C08: guardia ejecutor de cada entrada/salida (NULL en historicos).
      LEFT JOIN USUARIO gi ON gi.id_usuario = ra.id_guardia_ingreso
      LEFT JOIN USUARIO gs ON gs.id_usuario = ra.id_guardia_salida
      WHERE ${sqlFilters.join(" AND ")}
      ORDER BY COALESCE(${sqlUtcTimeToGuatemala("ra.hora_ingreso")}, a.hora_inicio) DESC, a.id_acceso DESC
    `,
    params,
  );

  return rows.map((row) => ({
    id_acceso: Number(row.id_acceso),
    visitante: row.visitante,
    placa: row.placa || "Sin placa",
    casa: row.casa,
    tipo_visita: row.tipo_visita,
    estado: mapGuardHistoryStatus(row),
    hora_programada: row.hora_programada,
    hora_ingreso: row.hora_ingreso || null,
    hora_salida: row.hora_salida || null,
    guardia_ingreso: row.guardia_ingreso || null,
    guardia_salida: row.guardia_salida || null,
  }));
}

module.exports = {
  listTenantPermissions,
  listTenantAuthorizationRequests,
  createTenantAuthorizationRequest,
  listResidentRegulations,
  listGuardDailyAccessHistory,
  mapGuardHistoryStatus,
  UNSUPPORTED_TENANT_PERMISSIONS,
};
