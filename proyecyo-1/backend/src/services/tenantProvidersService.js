const crypto = require("crypto");

const { pool, query } = require("../database/mysql");
const { assertVisitTimesAllowed } = require("./configurationService");
const { getVisitById } = require("./visitsService");
const { ensureValidDate, ensureValidTime } = require("../utils/dateTimeValidation");
const { ensureProviderIdentifiers } = require("../utils/providerAccessValidation");
const { ensureVisitWindowNotPast } = require("../utils/visitWindow");

// HU-C06.1/C06.2: roles que pueden registrar proveedores. Las rutas usan el mismo
// conjunto (administrador, residente/propietario e inquilino).
const PROVIDER_REGISTRATION_ROLES = Object.freeze(["admin", "residente", "inquilino"]);

function normalizeBoolean(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeDate(value) {
  const normalized = normalizeString(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

async function getUserContext(userId) {
  const rows = await query(
    `
      SELECT
        u.id_usuario,
        u.nombre,
        LOWER(tu.nombre) AS rol
      FROM USUARIO u
      INNER JOIN TIPO_USUARIO tu
        ON tu.id_tipo_usuario = u.id_tipo_usuario
      WHERE u.id_usuario = ?
      LIMIT 1
    `,
    [userId],
  );

  const user = rows[0];

  if (!user) {
    const error = new Error("No se encontro el usuario autenticado.");
    error.status = 404;
    throw error;
  }

  return user;
}

async function getTenantHouse(userId) {
  const rows = await query(
    `
      SELECT
        c.id_casa,
        c.numero,
        c.torre,
        r.id_residente,
        propietario.id_usuario AS propietario_usuario_id,
        propietario.nombre AS propietario_nombre
      FROM INQUILINO i
      INNER JOIN INQUILINO_CASA ic
        ON ic.id_inquilino = i.id_inquilino
      INNER JOIN CASA c
        ON c.id_casa = ic.id_casa
      LEFT JOIN RESIDENTE r
        ON r.id_residente = c.id_residente
      LEFT JOIN USUARIO propietario
        ON propietario.id_usuario = r.id_usuario
      WHERE i.id_usuario = ?
        AND i.autorizado = TRUE
      LIMIT 1
    `,
    [userId],
  );

  const house = rows[0];

  if (!house) {
    const error = new Error("No se encontro una casa autorizada para este inquilino.");
    error.status = 404;
    throw error;
  }

  return house;
}

async function getOwnerHouses(userId) {
  const rows = await query(
    `
      SELECT
        c.id_casa,
        c.numero,
        c.torre,
        r.id_residente,
        propietario.id_usuario AS propietario_usuario_id,
        propietario.nombre AS propietario_nombre
      FROM RESIDENTE r
      INNER JOIN CASA c
        ON c.id_residente = r.id_residente
      INNER JOIN USUARIO propietario
        ON propietario.id_usuario = r.id_usuario
      WHERE r.id_usuario = ?
      ORDER BY c.torre ASC, c.numero ASC
    `,
    [userId],
  );

  if (rows.length === 0) {
    const error = new Error("No se encontraron unidades asociadas al propietario.");
    error.status = 404;
    throw error;
  }

  return rows;
}

function mapProvider(row) {
  const isLinked = row.id_casa !== null && row.id_casa !== undefined;

  return {
    id_servicio: Number(row.id_servicio),
    nombre: row.nombre,
    tipo_servicio: row.tipo_servicio || "General",
    descripcion: row.descripcion || "Servicio residencial disponible para tu unidad.",
    activo: isLinked ? Number(row.activo) === 1 : false,
    estado: isLinked ? row.estado_validacion || "PENDIENTE" : "PENDIENTE",
    casa_unidad: row.torre ? `${row.torre}-${row.numero}` : row.numero,
    fecha_registro: row.fecha_registro || null,
    actualizado_en: row.actualizado_en || null,
    registrado_por: row.registrado_por || null,
  };
}

function mapOwnerProvider(row) {
  return {
    id_servicio: Number(row.id_servicio),
    id_casa: Number(row.id_casa),
    nombre: row.nombre,
    tipo_servicio: row.tipo_servicio || "General",
    descripcion: row.descripcion || "Servicio residencial disponible para tu unidad.",
    activo: Number(row.activo) === 1,
    estado: row.estado_validacion || "PENDIENTE",
    casa_unidad: row.torre ? `${row.torre}-${row.numero}` : row.numero,
    fecha_registro: row.fecha_registro || null,
    actualizado_en: row.actualizado_en || null,
    registrado_por: row.registrado_por || null,
    propietario_nombre: row.propietario_nombre,
  };
}

function mapProviderHistory(row) {
  return {
    id_historial: Number(row.id_historial),
    id_servicio: Number(row.id_servicio),
    proveedor_nombre: row.proveedor_nombre,
    accion: row.accion,
    detalle: row.detalle,
    activo_anterior: row.activo_anterior === null ? null : Number(row.activo_anterior) === 1,
    activo_nuevo: row.activo_nuevo === null ? null : Number(row.activo_nuevo) === 1,
    estado_anterior: row.estado_anterior || null,
    estado_nuevo: row.estado_nuevo || null,
    realizado_por_usuario: Number(row.realizado_por_usuario),
    realizado_por_nombre: row.realizado_por_nombre,
    realizado_por_rol: row.realizado_por_rol,
    creado_en: row.creado_en,
  };
}

async function createProviderHistoryEntry({
  idCasa,
  idServicio,
  accion,
  detalle,
  activoAnterior = null,
  activoNuevo = null,
  estadoAnterior = null,
  estadoNuevo = null,
  realizadoPorUsuario,
  realizadoPorNombre,
  realizadoPorRol,
}) {
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      idCasa,
      idServicio,
      accion,
      detalle,
      activoAnterior,
      activoNuevo,
      estadoAnterior,
      estadoNuevo,
      realizadoPorUsuario,
      realizadoPorNombre,
      realizadoPorRol,
    ],
  );
}

async function listTenantProviders(userId, filters = {}) {
  const house = await getTenantHouse(userId);
  const search = normalizeString(filters.search).toLowerCase();
  const onlyStatus = normalizeString(filters.status).toUpperCase();
  const registeredDate = normalizeDate(filters.date);
  const sqlFilters = ["c.id_casa = ?"];
  const params = [house.id_casa];

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

  if (["VALIDADO", "PENDIENTE"].includes(onlyStatus)) {
    sqlFilters.push("COALESCE(cs.estado_validacion, 'PENDIENTE') = ?");
    params.push(onlyStatus);
  }

  if (registeredDate) {
    sqlFilters.push("DATE(cs.fecha_registro) = ?");
    params.push(registeredDate);
  }

  const rows = await query(
    `
      SELECT
        s.id_servicio,
        s.nombre,
        s.tipo_servicio,
        s.descripcion,
        cs.id_casa,
        cs.activo,
        cs.estado_validacion,
        DATE_FORMAT(cs.fecha_registro, '%Y-%m-%d %H:%i:%s') AS fecha_registro,
        DATE_FORMAT(cs.actualizado_en, '%Y-%m-%d %H:%i:%s') AS actualizado_en,
        c.numero,
        c.torre,
        creador.realizado_por_nombre AS registrado_por
      FROM SERVICIO s
      CROSS JOIN CASA c
      LEFT JOIN CASA_SERVICIO cs
        ON cs.id_servicio = s.id_servicio
        AND cs.id_casa = c.id_casa
      LEFT JOIN HISTORIAL_CAMBIO_PROVEEDOR creador
        ON creador.id_casa = c.id_casa
        AND creador.id_servicio = s.id_servicio
        AND creador.accion = 'CREACION'
      WHERE ${sqlFilters.join(" AND ")}
      ORDER BY s.nombre ASC
    `,
    params,
  );

  return rows.map(mapProvider);
}

async function getTenantProvidersHistory(userId, filters = {}) {
  const house = await getTenantHouse(userId);
  const actor = normalizeString(filters.user).toLowerCase();
  const date = normalizeDate(filters.date);
  const providerId = Number(filters.providerId);
  const sqlFilters = ["h.id_casa = ?"];
  const params = [house.id_casa];

  if (actor) {
    sqlFilters.push("LOWER(h.realizado_por_nombre) LIKE ?");
    params.push(`%${actor}%`);
  }

  if (date) {
    sqlFilters.push("DATE(h.creado_en) = ?");
    params.push(date);
  }

  if (Number.isInteger(providerId) && providerId > 0) {
    sqlFilters.push("h.id_servicio = ?");
    params.push(providerId);
  }

  const rows = await query(
    `
      SELECT
        h.id_historial,
        h.id_servicio,
        s.nombre AS proveedor_nombre,
        h.accion,
        h.detalle,
        h.activo_anterior,
        h.activo_nuevo,
        h.estado_anterior,
        h.estado_nuevo,
        h.realizado_por_usuario,
        h.realizado_por_nombre,
        h.realizado_por_rol,
        DATE_FORMAT(h.creado_en, '%Y-%m-%d %H:%i:%s') AS creado_en
      FROM HISTORIAL_CAMBIO_PROVEEDOR h
      INNER JOIN SERVICIO s
        ON s.id_servicio = h.id_servicio
      WHERE ${sqlFilters.join(" AND ")}
      ORDER BY h.creado_en DESC, h.id_historial DESC
    `,
    params,
  );

  return rows.map(mapProviderHistory);
}

async function listOwnerProviders(userId, filters = {}) {
  const houses = await getOwnerHouses(userId);
  const houseIds = houses.map((house) => Number(house.id_casa));
  const search = normalizeString(filters.search).toLowerCase();
  const onlyStatus = normalizeString(filters.status).toUpperCase();
  const registeredDate = normalizeDate(filters.date);
  const sqlFilters = [`cs.id_casa IN (${houseIds.map(() => "?").join(", ")})`];
  const params = [...houseIds];

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

  if (["VALIDADO", "PENDIENTE"].includes(onlyStatus)) {
    sqlFilters.push("cs.estado_validacion = ?");
    params.push(onlyStatus);
  }

  if (registeredDate) {
    sqlFilters.push("DATE(cs.fecha_registro) = ?");
    params.push(registeredDate);
  }

  const rows = await query(
    `
      SELECT
        s.id_servicio,
        s.nombre,
        s.tipo_servicio,
        s.descripcion,
        cs.id_casa,
        cs.activo,
        cs.estado_validacion,
        DATE_FORMAT(cs.fecha_registro, '%Y-%m-%d %H:%i:%s') AS fecha_registro,
        DATE_FORMAT(cs.actualizado_en, '%Y-%m-%d %H:%i:%s') AS actualizado_en,
        c.numero,
        c.torre,
        propietario.nombre AS propietario_nombre,
        creador.realizado_por_nombre AS registrado_por
      FROM CASA_SERVICIO cs
      INNER JOIN SERVICIO s
        ON s.id_servicio = cs.id_servicio
      INNER JOIN CASA c
        ON c.id_casa = cs.id_casa
      INNER JOIN RESIDENTE r
        ON r.id_residente = c.id_residente
      INNER JOIN USUARIO propietario
        ON propietario.id_usuario = r.id_usuario
      LEFT JOIN HISTORIAL_CAMBIO_PROVEEDOR creador
        ON creador.id_casa = c.id_casa
        AND creador.id_servicio = s.id_servicio
        AND creador.accion = 'CREACION'
      WHERE ${sqlFilters.join(" AND ")}
      ORDER BY cs.estado_validacion ASC, cs.actualizado_en DESC, s.nombre ASC
    `,
    params,
  );

  return rows.map(mapOwnerProvider);
}

async function updateOwnerProviderValidation(userId, serviceId, payload = {}) {
  const normalizedServiceId = Number(serviceId);
  const normalizedHouseId = Number(payload.id_casa);

  if (!Number.isInteger(normalizedServiceId) || normalizedServiceId <= 0) {
    const error = new Error("El proveedor indicado no es valido.");
    error.status = 400;
    throw error;
  }

  if (!Number.isInteger(normalizedHouseId) || normalizedHouseId <= 0) {
    const error = new Error("La unidad del proveedor es obligatoria.");
    error.status = 400;
    throw error;
  }

  const owner = await getUserContext(userId);
  const houseRows = await query(
    `
      SELECT c.id_casa
      FROM CASA c
      INNER JOIN RESIDENTE r
        ON r.id_residente = c.id_residente
      WHERE c.id_casa = ?
        AND r.id_usuario = ?
      LIMIT 1
    `,
    [normalizedHouseId, userId],
  );

  if (!houseRows[0]) {
    const error = new Error("No tienes permisos para validar proveedores de esta unidad.");
    error.status = 403;
    throw error;
  }

  const currentRows = await query(
    `
      SELECT
        cs.activo,
        cs.estado_validacion,
        s.nombre
      FROM CASA_SERVICIO cs
      INNER JOIN SERVICIO s
        ON s.id_servicio = cs.id_servicio
      WHERE cs.id_casa = ?
        AND cs.id_servicio = ?
      LIMIT 1
    `,
    [normalizedHouseId, normalizedServiceId],
  );
  const current = currentRows[0];

  if (!current) {
    const error = new Error("No se encontro el proveedor asociado a tu unidad.");
    error.status = 404;
    throw error;
  }

  const nextStatus = payload.estado === "VALIDADO" ? "VALIDADO" : "PENDIENTE";
  const nextActive = payload.activo === undefined ? Number(current.activo) === 1 : normalizeBoolean(payload.activo);

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
    [nextActive, nextStatus, normalizedHouseId, normalizedServiceId],
  );

  await createProviderHistoryEntry({
    idCasa: normalizedHouseId,
    idServicio: normalizedServiceId,
    accion: "VALIDACION_PROPIETARIO",
    detalle: `${owner.nombre} valido el proveedor ${current.nombre} como ${nextStatus}.`,
    activoAnterior: Number(current.activo) === 1,
    activoNuevo: nextActive,
    estadoAnterior: current.estado_validacion || "PENDIENTE",
    estadoNuevo: nextStatus,
    realizadoPorUsuario: owner.id_usuario,
    realizadoPorNombre: owner.nombre,
    realizadoPorRol: owner.rol,
  });

  const providers = await listOwnerProviders(userId, {});
  return providers.find(
    (provider) => provider.id_servicio === normalizedServiceId && provider.id_casa === normalizedHouseId,
  );
}

async function updateTenantProvider(userId, serviceId, payload = {}) {
  const normalizedServiceId = Number(serviceId);

  if (!Number.isInteger(normalizedServiceId) || normalizedServiceId <= 0) {
    const error = new Error("El servicio indicado no es valido.");
    error.status = 400;
    throw error;
  }

  const house = await getTenantHouse(userId);
  const user = await getUserContext(userId);
  const serviceRows = await query(
    `
      SELECT
        s.id_servicio,
        s.nombre,
        cs.activo,
        cs.estado_validacion
      FROM SERVICIO s
      LEFT JOIN CASA_SERVICIO cs
        ON cs.id_servicio = s.id_servicio
        AND cs.id_casa = ?
      WHERE s.id_servicio = ?
      LIMIT 1
    `,
    [house.id_casa, normalizedServiceId],
  );

  const currentProvider = serviceRows[0];

  if (!currentProvider) {
    const error = new Error("El proveedor indicado no existe.");
    error.status = 404;
    throw error;
  }

  const active = normalizeBoolean(payload.activo);
  const previousActive = currentProvider.activo === null ? null : Number(currentProvider.activo) === 1;
  const previousStatus = currentProvider.estado_validacion || "PENDIENTE";

  await query(
    `
      INSERT INTO CASA_SERVICIO (
        id_casa,
        id_servicio,
        fecha_registro,
        actualizado_en,
        activo,
        estado_validacion
      )
      VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, 'PENDIENTE')
      ON DUPLICATE KEY UPDATE
        activo = VALUES(activo),
        actualizado_en = CURRENT_TIMESTAMP,
        estado_validacion = CASE
          WHEN VALUES(activo) = 0 THEN estado_validacion
          WHEN estado_validacion = 'VALIDADO' THEN estado_validacion
          ELSE 'PENDIENTE'
        END
    `,
    [house.id_casa, normalizedServiceId, active],
  );

  await createProviderHistoryEntry({
    idCasa: house.id_casa,
    idServicio: normalizedServiceId,
    accion: active ? "ACTIVACION" : "DESACTIVACION",
    detalle: active
      ? `El proveedor ${currentProvider.nombre} fue activado por ${user.nombre}.`
      : `El proveedor ${currentProvider.nombre} fue desactivado por ${user.nombre}.`,
    activoAnterior: previousActive,
    activoNuevo: active,
    estadoAnterior: previousStatus,
    estadoNuevo: active && previousStatus !== "VALIDADO" ? "PENDIENTE" : previousStatus,
    realizadoPorUsuario: user.id_usuario,
    realizadoPorNombre: user.nombre,
    realizadoPorRol: user.rol,
  });

  const providers = await listTenantProviders(userId);
  return providers.find((provider) => provider.id_servicio === normalizedServiceId);
}

function httpError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

async function getHouseById(houseId) {
  const rows = await query(
    `
      SELECT c.id_casa, c.numero, c.torre
      FROM CASA c
      WHERE c.id_casa = ?
      LIMIT 1
    `,
    [houseId],
  );

  if (!rows[0]) {
    throw httpError("La casa seleccionada no existe.", 404);
  }

  return rows[0];
}

/** Casa en la que el actor puede registrar al proveedor segun su rol. */
async function resolveProviderHouse(actor, payload = {}) {
  const requestedHouseId = Number(payload.id_casa);
  const hasRequestedHouse = Number.isInteger(requestedHouseId) && requestedHouseId > 0;

  if (actor.role === "inquilino") {
    const house = await getTenantHouse(actor.id);
    if (hasRequestedHouse && Number(house.id_casa) !== requestedHouseId) {
      throw httpError("No tienes permisos para registrar proveedores en esta unidad.", 403);
    }
    return house;
  }

  if (actor.role === "residente") {
    const houses = await getOwnerHouses(actor.id);
    if (!hasRequestedHouse) return houses[0];
    const house = houses.find((item) => Number(item.id_casa) === requestedHouseId);
    if (!house) {
      throw httpError("No tienes permisos para registrar proveedores en esta unidad.", 403);
    }
    return house;
  }

  if (actor.role === "admin") {
    if (!hasRequestedHouse) {
      throw httpError("Debe seleccionar una casa valida.", 400);
    }
    return getHouseById(requestedHouseId);
  }

  throw httpError("Tu rol no puede registrar proveedores.", 403);
}

function generateQrToken() {
  return crypto.randomBytes(18).toString("hex");
}

function validateProviderRegistration(payload = {}) {
  const nombre = normalizeString(payload.nombre);
  const servicio = normalizeString(payload.motivo_servicio || payload.tipo_servicio);
  const observaciones = normalizeString(payload.observaciones || payload.descripcion);

  if (!nombre) {
    throw httpError("El nombre del proveedor es obligatorio.", 400);
  }
  if (nombre.length > 100) {
    throw httpError("El nombre del proveedor no puede superar 100 caracteres.", 400);
  }
  if (!servicio) {
    throw httpError("Indica el servicio que realizara el proveedor.", 400);
  }
  if (servicio.length > 120) {
    throw httpError("El servicio no puede superar 120 caracteres.", 400);
  }
  if (observaciones.length > 255) {
    throw httpError("Las observaciones no pueden superar 255 caracteres.", 400);
  }

  const { medioIngreso, placa, dpi } = ensureProviderIdentifiers(payload);
  const fecha = ensureValidDate(payload.fecha);
  const horaInicio = ensureValidTime(payload.hora_inicio, "hora de inicio");
  const horaFin = ensureValidTime(payload.hora_fin, "hora de fin");

  if (horaInicio >= horaFin) {
    throw httpError("La hora de fin debe ser mayor a la hora de inicio.", 400);
  }

  ensureVisitWindowNotPast(fecha, horaInicio, horaFin);

  return { nombre, servicio, observaciones, medioIngreso, placa, dpi, fecha, horaInicio, horaFin };
}

async function getHouseProvider(houseId, serviceId) {
  const rows = await query(
    `
      SELECT
        s.id_servicio,
        s.nombre,
        s.tipo_servicio,
        s.descripcion,
        cs.id_casa,
        cs.activo,
        cs.estado_validacion,
        DATE_FORMAT(cs.fecha_registro, '%Y-%m-%d %H:%i:%s') AS fecha_registro,
        DATE_FORMAT(cs.actualizado_en, '%Y-%m-%d %H:%i:%s') AS actualizado_en,
        c.numero,
        c.torre,
        propietario.nombre AS propietario_nombre,
        creador.realizado_por_nombre AS registrado_por
      FROM CASA_SERVICIO cs
      INNER JOIN SERVICIO s ON s.id_servicio = cs.id_servicio
      INNER JOIN CASA c ON c.id_casa = cs.id_casa
      LEFT JOIN RESIDENTE r ON r.id_residente = c.id_residente
      LEFT JOIN USUARIO propietario ON propietario.id_usuario = r.id_usuario
      LEFT JOIN HISTORIAL_CAMBIO_PROVEEDOR creador
        ON creador.id_casa = c.id_casa
        AND creador.id_servicio = s.id_servicio
        AND creador.accion = 'CREACION'
      WHERE cs.id_casa = ? AND cs.id_servicio = ?
      LIMIT 1
    `,
    [houseId, serviceId],
  );

  return rows[0] ? mapOwnerProvider(rows[0]) : null;
}

/**
 * HU-C06: registro de un proveedor desde cualquiera de los roles permitidos.
 * En una sola transaccion vincula el proveedor a la casa y crea su acceso con QR,
 * de modo que nunca queda un proveedor sin acceso ni un acceso sin identificador.
 * El inquilino deja al proveedor PENDIENTE de validacion del propietario; el
 * propietario y el administrador lo registran ya VALIDADO.
 */
async function registerProvider(actor, payload = {}) {
  if (!actor || !PROVIDER_REGISTRATION_ROLES.includes(actor.role)) {
    throw httpError("Tu rol no puede registrar proveedores.", 403);
  }

  const data = validateProviderRegistration(payload);
  const house = await resolveProviderHouse(actor, payload);
  const user = await getUserContext(actor.id);
  await assertVisitTimesAllowed(data.horaInicio, data.horaFin, data.fecha);

  const validationStatus = actor.role === "inquilino" ? "PENDIENTE" : "VALIDADO";
  const houseLabel = house.torre ? `${house.torre}-${house.numero}` : house.numero;
  const connection = await pool.getConnection();
  let serviceId;
  let accessId;
  let previousLink;

  try {
    await connection.beginTransaction();

    const [existingServices] = await connection.execute(
      `
        SELECT id_servicio
        FROM SERVICIO
        WHERE LOWER(nombre) = LOWER(?)
          AND LOWER(tipo_servicio) = LOWER(?)
        LIMIT 1
      `,
      [data.nombre, data.servicio],
    );
    serviceId = existingServices[0]?.id_servicio;

    if (!serviceId) {
      const [serviceResult] = await connection.execute(
        "INSERT INTO SERVICIO (nombre, tipo_servicio, descripcion) VALUES (?, ?, ?)",
        [data.nombre, data.servicio, data.observaciones || `Proveedor registrado para la unidad ${houseLabel}.`],
      );
      serviceId = serviceResult.insertId;
    }

    const [linkRows] = await connection.execute(
      "SELECT activo, estado_validacion FROM CASA_SERVICIO WHERE id_casa = ? AND id_servicio = ? LIMIT 1 FOR UPDATE",
      [house.id_casa, serviceId],
    );
    previousLink = linkRows[0] || null;

    await connection.execute(
      `
        INSERT INTO CASA_SERVICIO (id_casa, id_servicio, fecha_registro, actualizado_en, activo, estado_validacion)
        VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, TRUE, ?)
        ON DUPLICATE KEY UPDATE
          activo = TRUE,
          actualizado_en = CURRENT_TIMESTAMP,
          estado_validacion = CASE
            WHEN estado_validacion = 'VALIDADO' THEN estado_validacion
            ELSE VALUES(estado_validacion)
          END
      `,
      [house.id_casa, serviceId, validationStatus],
    );

    const [existingVisitors] = await connection.execute(
      `SELECT id_visitante, nombre, dpi, placa FROM VISITANTE
       WHERE (? <> '' AND dpi = ?) OR (? <> '' AND UPPER(REPLACE(REPLACE(placa, '-', ''), ' ', '')) = ?)
       ORDER BY id_visitante LIMIT 1 FOR UPDATE`,
      [data.dpi, data.dpi, data.placa, data.placa.replace(/-/g, "")],
    );
    const existingVisitor = existingVisitors[0];
    let visitorId = existingVisitor?.id_visitante;

    if (existingVisitor) {
      // HU-C03: no se sobrescriben datos de un visitante existente sin confirmacion.
      const dataChanged =
        existingVisitor.nombre !== data.nombre ||
        (data.dpi && (existingVisitor.dpi || "") !== data.dpi) ||
        (data.placa && (existingVisitor.placa || "") !== data.placa);

      if (dataChanged && !payload.confirmar_actualizacion) {
        const error = httpError(
          `Ya existe un visitante registrado con esos datos (${existingVisitor.nombre}). ` +
            "¿Deseas actualizar sus datos al registrar este proveedor?",
          409,
          "VISITOR_DATA_CONFLICT",
        );
        error.existing = {
          id_visitante: existingVisitor.id_visitante,
          nombre: existingVisitor.nombre,
          dpi: existingVisitor.dpi,
          placa: existingVisitor.placa,
        };
        throw error;
      }

      if (dataChanged) {
        await connection.execute(
          "UPDATE VISITANTE SET nombre = ?, dpi = COALESCE(?, dpi), placa = COALESCE(?, placa) WHERE id_visitante = ?",
          [data.nombre, data.dpi || null, data.placa || null, visitorId],
        );
      }
    } else {
      const [visitorResult] = await connection.execute(
        "INSERT INTO VISITANTE (nombre, dpi, placa, activo) VALUES (?, ?, ?, TRUE)",
        [data.nombre, data.dpi || null, data.placa || null],
      );
      visitorId = visitorResult.insertId;
    }

    const [duplicateRows] = await connection.execute(
      `SELECT id_acceso FROM ACCESO
       WHERE id_visitante = ? AND id_casa = ? AND fecha = ? AND hora_inicio = ? AND hora_fin = ?
         AND estado_acceso <> 'CANCELADA'
       LIMIT 1`,
      [visitorId, house.id_casa, data.fecha, data.horaInicio, data.horaFin],
    );
    if (duplicateRows.length > 0) {
      throw httpError(
        "Ya existe un acceso autorizado para este proveedor en la misma fecha y horario.",
        409,
        "DUPLICATE_VISIT",
      );
    }

    const [accessResult] = await connection.execute(
      `
        INSERT INTO ACCESO (
          id_visitante, id_casa, id_usuario_autoriza, fecha, hora_inicio, hora_fin,
          tipo_visita, motivo_servicio, observaciones, token_qr, estado_acceso
        )
        VALUES (?, ?, ?, ?, ?, ?, 'PROVEEDOR', ?, ?, ?, 'AUTORIZADA')
      `,
      [
        visitorId,
        house.id_casa,
        actor.id,
        data.fecha,
        data.horaInicio,
        data.horaFin,
        data.servicio,
        data.observaciones || null,
        generateQrToken(),
      ],
    );
    accessId = accessResult.insertId;

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  await createProviderHistoryEntry({
    idCasa: house.id_casa,
    idServicio: Number(serviceId),
    accion: previousLink ? "REACTIVACION" : "CREACION",
    detalle: previousLink
      ? `${user.nombre} reactivo el proveedor ${data.nombre} con un nuevo acceso.`
      : `${user.nombre} registro el proveedor ${data.nombre} para la unidad ${houseLabel}.`,
    activoAnterior: previousLink ? Number(previousLink.activo) === 1 : null,
    activoNuevo: true,
    estadoAnterior: previousLink?.estado_validacion || null,
    estadoNuevo: previousLink?.estado_validacion === "VALIDADO" ? "VALIDADO" : validationStatus,
    realizadoPorUsuario: user.id_usuario,
    realizadoPorNombre: user.nombre,
    realizadoPorRol: user.rol,
  });

  const [proveedor, acceso] = await Promise.all([
    getHouseProvider(house.id_casa, serviceId),
    getVisitById(accessId),
  ]);

  return { proveedor, acceso };
}

module.exports = {
  PROVIDER_REGISTRATION_ROLES,
  registerProvider,
  listTenantProviders,
  getTenantProvidersHistory,
  listOwnerProviders,
  updateTenantProvider,
  updateOwnerProviderValidation,
};
