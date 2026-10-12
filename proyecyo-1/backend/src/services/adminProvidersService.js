const { query } = require("../database/mysql");

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeDate(value) {
  const normalized = normalizeString(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function normalizeBoolean(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function normalizeProviderStatus(value) {
  const normalized = normalizeString(value).toUpperCase();

  if (!normalized || normalized === "TODOS") {
    return null;
  }

  if (!["VALIDADO", "PENDIENTE"].includes(normalized)) {
    const error = new Error("El filtro de estado del proveedor es invalido.");
    error.status = 400;
    throw error;
  }

  return normalized;
}

function normalizeProviderActivity(value) {
  const normalized = normalizeString(value).toUpperCase();

  if (!normalized || normalized === "TODOS") {
    return null;
  }

  if (!["ACTIVO", "INACTIVO"].includes(normalized)) {
    const error = new Error("El filtro de actividad del proveedor es invalido.");
    error.status = 400;
    throw error;
  }

  return normalized;
}

function mapAdminProvider(row) {
  return {
    id_servicio: Number(row.id_servicio),
    id_casa: Number(row.id_casa),
    nombre: row.nombre,
    tipo_servicio: row.tipo_servicio || "General",
    descripcion: row.descripcion || "",
    casa_unidad: row.torre ? `${row.torre}-${row.numero}` : row.numero,
    activo: Number(row.activo) === 1,
    estado: row.estado_validacion || "PENDIENTE",
    fecha_registro: row.fecha_registro,
    actualizado_en: row.actualizado_en,
    propietario_nombre: row.propietario_nombre,
    ultimo_cambio_por: row.ultimo_cambio_por || row.propietario_nombre,
    ultimo_cambio_en: row.ultimo_cambio_en || row.actualizado_en,
    frecuencia_cambios: Number(row.frecuencia_cambios || 0),
  };
}

function mapAdminProviderHistory(row) {
  return {
    id_historial: Number(row.id_historial),
    id_servicio: Number(row.id_servicio),
    proveedor_nombre: row.proveedor_nombre,
    casa_unidad: row.torre ? `${row.torre}-${row.numero}` : row.numero,
    accion: row.accion,
    detalle: row.detalle,
    realizado_por_nombre: row.realizado_por_nombre,
    realizado_por_rol: row.realizado_por_rol,
    estado_anterior: row.estado_anterior || null,
    estado_nuevo: row.estado_nuevo || null,
    activo_anterior: row.activo_anterior === null ? null : Number(row.activo_anterior) === 1,
    activo_nuevo: row.activo_nuevo === null ? null : Number(row.activo_nuevo) === 1,
    creado_en: row.creado_en,
  };
}

async function getAdminContext(userId) {
  const rows = await query(
    `
      SELECT
        u.id_usuario,
        u.nombre
      FROM USUARIO u
      WHERE u.id_usuario = ?
      LIMIT 1
    `,
    [userId],
  );

  if (!rows[0]) {
    const error = new Error("No se encontro el administrador autenticado.");
    error.status = 404;
    throw error;
  }

  return rows[0];
}

async function listAdminProviders(filters = {}) {
  const search = normalizeString(filters.search).toLowerCase();
  const house = normalizeString(filters.house).toLowerCase();
  const actor = normalizeString(filters.user).toLowerCase();
  const date = normalizeDate(filters.date);
  const status = normalizeProviderStatus(filters.status);
  const activity = normalizeProviderActivity(filters.activity);
  const sqlFilters = ["1 = 1"];
  const params = [];

  if (search) {
    sqlFilters.push(`
      (
        LOWER(s.nombre) LIKE ?
        OR LOWER(COALESCE(s.tipo_servicio, '')) LIKE ?
        OR LOWER(COALESCE(s.descripcion, '')) LIKE ?
      )
    `);
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (house) {
    sqlFilters.push(`
      LOWER(
        CONCAT(
          COALESCE(c.torre, ''),
          CASE WHEN c.torre IS NOT NULL AND c.torre <> '' THEN '-' ELSE '' END,
          c.numero
        )
      ) LIKE ?
    `);
    params.push(`%${house}%`);
  }

  if (actor) {
    sqlFilters.push("LOWER(COALESCE(ultimo_cambio.realizado_por_nombre, propietario.nombre)) LIKE ?");
    params.push(`%${actor}%`);
  }

  if (date) {
    sqlFilters.push("DATE(cs.actualizado_en) = ?");
    params.push(date);
  }

  if (status) {
    sqlFilters.push("cs.estado_validacion = ?");
    params.push(status);
  }

  if (activity) {
    sqlFilters.push(activity === "ACTIVO" ? "cs.activo = TRUE" : "cs.activo = FALSE");
  }

  const rows = await query(
    `
      SELECT
        cs.id_casa,
        cs.id_servicio,
        s.nombre,
        s.tipo_servicio,
        s.descripcion,
        c.numero,
        c.torre,
        cs.activo,
        cs.estado_validacion,
        DATE_FORMAT(cs.fecha_registro, '%Y-%m-%d %H:%i:%s') AS fecha_registro,
        DATE_FORMAT(cs.actualizado_en, '%Y-%m-%d %H:%i:%s') AS actualizado_en,
        propietario.nombre AS propietario_nombre,
        ultimo_cambio.realizado_por_nombre AS ultimo_cambio_por,
        DATE_FORMAT(ultimo_cambio.creado_en, '%Y-%m-%d %H:%i:%s') AS ultimo_cambio_en,
        COALESCE(historial_totales.total, 0) AS frecuencia_cambios
      FROM CASA_SERVICIO cs
      INNER JOIN SERVICIO s
        ON s.id_servicio = cs.id_servicio
      INNER JOIN CASA c
        ON c.id_casa = cs.id_casa
      LEFT JOIN RESIDENTE r
        ON r.id_residente = c.id_residente
      LEFT JOIN USUARIO propietario
        ON propietario.id_usuario = r.id_usuario
      LEFT JOIN (
        SELECT h1.*
        FROM HISTORIAL_CAMBIO_PROVEEDOR h1
        INNER JOIN (
          SELECT id_casa, id_servicio, MAX(id_historial) AS max_historial
          FROM HISTORIAL_CAMBIO_PROVEEDOR
          GROUP BY id_casa, id_servicio
        ) ult
          ON ult.id_casa = h1.id_casa
          AND ult.id_servicio = h1.id_servicio
          AND ult.max_historial = h1.id_historial
      ) ultimo_cambio
        ON ultimo_cambio.id_casa = cs.id_casa
        AND ultimo_cambio.id_servicio = cs.id_servicio
      LEFT JOIN (
        SELECT id_casa, id_servicio, COUNT(*) AS total
        FROM HISTORIAL_CAMBIO_PROVEEDOR
        GROUP BY id_casa, id_servicio
      ) historial_totales
        ON historial_totales.id_casa = cs.id_casa
        AND historial_totales.id_servicio = cs.id_servicio
      WHERE ${sqlFilters.join(" AND ")}
      ORDER BY cs.actualizado_en DESC, s.nombre ASC
    `,
    params,
  );

  return rows.map(mapAdminProvider);
}

async function listAdminProviderHistory(filters = {}) {
  const actor = normalizeString(filters.user).toLowerCase();
  const date = normalizeDate(filters.date);
  const status = normalizeProviderStatus(filters.status);
  const sqlFilters = ["1 = 1"];
  const params = [];

  if (actor) {
    sqlFilters.push("LOWER(h.realizado_por_nombre) LIKE ?");
    params.push(`%${actor}%`);
  }

  if (date) {
    sqlFilters.push("DATE(h.creado_en) = ?");
    params.push(date);
  }

  if (status) {
    sqlFilters.push("COALESCE(h.estado_nuevo, h.estado_anterior, 'PENDIENTE') = ?");
    params.push(status);
  }

  const rows = await query(
    `
      SELECT
        h.id_historial,
        h.id_servicio,
        s.nombre AS proveedor_nombre,
        c.numero,
        c.torre,
        h.accion,
        h.detalle,
        h.realizado_por_nombre,
        h.realizado_por_rol,
        h.estado_anterior,
        h.estado_nuevo,
        h.activo_anterior,
        h.activo_nuevo,
        DATE_FORMAT(h.creado_en, '%Y-%m-%d %H:%i:%s') AS creado_en
      FROM HISTORIAL_CAMBIO_PROVEEDOR h
      INNER JOIN SERVICIO s
        ON s.id_servicio = h.id_servicio
      INNER JOIN CASA c
        ON c.id_casa = h.id_casa
      WHERE ${sqlFilters.join(" AND ")}
      ORDER BY h.creado_en DESC, h.id_historial DESC
    `,
    params,
  );

  return rows.map(mapAdminProviderHistory);
}

async function updateAdminProvider(providerId, payload = {}, adminUserId) {
  const normalizedProviderId = Number(providerId);

  if (!Number.isInteger(normalizedProviderId) || normalizedProviderId <= 0) {
    const error = new Error("El proveedor indicado no es valido.");
    error.status = 400;
    throw error;
  }

  const admin = await getAdminContext(adminUserId);
  const rows = await query(
    `
      SELECT
        cs.id_casa,
        cs.id_servicio,
        cs.activo,
        cs.estado_validacion,
        s.nombre
      FROM CASA_SERVICIO cs
      INNER JOIN SERVICIO s
        ON s.id_servicio = cs.id_servicio
      WHERE cs.id_servicio = ?
        AND cs.id_casa = ?
      LIMIT 1
    `,
    [normalizedProviderId, Number(payload.id_casa)],
  );

  const current = rows[0];

  if (!current) {
    const error = new Error("No se encontro la asociacion del proveedor con la unidad.");
    error.status = 404;
    throw error;
  }

  const nextActive =
    payload.activo === undefined ? Number(current.activo) === 1 : normalizeBoolean(payload.activo);
  const nextStatus = payload.estado === "VALIDADO" ? "VALIDADO" : "PENDIENTE";

  await query(
    `
      UPDATE CASA_SERVICIO
      SET
        activo = ?,
        estado_validacion = ?,
        actualizado_en = CURRENT_TIMESTAMP
      WHERE id_casa = ?
        AND id_servicio = ?
    `,
    [nextActive, nextStatus, current.id_casa, normalizedProviderId],
  );

  await query(
    `
      INSERT INTO HISTORIAL_CAMBIO_PROVEEDOR (
        id_casa,
        id_servicio,
        accion,
        detalle,
        activo_anterior,
        activo_nuevo,
        estado_anterior,
        estado_nuevo,
        realizado_por_usuario,
        realizado_por_nombre,
        realizado_por_rol
      )
      VALUES (?, ?, 'REVISION_ADMIN', ?, ?, ?, ?, ?, ?, ?, 'admin')
    `,
    [
      current.id_casa,
      normalizedProviderId,
      `Administrador ${admin.nombre} actualizo el proveedor ${current.nombre}.`,
      Number(current.activo) === 1,
      nextActive,
      current.estado_validacion || "PENDIENTE",
      nextStatus,
      admin.id_usuario,
      admin.nombre,
    ],
  );

  const updatedProviders = await listAdminProviders({});
  return updatedProviders.find(
    (provider) => provider.id_servicio === normalizedProviderId && provider.id_casa === current.id_casa,
  );
}

module.exports = {
  listAdminProviders,
  listAdminProviderHistory,
  updateAdminProvider,
};
