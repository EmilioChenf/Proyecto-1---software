const { pool, query } = require("../database/mysql");
const { logger } = require("../utils/safeLogger");
const { assertVisitTimesAllowed } = require("./configurationService");
const { recordAudit } = require("./auditService");
const { ensureValidVehiclePlate } = require("../utils/vehiclePlate");
const { ensureValidDate, ensureValidTime } = require("../utils/dateTimeValidation");
const crypto = require("crypto");
const { guatemalaToday, sqlUtcTimeToGuatemala } = require("../utils/guatemalaTime");
const RESIDENTIAL_TIMEZONE = "America/Guatemala";

function normalizeString(value) {
  return String(value || "").trim();
}

function ensureVisitType(value) {
  const normalized = normalizeString(value).toUpperCase();
  const allowed = ["VISITA", "DELIVERY", "PROVEEDOR"];

  if (!allowed.includes(normalized)) {
    const error = new Error("El tipo de visita es invalido.");
    error.status = 400;
    throw error;
  }

  return normalized;
}

function ensureMaxLength(value, maxLength, fieldName) {
  const normalized = normalizeString(value);

  if (normalized.length > maxLength) {
    const error = new Error(`${fieldName} no puede superar ${maxLength} caracteres.`);
    error.status = 400;
    throw error;
  }

  return normalized;
}

async function getHouseByUserId(userId, role = "residente") {
  const rows =
    role === "inquilino"
      ? await query(
          `
            SELECT
              c.id_casa,
              c.numero,
              c.torre
            FROM INQUILINO i
            INNER JOIN INQUILINO_CASA ic
              ON ic.id_inquilino = i.id_inquilino
            INNER JOIN CASA c
              ON c.id_casa = ic.id_casa
            WHERE i.id_usuario = ?
              AND i.autorizado = TRUE
            LIMIT 1
          `,
          [userId],
        )
      : await query(
          `
            SELECT
              c.id_casa,
              c.numero,
              c.torre
            FROM CASA c
            INNER JOIN RESIDENTE r
              ON r.id_residente = c.id_residente
            WHERE r.id_usuario = ?
            LIMIT 1
          `,
          [userId],
        );

  const house = rows[0];

  if (!house) {
    const error = new Error("No se encontro una casa asociada al usuario.");
    error.status = 404;
    throw error;
  }

  return house;
}

function mapVisit(row) {
  const qrStatus = getQrStatus(row);

  return {
    id_acceso: row.id_acceso,
    id_visitante: row.id_visitante,
    nombre: row.nombre,
    dpi: row.dpi,
    placa: row.placa,
    foto: row.foto || null,
    fecha: row.fecha,
    hora_inicio: row.hora_inicio,
    hora_fin: row.hora_fin,
    hora_salida: row.hora_salida || null,
    tipo_visita: row.tipo_visita,
    motivo_servicio: row.motivo_servicio || "",
    observaciones: row.observaciones || "",
    token_qr: row.token_qr,
    estado_acceso: row.estado_acceso,
    es_acceso_especial: Boolean(row.es_acceso_especial),
    fuera_horario: Boolean(row.fuera_horario),
    motivo_excepcion: row.motivo_excepcion || "",
    qr_status: qrStatus,
    qr_value: row.token_qr ? `NEXUSVISIT:${row.token_qr}` : null,
    casa: row.casa,
  };
}

function getCurrentDateTimeInTimezone() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: RESIDENTIAL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}:${values.second}`,
  };
}

function normalizeQrTime(value, fallback) {
  const normalized = String(value || fallback);
  return normalized.length === 5 ? `${normalized}:00` : normalized;
}

function getQrStatus(visit) {
  if (visit.estado_acceso === "SALIDA_REGISTRADA" || visit.hora_salida) {
    return "EXIT_REGISTERED";
  }

  if (visit.estado_acceso === "INGRESO_REGISTRADO") {
    return "USED";
  }

  if (visit.estado_acceso === "CANCELADA" || visit.estado_acceso === "RECHAZADA") {
    return "CANCELLED";
  }

  if (visit.estado_acceso === "PENDIENTE_APROBACION" || !visit.token_qr) {
    return "PENDING_APPROVAL";
  }

  const currentDateTime = getCurrentDateTimeInTimezone();
  const startTime = normalizeQrTime(visit.hora_inicio, "00:00:00");
  const endTime = normalizeQrTime(visit.hora_fin, "23:59:59");

  if (
    currentDateTime.date < visit.fecha ||
    (currentDateTime.date === visit.fecha && currentDateTime.time < startTime)
  ) {
    return "NOT_YET_VALID";
  }

  if (
    currentDateTime.date > visit.fecha ||
    (currentDateTime.date === visit.fecha && currentDateTime.time > endTime)
  ) {
    return "EXPIRED";
  }

  return "VALID";
}

function generateQrToken() {
  return crypto.randomBytes(18).toString("hex");
}

function normalizeQrToken(value) {
  const normalized = normalizeString(value);
  const token = normalized.startsWith("NEXUSVISIT:")
    ? normalized.slice("NEXUSVISIT:".length)
    : normalized;

  if (!token || token.length > 64) {
    const error = new Error("El codigo QR es obligatorio.");
    error.status = 400;
    error.code = "QR_INVALID";
    throw error;
  }

  return token;
}

function getOwnerFilter(role) {
  return role === "inquilino" ? " AND a.id_usuario_autoriza = ?" : "";
}

function getOwnerParams(userId, role) {
  return role === "inquilino" ? [userId] : [];
}

async function listResidentVisits(userId, role = "residente") {
  const house = await getHouseByUserId(userId, role);
  const rows = await query(
    `
      SELECT
        a.id_acceso,
        v.id_visitante,
        v.nombre,
        v.dpi,
        v.placa,
        NULL AS foto,
        DATE_FORMAT(a.fecha, '%Y-%m-%d') AS fecha,
        TIME_FORMAT(a.hora_inicio, '%H:%i') AS hora_inicio,
        TIME_FORMAT(a.hora_fin, '%H:%i') AS hora_fin,
        (
          SELECT TIME_FORMAT(${sqlUtcTimeToGuatemala("ra.hora_salida")}, '%H:%i')
          FROM REGISTRO_ACCESO ra
          WHERE ra.id_acceso = a.id_acceso
          LIMIT 1
        ) AS hora_salida,
        a.tipo_visita,
        a.motivo_servicio,
        a.observaciones,
        a.token_qr,
        a.estado_acceso,
        CONCAT(COALESCE(c.torre, ''), CASE WHEN c.torre IS NOT NULL AND c.torre <> '' THEN '-' ELSE '' END, c.numero) AS casa
      FROM ACCESO a
      INNER JOIN VISITANTE v
        ON v.id_visitante = a.id_visitante
      INNER JOIN CASA c
        ON c.id_casa = a.id_casa
      WHERE a.id_casa = ?
        ${getOwnerFilter(role)}
      ORDER BY a.fecha DESC, a.hora_inicio DESC, a.id_acceso DESC
    `,
    [house.id_casa, ...getOwnerParams(userId, role)],
  );

  return rows.map(mapVisit);
}

async function listFrequentVisitors(userId, role = "residente") {
  const house = await getHouseByUserId(userId, role);
  const rows = await query(
    `
      SELECT
        MAX(v.id_visitante) AS id_visitante,
        v.nombre,
        v.dpi,
        v.placa,
        COUNT(*) AS total_visitas,
        MAX(a.fecha) AS ultima_fecha
      FROM ACCESO a
      INNER JOIN VISITANTE v
        ON v.id_visitante = a.id_visitante
      WHERE a.id_casa = ?
        ${getOwnerFilter(role)}
      GROUP BY v.nombre, v.dpi, v.placa
      ORDER BY total_visitas DESC, ultima_fecha DESC, v.nombre ASC
      LIMIT 5
    `,
    [house.id_casa, ...getOwnerParams(userId, role)],
  );

  return rows.map((row) => ({
    id_visitante: row.id_visitante,
    nombre: row.nombre,
    dpi: row.dpi,
    placa: row.placa,
    total_visitas: Number(row.total_visitas),
    ultima_fecha: row.ultima_fecha
      ? new Date(row.ultima_fecha).toISOString().slice(0, 10)
      : null,
  }));
}

async function createVisit(userId, role = "residente", payload) {
  const house = await getHouseByUserId(userId, role);
  const nombre = normalizeString(payload.nombre);
  const dpi = normalizeString(payload.dpi);
  const placa = ensureValidVehiclePlate(payload.placa);
  const foto = normalizeString(payload.foto);
  const fecha = ensureValidDate(payload.fecha);
  const horaInicio = ensureValidTime(payload.hora_inicio, "hora de inicio");
  const horaFin = ensureValidTime(payload.hora_fin, "hora de fin");
  const tipoVisita = ensureVisitType(payload.tipo_visita);
  const motivoServicio = ensureMaxLength(payload.motivo_servicio, 120, "El motivo del servicio");
  const observaciones = ensureMaxLength(payload.observaciones, 255, "Las observaciones");
  const qrToken = generateQrToken();

  if (!nombre) {
    const error = new Error("El nombre del visitante es obligatorio.");
    error.status = 400;
    throw error;
  }

  if (horaInicio >= horaFin) {
    const error = new Error("La hora de fin debe ser mayor a la hora de inicio.");
    error.status = 400;
    throw error;
  }

  await assertVisitTimesAllowed(horaInicio, horaFin, fecha);

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [existingVisitors] = await connection.execute(
      `SELECT id_visitante FROM VISITANTE
       WHERE (? <> '' AND dpi = ?) OR (? <> '' AND UPPER(REPLACE(REPLACE(placa, '-', ''), ' ', '')) = ?)
       ORDER BY id_visitante LIMIT 1 FOR UPDATE`,
      [dpi, dpi, placa, placa.replace(/-/g, "")],
    );
    let visitorId = existingVisitors[0]?.id_visitante;
    if (visitorId) {
      await connection.execute(
        "UPDATE VISITANTE SET nombre = ?, dpi = ?, placa = ? WHERE id_visitante = ?",
        [nombre, dpi || null, placa || null, visitorId],
      );
    } else {
      const [visitorResult] = await connection.execute(
        "INSERT INTO VISITANTE (nombre, dpi, placa) VALUES (?, ?, ?)",
        [nombre, dpi || null, placa || null],
      );
      visitorId = visitorResult.insertId;
    }

    const [accessResult] = await connection.execute(
      `
        INSERT INTO ACCESO (id_visitante, id_casa, id_usuario_autoriza, fecha, hora_inicio, hora_fin, tipo_visita, motivo_servicio, observaciones, token_qr, estado_acceso)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AUTORIZADA')
      `,
      [
        visitorId,
        house.id_casa,
        userId,
        fecha,
        horaInicio,
        horaFin,
        tipoVisita,
        motivoServicio || null,
        observaciones || null,
        qrToken,
      ],
    );

    await connection.commit();

    const rows = await query(
      `
        SELECT
          a.id_acceso,
          v.id_visitante,
          v.nombre,
          v.dpi,
          v.placa,
          ? AS foto,
          DATE_FORMAT(a.fecha, '%Y-%m-%d') AS fecha,
          TIME_FORMAT(a.hora_inicio, '%H:%i') AS hora_inicio,
          TIME_FORMAT(a.hora_fin, '%H:%i') AS hora_fin,
          NULL AS hora_salida,
          a.tipo_visita,
          a.motivo_servicio,
          a.observaciones,
          a.token_qr,
          a.estado_acceso,
          CONCAT(COALESCE(c.torre, ''), CASE WHEN c.torre IS NOT NULL AND c.torre <> '' THEN '-' ELSE '' END, c.numero) AS casa
        FROM ACCESO a
        INNER JOIN VISITANTE v
          ON v.id_visitante = a.id_visitante
        INNER JOIN CASA c
          ON c.id_casa = a.id_casa
        WHERE a.id_acceso = ?
        LIMIT 1
      `,
      [foto || null, accessResult.insertId],
    );

    return mapVisit(rows[0]);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function deleteVisit(userId, role = "residente", accessId) {
  const house = await getHouseByUserId(userId, role);
  const normalizedAccessId = Number(accessId);

  if (!Number.isInteger(normalizedAccessId) || normalizedAccessId <= 0) {
    const error = new Error("La visita es invalida.");
    error.status = 400;
    throw error;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `
        SELECT
          a.id_acceso,
          a.id_visitante,
          v.nombre,
          v.dpi,
          v.placa,
          DATE_FORMAT(a.fecha, '%Y-%m-%d') AS fecha,
          TIME_FORMAT(a.hora_inicio, '%H:%i') AS hora_inicio,
          TIME_FORMAT(a.hora_fin, '%H:%i') AS hora_fin,
          (
            SELECT TIME_FORMAT(${sqlUtcTimeToGuatemala("ra.hora_salida")}, '%H:%i')
            FROM REGISTRO_ACCESO ra
            WHERE ra.id_acceso = a.id_acceso
            LIMIT 1
          ) AS hora_salida,
          a.tipo_visita,
          a.motivo_servicio,
          a.observaciones,
          a.token_qr,
          a.estado_acceso,
          CONCAT(COALESCE(c.torre, ''), CASE WHEN c.torre IS NOT NULL AND c.torre <> '' THEN '-' ELSE '' END, c.numero) AS casa
        FROM ACCESO a
        INNER JOIN VISITANTE v
          ON v.id_visitante = a.id_visitante
        INNER JOIN CASA c
          ON c.id_casa = a.id_casa
        WHERE a.id_acceso = ? AND a.id_casa = ?
          ${getOwnerFilter(role)}
        LIMIT 1 FOR UPDATE
      `,
      [normalizedAccessId, house.id_casa, ...getOwnerParams(userId, role)],
    );

    const visit = rows[0];

    if (!visit) {
      const error = new Error("Visita no encontrada.");
      error.status = 404;
      throw error;
    }

    await assertVisitsHaveNoHistory(connection, [visit]);
    await connection.execute("DELETE FROM ACCESO WHERE id_acceso = ?", [normalizedAccessId]);
    await connection.execute(
      `
        DELETE FROM VISITANTE
        WHERE id_visitante = ?
          AND NOT EXISTS (
            SELECT 1
            FROM ACCESO
            WHERE id_visitante = ?
          )
      `,
      [visit.id_visitante, visit.id_visitante],
    );
    await connection.commit();

    return mapVisit(visit);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function updateVisit(userId, role = "residente", accessId, payload = {}) {
  const house = await getHouseByUserId(userId, role);
  const normalizedAccessId = Number(accessId);

  if (!Number.isInteger(normalizedAccessId) || normalizedAccessId <= 0) {
    const error = new Error("La visita es invalida.");
    error.status = 400;
    throw error;
  }

  const rows = await query(
    `
      SELECT
        a.id_acceso,
        a.id_visitante,
        v.nombre,
        v.dpi,
        v.placa,
        DATE_FORMAT(a.fecha, '%Y-%m-%d') AS fecha,
        TIME_FORMAT(a.hora_inicio, '%H:%i') AS hora_inicio,
        TIME_FORMAT(a.hora_fin, '%H:%i') AS hora_fin,
        (
          SELECT TIME_FORMAT(${sqlUtcTimeToGuatemala("ra.hora_salida")}, '%H:%i')
          FROM REGISTRO_ACCESO ra
          WHERE ra.id_acceso = a.id_acceso
          LIMIT 1
        ) AS hora_salida,
        a.tipo_visita,
        a.motivo_servicio,
        a.observaciones,
        a.token_qr,
        a.estado_acceso,
        CONCAT(COALESCE(c.torre, ''), CASE WHEN c.torre IS NOT NULL AND c.torre <> '' THEN '-' ELSE '' END, c.numero) AS casa
      FROM ACCESO a
      INNER JOIN VISITANTE v
        ON v.id_visitante = a.id_visitante
      INNER JOIN CASA c
        ON c.id_casa = a.id_casa
      WHERE a.id_acceso = ? AND a.id_casa = ?
        ${getOwnerFilter(role)}
      LIMIT 1
    `,
    [normalizedAccessId, house.id_casa, ...getOwnerParams(userId, role)],
  );

  const visit = rows[0];

  if (!visit) {
    const error = new Error("Visita no encontrada.");
    error.status = 404;
    throw error;
  }

  const mappedVisit = mapVisit(visit);
  const status = String(visit.estado_acceso || "").toUpperCase();

  if (status !== "AUTORIZADA" || mappedVisit.qr_status !== "VALID") {
    const error = new Error("Este acceso ya no puede modificarse por su estado actual.");
    error.status = 409;
    throw error;
  }

  const nombre = normalizeString(payload.nombre);
  const dpi = normalizeString(payload.dpi);
  const placa = ensureValidVehiclePlate(payload.placa);
  const fecha = ensureValidDate(payload.fecha);
  const horaInicio = ensureValidTime(payload.hora_inicio, "hora de inicio");
  const horaFin = ensureValidTime(payload.hora_fin, "hora de fin");
  const tipoVisita = ensureVisitType(payload.tipo_visita);
  const motivoServicio = ensureMaxLength(payload.motivo_servicio, 120, "El motivo del servicio");
  const observaciones = ensureMaxLength(payload.observaciones, 255, "Las observaciones");

  if (!nombre) {
    const error = new Error("El nombre del visitante es obligatorio.");
    error.status = 400;
    throw error;
  }

  if (horaInicio >= horaFin) {
    const error = new Error("La hora de fin debe ser mayor a la hora de inicio.");
    error.status = 400;
    throw error;
  }

  await assertVisitTimesAllowed(horaInicio, horaFin, fecha);

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await connection.execute(
      `
        UPDATE VISITANTE
        SET nombre = ?, dpi = ?, placa = ?
        WHERE id_visitante = ?
      `,
      [nombre, dpi, placa, visit.id_visitante],
    );
    await connection.execute(
      `
        UPDATE ACCESO
        SET fecha = ?,
            hora_inicio = ?,
            hora_fin = ?,
            tipo_visita = ?,
            motivo_servicio = ?,
            observaciones = ?
        WHERE id_acceso = ?
      `,
      [
        fecha,
        horaInicio,
        horaFin,
        tipoVisita,
        motivoServicio || null,
        observaciones || null,
        normalizedAccessId,
      ],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const updatedRows = await query(
    `
      SELECT
        a.id_acceso,
        v.id_visitante,
        v.nombre,
        v.dpi,
        v.placa,
        NULL AS foto,
        DATE_FORMAT(a.fecha, '%Y-%m-%d') AS fecha,
        TIME_FORMAT(a.hora_inicio, '%H:%i') AS hora_inicio,
        TIME_FORMAT(a.hora_fin, '%H:%i') AS hora_fin,
        NULL AS hora_salida,
        a.tipo_visita,
        a.motivo_servicio,
        a.observaciones,
        a.token_qr,
        a.estado_acceso,
        CONCAT(COALESCE(c.torre, ''), CASE WHEN c.torre IS NOT NULL AND c.torre <> '' THEN '-' ELSE '' END, c.numero) AS casa
      FROM ACCESO a
      INNER JOIN VISITANTE v ON v.id_visitante = a.id_visitante
      INNER JOIN CASA c ON c.id_casa = a.id_casa
      WHERE a.id_acceso = ?
      LIMIT 1
    `,
    [normalizedAccessId],
  );

  return mapVisit(updatedRows[0]);
}

async function createGuardCancellationNotifications(accessId) {
  // Obtiene los datos del acceso para componer un mensaje informativo
  const accessRows = await query(
    `
      SELECT
        a.id_acceso,
        v.nombre AS visitante,
        TIME_FORMAT(a.hora_inicio, '%H:%i') AS hora_inicio,
        DATE_FORMAT(a.fecha, '%Y-%m-%d') AS fecha,
        CONCAT(
          COALESCE(c.torre, ''),
          CASE WHEN c.torre IS NOT NULL AND c.torre <> '' THEN '-' ELSE '' END,
          c.numero
        ) AS casa
      FROM ACCESO a
      INNER JOIN VISITANTE v ON v.id_visitante = a.id_visitante
      INNER JOIN CASA c ON c.id_casa = a.id_casa
      WHERE a.id_acceso = ?
      LIMIT 1
    `,
    [accessId],
  );

  const accessInfo = accessRows[0];
  if (!accessInfo) {
    return;
  }

  // Obtiene los ids de todos los guardias activos
  const guards = await query(
    `
      SELECT u.id_usuario
      FROM USUARIO u
      INNER JOIN TIPO_USUARIO tu ON tu.id_tipo_usuario = u.id_tipo_usuario
      WHERE tu.nombre = 'guardia' AND u.activo = TRUE
    `,
  );

  if (guards.length === 0) {
    return;
  }

  const titulo = "Acceso cancelado";
  const mensaje = `${accessInfo.visitante} (casa ${accessInfo.casa}) cancelada para ${accessInfo.fecha} ${accessInfo.hora_inicio}.`;

  // Inserta una notificacion por cada guardia
  const insertPromises = guards.map((guard) =>
    query(
      `
        INSERT INTO NOTIFICACION (id_usuario, id_acceso, tipo, titulo, mensaje)
        VALUES (?, ?, 'ACCESO_CANCELADO', ?, ?)
      `,
      [guard.id_usuario, accessId, titulo, mensaje],
    ),
  );

  await Promise.all(insertPromises);
}

async function cancelVisit(userId, role = "residente", accessId) {
  const house = await getHouseByUserId(userId, role);
  const normalizedAccessId = Number(accessId);

  if (!Number.isInteger(normalizedAccessId) || normalizedAccessId <= 0) {
    const error = new Error("La visita es invalida.");
    error.status = 400;
    throw error;
  }

  const rows = await query(
    `
      SELECT a.id_acceso, a.estado_acceso
      FROM ACCESO a
      INNER JOIN CASA c ON c.id_casa = a.id_casa
      WHERE a.id_acceso = ? AND a.id_casa = ?
        ${getOwnerFilter(role)}
      LIMIT 1
    `,
    [normalizedAccessId, house.id_casa, ...getOwnerParams(userId, role)],
  );

  const existing = rows[0];

  if (!existing) {
    const error = new Error("Visita no encontrada.");
    error.status = 404;
    throw error;
  }

  if (String(existing.estado_acceso).toUpperCase() === "INGRESO_REGISTRADO") {
    const error = new Error("No se puede cancelar una visita que ya tiene ingreso registrado.");
    error.status = 409;
    throw error;
  }

  if (String(existing.estado_acceso).toUpperCase() === "CANCELADA") {
    const error = new Error("La visita ya fue cancelada previamente.");
    error.status = 409;
    throw error;
  }

  await query(
    "UPDATE ACCESO SET estado_acceso = 'CANCELADA' WHERE id_acceso = ?",
    [normalizedAccessId],
  );

  // SCRUM-178: notifica a todos los guardias activos sobre la cancelacion
  try {
    await createGuardCancellationNotifications(normalizedAccessId);
  } catch (notificationError) {
    // No bloqueamos la cancelacion si fallan las notificaciones
    logger.error("Error creando notificaciones de cancelacion:", notificationError);
  }

  const updatedRows = await query(
    `
      SELECT
        a.id_acceso,
        v.id_visitante,
        v.nombre,
        v.dpi,
        v.placa,
        NULL AS foto,
        DATE_FORMAT(a.fecha, '%Y-%m-%d') AS fecha,
        TIME_FORMAT(a.hora_inicio, '%H:%i') AS hora_inicio,
        TIME_FORMAT(a.hora_fin, '%H:%i') AS hora_fin,
        NULL AS hora_salida,
        a.tipo_visita,
        a.motivo_servicio,
        a.observaciones,
        a.token_qr,
        a.estado_acceso,
        CONCAT(COALESCE(c.torre, ''), CASE WHEN c.torre IS NOT NULL AND c.torre <> '' THEN '-' ELSE '' END, c.numero) AS casa
      FROM ACCESO a
      INNER JOIN VISITANTE v ON v.id_visitante = a.id_visitante
      INNER JOIN CASA c ON c.id_casa = a.id_casa
      WHERE a.id_acceso = ?
      LIMIT 1
    `,
    [normalizedAccessId],
  );

  return mapVisit(updatedRows[0]);
}

async function deleteFrequentVisitor(userId, role = "residente", visitorId) {
  const house = await getHouseByUserId(userId, role);
  const normalizedVisitorId = Number(visitorId);

  if (!Number.isInteger(normalizedVisitorId) || normalizedVisitorId <= 0) {
    const error = new Error("El visitante es invalido.");
    error.status = 400;
    throw error;
  }

  const rows = await query(
    `
      SELECT v.id_visitante, v.nombre
      FROM VISITANTE v
      INNER JOIN ACCESO a ON a.id_visitante = v.id_visitante
      WHERE v.id_visitante = ? AND a.id_casa = ?
        ${getOwnerFilter(role)}
      LIMIT 1
    `,
    [normalizedVisitorId, house.id_casa, ...getOwnerParams(userId, role)],
  );

  const visitor = rows[0];

  if (!visitor) {
    const error = new Error("Visitante frecuente no encontrado.");
    error.status = 404;
    throw error;
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const [accesses] = await connection.execute(
      `SELECT a.id_acceso, a.estado_acceso FROM ACCESO a
       WHERE a.id_visitante = ? AND a.id_casa = ? ${getOwnerFilter(role)}
       ORDER BY a.id_acceso FOR UPDATE`,
      [normalizedVisitorId, house.id_casa, ...getOwnerParams(userId, role)],
    );
    await assertVisitsHaveNoHistory(connection, accesses);
    await connection.execute(
      `DELETE FROM ACCESO WHERE id_visitante = ? AND id_casa = ? ${getOwnerFilter(role)}`,
      [normalizedVisitorId, house.id_casa, ...getOwnerParams(userId, role)],
    );
    await connection.execute(
      `
        DELETE FROM VISITANTE
        WHERE id_visitante = ?
          AND NOT EXISTS (
            SELECT 1 FROM ACCESO WHERE id_visitante = ?
          )
      `,
      [normalizedVisitorId, normalizedVisitorId],
    );
    await connection.commit();

    return { id_visitante: normalizedVisitorId, nombre: visitor.nombre };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// El bloqueo de ACCESO serializa estas eliminaciones con ingreso, salida y cancelacion.
// Incluso un estado inconsistente debe conservar cualquier REGISTRO_ACCESO existente.
async function assertVisitsHaveNoHistory(connection, visits) {
  for (const visit of visits) {
    const [records] = await connection.execute(
      "SELECT id_registro FROM REGISTRO_ACCESO WHERE id_acceso = ? LIMIT 1 FOR UPDATE",
      [visit.id_acceso],
    );
    if (records.length || ["INGRESO_REGISTRADO", "SALIDA_REGISTRADA"].includes(visit.estado_acceso)) {
      const error = new Error("La visita tiene historial de acceso y no puede eliminarse. Cancele la visita para conservar sus movimientos.");
      error.status = 409;
      error.code = "VISIT_HAS_HISTORY";
      throw error;
    }
  }
}

const GUARD_VISIT_SELECT = `
      SELECT
        a.id_acceso,
        v.id_visitante,
        v.nombre,
        v.dpi,
        v.placa,
        NULL AS foto,
        DATE_FORMAT(a.fecha, '%Y-%m-%d') AS fecha,
        TIME_FORMAT(a.hora_inicio, '%H:%i') AS hora_inicio,
        TIME_FORMAT(a.hora_fin, '%H:%i') AS hora_fin,
        (
          SELECT TIME_FORMAT(${sqlUtcTimeToGuatemala("ra.hora_salida")}, '%H:%i')
          FROM REGISTRO_ACCESO ra
          WHERE ra.id_acceso = a.id_acceso
          LIMIT 1
        ) AS hora_salida,
        a.tipo_visita,
        a.motivo_servicio,
        a.observaciones,
        a.token_qr,
        a.estado_acceso,
        a.es_acceso_especial,
        a.fuera_horario,
        a.motivo_excepcion,
        CONCAT(COALESCE(c.torre, ''), CASE WHEN c.torre IS NOT NULL AND c.torre <> '' THEN '-' ELSE '' END, c.numero) AS casa
      FROM ACCESO a
      INNER JOIN VISITANTE v
        ON v.id_visitante = a.id_visitante
      INNER JOIN CASA c
        ON c.id_casa = a.id_casa`;

function compareGuardVisits(left, right) {
  return (
    String(right.fecha).localeCompare(String(left.fecha)) ||
    String(right.hora_inicio || "").localeCompare(String(left.hora_inicio || "")) ||
    Number(right.id_acceso) - Number(left.id_acceso)
  );
}

// HU-C08: la visibilidad del guardia es la del residencial (esta base de datos),
// nunca la de la cuenta que creo la visita ni la del guardia en turno. Toda
// visita abierta de cualquier residente o inquilino se lista completa; antes
// solo se mostraban las 20 mas recientes y las abiertas podian quedar fuera.
async function getGuardShiftVisits() {
  const today = guatemalaToday();
  const [openRows, recentRows] = await Promise.all([
    query(
      `${GUARD_VISIT_SELECT}
      -- Abiertas del turno: pendientes de hoy y visitantes que siguen adentro.
      WHERE a.fecha <= ?
        AND (
          a.estado_acceso = 'INGRESO_REGISTRADO'
          OR (a.fecha = ? AND a.estado_acceso IN ('AUTORIZADA', 'PENDIENTE_APROBACION'))
        )
    `,
      [today, today],
    ),
    query(
      `${GUARD_VISIT_SELECT}
      -- "Visitas recientes": hoy y dias anteriores en Guatemala; las fechas
      -- futuras no se presentan como si ya hubieran ocurrido.
      WHERE a.fecha <= ?
      ORDER BY a.fecha DESC, a.hora_inicio DESC, a.id_acceso DESC
      LIMIT 20
    `,
      [today],
    ),
  ]);

  const byAccess = new Map();
  for (const row of [...openRows, ...recentRows]) byAccess.set(row.id_acceso, row);

  return [...byAccess.values()].sort(compareGuardVisits).map(mapVisit);
}

async function recordQrValidationAttempt({
  accessId = null,
  tokenQr = null,
  guardUserId = null,
  result,
  detail,
}) {
  try {
    await query(
      `
        INSERT INTO INTENTO_VALIDACION_QR (
          id_acceso,
          token_qr,
          id_usuario_guardia,
          resultado,
          detalle
        )
        VALUES (?, ?, ?, ?, ?)
      `,
      [accessId, tokenQr, guardUserId, result, String(detail || "").slice(0, 255)],
    );
  } catch (error) {
    // La auditoria no debe impedir que el guardia reciba el resultado del QR.
    logger.warn("No fue posible registrar el intento de validacion QR.", error);
  }
}

async function validateQrVisit(qrToken, guardUserId = null) {
  let normalizedToken = null;

  try {
    normalizedToken = normalizeQrToken(qrToken);
  } catch (error) {
    await recordQrValidationAttempt({
      tokenQr: String(qrToken || "").slice(0, 64),
      guardUserId,
      result: "INVALIDO",
      detail: error.message,
    });
    throw error;
  }

  let mappedVisit;
  try {
    mappedVisit = await findVisitByQrToken(normalizedToken);
  } catch (error) {
    await recordQrValidationAttempt({
      tokenQr: normalizedToken,
      guardUserId,
      result: error.status === 404 ? "NO_ENCONTRADO" : "INVALIDO",
      detail: error.message,
    });
    throw error;
  }

  const reject = async (result, message, status, code) => {
    await recordQrValidationAttempt({
      accessId: mappedVisit.id_acceso,
      tokenQr: normalizedToken,
      guardUserId,
      result,
      detail: message,
    });
    const error = new Error(message);
    error.status = status;
    error.code = code;
    throw error;
  };

  if (mappedVisit.qr_status === "NOT_YET_VALID") {
    await reject(
      "AUN_NO_VIGENTE",
      "Este QR aun no esta vigente. Espere hasta la hora de inicio programada.",
      409,
      "QR_NOT_YET_VALID",
    );
  }

  if (mappedVisit.qr_status === "PENDING_APPROVAL") {
    await reject(
      "PENDIENTE_APROBACION",
      "Este acceso especial aun no ha sido aprobado.",
      409,
      "QR_PENDING_APPROVAL",
    );
  }

  if (mappedVisit.qr_status === "USED") {
    await reject("REUTILIZADO", "Este QR ya fue utilizado.", 409, "QR_ALREADY_USED");
  }

  if (mappedVisit.qr_status === "EXIT_REGISTERED") {
    await reject(
      "REUTILIZADO",
      "La salida de esta visita ya fue registrada.",
      409,
      "QR_ALREADY_USED",
    );
  }

  if (mappedVisit.qr_status === "EXPIRED") {
    await reject("EXPIRADO", "QR expirado.", 410, "QR_EXPIRED");
  }

  if (mappedVisit.qr_status === "CANCELLED") {
    const message =
      `Acceso cancelado: ${mappedVisit.nombre} (casa ${mappedVisit.casa}). No autorizar el ingreso.`;
    await reject("CANCELADO", message, 410, "ACCESS_CANCELLED");
  }

  await recordQrValidationAttempt({
    accessId: mappedVisit.id_acceso,
    tokenQr: normalizedToken,
    guardUserId,
    result: "VALIDO",
    detail: "QR vigente y disponible para registrar el ingreso.",
  });

  return mappedVisit;
}

async function findVisitByQrToken(normalizedToken) {
  const rows = await query(
    `
      SELECT
        a.id_acceso,
        v.id_visitante,
        v.nombre,
        v.dpi,
        v.placa,
        NULL AS foto,
        DATE_FORMAT(a.fecha, '%Y-%m-%d') AS fecha,
        TIME_FORMAT(a.hora_inicio, '%H:%i') AS hora_inicio,
        TIME_FORMAT(a.hora_fin, '%H:%i') AS hora_fin,
        (
          SELECT TIME_FORMAT(${sqlUtcTimeToGuatemala("ra.hora_salida")}, '%H:%i')
          FROM REGISTRO_ACCESO ra
          WHERE ra.id_acceso = a.id_acceso
          LIMIT 1
        ) AS hora_salida,
        a.tipo_visita,
        a.motivo_servicio,
        a.observaciones,
        a.token_qr,
        a.estado_acceso,
        a.es_acceso_especial,
        a.fuera_horario,
        a.motivo_excepcion,
        CONCAT(COALESCE(c.torre, ''), CASE WHEN c.torre IS NOT NULL AND c.torre <> '' THEN '-' ELSE '' END, c.numero) AS casa
      FROM ACCESO a
      INNER JOIN VISITANTE v
        ON v.id_visitante = a.id_visitante
      INNER JOIN CASA c
        ON c.id_casa = a.id_casa
      WHERE a.token_qr = ?
      LIMIT 1
    `,
    [normalizedToken],
  );

  const visit = rows[0];

  if (!visit) {
    const error = new Error("QR no reconocido.");
    error.status = 404;
    throw error;
  }

  return mapVisit(visit);
}

async function createArrivalNotification(connection, accessId) {
  const [rows] = await connection.execute(
    `
      SELECT
        a.id_acceso,
        v.nombre AS visitante,
        c.numero,
        c.torre,
        u.id_usuario AS id_residente_usuario
      FROM ACCESO a
      INNER JOIN VISITANTE v ON v.id_visitante = a.id_visitante
      INNER JOIN CASA c ON c.id_casa = a.id_casa
      INNER JOIN USUARIO u ON u.id_usuario = a.id_usuario_autoriza AND u.activo = 1
      INNER JOIN TIPO_USUARIO tu ON tu.id_tipo_usuario = u.id_tipo_usuario
      WHERE a.id_acceso = ? AND LOWER(tu.nombre) IN ('residente','inquilino')
        AND (
          EXISTS(SELECT 1 FROM RESIDENTE r WHERE r.id_residente=c.id_residente AND r.id_usuario=u.id_usuario)
          OR (c.relaciones_confirmadas_en IS NOT NULL AND EXISTS(
            SELECT 1 FROM CASA_HABITANTE h WHERE h.id_casa=c.id_casa AND h.id_usuario=u.id_usuario
              AND h.autorizado=1 AND h.id_version_pendiente IS NULL
              AND h.vigente_desde<=DATE(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','-06:00'))
              AND (h.vigente_hasta IS NULL OR h.vigente_hasta>DATE(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','-06:00')))))
          OR (c.relaciones_confirmadas_en IS NULL AND EXISTS(
            SELECT 1 FROM INQUILINO i JOIN INQUILINO_CASA ic ON ic.id_inquilino=i.id_inquilino
            WHERE i.id_usuario=u.id_usuario AND i.autorizado=1 AND ic.id_casa=c.id_casa))
        )
      LIMIT 1
    `,
    [accessId],
  );

  const data = rows[0];

  if (!data) {
    return;
  }

  const casa = `${data.torre ? `${data.torre}-` : ""}${data.numero}`;
  const titulo = "Tu visita ya llegó";
  const mensaje = `${data.visitante} llegó a la garita y su ingreso fue registrado para la casa ${casa}.`;

  await connection.execute(
    `
      INSERT INTO NOTIFICACION (id_usuario, id_acceso, tipo, titulo, mensaje, leido)
      SELECT ?, ?, 'LLEGADA_VISITA', ?, ?, FALSE
      WHERE NOT EXISTS (
        SELECT 1
        FROM NOTIFICACION
        WHERE id_usuario = ?
          AND id_acceso = ?
          AND tipo = 'LLEGADA_VISITA'
      )
    `,
    [
      data.id_residente_usuario,
      accessId,
      titulo,
      mensaje,
      data.id_residente_usuario,
      accessId,
    ],
  );
}

// La auditoria se escribe en la misma transaccion que el cambio de estado:
// si no se puede registrar al guardia ejecutor, el ingreso/salida no ocurre.
function transactionAudit(connection, entry) {
  return recordAudit(entry, (sql, params) => connection.execute(sql, params));
}

// HU-C08: cualquier guardia del residencial puede registrar el ingreso. La
// concurrencia la resuelve el UPDATE condicional (estado AUTORIZADA): con dos
// guardias validando el mismo QR, InnoDB serializa la fila y solo uno obtiene
// affectedRows = 1; el otro recibe QR_ALREADY_USED y su intento queda auditado.
async function registerQrEntry(qrToken, guardUserId = null, metadata = {}) {
  const visit = await validateQrVisit(qrToken, guardUserId);
  const normalizedToken = visit.token_qr;

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const [updateResult] = await connection.execute(
      `
        UPDATE ACCESO
        SET estado_acceso = 'INGRESO_REGISTRADO'
        WHERE id_acceso = ? AND estado_acceso = 'AUTORIZADA'
      `,
      [visit.id_acceso],
    );

    if (updateResult.affectedRows === 0) {
      const error = new Error("Este QR ya fue utilizado.");
      error.status = 409;
      error.code = "QR_ALREADY_USED";
      throw error;
    }

    await connection.execute(
      `
        INSERT INTO REGISTRO_ACCESO (id_acceso, hora_ingreso, id_guardia_ingreso)
        VALUES (?, CURTIME(), ?)
        ON DUPLICATE KEY UPDATE
          hora_ingreso = VALUES(hora_ingreso),
          id_guardia_ingreso = VALUES(id_guardia_ingreso)
      `,
      [visit.id_acceso, guardUserId],
    );
    await createArrivalNotification(connection, visit.id_acceso);
    await transactionAudit(connection, {
      userId: guardUserId,
      action: "VISIT_ENTRY_REGISTERED",
      entity: "ACCESO",
      entityId: visit.id_acceso,
      previousData: { estado_acceso: "AUTORIZADA" },
      newData: { estado_acceso: "INGRESO_REGISTRADO", id_guardia_ingreso: guardUserId, casa: visit.casa },
      metadata,
    });
    await connection.commit();

    return findVisitByQrToken(normalizedToken);
  } catch (error) {
    await connection.rollback();
    if (error.code === "QR_ALREADY_USED") {
      await recordQrValidationAttempt({
        accessId: visit.id_acceso,
        tokenQr: normalizedToken,
        guardUserId,
        result: "REUTILIZADO",
        detail: error.message,
      });
    }
    throw error;
  } finally {
    connection.release();
  }
}

function ensureQrExitCanBeRegistered(visit) {
  const status = String(visit.estado_acceso || "").toUpperCase();

  if (status === "CANCELADA" || visit.qr_status === "CANCELLED") {
    const error = new Error("Este QR ya no es valido.");
    error.status = 410;
    throw error;
  }

  if (status === "AUTORIZADA" || visit.qr_status === "VALID") {
    const error = new Error("Primero debe registrarse el ingreso del visitante.");
    error.status = 409;
    throw error;
  }

  if (status === "SALIDA_REGISTRADA" || visit.qr_status === "EXIT_REGISTERED" || visit.hora_salida) {
    const error = new Error("La salida de esta visita ya fue registrada.");
    error.status = 409;
    throw error;
  }

  if (status !== "INGRESO_REGISTRADO") {
    const error = new Error("Este acceso no se encuentra en estado valido para registrar salida.");
    error.status = 409;
    throw error;
  }

  return true;
}

// Igual que el ingreso: la salida la puede registrar cualquier guardia y solo
// una de dos operaciones simultaneas cambia INGRESO_REGISTRADO -> SALIDA_REGISTRADA.
async function registerQrExit(qrToken, guardUserId = null, metadata = {}) {
  const normalizedToken = normalizeQrToken(qrToken);
  const visit = await findVisitByQrToken(normalizedToken);

  ensureQrExitCanBeRegistered(visit);

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const [stateResult] = await connection.execute(
      `
        UPDATE ACCESO
        SET estado_acceso = 'SALIDA_REGISTRADA'
        WHERE id_acceso = ? AND estado_acceso = 'INGRESO_REGISTRADO'
      `,
      [visit.id_acceso],
    );
    const [result] = stateResult.affectedRows === 0
      ? [stateResult]
      : await connection.execute(
          `
            UPDATE REGISTRO_ACCESO
            SET hora_salida = CURTIME(), id_guardia_salida = ?
            WHERE id_acceso = ?
              AND hora_salida IS NULL
          `,
          [guardUserId, visit.id_acceso],
        );

    if (result.affectedRows === 0) {
      const error = new Error("La salida de esta visita ya fue registrada.");
      error.status = 409;
      throw error;
    }

    await transactionAudit(connection, {
      userId: guardUserId,
      action: "VISIT_EXIT_REGISTERED",
      entity: "ACCESO",
      entityId: visit.id_acceso,
      previousData: { estado_acceso: "INGRESO_REGISTRADO" },
      newData: { estado_acceso: "SALIDA_REGISTRADA", id_guardia_salida: guardUserId, casa: visit.casa },
      metadata,
    });
    await connection.commit();

    return findVisitByQrToken(normalizedToken);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  listResidentVisits,
  listFrequentVisitors,
  createVisit,
  updateVisit,
  deleteVisit,
  cancelVisit,
  deleteFrequentVisitor,
  getGuardShiftVisits,
  validateQrVisit,
  registerQrEntry,
  registerQrExit,
  __private__: {
    ensureVisitType,
    ensureQrExitCanBeRegistered,
    getQrStatus,
    normalizeQrToken,
  },
};
