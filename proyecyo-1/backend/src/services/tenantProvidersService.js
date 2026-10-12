const { query } = require("../database/mysql");

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

async function createTenantProvider(userId, payload = {}) {
  const house = await getTenantHouse(userId);
  const user = await getUserContext(userId);
  const nombre = normalizeString(payload.nombre);
  const tipoServicio = normalizeString(payload.tipo_servicio) || "General";
  const descripcion =
    normalizeString(payload.descripcion) || "Proveedor registrado por el inquilino para esta unidad.";

  if (!nombre) {
    const error = new Error("El nombre del proveedor es obligatorio.");
    error.status = 400;
    throw error;
  }

  const existingRows = await query(
    `
      SELECT id_servicio
      FROM SERVICIO
      WHERE LOWER(nombre) = LOWER(?)
        AND LOWER(tipo_servicio) = LOWER(?)
      LIMIT 1
    `,
    [nombre, tipoServicio],
  );

  let serviceId = existingRows[0]?.id_servicio;

  if (!serviceId) {
    const result = await query(
      `
        INSERT INTO SERVICIO (nombre, tipo_servicio, descripcion)
        VALUES (?, ?, ?)
      `,
      [nombre, tipoServicio, descripcion],
    );
    serviceId = result.insertId;
  }

  const currentRows = await query(
    `
      SELECT activo, estado_validacion
      FROM CASA_SERVICIO
      WHERE id_casa = ?
        AND id_servicio = ?
      LIMIT 1
    `,
    [house.id_casa, serviceId],
  );

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
      VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, TRUE, 'PENDIENTE')
      ON DUPLICATE KEY UPDATE
        activo = TRUE,
        actualizado_en = CURRENT_TIMESTAMP,
        estado_validacion = CASE
          WHEN estado_validacion = 'VALIDADO' THEN estado_validacion
          ELSE 'PENDIENTE'
        END
    `,
    [house.id_casa, serviceId],
  );

  await createProviderHistoryEntry({
    idCasa: house.id_casa,
    idServicio: Number(serviceId),
    accion: currentRows.length > 0 ? "REACTIVACION" : "CREACION",
    detalle:
      currentRows.length > 0
        ? `${user.nombre} reactivo o actualizo el proveedor ${nombre}.`
        : `${user.nombre} registro el proveedor ${nombre} para la unidad ${house.torre}-${house.numero}.`,
    activoAnterior: currentRows[0] ? Number(currentRows[0].activo) === 1 : null,
    activoNuevo: true,
    estadoAnterior: currentRows[0]?.estado_validacion || null,
    estadoNuevo: currentRows[0]?.estado_validacion === "VALIDADO" ? "VALIDADO" : "PENDIENTE",
    realizadoPorUsuario: user.id_usuario,
    realizadoPorNombre: user.nombre,
    realizadoPorRol: user.rol,
  });

  const providers = await listTenantProviders(userId);
  return providers.find((provider) => provider.id_servicio === Number(serviceId));
}

module.exports = {
  listTenantProviders,
  getTenantProvidersHistory,
  listOwnerProviders,
  createTenantProvider,
  updateTenantProvider,
  updateOwnerProviderValidation,
};
