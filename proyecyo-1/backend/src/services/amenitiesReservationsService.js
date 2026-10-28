const { pool, query } = require("../database/mysql");
const { ensureValidDate, ensureValidTime } = require("../utils/dateTimeValidation");
const { ensureBoolean } = require("../utils/booleanValidation");
const { recordAudit } = require("./auditService");
const { logger } = require("../utils/safeLogger");

const RESIDENTIAL_TIMEZONE = "America/Guatemala";
const MAX_ACTIVE_RESERVATIONS_PER_USER = 3;
const RESERVATION_LIMIT_MESSAGE =
  "El usuario ya alcanzo el limite de reservas activas permitidas.";

const DEFAULT_AMENITIES = [
  {
    legacyNames: ["Salon Social"],
    nombre: "Salon de eventos",
    descripcion: "Espacio para celebraciones privadas y reuniones.",
    hora_apertura: "08:00:00",
    hora_cierre: "22:00:00",
    intervalo_minutos: 60,
    activo: true,
  },
  {
    legacyNames: ["Cancha"],
    nombre: "Cancha de tenis",
    descripcion: "Cancha al aire libre para entrenamientos y partidos.",
    hora_apertura: "06:00:00",
    hora_cierre: "21:00:00",
    intervalo_minutos: 60,
    activo: true,
  },
  {
    legacyNames: [],
    nombre: "Piscina",
    descripcion: "Piscina familiar con control por bloques de uso.",
    hora_apertura: "08:00:00",
    hora_cierre: "20:00:00",
    intervalo_minutos: 60,
    activo: true,
  },
  {
    legacyNames: [],
    nombre: "Gimnasio",
    descripcion: "Zona de entrenamiento con acceso por franjas horarias.",
    hora_apertura: "05:00:00",
    hora_cierre: "22:00:00",
    intervalo_minutos: 60,
    activo: true,
  },
  {
    legacyNames: ["Area BBQ"],
    nombre: "Area de parrillas",
    descripcion: "Area social con estaciones de parrilla y mesas.",
    hora_apertura: "09:00:00",
    hora_cierre: "23:00:00",
    intervalo_minutos: 60,
    activo: true,
  },
  {
    legacyNames: [],
    nombre: "Salon infantil",
    descripcion: "Salon recreativo para actividades infantiles.",
    hora_apertura: "09:00:00",
    hora_cierre: "19:00:00",
    intervalo_minutos: 60,
    activo: true,
  },
];

const USER_UNIT_SUBQUERY = `
  SELECT
    grouped_units.id_usuario,
    GROUP_CONCAT(DISTINCT grouped_units.unidad ORDER BY grouped_units.unidad SEPARATOR ', ') AS unidad
  FROM (
    SELECT
      r.id_usuario,
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
  ) grouped_units
  GROUP BY grouped_units.id_usuario
`;

function normalizeString(value) {
  return String(value || "").trim();
}

function ensurePositiveInteger(value, fieldName) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    const error = new Error(`El campo ${fieldName} es invalido.`);
    error.status = 400;
    throw error;
  }

  return parsed;
}

function ensureValidInterval(value) {
  const parsed = ensurePositiveInteger(value, "intervalo_minutos");

  if (![15, 30, 60].includes(parsed)) {
    const error = new Error("El intervalo debe ser de 15, 30 o 60 minutos.");
    error.status = 400;
    throw error;
  }

  return parsed;
}

function toMinutes(time) {
  const normalized = time.length === 5 ? `${time}:00` : time;
  const [hours, minutes] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatMinutesToTime(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (totalMinutes % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
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
    hourCycle: "h23",
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

function createReservationKey(reservation) {
  return [
    reservation.id_usuario,
    reservation.id_amenidad,
    reservation.fecha,
    reservation.hora_inicio,
  ].join("-");
}

function parseReservationKey(value) {
  const match = normalizeString(value).match(/^(\d+)-(\d+)-(\d{4}-\d{2}-\d{2})-(\d{2}:\d{2})$/);

  if (!match) {
    const error = new Error("La reserva indicada no es valida.");
    error.status = 400;
    throw error;
  }

  return {
    id_usuario: Number(match[1]),
    id_amenidad: Number(match[2]),
    fecha: match[3],
    hora_inicio: `${match[4]}:00`,
  };
}

function mapAmenity(row) {
  return {
    id_amenidad: Number(row.id_amenidad),
    nombre: row.nombre,
    descripcion: row.descripcion || "",
    hora_apertura: row.hora_apertura,
    hora_cierre: row.hora_cierre,
    intervalo_minutos: Number(row.intervalo_minutos || 60),
    activo: Boolean(row.activo),
  };
}

function getCurrentReservationStatus(row) {
  const configuredStatus = normalizeString(row.estado).toUpperCase() || "CONFIRMADA";

  if (configuredStatus === "CANCELADA") {
    return "CANCELADA";
  }

  const currentDateTime = getCurrentDateTimeInTimezone();

  if (
    currentDateTime.date > row.fecha ||
    (currentDateTime.date === row.fecha && currentDateTime.time >= `${row.hora_fin}:00`)
  ) {
    return "FINALIZADA";
  }

  if (
    currentDateTime.date === row.fecha &&
    currentDateTime.time >= `${row.hora_inicio}:00` &&
    currentDateTime.time < `${row.hora_fin}:00`
  ) {
    return "EN_CURSO";
  }

  if (configuredStatus === "PENDIENTE") {
    return "PENDIENTE";
  }

  return "CONFIRMADA";
}

function mapReservation(row, includeUserDetails) {
  const mapped = {
    reservation_key: createReservationKey(row),
    id_usuario: Number(row.id_usuario),
    id_amenidad: Number(row.id_amenidad),
    amenidad_nombre: row.amenidad_nombre,
    fecha: row.fecha,
    hora_inicio: row.hora_inicio,
    hora_fin: row.hora_fin,
    estado: normalizeString(row.estado).toUpperCase() || "CONFIRMADA",
    estado_actual: getCurrentReservationStatus(row),
  };

  if (includeUserDetails) {
    mapped.usuario_nombre = row.usuario_nombre;
    mapped.usuario_rol = row.usuario_rol;
    mapped.unidad = row.unidad || "Sin unidad";
    // HU-C05.5/C05.9: autoria de la creacion y de la cancelacion.
    mapped.creada_por_nombre = row.creada_por_nombre || null;
    mapped.creada_por_admin = Boolean(row.creada_por_admin);
    mapped.cancelada_por_nombre = row.cancelada_por_nombre || null;
    mapped.cancelada_en = row.cancelada_en || null;
    mapped.motivo_cancelacion = row.motivo_cancelacion || null;
  }

  return mapped;
}

function buildSlots(horaApertura, horaCierre, intervaloMinutos) {
  const openingMinutes = toMinutes(horaApertura);
  const closingMinutes = toMinutes(horaCierre);
  const slots = [];

  for (
    let cursor = openingMinutes;
    cursor + intervaloMinutos <= closingMinutes;
    cursor += intervaloMinutos
  ) {
    slots.push({
      hora_inicio: formatMinutesToTime(cursor),
      hora_fin: formatMinutesToTime(cursor + intervaloMinutos),
    });
  }

  return slots;
}

function validateReservationRange(amenity, fecha, horaInicio, horaFin) {
  if (!amenity.activo) {
    const error = new Error("La amenidad seleccionada no esta disponible.");
    error.status = 409;
    throw error;
  }

  if (horaInicio >= horaFin) {
    const error = new Error("La hora de fin debe ser mayor a la hora de inicio.");
    error.status = 400;
    throw error;
  }

  const startMinutes = toMinutes(horaInicio);
  const endMinutes = toMinutes(horaFin);
  const openingMinutes = toMinutes(amenity.hora_apertura);
  const closingMinutes = toMinutes(amenity.hora_cierre);

  if (startMinutes < openingMinutes || endMinutes > closingMinutes) {
    const error = new Error("El horario seleccionado esta fuera de la ventana disponible de la amenidad.");
    error.status = 400;
    throw error;
  }

  if (
    (startMinutes - openingMinutes) % amenity.intervalo_minutos !== 0 ||
    (endMinutes - openingMinutes) % amenity.intervalo_minutos !== 0
  ) {
    const error = new Error("El horario debe respetar el intervalo configurado para la amenidad.");
    error.status = 400;
    throw error;
  }

  const currentDateTime = getCurrentDateTimeInTimezone();

  if (
    fecha < currentDateTime.date ||
    (fecha === currentDateTime.date && horaInicio <= currentDateTime.time)
  ) {
    // HU-C05.1/C05.2: codigo estable para que el frontend lo muestre de forma visible.
    const error = new Error("No se pueden registrar reservas en horarios pasados. Elige una fecha y hora futuras.");
    error.status = 400;
    error.code = "RESERVATION_IN_PAST";
    error.errores = [{ field: fecha < currentDateTime.date ? "fecha" : "hora_inicio", message: error.message }];
    throw error;
  }
}

function assertReservationChangeAllowed(reservation) {
  const currentDateTime = getCurrentDateTimeInTimezone();
  const reservationStart = new Date(`${reservation.fecha}T${reservation.hora_inicio}:00`);
  const now = new Date(`${currentDateTime.date}T${currentDateTime.time}`);
  const minutesUntilStart = (reservationStart.getTime() - now.getTime()) / 60000;

  if (String(reservation.estado || "").toUpperCase() === "CANCELADA") {
    const error = new Error("La reserva ya fue cancelada.");
    error.status = 409;
    throw error;
  }

  if (minutesUntilStart < 120) {
    const error = new Error("Solo puedes modificar o cancelar reservas con al menos 2 horas de anticipacion.");
    error.status = 409;
    throw error;
  }
}

async function getReservationForChange(connection, key, viewer, lockRow) {
  const [rows] = await connection.execute(
    `
      SELECT
        r.id_usuario,
        r.id_amenidad,
        a.nombre AS amenidad_nombre,
        DATE_FORMAT(r.fecha, '%Y-%m-%d') AS fecha,
        TIME_FORMAT(r.hora_inicio, '%H:%i') AS hora_inicio,
        TIME_FORMAT(r.hora_fin, '%H:%i') AS hora_fin,
        COALESCE(r.estado, 'CONFIRMADA') AS estado,
        u.nombre AS usuario_nombre,
        tu.nombre AS usuario_rol,
        COALESCE(unidad.unidad, 'Sin unidad') AS unidad
      FROM RESERVA r
      INNER JOIN AMENIDAD a
        ON a.id_amenidad = r.id_amenidad
      INNER JOIN USUARIO u
        ON u.id_usuario = r.id_usuario
      INNER JOIN TIPO_USUARIO tu
        ON tu.id_tipo_usuario = u.id_tipo_usuario
      LEFT JOIN (${USER_UNIT_SUBQUERY}) unidad
        ON unidad.id_usuario = u.id_usuario
      WHERE r.id_usuario = ?
        AND r.id_amenidad = ?
        AND r.fecha = ?
        AND r.hora_inicio = ?
        ${viewer.role === "admin" ? "" : "AND r.id_usuario = ?"}
      LIMIT 1
      ${lockRow ? "FOR UPDATE" : ""}
    `,
    viewer.role === "admin"
      ? [key.id_usuario, key.id_amenidad, key.fecha, key.hora_inicio]
      : [key.id_usuario, key.id_amenidad, key.fecha, key.hora_inicio, viewer.id],
  );

  const reservation = rows[0];

  if (!reservation) {
    const error = new Error(viewer.role === "admin" ? "Reserva no encontrada." : "Reserva no encontrada para el residente autenticado.");
    error.status = 404;
    throw error;
  }

  return reservation;
}

function describeSlot(fecha, horaInicio, horaFin) {
  return `${fecha} ${String(horaInicio).slice(0, 5)}-${String(horaFin).slice(0, 5)}`;
}

// HU-C05.3: detalle legible de que cambio en una modificacion.
function describeReservationChanges(before, after) {
  const changes = [];
  if (after.amenidad_nombre && after.amenidad_nombre !== before.amenidad_nombre) {
    changes.push(`amenidad ${before.amenidad_nombre} -> ${after.amenidad_nombre}`);
  }
  if (after.fecha !== before.fecha) changes.push(`fecha ${before.fecha} -> ${after.fecha}`);
  const beforeHours = `${String(before.hora_inicio).slice(0, 5)}-${String(before.hora_fin).slice(0, 5)}`;
  const afterHours = `${String(after.hora_inicio).slice(0, 5)}-${String(after.hora_fin).slice(0, 5)}`;
  if (afterHours !== beforeHours) changes.push(`horario ${beforeHours} -> ${afterHours}`);
  return changes.length ? changes.join("; ") : "sin cambios de amenidad, fecha u horario";
}

function buildHistoryDetail(action, before, after, viewer, motivo) {
  const reason = motivo ? ` Motivo: ${motivo}` : "";
  const slot = describeSlot(before.fecha, before.hora_inicio, before.hora_fin);
  if (action === "CANCELACION_ADMIN") {
    return `Administración (${viewer.nombre}) canceló la reserva de ${before.amenidad_nombre} del ${slot}.${reason}`;
  }
  if (action === "CANCELACION") {
    return `${viewer.nombre} canceló la reserva de ${before.amenidad_nombre} del ${slot}.${reason}`;
  }
  if (action === "CREACION_ADMIN") {
    return `Administración (${viewer.nombre}) creó la reserva de ${before.amenidad_nombre} del ${slot} en nombre de ${before.usuario_nombre}.`;
  }
  if (action === "CREACION") {
    return `${viewer.nombre} creó la reserva de ${before.amenidad_nombre} del ${slot}.`;
  }
  return `${viewer.nombre} modificó la reserva de ${before.amenidad_nombre}: ${describeReservationChanges(before, after)}.`;
}

async function insertReservationHistory(connection, before, after, action, viewer, { motivo = null } = {}) {
  const isCreation = action === "CREACION" || action === "CREACION_ADMIN";
  const detail = buildHistoryDetail(action, before, after || before, viewer, motivo).slice(0, 255);
  await connection.execute(
    `
      INSERT INTO HISTORIAL_RESERVA (
        id_usuario,
        id_amenidad,
        id_amenidad_nueva,
        fecha_anterior,
        hora_inicio_anterior,
        hora_fin_anterior,
        fecha_nueva,
        hora_inicio_nueva,
        hora_fin_nueva,
        estado_anterior,
        estado_nuevo,
        accion,
        detalle,
        motivo,
        realizado_por,
        realizado_por_nombre,
        realizado_por_rol
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      before.id_usuario,
      before.id_amenidad,
      after?.id_amenidad || before.id_amenidad,
      isCreation ? null : before.fecha,
      isCreation ? null : before.hora_inicio,
      isCreation ? null : before.hora_fin,
      after?.fecha || before.fecha,
      after?.hora_inicio || before.hora_inicio,
      after?.hora_fin || before.hora_fin,
      isCreation ? null : before.estado,
      after?.estado || before.estado,
      action,
      detail,
      motivo,
      viewer.id,
      viewer.nombre,
      viewer.role || null,
    ],
  );
  return detail;
}

// HU-C05.11: auditoria general (AUDITORIA) en la misma transaccion que el cambio.
function reservationAudit(connection, viewer, action, reservation, newData, previousData) {
  return recordAudit(
    {
      userId: viewer.id,
      action,
      entity: "RESERVA",
      entityId: createReservationKey(reservation),
      previousData,
      newData: { ...newData, ejecutado_por_rol: viewer.role || null },
    },
    (sql, params) => connection.execute(sql, params),
  );
}

function normalizeCancellationReason(value) {
  const motivo = normalizeString(value);
  if (motivo.length > 255) {
    const error = new Error("El motivo de cancelación no puede superar 255 caracteres.");
    error.status = 400;
    error.code = "INVALID_CANCELLATION_REASON";
    error.errores = [{ field: "motivo", message: error.message }];
    throw error;
  }
  return motivo || null;
}

async function ensureAmenityCatalog(connection) {
  const [existingRows] = await connection.execute(`
    SELECT id_amenidad, nombre, descripcion, hora_apertura, hora_cierre, intervalo_minutos, activo
    FROM AMENIDAD
    ORDER BY id_amenidad ASC
  `);

  const names = new Set(existingRows.map((row) => normalizeString(row.nombre).toLowerCase()));

  for (const amenity of DEFAULT_AMENITIES) {
    for (const legacyName of amenity.legacyNames) {
      const normalizedLegacyName = legacyName.toLowerCase();
      const normalizedCurrentName = amenity.nombre.toLowerCase();

      if (names.has(normalizedLegacyName) && !names.has(normalizedCurrentName)) {
        await connection.execute(
          `
            UPDATE AMENIDAD
            SET nombre = ?
            WHERE LOWER(nombre) = ?
          `,
          [amenity.nombre, normalizedLegacyName],
        );
        names.delete(normalizedLegacyName);
        names.add(normalizedCurrentName);
      }
    }
  }

  for (const amenity of DEFAULT_AMENITIES) {
    const normalizedName = amenity.nombre.toLowerCase();

    if (!names.has(normalizedName)) {
      await connection.execute(
        `
          INSERT INTO AMENIDAD (
            nombre,
            descripcion,
            hora_apertura,
            hora_cierre,
            intervalo_minutos,
            activo
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          amenity.nombre,
          amenity.descripcion,
          amenity.hora_apertura,
          amenity.hora_cierre,
          amenity.intervalo_minutos,
          amenity.activo ? 1 : 0,
        ],
      );
      names.add(normalizedName);
      continue;
    }

    await connection.execute(
      `
        UPDATE AMENIDAD
        SET
          descripcion = COALESCE(NULLIF(descripcion, ''), ?),
          hora_apertura = COALESCE(hora_apertura, ?),
          hora_cierre = COALESCE(hora_cierre, ?),
          intervalo_minutos = COALESCE(intervalo_minutos, ?),
          activo = COALESCE(activo, ?)
        WHERE LOWER(nombre) = ?
      `,
      [
        amenity.descripcion,
        amenity.hora_apertura,
        amenity.hora_cierre,
        amenity.intervalo_minutos,
        amenity.activo ? 1 : 0,
        normalizedName,
      ],
    );
  }
}

async function getAmenityRecord(connection, amenityId) {
  const [rows] = await connection.execute(
    `
      SELECT
        id_amenidad,
        nombre,
        COALESCE(descripcion, '') AS descripcion,
        TIME_FORMAT(hora_apertura, '%H:%i') AS hora_apertura,
        TIME_FORMAT(hora_cierre, '%H:%i') AS hora_cierre,
        intervalo_minutos,
        activo
      FROM AMENIDAD
      WHERE id_amenidad = ?
      LIMIT 1
    `,
    [amenityId],
  );

  const amenity = rows[0];

  if (!amenity) {
    const error = new Error("La amenidad seleccionada no existe.");
    error.status = 404;
    throw error;
  }

  return mapAmenity(amenity);
}

async function getReservableUserRecord(connection, userId) {
  const [rows] = await connection.execute(
    `
      SELECT
        u.id_usuario,
        u.nombre,
        tu.nombre AS rol,
        COALESCE(unidad.unidad, 'Sin unidad') AS unidad
      FROM USUARIO u
      INNER JOIN TIPO_USUARIO tu
        ON tu.id_tipo_usuario = u.id_tipo_usuario
      LEFT JOIN (${USER_UNIT_SUBQUERY}) unidad
        ON unidad.id_usuario = u.id_usuario
      WHERE u.id_usuario = ?
        AND u.activo = 1
        AND tu.nombre IN ('residente', 'inquilino')
      LIMIT 1
      FOR UPDATE
    `,
    [userId],
  );

  const user = rows[0];

  if (!user) {
    const error = new Error("El usuario seleccionado no puede reservar amenidades.");
    error.status = 400;
    throw error;
  }

  return {
    id_usuario: Number(user.id_usuario),
    nombre: user.nombre,
    rol: user.rol,
    unidad: user.unidad || "Sin unidad",
  };
}

async function getUserName(connection, userId) {
  const [rows] = await connection.execute(
    "SELECT nombre FROM USUARIO WHERE id_usuario = ? LIMIT 1",
    [userId],
  );

  return rows[0]?.nombre || "Usuario";
}

async function findReservationConflict(connection, amenityId, fecha, horaInicio, horaFin, lockRow) {
  const [rows] = await connection.execute(
    `
      SELECT
        r.id_usuario,
        r.id_amenidad,
        a.nombre AS amenidad_nombre,
        DATE_FORMAT(r.fecha, '%Y-%m-%d') AS fecha,
        TIME_FORMAT(r.hora_inicio, '%H:%i') AS hora_inicio,
        TIME_FORMAT(r.hora_fin, '%H:%i') AS hora_fin,
        COALESCE(r.estado, 'CONFIRMADA') AS estado,
        u.nombre AS usuario_nombre,
        tu.nombre AS usuario_rol,
        COALESCE(unidad.unidad, 'Sin unidad') AS unidad
      FROM RESERVA r
      INNER JOIN AMENIDAD a
        ON a.id_amenidad = r.id_amenidad
      INNER JOIN USUARIO u
        ON u.id_usuario = r.id_usuario
      INNER JOIN TIPO_USUARIO tu
        ON tu.id_tipo_usuario = u.id_tipo_usuario
      LEFT JOIN (${USER_UNIT_SUBQUERY}) unidad
        ON unidad.id_usuario = u.id_usuario
      WHERE r.id_amenidad = ?
        AND r.fecha = ?
        AND COALESCE(r.estado, 'CONFIRMADA') <> 'CANCELADA'
        AND r.hora_inicio < ?
        AND r.hora_fin > ?
      ORDER BY r.hora_inicio ASC
      LIMIT 1
      ${lockRow ? "FOR UPDATE" : ""}
    `,
    [amenityId, fecha, horaFin, horaInicio],
  );

  return rows[0] || null;
}

async function countActiveReservationsByUser(connection, userId, lockRows) {
  const currentDateTime = getCurrentDateTimeInTimezone();
  const [rows] = await connection.execute(
    `
      SELECT
        id_usuario
      FROM RESERVA
      WHERE id_usuario = ?
        AND COALESCE(estado, 'CONFIRMADA') <> 'CANCELADA'
        AND (
          fecha > ?
          OR (fecha = ? AND hora_fin > ?)
        )
      ${lockRows ? "FOR UPDATE" : ""}
    `,
    [userId, currentDateTime.date, currentDateTime.date, currentDateTime.time],
  );

  return rows.length;
}

async function getReservationLimitStatus(connection, userId, lockRows = false) {
  const activeReservations = await countActiveReservationsByUser(connection, userId, lockRows);

  return {
    limite: MAX_ACTIVE_RESERVATIONS_PER_USER,
    reservas_activas: activeReservations,
    limite_alcanzado: activeReservations >= MAX_ACTIVE_RESERVATIONS_PER_USER,
  };
}

function throwReservationLimitError() {
  const error = new Error(RESERVATION_LIMIT_MESSAGE);
  error.status = 409;
  error.code = "ACTIVE_RESERVATION_LIMIT_REACHED";
  throw error;
}

async function assertNoActiveAmenitySanction(connection, userId) {
  const [rows] = await connection.execute(
    `SELECT s.id_sancion, s.motivo FROM SANCION s
      INNER JOIN (SELECT c.id_casa, r.id_usuario FROM CASA c INNER JOIN RESIDENTE r ON r.id_residente=c.id_residente
                  UNION SELECT ic.id_casa, i.id_usuario FROM INQUILINO_CASA ic INNER JOIN INQUILINO i ON i.id_inquilino=ic.id_inquilino AND i.autorizado=TRUE) unidad
        ON unidad.id_casa=s.id_casa
     WHERE unidad.id_usuario=? AND s.estado='PENDIENTE' LIMIT 1 FOR UPDATE`, [userId],
  );
  if (rows[0]) {
    const error = new Error(`Reserva bloqueada por sancion vigente: ${rows[0].motivo}`);
    error.status = 403; error.code = "ACTIVE_SANCTION"; throw error;
  }
}

function normalizeReservationPayload(payload, requireUserId) {
  const normalized = {
    id_usuario: payload.id_usuario == null ? null : Number(payload.id_usuario),
    id_amenidad: ensurePositiveInteger(payload.id_amenidad, "id_amenidad"),
    fecha: ensureValidDate(payload.fecha),
    hora_inicio: ensureValidTime(payload.hora_inicio, "hora de inicio"),
    hora_fin: ensureValidTime(payload.hora_fin, "hora de fin"),
  };

  if (requireUserId) {
    normalized.id_usuario = ensurePositiveInteger(payload.id_usuario, "id_usuario");
  }

  return normalized;
}

async function listAmenities() {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await ensureAmenityCatalog(connection);

    const [rows] = await connection.execute(`
      SELECT
        id_amenidad,
        nombre,
        COALESCE(descripcion, '') AS descripcion,
        TIME_FORMAT(hora_apertura, '%H:%i') AS hora_apertura,
        TIME_FORMAT(hora_cierre, '%H:%i') AS hora_cierre,
        intervalo_minutos,
        activo
      FROM AMENIDAD
      ORDER BY id_amenidad ASC
    `);

    await connection.commit();
    return rows.map(mapAmenity);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function listReservableUsers() {
  const rows = await query(
    `
      SELECT
        u.id_usuario,
        u.nombre,
        tu.nombre AS rol,
        COALESCE(unidad.unidad, 'Sin unidad') AS unidad
      FROM USUARIO u
      INNER JOIN TIPO_USUARIO tu
        ON tu.id_tipo_usuario = u.id_tipo_usuario
      LEFT JOIN (${USER_UNIT_SUBQUERY}) unidad
        ON unidad.id_usuario = u.id_usuario
      WHERE u.activo = 1
        AND tu.nombre IN ('residente', 'inquilino')
      ORDER BY u.nombre ASC
    `,
  );

  return rows.map((row) => ({
    id_usuario: Number(row.id_usuario),
    nombre: row.nombre,
    rol: row.rol,
    unidad: row.unidad || "Sin unidad",
  }));
}

async function listReservationsByRange(fromDate, toDate, options = {}) {
  const from = ensureValidDate(fromDate);
  const to = ensureValidDate(toDate);
  const amenityId = options.id_amenidad == null ? null : Number(options.id_amenidad);
  const userId = options.id_usuario == null ? null : Number(options.id_usuario);
  const includeUserDetails = Boolean(options.includeUserDetails);
  const estado = normalizeString(options.estado).toUpperCase();
  const unidad = normalizeString(options.unidad).toLowerCase();
  if (estado && !["PENDIENTE", "CONFIRMADA", "CANCELADA"].includes(estado)) {
    const error = new Error("El estado de reserva es invalido."); error.status = 400; throw error;
  }

  if (from > to) {
    const error = new Error("El rango de fechas es invalido.");
    error.status = 400;
    throw error;
  }

  if (amenityId != null && (!Number.isInteger(amenityId) || amenityId <= 0)) {
    const error = new Error("La amenidad es invalida.");
    error.status = 400;
    throw error;
  }

  if (userId != null && (!Number.isInteger(userId) || userId <= 0)) {
    const error = new Error("El usuario es invalido.");
    error.status = 400;
    throw error;
  }

  const params = [from, to];
  let filtersSql = "";

  if (amenityId != null) {
    filtersSql += " AND r.id_amenidad = ?";
    params.push(amenityId);
  }

  if (userId != null) {
    filtersSql += " AND r.id_usuario = ?";
    params.push(userId);
  }
  if (estado) { filtersSql += " AND COALESCE(r.estado, 'CONFIRMADA') = ?"; params.push(estado); }
  if (unidad) { filtersSql += " AND LOWER(COALESCE(unidad.unidad, 'Sin unidad')) LIKE ?"; params.push(`%${unidad}%`); }

  const rows = await query(
    `
      SELECT
        r.id_usuario,
        r.id_amenidad,
        a.nombre AS amenidad_nombre,
        DATE_FORMAT(r.fecha, '%Y-%m-%d') AS fecha,
        TIME_FORMAT(r.hora_inicio, '%H:%i') AS hora_inicio,
        TIME_FORMAT(r.hora_fin, '%H:%i') AS hora_fin,
        COALESCE(r.estado, 'CONFIRMADA') AS estado,
        u.nombre AS usuario_nombre,
        tu.nombre AS usuario_rol,
        COALESCE(unidad.unidad, 'Sin unidad') AS unidad,
        creador.nombre AS creada_por_nombre,
        (r.creada_por IS NOT NULL AND r.creada_por <> r.id_usuario) AS creada_por_admin,
        cancelador.nombre AS cancelada_por_nombre,
        DATE_FORMAT(r.cancelada_en, '%Y-%m-%d %H:%i:%s') AS cancelada_en,
        r.motivo_cancelacion
      FROM RESERVA r
      INNER JOIN AMENIDAD a
        ON a.id_amenidad = r.id_amenidad
      INNER JOIN USUARIO u
        ON u.id_usuario = r.id_usuario
      INNER JOIN TIPO_USUARIO tu
        ON tu.id_tipo_usuario = u.id_tipo_usuario
      LEFT JOIN (${USER_UNIT_SUBQUERY}) unidad
        ON unidad.id_usuario = u.id_usuario
      LEFT JOIN USUARIO creador
        ON creador.id_usuario = r.creada_por
      LEFT JOIN USUARIO cancelador
        ON cancelador.id_usuario = r.cancelada_por
      WHERE r.fecha BETWEEN ? AND ?
        ${options.includeCanceled ? "" : "AND COALESCE(r.estado, 'CONFIRMADA') <> 'CANCELADA'"}
        ${filtersSql}
      ORDER BY r.fecha ASC, r.hora_inicio ASC, a.id_amenidad ASC, u.nombre ASC
    `,
    params,
  );

  return rows.map((row) => mapReservation(row, includeUserDetails));
}

async function listReservationHistory(userId) {
  const rows = await query(
    `
      SELECT
        h.id_historial,
        h.accion,
        h.detalle,
        a.nombre AS amenidad_nombre,
        DATE_FORMAT(h.fecha_anterior, '%Y-%m-%d') AS fecha_anterior,
        TIME_FORMAT(h.hora_inicio_anterior, '%H:%i') AS hora_inicio_anterior,
        TIME_FORMAT(h.hora_fin_anterior, '%H:%i') AS hora_fin_anterior,
        DATE_FORMAT(h.fecha_nueva, '%Y-%m-%d') AS fecha_nueva,
        TIME_FORMAT(h.hora_inicio_nueva, '%H:%i') AS hora_inicio_nueva,
        TIME_FORMAT(h.hora_fin_nueva, '%H:%i') AS hora_fin_nueva,
        h.estado_anterior,
        h.estado_nuevo,
        h.realizado_por_nombre,
        h.realizado_por_rol,
        h.motivo,
        DATE_FORMAT(h.creado_en, '%Y-%m-%d %H:%i:%s') AS creado_en
      FROM HISTORIAL_RESERVA h
      INNER JOIN AMENIDAD a
        ON a.id_amenidad = h.id_amenidad
      WHERE h.id_usuario = ?
      ORDER BY h.creado_en DESC, h.id_historial DESC
      LIMIT 20
    `,
    [userId],
  );

  return rows.map((row) => ({
    id_historial: Number(row.id_historial),
    accion: row.accion,
    detalle: row.detalle,
    amenidad_nombre: row.amenidad_nombre,
    fecha_anterior: row.fecha_anterior,
    hora_inicio_anterior: row.hora_inicio_anterior,
    hora_fin_anterior: row.hora_fin_anterior,
    fecha_nueva: row.fecha_nueva,
    hora_inicio_nueva: row.hora_inicio_nueva,
    hora_fin_nueva: row.hora_fin_nueva,
    estado_anterior: row.estado_anterior,
    estado_nuevo: row.estado_nuevo,
    realizado_por_nombre: row.realizado_por_nombre,
    realizado_por_rol: row.realizado_por_rol || null,
    motivo: row.motivo || null,
    creado_en: row.creado_en,
  }));
}

async function updateAmenityReservation(viewer, reservationKey, payload = {}) {
  const key = parseReservationKey(reservationKey);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await ensureAmenityCatalog(connection);
    const current = await getReservationForChange(connection, key, viewer, true);
    assertReservationChangeAllowed(current);

    const next = normalizeReservationPayload(
      {
        id_usuario: current.id_usuario,
        id_amenidad: payload.id_amenidad || current.id_amenidad,
        fecha: payload.fecha || current.fecha,
        hora_inicio: payload.hora_inicio || current.hora_inicio,
        hora_fin: payload.hora_fin || current.hora_fin,
      },
      true,
    );
    const amenity = await getAmenityRecord(connection, next.id_amenidad);
    validateReservationRange(amenity, next.fecha, next.hora_inicio, next.hora_fin);

    const conflict = await findReservationConflict(
      connection,
      next.id_amenidad,
      next.fecha,
      next.hora_inicio,
      next.hora_fin,
      true,
    );

    if (
      conflict &&
      !(
        Number(conflict.id_usuario) === Number(current.id_usuario) &&
        Number(conflict.id_amenidad) === Number(current.id_amenidad) &&
        conflict.fecha === current.fecha &&
        conflict.hora_inicio === current.hora_inicio
      )
    ) {
      const error = new Error("El nuevo horario ya esta ocupado para esta amenidad.");
      error.status = 409;
      throw error;
    }

    await connection.execute(
      `
        UPDATE RESERVA
        SET
          id_amenidad = ?,
          fecha = ?,
          hora_inicio = ?,
          hora_fin = ?,
          estado = 'CONFIRMADA'
        WHERE id_usuario = ?
          AND id_amenidad = ?
          AND fecha = ?
          AND hora_inicio = ?
      `,
      [
        next.id_amenidad,
        next.fecha,
        next.hora_inicio,
        next.hora_fin,
        current.id_usuario,
        current.id_amenidad,
        current.fecha,
        `${current.hora_inicio}:00`,
      ],
    );

    const viewerName = await getUserName(connection, viewer.id);
    const after = {
      id_amenidad: next.id_amenidad,
      amenidad_nombre: amenity.nombre,
      fecha: next.fecha,
      hora_inicio: next.hora_inicio.slice(0, 5),
      hora_fin: next.hora_fin.slice(0, 5),
      estado: "CONFIRMADA",
    };
    const actor = { id: viewer.id, nombre: viewerName, role: viewer.role || "residente" };
    const detail = await insertReservationHistory(connection, current, after, "MODIFICACION", actor);
    await reservationAudit(connection, actor, "RESERVATION_UPDATED", { ...current, ...after },
      { cambios: detail, id_usuario_reserva: current.id_usuario },
      { id_amenidad: current.id_amenidad, fecha: current.fecha, hora_inicio: current.hora_inicio, hora_fin: current.hora_fin });

    await connection.commit();

    const updatedRows = await listReservationsByRange(next.fecha, next.fecha, {
      id_amenidad: next.id_amenidad,
      id_usuario: current.id_usuario,
      includeUserDetails: false,
    });
    return updatedRows.find((item) => item.hora_inicio === next.hora_inicio.slice(0, 5)) || null;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function applyReservationCancellation(connection, current, actor, action, motivo) {
  const [result] = await connection.execute(
    `
      UPDATE RESERVA
      SET estado = 'CANCELADA',
          cancelada_por = ?,
          cancelada_en = UTC_TIMESTAMP(),
          motivo_cancelacion = ?
      WHERE id_usuario = ?
        AND id_amenidad = ?
        AND fecha = ?
        AND hora_inicio = ?
        AND COALESCE(estado, 'CONFIRMADA') <> 'CANCELADA'
    `,
    [actor.id, motivo, current.id_usuario, current.id_amenidad, current.fecha, `${current.hora_inicio}:00`],
  );
  if (result.affectedRows !== 1) {
    const error = new Error("La reserva ya fue cancelada.");
    error.status = 409;
    throw error;
  }

  await insertReservationHistory(connection, current, { ...current, estado: "CANCELADA" }, action, actor, { motivo });
  await reservationAudit(connection, actor, "RESERVATION_CANCELLED", current,
    { estado: "CANCELADA", motivo, id_usuario_reserva: current.id_usuario, cancelacion_administrativa: action === "CANCELACION_ADMIN" },
    { estado: current.estado });

  // Return the same UTC timestamp persisted by the transaction, not the browser's
  // clock or a missing value that requires a second page load to become visible.
  const [[metadata]] = await connection.execute(
    `SELECT DATE_FORMAT(cancelada_en, '%Y-%m-%d %H:%i:%s') AS cancelada_en
     FROM RESERVA WHERE id_usuario = ? AND id_amenidad = ? AND fecha = ? AND hora_inicio = ?`,
    [current.id_usuario, current.id_amenidad, current.fecha, `${current.hora_inicio}:00`],
  );
  return { cancelada_en: metadata?.cancelada_en || null, cancelada_por_nombre: actor.nombre, motivo_cancelacion: motivo };
}

async function cancelAmenityReservation(viewer, reservationKey, payload = {}) {
  const key = parseReservationKey(reservationKey);
  const motivo = normalizeCancellationReason(payload.motivo);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const current = await getReservationForChange(connection, key, { ...viewer, role: "residente" }, true);
    assertReservationChangeAllowed(current);

    const viewerName = await getUserName(connection, viewer.id);
    const cancellation = await applyReservationCancellation(
      connection,
      current,
      { id: viewer.id, nombre: viewerName, role: viewer.role || "residente" },
      "CANCELACION",
      motivo,
    );

    await connection.commit();
    return { ...mapReservation({ ...current, estado: "CANCELADA" }, false), ...cancellation };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// HU-C05.4-C05.8: un administrador activo (requireAdmin valida rol y cuenta) cancela
// cualquier reserva vigente. Queda registrado quien, cuando y por que; el residente o
// inquilino lo ve en su historial y recibe una notificacion; el horario se libera
// porque disponibilidad, conflictos y limites ignoran las reservas CANCELADA.
async function adminCancelAmenityReservation(viewer, reservationKey, payload = {}) {
  const key = parseReservationKey(reservationKey);
  const motivo = normalizeCancellationReason(payload.motivo);
  const adminId = ensurePositiveInteger(viewer?.id, "id_usuario");
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const current = await getReservationForChange(connection, key, { id: adminId, role: "admin" }, true);

    if (String(current.estado || "").toUpperCase() === "CANCELADA") {
      const error = new Error("La reserva ya fue cancelada.");
      error.status = 409;
      throw error;
    }
    if (getCurrentReservationStatus(current) === "FINALIZADA") {
      const error = new Error("La reserva ya finalizó; no puede cancelarse.");
      error.status = 409;
      error.code = "RESERVATION_FINISHED";
      throw error;
    }

    const adminName = await getUserName(connection, adminId);
    const actor = { id: adminId, nombre: adminName, role: "admin" };
    const cancellation = await applyReservationCancellation(connection, current, actor, "CANCELACION_ADMIN", motivo);

    await connection.execute(
      `
        INSERT INTO NOTIFICACION (id_usuario, tipo, titulo, mensaje)
        VALUES (?, 'RESERVA_CANCELADA', ?, ?)
      `,
      [
        current.id_usuario,
        "Reserva cancelada por administración",
        `Tu reserva de ${current.amenidad_nombre} del ${describeSlot(current.fecha, current.hora_inicio, current.hora_fin)} fue cancelada.${motivo ? ` Motivo: ${motivo}` : ""}`.slice(0, 255),
      ],
    );

    await connection.commit();
    return mapReservation(
      {
        ...current,
        estado: "CANCELADA",
        ...cancellation,
        cancelada_por_nombre: adminName,
        motivo_cancelacion: motivo,
      },
      true,
    );
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function getAmenityStats(fromDate, toDate, filters = {}) {
  const from = ensureValidDate(fromDate);
  const to = ensureValidDate(toDate);
  const amenityId = filters.id_amenidad == null ? null : Number(filters.id_amenidad);
  const params = [from, to];
  let amenityFilter = "";

  if (amenityId && Number.isInteger(amenityId) && amenityId > 0) {
    amenityFilter = " AND a.id_amenidad = ?";
    params.push(amenityId);
  }

  const rows = await query(
    `
      SELECT
        a.id_amenidad,
        a.nombre,
        COUNT(r.id_usuario) AS total_reservas,
        SUM(CASE WHEN COALESCE(r.estado, 'CONFIRMADA') = 'CANCELADA' THEN 1 ELSE 0 END) AS canceladas,
        SUM(CASE WHEN COALESCE(r.estado, 'CONFIRMADA') <> 'CANCELADA' THEN 1 ELSE 0 END) AS activas
      FROM AMENIDAD a
      LEFT JOIN RESERVA r
        ON r.id_amenidad = a.id_amenidad
        AND r.fecha BETWEEN ? AND ?
      WHERE a.activo = TRUE
        ${amenityFilter}
      GROUP BY a.id_amenidad, a.nombre
      ORDER BY activas DESC, total_reservas DESC, a.nombre ASC
    `,
    params,
  );

  const byAmenity = rows.map((row, index) => ({
    id_amenidad: Number(row.id_amenidad),
    nombre: row.nombre,
    activas: Number(row.activas || 0),
    canceladas: Number(row.canceladas || 0),
    total_reservas: Number(row.activas || 0) + Number(row.canceladas || 0),
    ranking: index + 1,
  }));

  return {
    from,
    to,
    total_reservas: byAmenity.reduce((total, item) => total + item.total_reservas, 0),
    reservas_activas: byAmenity.reduce((total, item) => total + item.activas, 0),
    reservas_canceladas: byAmenity.reduce((total, item) => total + item.canceladas, 0),
    por_amenidad: byAmenity,
    ranking: byAmenity.filter((item) => item.total_reservas > 0),
  };
}

async function getAmenityAvailability(amenityIdValue, fechaValue, options = {}) {
  const amenityId = ensurePositiveInteger(amenityIdValue, "id_amenidad");
  const fecha = ensureValidDate(fechaValue);
  const includeUserDetails = Boolean(options.includeUserDetails);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await ensureAmenityCatalog(connection);
    const amenity = await getAmenityRecord(connection, amenityId);

    const [reservationRows] = await connection.execute(
      `
        SELECT
          r.id_usuario,
          r.id_amenidad,
          a.nombre AS amenidad_nombre,
          DATE_FORMAT(r.fecha, '%Y-%m-%d') AS fecha,
          TIME_FORMAT(r.hora_inicio, '%H:%i') AS hora_inicio,
          TIME_FORMAT(r.hora_fin, '%H:%i') AS hora_fin,
          COALESCE(r.estado, 'CONFIRMADA') AS estado,
          u.nombre AS usuario_nombre,
          tu.nombre AS usuario_rol,
          COALESCE(unidad.unidad, 'Sin unidad') AS unidad
        FROM RESERVA r
        INNER JOIN AMENIDAD a
          ON a.id_amenidad = r.id_amenidad
        INNER JOIN USUARIO u
          ON u.id_usuario = r.id_usuario
        INNER JOIN TIPO_USUARIO tu
          ON tu.id_tipo_usuario = u.id_tipo_usuario
        LEFT JOIN (${USER_UNIT_SUBQUERY}) unidad
          ON unidad.id_usuario = u.id_usuario
        WHERE r.id_amenidad = ?
          AND r.fecha = ?
          AND COALESCE(r.estado, 'CONFIRMADA') <> 'CANCELADA'
        ORDER BY r.hora_inicio ASC
      `,
      [amenityId, fecha],
    );

    const reservations = reservationRows.map((row) => mapReservation(row, includeUserDetails));
    const slots = buildSlots(
      amenity.hora_apertura,
      amenity.hora_cierre,
      amenity.intervalo_minutos,
    ).map((slot) => {
      const conflictingReservation =
        reservations.find(
          (reservation) =>
            reservation.hora_inicio < slot.hora_fin && reservation.hora_fin > slot.hora_inicio,
        ) || null;

      return {
        hora_inicio: slot.hora_inicio,
        hora_fin: slot.hora_fin,
        disponible: amenity.activo && !conflictingReservation,
        reserva: conflictingReservation,
      };
    });

    await connection.commit();

    return {
      amenidad: amenity,
      fecha,
      slots,
      reservas: reservations,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function composeUnifiedAvailability(amenities, fecha, availabilityLoader) {
  const activeAmenities = amenities.filter((amenity) => amenity.activo);
  const amenidades = await Promise.all(
    activeAmenities.map((amenity) => availabilityLoader(amenity.id_amenidad, fecha)),
  );

  return { fecha, amenidades };
}

async function getUnifiedAmenityAvailability(fechaValue) {
  const fecha = ensureValidDate(fechaValue);
  const amenities = await listAmenities();

  return composeUnifiedAvailability(amenities, fecha, (amenityId, selectedDate) =>
    getAmenityAvailability(amenityId, selectedDate, { includeUserDetails: false }),
  );
}

async function validateAmenityReservationConflict(payload, options = {}) {
  const normalizedPayload = normalizeReservationPayload(payload, Boolean(options.requireUserId));
  const includeUserDetails = Boolean(options.includeUserDetails);
  const shouldValidateLimit = Boolean(options.validateUserLimit) || normalizedPayload.id_usuario != null;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await ensureAmenityCatalog(connection);
    const amenity = await getAmenityRecord(connection, normalizedPayload.id_amenidad);

    validateReservationRange(
      amenity,
      normalizedPayload.fecha,
      normalizedPayload.hora_inicio,
      normalizedPayload.hora_fin,
    );

    const conflictingReservation = await findReservationConflict(
      connection,
      normalizedPayload.id_amenidad,
      normalizedPayload.fecha,
      normalizedPayload.hora_inicio,
      normalizedPayload.hora_fin,
      false,
    );
    const limitStatus =
      shouldValidateLimit && normalizedPayload.id_usuario != null
        ? await getReservationLimitStatus(connection, normalizedPayload.id_usuario, false)
        : null;

    await connection.commit();

    return {
      conflicto: Boolean(conflictingReservation),
      reserva: conflictingReservation
        ? mapReservation(conflictingReservation, includeUserDetails)
        : null,
      limite_alcanzado: Boolean(limitStatus?.limite_alcanzado),
      limite_reservas: limitStatus?.limite ?? MAX_ACTIVE_RESERVATIONS_PER_USER,
      reservas_activas_usuario: limitStatus?.reservas_activas ?? null,
      mensaje_limite: limitStatus?.limite_alcanzado ? RESERVATION_LIMIT_MESSAGE : null,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function createAmenityReservation(viewer, payload) {
  const normalizedViewer = {
    role: normalizeString(viewer?.role).toLowerCase(),
    id: viewer?.id == null ? null : Number(viewer.id),
  };
  const isAdmin = normalizedViewer.role === "admin";
  const normalizedPayload = normalizeReservationPayload(payload, isAdmin);
  const userId = isAdmin
    ? normalizedPayload.id_usuario
    : ensurePositiveInteger(normalizedViewer.id, "id_usuario");
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await ensureAmenityCatalog(connection);

    const reservableUser = await getReservableUserRecord(connection, userId);
    await assertNoActiveAmenitySanction(connection, userId);
    const amenity = await getAmenityRecord(connection, normalizedPayload.id_amenidad);

    validateReservationRange(
      amenity,
      normalizedPayload.fecha,
      normalizedPayload.hora_inicio,
      normalizedPayload.hora_fin,
    );

    const conflictingReservation = await findReservationConflict(
      connection,
      normalizedPayload.id_amenidad,
      normalizedPayload.fecha,
      normalizedPayload.hora_inicio,
      normalizedPayload.hora_fin,
      true,
    );

    if (conflictingReservation) {
      const error = new Error("El horario seleccionado ya esta ocupado para esta amenidad.");
      error.status = 409;
      throw error;
    }

    const limitStatus = await getReservationLimitStatus(connection, userId, true);

    if (limitStatus.limite_alcanzado) {
      throwReservationLimitError();
    }

    // La PK incluye usuario/amenidad/fecha/inicio. El bloqueo y la validacion
    // anteriores ya rechazan toda reserva activa superpuesta; una PK repetida
    // solo puede reutilizar una cancelada. HISTORIAL_RESERVA se conserva intacto.
    await connection.execute(
      `
        INSERT INTO RESERVA (
          id_usuario,
          id_amenidad,
          fecha,
          hora_inicio,
          hora_fin,
          estado,
          creado_en,
          creada_por
        )
        VALUES (?, ?, ?, ?, ?, 'CONFIRMADA', NOW(), ?)
        ON DUPLICATE KEY UPDATE
          hora_fin = VALUES(hora_fin),
          estado = 'CONFIRMADA',
          creado_en = NOW(),
          creada_por = VALUES(creada_por),
          cancelada_por = NULL,
          cancelada_en = NULL,
          motivo_cancelacion = NULL
      `,
      [
        userId,
        normalizedPayload.id_amenidad,
        normalizedPayload.fecha,
        normalizedPayload.hora_inicio,
        normalizedPayload.hora_fin,
        normalizedViewer.id,
      ],
    );

    // HU-C05.9/C05.11: quien creo la reserva y, si fue un administrador, en nombre de quien.
    const created = {
      id_usuario: userId,
      id_amenidad: normalizedPayload.id_amenidad,
      amenidad_nombre: amenity.nombre,
      usuario_nombre: reservableUser.nombre,
      fecha: normalizedPayload.fecha,
      hora_inicio: normalizedPayload.hora_inicio.slice(0, 5),
      hora_fin: normalizedPayload.hora_fin.slice(0, 5),
      estado: "CONFIRMADA",
    };
    const actor = {
      id: normalizedViewer.id,
      nombre: isAdmin ? await getUserName(connection, normalizedViewer.id) : reservableUser.nombre,
      role: normalizedViewer.role || "residente",
    };
    await insertReservationHistory(connection, created, created, isAdmin ? "CREACION_ADMIN" : "CREACION", actor);
    await reservationAudit(connection, actor, "RESERVATION_CREATED", created, {
      id_usuario_reserva: userId,
      en_nombre_de_otro: isAdmin,
      fecha: created.fecha,
      hora_inicio: created.hora_inicio,
      hora_fin: created.hora_fin,
    });

    await connection.commit();

    return {
      reservation_key: createReservationKey({
        id_usuario: userId,
        id_amenidad: normalizedPayload.id_amenidad,
        fecha: normalizedPayload.fecha,
        hora_inicio: normalizedPayload.hora_inicio.slice(0, 5),
      }),
      id_usuario: userId,
      id_amenidad: normalizedPayload.id_amenidad,
      amenidad_nombre: amenity.nombre,
      fecha: normalizedPayload.fecha,
      hora_inicio: normalizedPayload.hora_inicio.slice(0, 5),
      hora_fin: normalizedPayload.hora_fin.slice(0, 5),
      estado: "CONFIRMADA",
      estado_actual: getCurrentReservationStatus({
        fecha: normalizedPayload.fecha,
        hora_inicio: normalizedPayload.hora_inicio.slice(0, 5),
        hora_fin: normalizedPayload.hora_fin.slice(0, 5),
        estado: "CONFIRMADA",
      }),
      usuario_nombre: reservableUser.nombre,
      usuario_rol: reservableUser.rol,
      unidad: reservableUser.unidad,
      creada_por_admin: isAdmin,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function updateAmenitySchedule(amenityIdValue, payload) {
  const amenityId = ensurePositiveInteger(amenityIdValue, "id_amenidad");
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await ensureAmenityCatalog(connection);

    const currentAmenity = await getAmenityRecord(connection, amenityId);
    const horaApertura = ensureValidTime(
      payload.hora_apertura || currentAmenity.hora_apertura,
      "hora de apertura",
    );
    const horaCierre = ensureValidTime(
      payload.hora_cierre || currentAmenity.hora_cierre,
      "hora de cierre",
    );
    const intervaloMinutos =
      payload.intervalo_minutos == null
        ? currentAmenity.intervalo_minutos
        : ensureValidInterval(payload.intervalo_minutos);
    const activo = ensureBoolean(payload.activo, currentAmenity.activo);
    const descripcion = normalizeString(payload.descripcion || currentAmenity.descripcion);

    if (horaApertura >= horaCierre) {
      const error = new Error("La hora de cierre debe ser mayor a la hora de apertura.");
      error.status = 400;
      throw error;
    }

    const openingMinutes = toMinutes(horaApertura);
    const closingMinutes = toMinutes(horaCierre);

    if (closingMinutes - openingMinutes < intervaloMinutos) {
      const error = new Error("El horario configurado no deja espacio suficiente para el intervalo.");
      error.status = 400;
      throw error;
    }

    if ((closingMinutes - openingMinutes) % intervaloMinutos !== 0) {
      const error = new Error("La ventana operativa debe ser divisible por el intervalo configurado.");
      error.status = 400;
      throw error;
    }

    const currentDateTime = getCurrentDateTimeInTimezone();
    const [futureConflicts] = await connection.execute(
      `
        SELECT
          DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha,
          TIME_FORMAT(hora_inicio, '%H:%i') AS hora_inicio,
          TIME_FORMAT(hora_fin, '%H:%i') AS hora_fin
        FROM RESERVA
        WHERE id_amenidad = ?
          AND fecha >= ?
          AND COALESCE(estado, 'CONFIRMADA') <> 'CANCELADA'
          AND (hora_inicio < ? OR hora_fin > ?)
        ORDER BY fecha ASC, hora_inicio ASC
        LIMIT 1
        FOR UPDATE
      `,
      [amenityId, currentDateTime.date, horaApertura, horaCierre],
    );

    if (futureConflicts.length > 0) {
      const error = new Error(
        "Existe al menos una reserva futura fuera del nuevo horario configurado para esta amenidad.",
      );
      error.status = 409;
      throw error;
    }

    await connection.execute(
      `
        UPDATE AMENIDAD
        SET
          descripcion = ?,
          hora_apertura = ?,
          hora_cierre = ?,
          intervalo_minutos = ?,
          activo = ?
        WHERE id_amenidad = ?
      `,
      [
        descripcion || null,
        horaApertura,
        horaCierre,
        intervaloMinutos,
        activo ? 1 : 0,
        amenityId,
      ],
    );

    await connection.commit();

    const updatedAmenity = await listAmenities();
    return updatedAmenity.find((item) => item.id_amenidad === amenityId) || null;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  MAX_ACTIVE_RESERVATIONS_PER_USER,
  RESERVATION_LIMIT_MESSAGE,
  listAmenities,
  listReservableUsers,
  listReservationsByRange,
  listReservationHistory,
  getAmenityAvailability,
  getUnifiedAmenityAvailability,
  validateAmenityReservationConflict,
  createAmenityReservation,
  updateAmenityReservation,
  cancelAmenityReservation,
  adminCancelAmenityReservation,
  getAmenityStats,
  updateAmenitySchedule,
  __private__: {
    composeUnifiedAvailability,
    countActiveReservationsByUser,
    getReservationLimitStatus,
    throwReservationLimitError,
    assertNoActiveAmenitySanction,
  },
};
