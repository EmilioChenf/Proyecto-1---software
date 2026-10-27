const { pool, query } = require("../database/mysql");
const { logger } = require("../utils/safeLogger");
const { assertVisitTimesAllowed } = require("./configurationService");
const { recordAudit } = require("./auditService");
const { ensureValidVehiclePlate } = require("../utils/vehiclePlate");
const { ensureValidDate, ensureValidTime } = require("../utils/dateTimeValidation");
const { ensureValidDpi } = require("../utils/identityDocument");
const { ensureVisitWindowNotPast } = require("../utils/visitWindow");
const {
  describeProviderEntryMode,
  ensureProviderIdentifiers,
} = require("../utils/providerAccessValidation");
const crypto = require("crypto");
const { guatemalaToday, sqlUtcTimeToGuatemala } = require("../utils/guatemalaTime");
const RESIDENTIAL_TIMEZONE = "America/Guatemala";

function normalizeString(value) {
  return String(value || "").trim();
}

// HU-C06: los proveedores siempre quedan identificados segun su medio de ingreso
// (placa si llegan en vehiculo, DPI si llegan a pie); el resto de visitas conserva
// la validacion de formato de HU-C03.
function ensureVisitIdentifiers(payload, tipoVisita) {
  if (tipoVisita === "PROVEEDOR") {
    const { placa, dpi } = ensureProviderIdentifiers(payload);
    return { placa, dpi };
  }

  const dpi = ensureValidDpi(payload.dpi);
  // HU-C03.1: una visita personal (la que genera visitantes frecuentes) siempre
  // identifica al visitante con su DPI/documento; delivery conserva DPI o placa.
  if (tipoVisita === "VISITA" && !dpi) {
    throw visitorDocumentRequired();
  }

  return {
    dpi,
    placa: ensureValidVehiclePlate(payload.placa),
  };
}

function visitorDocumentRequired() {
  const error = new Error("El DPI/documento del visitante es obligatorio (13 dígitos).");
  error.status = 400;
  error.code = "VISITOR_DOCUMENT_REQUIRED";
  error.errores = [{ field: "dpi", message: error.message }];
  return error;
}

function houseLabel(house) {
  return `${house.torre ? `${house.torre}-` : ""}${house.numero}`;
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
    // HU-C04.5: movimiento de entrada visible aunque la visita quede cancelada o vencida.
    hora_ingreso: row.hora_ingreso || null,
    tipo_visita: row.tipo_visita,
    medio_ingreso: row.tipo_visita === "PROVEEDOR" ? describeProviderEntryMode(row.placa) : null,
    motivo_servicio: row.motivo_servicio || "",
    observaciones: row.observaciones || "",
    token_qr: row.token_qr,
    estado_acceso: row.estado_acceso,
    es_acceso_especial: Boolean(row.es_acceso_especial),
    fuera_horario: Boolean(row.fuera_horario),
    motivo_excepcion: row.motivo_excepcion || "",
    qr_status: qrStatus,
    // HU-C06.7: un QR vencido no se entrega para mostrarlo ni compartirlo.
    qr_value: row.token_qr && qrStatus !== "EXPIRED" ? `NEXUSVISIT:${row.token_qr}` : null,
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
        (
          SELECT TIME_FORMAT(${sqlUtcTimeToGuatemala("ra.hora_ingreso")}, '%H:%i')
          FROM REGISTRO_ACCESO ra
          WHERE ra.id_acceso = a.id_acceso
          LIMIT 1
        ) AS hora_ingreso,
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
        AND a.eliminado_en IS NULL
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
        v.id_visitante,
        v.nombre,
        v.dpi,
        v.placa,
        COUNT(*) AS total_visitas,
        MAX(a.fecha) AS ultima_fecha
      FROM ACCESO a
      INNER JOIN VISITANTE v
        ON v.id_visitante = a.id_visitante
      WHERE a.id_casa = ?
        AND v.activo = TRUE
        ${getOwnerFilter(role)}
      GROUP BY v.id_visitante, v.nombre, v.dpi, v.placa
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
    // HU-C03.5: vivienda que se muestra al confirmar el acceso rapido.
    casa: houseLabel(house),
  }));
}

async function createVisit(userId, role = "residente", payload) {
  const house = await getHouseByUserId(userId, role);
  const nombre = normalizeString(payload.nombre);
  const tipoVisita = ensureVisitType(payload.tipo_visita);
  const { dpi, placa } = ensureVisitIdentifiers(payload, tipoVisita);
  const foto = normalizeString(payload.foto);
  const fecha = ensureValidDate(payload.fecha);
  const horaInicio = ensureValidTime(payload.hora_inicio, "hora de inicio");
  const horaFin = ensureValidTime(payload.hora_fin, "hora de fin");
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

  // HU-C06.6/C06.7: sin fechas ni horarios pasados, asi nunca se genera un QR vencido.
  ensureVisitWindowNotPast(fecha, horaInicio, horaFin);
  await assertVisitTimesAllowed(horaInicio, horaFin, fecha);
  const qrToken = generateQrToken();

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    // HU-C03.9: serializa las autorizaciones de la misma vivienda. Sin este bloqueo, dos
    // envios simultaneos con un DPI nuevo no ven al visitante del otro y emiten dos QR.
    await connection.execute("SELECT id_casa FROM CASA WHERE id_casa = ? FOR UPDATE", [house.id_casa]);

    const [existingVisitors] = await connection.execute(
      `SELECT id_visitante, nombre, dpi, placa, activo FROM VISITANTE
       WHERE (? <> '' AND dpi = ?) OR (? <> '' AND UPPER(REPLACE(REPLACE(placa, '-', ''), ' ', '')) = ?)
       ORDER BY id_visitante LIMIT 1 FOR UPDATE`,
      [dpi, dpi, placa, placa.replace(/-/g, "")],
    );
    let visitorId = existingVisitors[0]?.id_visitante;
    const existingVisitor = existingVisitors[0];

    if (visitorId) {
      const nameChanged = existingVisitor.nombre !== nombre;
      const dpiChanged = (existingVisitor.dpi || "") !== (dpi || "");
      const placaChanged = (existingVisitor.placa || "") !== (placa || "");
      const dataChanged = nameChanged || dpiChanged || placaChanged;

      if (dataChanged && !payload.confirmar_actualizacion) {
        await connection.rollback();
        const error = new Error(
          `Ya existe un visitante registrado con esos datos (${existingVisitor.nombre}). ` +
          `¿Deseas actualizar sus datos al crear esta visita?`,
        );
        error.status = 409;
        error.code = "VISITOR_DATA_CONFLICT";
        // Solo se devuelven los identificadores que el usuario ya escribio: el
        // VISITANTE es compartido y no debe revelar datos que no conoce.
        error.existing = {
          id_visitante: existingVisitor.id_visitante,
          nombre: existingVisitor.nombre,
          dpi: dpi && existingVisitor.dpi === dpi ? existingVisitor.dpi : null,
          placa: placa && existingVisitor.placa === placa ? existingVisitor.placa : null,
        };
        throw error;
      }

      if (dataChanged) {
        await connection.execute(
          "UPDATE VISITANTE SET nombre = ?, dpi = ?, placa = ? WHERE id_visitante = ?",
          [nombre, dpi || null, placa || null, visitorId],
        );
      }

      // HU-C03.6: autorizar de nuevo a un visitante desactivado lo reactiva; su
      // historial nunca se perdio.
      if (!existingVisitor.activo) {
        await connection.execute("UPDATE VISITANTE SET activo = TRUE WHERE id_visitante = ?", [visitorId]);
      }
    } else {
      const [visitorResult] = await connection.execute(
        "INSERT INTO VISITANTE (nombre, dpi, placa, activo) VALUES (?, ?, ?, TRUE)",
        [nombre, dpi || null, placa || null],
      );
      visitorId = visitorResult.insertId;
    }

    const [dupRows] = await connection.execute(
      `SELECT id_acceso FROM ACCESO
       WHERE id_visitante = ? AND id_casa = ? AND fecha = ? AND hora_inicio = ? AND hora_fin = ?
         AND estado_acceso <> 'CANCELADA'
       LIMIT 1`,
      [visitorId, house.id_casa, fecha, horaInicio, horaFin],
    );
    if (dupRows.length > 0) {
      await connection.rollback();
      const error = new Error("Ya existe una visita autorizada para este visitante en la misma fecha y horario.");
      error.status = 409;
      error.code = "DUPLICATE_VISIT";
      throw error;
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

// HU-C04: evidencia de acceso de una visita. Con movimientos (entrada/salida) o con
// intentos de validacion de su QR, la visita ya forma parte del historial de garita.
async function getAccessHistoryEvidence(accessId, runner = query) {
  const rows = await runner(
    `
      SELECT
        (SELECT COUNT(*) FROM REGISTRO_ACCESO ra WHERE ra.id_acceso = ?) AS movimientos,
        (SELECT COUNT(*) FROM INTENTO_VALIDACION_QR iv WHERE iv.id_acceso = ?) AS intentos
    `,
    [accessId, accessId],
  );
  return {
    movimientos: Number(rows[0]?.movimientos || 0),
    intentos: Number(rows[0]?.intentos || 0),
  };
}

function conflict(message, code) {
  const error = new Error(message);
  error.status = 409;
  error.code = code;
  return error;
}

async function deleteVisit(userId, role = "residente", accessId) {
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
        AND a.eliminado_en IS NULL
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

  const status = String(visit.estado_acceso || "").toUpperCase();

  // HU-C04.1: con el visitante adentro no se elimina ni se oculta nada: la garita
  // todavia debe registrar su salida sobre este mismo acceso.
  if (status === "INGRESO_REGISTRADO") {
    throw conflict(
      "El visitante sigue dentro del residencial. La visita no puede eliminarse hasta que la garita registre su salida.",
      "VISIT_IN_PROGRESS",
    );
  }

  const evidence = await getAccessHistoryEvidence(normalizedAccessId);
  const hasHistory = status === "SALIDA_REGISTRADA" || evidence.movimientos > 0 || evidence.intentos > 0;

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    if (hasHistory) {
      // HU-C04.1/C04.2: eliminacion logica. Se conservan visitante, vivienda, horario,
      // REGISTRO_ACCESO (timestamps y guardias) e intentos; solo se retira de la lista
      // del residente. Si el QR seguia vigente queda cancelado (HU-C04.4).
      const [result] = await connection.execute(
        `
          UPDATE ACCESO
          SET eliminado_en = UTC_TIMESTAMP(),
              id_usuario_elimina = ?,
              cancelado_en = CASE WHEN estado_acceso IN ('AUTORIZADA', 'PENDIENTE_APROBACION') THEN UTC_TIMESTAMP() ELSE cancelado_en END,
              id_usuario_cancela = CASE WHEN estado_acceso IN ('AUTORIZADA', 'PENDIENTE_APROBACION') THEN ? ELSE id_usuario_cancela END,
              estado_acceso = CASE WHEN estado_acceso IN ('AUTORIZADA', 'PENDIENTE_APROBACION') THEN 'CANCELADA' ELSE estado_acceso END
          WHERE id_acceso = ?
            AND eliminado_en IS NULL
            AND estado_acceso <> 'INGRESO_REGISTRADO'
        `,
        [userId, userId, normalizedAccessId],
      );
      if (result.affectedRows !== 1) {
        throw conflict("La visita cambio de estado mientras se eliminaba. Actualiza la lista e intenta de nuevo.", "VISIT_STATE_CHANGED");
      }
      await transactionAudit(connection, {
        userId,
        action: "VISIT_ARCHIVED",
        entity: "ACCESO",
        entityId: normalizedAccessId,
        previousData: { estado_acceso: status },
        newData: { eliminado: true, conserva_historial: true, movimientos: evidence.movimientos, intentos: evidence.intentos },
      });
      await connection.commit();
      return { ...mapVisit(visit), desactivada: true };
    }

    // Sin movimientos ni intentos no hay evidencia de acceso: se conserva el borrado
    // fisico historico. La condicion se repite en SQL por si la garita actuo en paralelo.
    const [deleted] = await connection.execute(
      `
        DELETE FROM ACCESO
        WHERE id_acceso = ?
          AND estado_acceso NOT IN ('INGRESO_REGISTRADO', 'SALIDA_REGISTRADA')
          AND NOT EXISTS (SELECT 1 FROM REGISTRO_ACCESO ra WHERE ra.id_acceso = ?)
          AND NOT EXISTS (SELECT 1 FROM INTENTO_VALIDACION_QR iv WHERE iv.id_acceso = ?)
      `,
      [normalizedAccessId, normalizedAccessId, normalizedAccessId],
    );
    if (deleted.affectedRows !== 1) {
      throw conflict("La visita cambio de estado mientras se eliminaba. Actualiza la lista e intenta de nuevo.", "VISIT_STATE_CHANGED");
    }
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

    return { ...mapVisit(visit), desactivada: false };
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
  const tipoVisita = ensureVisitType(payload.tipo_visita);
  const { dpi, placa } = ensureVisitIdentifiers(payload, tipoVisita);
  const fecha = ensureValidDate(payload.fecha);
  const horaInicio = ensureValidTime(payload.hora_inicio, "hora de inicio");
  const horaFin = ensureValidTime(payload.hora_fin, "hora de fin");
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

  // Un acceso vigente que conserva su inicio puede editarse aunque ya haya empezado;
  // cualquier cambio de fecha u hora de inicio no puede quedar en el pasado.
  const keepsStart = fecha === visit.fecha && horaInicio.slice(0, 5) === String(visit.hora_inicio).slice(0, 5);
  ensureVisitWindowNotPast(fecha, horaInicio, horaFin, { allowStartedWindow: keepsStart });
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
      [nombre, dpi || null, placa || null, visit.id_visitante],
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
        AND a.eliminado_en IS NULL
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

  // HU-C04.3: una visita finalizada conserva su estado historico; cancelarla
  // reescribiria SALIDA_REGISTRADA y perderia la trazabilidad.
  if (String(existing.estado_acceso).toUpperCase() === "SALIDA_REGISTRADA") {
    throw conflict("La visita ya finalizó (salida registrada) y se conserva en el historial; no puede cancelarse.", "VISIT_ALREADY_FINISHED");
  }

  if (String(existing.estado_acceso).toUpperCase() === "RECHAZADA") {
    throw conflict("La visita fue rechazada por la administración; no puede cancelarse.", "VISIT_REJECTED");
  }

  // Cancelacion logica condicional: si la garita registro el ingreso en paralelo,
  // la cancelacion no ocurre (HU-C04.4: nunca queda un QR cancelado con alguien adentro).
  const cancelResult = await query(
    `
      UPDATE ACCESO
      SET estado_acceso = 'CANCELADA', cancelado_en = UTC_TIMESTAMP(), id_usuario_cancela = ?
      WHERE id_acceso = ? AND estado_acceso IN ('AUTORIZADA', 'PENDIENTE_APROBACION')
    `,
    [userId, normalizedAccessId],
  );
  if (!cancelResult || cancelResult.affectedRows !== 1) {
    throw conflict("La visita cambió de estado (por ejemplo, ya se registró el ingreso). Actualiza la lista.", "VISIT_STATE_CHANGED");
  }

  await recordAudit({
    userId,
    action: "VISIT_CANCELLED",
    entity: "ACCESO",
    entityId: normalizedAccessId,
    previousData: { estado_acceso: existing.estado_acceso },
    newData: { estado_acceso: "CANCELADA" },
  }).catch((auditError) => logger.warn("No fue posible auditar la cancelacion de la visita.", auditError));

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

  // HU-C03.6/C04.1: movimientos, intentos de QR o estados de acceso ya usados son
  // historial; en ese caso solo se desactiva al visitante.
  const historyRows = await query(
    `SELECT COUNT(*) AS total FROM ACCESO a
     WHERE a.id_visitante = ? AND a.id_casa = ?
       AND (a.estado_acceso IN ('INGRESO_REGISTRADO', 'SALIDA_REGISTRADA')
         OR a.eliminado_en IS NOT NULL
         OR EXISTS (SELECT 1 FROM REGISTRO_ACCESO ra WHERE ra.id_acceso = a.id_acceso)
         OR EXISTS (SELECT 1 FROM INTENTO_VALIDACION_QR iv WHERE iv.id_acceso = a.id_acceso))`,
    [normalizedVisitorId, house.id_casa],
  );
  const hasHistory = Number(historyRows[0]?.total) > 0;

  if (hasHistory) {
    await query(
      "UPDATE VISITANTE SET activo = FALSE WHERE id_visitante = ?",
      [normalizedVisitorId],
    );
    return { id_visitante: normalizedVisitorId, nombre: visitor.nombre, desactivado: true };
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await connection.execute(
      `DELETE FROM ACCESO WHERE id_visitante = ? AND id_casa = ? ${getOwnerFilter(role)}`,
      [normalizedVisitorId, house.id_casa, ...getOwnerParams(userId, role)],
    );
    await connection.execute(
      `DELETE FROM VISITANTE WHERE id_visitante = ? AND NOT EXISTS (SELECT 1 FROM ACCESO WHERE id_visitante = ?)`,
      [normalizedVisitorId, normalizedVisitorId],
    );
    await connection.commit();
    return { id_visitante: normalizedVisitorId, nombre: visitor.nombre, desactivado: false };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
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

/** Acceso ya creado, con el mismo formato que el historial de visitas. */
async function getVisitById(accessId) {
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
        NULL AS hora_salida,
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
      INNER JOIN VISITANTE v ON v.id_visitante = a.id_visitante
      INNER JOIN CASA c ON c.id_casa = a.id_casa
      WHERE a.id_acceso = ?
      LIMIT 1
    `,
    [accessId],
  );

  if (!rows[0]) {
    const error = new Error("Acceso no encontrado.");
    error.status = 404;
    throw error;
  }

  return mapVisit(rows[0]);
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

async function updateFrequentVisitor(userId, role = "residente", visitorId, payload = {}) {
  const house = await getHouseByUserId(userId, role);
  const normalizedVisitorId = Number(visitorId);

  if (!Number.isInteger(normalizedVisitorId) || normalizedVisitorId <= 0) {
    const error = new Error("El visitante es invalido.");
    error.status = 400;
    throw error;
  }

  const rows = await query(
    `
      SELECT v.id_visitante, v.nombre, v.dpi, v.placa
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

  const nombre = normalizeString(payload.nombre) || visitor.nombre;
  const dpi = payload.dpi !== undefined ? ensureValidDpi(payload.dpi) : (visitor.dpi || "");
  const placa = payload.placa !== undefined ? ensureValidVehiclePlate(payload.placa) : (visitor.placa || "");

  if (!nombre) {
    const error = new Error("El nombre del visitante es obligatorio.");
    error.status = 400;
    throw error;
  }

  // HU-C03.1: un visitante frecuente no puede quedar sin documento.
  if (!dpi) {
    throw visitorDocumentRequired();
  }

  // HU-C03.3: la edicion explicita tampoco puede duplicar el DPI de otro visitante.
  const sameDpi = await query(
    "SELECT id_visitante FROM VISITANTE WHERE dpi = ? AND id_visitante <> ? LIMIT 1",
    [dpi, normalizedVisitorId],
  );
  if (sameDpi[0]) {
    const error = new Error("Ya existe otro visitante registrado con ese DPI.");
    error.status = 409;
    error.code = "VISITOR_DPI_IN_USE";
    error.errores = [{ field: "dpi", message: error.message }];
    throw error;
  }

  await query(
    "UPDATE VISITANTE SET nombre = ?, dpi = ?, placa = ? WHERE id_visitante = ?",
    [nombre, dpi || null, placa || null, normalizedVisitorId],
  );

  return {
    id_visitante: normalizedVisitorId,
    nombre,
    dpi: dpi || null,
    placa: placa || null,
  };
}

module.exports = {
  listResidentVisits,
  listFrequentVisitors,
  createVisit,
  updateVisit,
  deleteVisit,
  cancelVisit,
  deleteFrequentVisitor,
  updateFrequentVisitor,
  getVisitById,
  getGuardShiftVisits,
  validateQrVisit,
  registerQrEntry,
  registerQrExit,
  __private__: {
    ensureVisitType,
    ensureQrExitCanBeRegistered,
    getQrStatus,
    normalizeQrToken,
    ensureValidDpi,
    ensureVisitIdentifiers,
  },
};
