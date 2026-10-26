const crypto = require("crypto");

const { pool, query } = require("../database/mysql");
const { ensureValidVehiclePlate } = require("../utils/vehiclePlate");
const { ensureValidDate, ensureValidTime } = require("../utils/dateTimeValidation");
const { ensureValidDpi } = require("../utils/identityDocument");
const {
  describeProviderEntryMode,
  ensureProviderIdentifiers,
} = require("../utils/providerAccessValidation");

const DEFAULT_SCHEDULE = { inicio: "06:00", fin: "22:00" };

function normalizeString(value) {
  return String(value || "").trim();
}

function generateQrToken() {
  return crypto.randomBytes(18).toString("hex");
}

const SPECIAL_ACCESS_TYPES = ["VISITA", "DELIVERY", "PROVEEDOR"];

function ensureSpecialAccessType(value) {
  const normalized = normalizeString(value).toUpperCase() || "VISITA";
  if (!SPECIAL_ACCESS_TYPES.includes(normalized)) {
    const error = new Error("El tipo de acceso es invalido.");
    error.status = 400;
    throw error;
  }
  return normalized;
}

// HU-C06: el administrador tambien registra proveedores. Para ellos rige la regla de
// identificador por medio de ingreso; las demas visitas siguen exigiendo DPI.
function ensureSpecialAccessIdentifiers(payload, tipoVisita) {
  if (tipoVisita === "PROVEEDOR") {
    const { placa, dpi } = ensureProviderIdentifiers(payload);
    return { placa, dpi };
  }

  const dpi = ensureValidDpi(payload.dpi);
  if (!dpi) {
    const error = new Error("El nombre y DPI del visitante son obligatorios.");
    error.status = 400;
    throw error;
  }
  return { dpi, placa: ensureValidVehiclePlate(payload.placa) };
}

function toMinutes(timeValue) {
  const normalized = ensureValidTime(timeValue, "hora");
  const [hours, minutes] = normalized.split(":");

  return Number(hours) * 60 + Number(minutes);
}

async function getVisitScheduleConfig() {
  const rows = await query(
    `
      SELECT clave, valor
      FROM CONFIGURACION
      WHERE clave IN ('horario_visita_inicio', 'horario_visita_fin')
    `,
  );

  const config = Object.fromEntries(rows.map((row) => [row.clave, row.valor]));

  return {
    inicio: config.horario_visita_inicio || DEFAULT_SCHEDULE.inicio,
    fin: config.horario_visita_fin || DEFAULT_SCHEDULE.fin,
  };
}

function isOutsideRestrictedHours(horaInicio, horaFin, schedule) {
  const startMinutes = toMinutes(horaInicio);
  const endMinutes = toMinutes(horaFin);
  const allowedStart = toMinutes(schedule.inicio);
  const allowedEnd = toMinutes(schedule.fin);

  return startMinutes < allowedStart || endMinutes > allowedEnd;
}

function mapSpecialAccess(row) {
  return {
    id_acceso: row.id_acceso,
    fecha: row.fecha,
    hora_inicio: row.hora_inicio,
    hora_fin: row.hora_fin,
    nombre: row.nombre,
    dpi: row.dpi,
    placa: row.placa || "",
    casa: row.casa,
    id_casa: row.id_casa,
    tipo_visita: row.tipo_visita,
    medio_ingreso: row.tipo_visita === "PROVEEDOR" ? describeProviderEntryMode(row.placa) : null,
    motivo_servicio: row.motivo_servicio || "",
    motivo_excepcion: row.motivo_excepcion || "",
    es_acceso_especial: Boolean(row.es_acceso_especial),
    estado_acceso: row.estado_acceso,
    token_qr: row.token_qr || null,
    qr_value: row.token_qr ? `NEXUSVISIT:${row.token_qr}` : null,
    fuera_horario: Boolean(row.fuera_horario),
  };
}

function mapExceptionHistory(row) {
  return {
    id_excepcion: row.id_excepcion,
    id_acceso: row.id_acceso,
    accion: row.accion,
    motivo: row.motivo,
    hora_solicitada_inicio: row.hora_solicitada_inicio,
    hora_solicitada_fin: row.hora_solicitada_fin,
    visitante: row.visitante,
    casa: row.casa,
    aprobado_por: row.aprobado_por,
    aprobado_por_nombre: row.aprobado_por_nombre,
    creado_en: row.creado_en,
  };
}

async function listHouses() {
  const rows = await query(
    `
      SELECT
        c.id_casa,
        c.numero,
        c.torre,
        CONCAT(
          COALESCE(c.torre, ''),
          CASE WHEN c.torre IS NOT NULL AND c.torre <> '' THEN '-' ELSE '' END,
          c.numero
        ) AS etiqueta,
        u.nombre AS propietario
      FROM CASA c
      INNER JOIN RESIDENTE r ON r.id_residente = c.id_residente
      INNER JOIN USUARIO u ON u.id_usuario = r.id_usuario
      ORDER BY c.torre, c.numero
    `,
  );

  return rows;
}

async function listPendingSpecialAccesses() {
  const rows = await query(
    `
      SELECT
        a.id_acceso,
        DATE_FORMAT(a.fecha, '%Y-%m-%d') AS fecha,
        TIME_FORMAT(a.hora_inicio, '%H:%i') AS hora_inicio,
        TIME_FORMAT(a.hora_fin, '%H:%i') AS hora_fin,
        v.nombre,
        v.dpi,
        v.placa,
        a.id_casa,
        a.tipo_visita,
        a.motivo_servicio,
        a.motivo_excepcion,
        a.es_acceso_especial,
        a.estado_acceso,
        a.token_qr,
        a.fuera_horario,
        CONCAT(
          COALESCE(c.torre, ''),
          CASE WHEN c.torre IS NOT NULL AND c.torre <> '' THEN '-' ELSE '' END,
          c.numero
        ) AS casa
      FROM ACCESO a
      INNER JOIN VISITANTE v ON v.id_visitante = a.id_visitante
      INNER JOIN CASA c ON c.id_casa = a.id_casa
      WHERE a.es_acceso_especial = TRUE
        AND a.estado_acceso = 'PENDIENTE_APROBACION'
      ORDER BY a.fecha ASC, a.hora_inicio ASC, a.id_acceso DESC
    `,
  );

  return rows.map(mapSpecialAccess);
}

async function listSpecialAccessHistory() {
  const rows = await query(
    `
      SELECT
        e.id_excepcion,
        e.id_acceso,
        e.accion,
        e.motivo,
        TIME_FORMAT(e.hora_solicitada_inicio, '%H:%i') AS hora_solicitada_inicio,
        TIME_FORMAT(e.hora_solicitada_fin, '%H:%i') AS hora_solicitada_fin,
        DATE_FORMAT(e.creado_en, '%Y-%m-%d %H:%i:%s') AS creado_en,
        e.aprobado_por,
        u.nombre AS aprobado_por_nombre,
        v.nombre AS visitante,
        CONCAT(
          COALESCE(c.torre, ''),
          CASE WHEN c.torre IS NOT NULL AND c.torre <> '' THEN '-' ELSE '' END,
          c.numero
        ) AS casa
      FROM ACCESO_EXCEPCION e
      INNER JOIN ACCESO a ON a.id_acceso = e.id_acceso
      INNER JOIN VISITANTE v ON v.id_visitante = a.id_visitante
      INNER JOIN CASA c ON c.id_casa = a.id_casa
      INNER JOIN USUARIO u ON u.id_usuario = e.aprobado_por
      ORDER BY e.creado_en DESC, e.id_excepcion DESC
      LIMIT 50
    `,
  );

  return rows.map(mapExceptionHistory);
}

async function notifyGuards(connection, accessId, titulo, mensaje) {
  const [guards] = await connection.execute(
    `
      SELECT u.id_usuario
      FROM USUARIO u
      INNER JOIN TIPO_USUARIO tu ON tu.id_tipo_usuario = u.id_tipo_usuario
      WHERE tu.nombre = 'guardia' AND u.activo = TRUE
    `,
  );

  for (const guard of guards) {
    await connection.execute(
      `
        INSERT INTO NOTIFICACION (id_usuario, id_acceso, tipo, titulo, mensaje, leido)
        VALUES (?, ?, 'ACCESO_ESPECIAL', ?, ?, FALSE)
      `,
      [guard.id_usuario, accessId, titulo, mensaje],
    );
  }
}

async function createSpecialAccess(adminUserId, payload = {}) {
  const nombre = normalizeString(payload.nombre);
  const tipoVisita = ensureSpecialAccessType(payload.tipo_visita);

  if (!nombre) {
    const error = new Error(
      tipoVisita === "PROVEEDOR"
        ? "El nombre del proveedor es obligatorio."
        : "El nombre y DPI del visitante son obligatorios.",
    );
    error.status = 400;
    throw error;
  }

  const { dpi, placa } = ensureSpecialAccessIdentifiers(payload, tipoVisita);
  const fecha = ensureValidDate(payload.fecha);
  const horaInicio = ensureValidTime(payload.hora_inicio, "hora de inicio");
  const horaFin = ensureValidTime(payload.hora_fin, "hora de fin");
  const motivo = normalizeString(payload.motivo_excepcion);
  const motivoServicio = normalizeString(payload.motivo_servicio).slice(0, 120);
  const idCasa = Number(payload.id_casa);

  if (tipoVisita === "PROVEEDOR" && !motivoServicio) {
    const error = new Error("Indica el servicio que realizara el proveedor.");
    error.status = 400;
    throw error;
  }

  if (!Number.isInteger(idCasa) || idCasa <= 0) {
    const error = new Error("Debe seleccionar una casa valida.");
    error.status = 400;
    throw error;
  }

  if (!motivo) {
    const error = new Error("El motivo de la excepcion es obligatorio.");
    error.status = 400;
    throw error;
  }

  if (toMinutes(horaFin) <= toMinutes(horaInicio)) {
    const error = new Error("La hora de fin debe ser posterior a la hora de inicio.");
    error.status = 400;
    throw error;
  }

  const houseRows = await query("SELECT id_casa FROM CASA WHERE id_casa = ? LIMIT 1", [idCasa]);

  if (!houseRows[0]) {
    const error = new Error("La casa seleccionada no existe.");
    error.status = 404;
    throw error;
  }

  const schedule = await getVisitScheduleConfig();
  const outsideHours = isOutsideRestrictedHours(horaInicio, horaFin, schedule);
  const estadoAcceso = outsideHours ? "PENDIENTE_APROBACION" : "AUTORIZADA";
  const tokenQr = outsideHours ? null : generateQrToken();

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    let visitorId;

      const [existingVisitorRows] = await connection.execute(
        `SELECT id_visitante FROM VISITANTE
         WHERE (? <> '' AND dpi = ?) OR (? <> '' AND UPPER(REPLACE(REPLACE(placa, '-', ''), ' ', '')) = ?)
         ORDER BY id_visitante LIMIT 1 FOR UPDATE`,
        [dpi, dpi, placa, placa.replace(/-/g, "")],
      );

    if (existingVisitorRows[0]) {
      visitorId = existingVisitorRows[0].id_visitante;
      await connection.execute(
        "UPDATE VISITANTE SET nombre = ?, dpi = COALESCE(?, dpi), placa = ? WHERE id_visitante = ?",
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
        INSERT INTO ACCESO (
          id_visitante,
          id_casa,
          id_usuario_autoriza,
          fecha,
          hora_inicio,
          hora_fin,
          tipo_visita,
          motivo_servicio,
          motivo_excepcion,
          token_qr,
          estado_acceso,
          es_acceso_especial,
          fuera_horario
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?)
      `,
      [
        visitorId,
        idCasa,
        adminUserId,
        fecha,
        horaInicio,
        horaFin,
        tipoVisita,
        motivoServicio || null,
        motivo,
        tokenQr,
        estadoAcceso,
        outsideHours,
      ],
    );

    const accessId = accessResult.insertId;

    const [casaRowsForNotify] = await connection.execute(
      `
        SELECT CONCAT(
          COALESCE(c.torre, ''),
          CASE WHEN c.torre IS NOT NULL AND c.torre <> '' THEN '-' ELSE '' END,
          c.numero
        ) AS casa
        FROM CASA c
        WHERE c.id_casa = ?
        LIMIT 1
      `,
      [idCasa],
    );
    const casaLabel = casaRowsForNotify[0]?.casa || "la unidad";
    const horaInicioCorta = horaInicio.slice(0, 5);
    const horaFinCorta = horaFin.slice(0, 5);

    if (!outsideHours) {
      await connection.execute(
        `
          INSERT INTO ACCESO_EXCEPCION (
            id_acceso,
            aprobado_por,
            motivo,
            hora_solicitada_inicio,
            hora_solicitada_fin,
            accion
          )
          VALUES (?, ?, ?, ?, ?, 'APROBADO')
        `,
        [accessId, adminUserId, motivo, horaInicio, horaFin],
      );

      await notifyGuards(
        connection,
        accessId,
        "Acceso especial autorizado",
        `${nombre} tiene acceso especial aprobado para ${casaLabel} (${horaInicioCorta}-${horaFinCorta}).`,
      );
    } else {
      await notifyGuards(
        connection,
        accessId,
        "Acceso especial pendiente",
        `${nombre} solicita acceso especial fuera de horario para ${casaLabel} (${fecha} ${horaInicioCorta}-${horaFinCorta}). Pendiente de aprobacion administrativa; sin QR hasta aprobar.`,
      );
    }

    await connection.commit();

    const rows = await query(
      `
        SELECT
          a.id_acceso,
          DATE_FORMAT(a.fecha, '%Y-%m-%d') AS fecha,
          TIME_FORMAT(a.hora_inicio, '%H:%i') AS hora_inicio,
          TIME_FORMAT(a.hora_fin, '%H:%i') AS hora_fin,
          v.nombre,
          v.dpi,
          v.placa,
          a.id_casa,
          a.tipo_visita,
          a.motivo_servicio,
          a.motivo_excepcion,
          a.es_acceso_especial,
          a.estado_acceso,
          a.token_qr,
          a.fuera_horario,
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

    return {
      ...mapSpecialAccess(rows[0]),
      horario_permitido: schedule,
      requiere_aprobacion: outsideHours,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function approveSpecialAccess(adminUserId, accessId) {
  const normalizedAccessId = Number(accessId);

  if (!Number.isInteger(normalizedAccessId) || normalizedAccessId <= 0) {
    const error = new Error("El acceso es invalido.");
    error.status = 400;
    throw error;
  }

  const rows = await query(
    `
      SELECT
        a.id_acceso,
        a.estado_acceso,
        a.motivo_excepcion,
        a.hora_inicio,
        a.hora_fin,
        v.nombre AS visitante,
        CONCAT(
          COALESCE(c.torre, ''),
          CASE WHEN c.torre IS NOT NULL AND c.torre <> '' THEN '-' ELSE '' END,
          c.numero
        ) AS casa
      FROM ACCESO a
      INNER JOIN VISITANTE v ON v.id_visitante = a.id_visitante
      INNER JOIN CASA c ON c.id_casa = a.id_casa
      WHERE a.id_acceso = ? AND a.es_acceso_especial = TRUE
      LIMIT 1
    `,
    [normalizedAccessId],
  );

  const access = rows[0];

  if (!access) {
    const error = new Error("Acceso especial no encontrado.");
    error.status = 404;
    throw error;
  }

  if (access.estado_acceso !== "PENDIENTE_APROBACION") {
    const error = new Error("Este acceso ya fue procesado.");
    error.status = 409;
    throw error;
  }

  const tokenQr = generateQrToken();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    await connection.execute(
      `
        UPDATE ACCESO
        SET estado_acceso = 'AUTORIZADA',
            token_qr = ?
        WHERE id_acceso = ?
      `,
      [tokenQr, normalizedAccessId],
    );

    await connection.execute(
      `
        INSERT INTO ACCESO_EXCEPCION (
          id_acceso,
          aprobado_por,
          motivo,
          hora_solicitada_inicio,
          hora_solicitada_fin,
          accion
        )
        VALUES (?, ?, ?, ?, ?, 'APROBADO')
      `,
      [
        normalizedAccessId,
        adminUserId,
        access.motivo_excepcion,
        access.hora_inicio,
        access.hora_fin,
      ],
    );

    await notifyGuards(
      connection,
      normalizedAccessId,
      "Acceso especial aprobado",
      `${access.visitante} fue aprobado fuera de horario para ${access.casa}.`,
    );

    await connection.commit();

    const updatedRows = await query(
      `
        SELECT
          a.id_acceso,
          DATE_FORMAT(a.fecha, '%Y-%m-%d') AS fecha,
          TIME_FORMAT(a.hora_inicio, '%H:%i') AS hora_inicio,
          TIME_FORMAT(a.hora_fin, '%H:%i') AS hora_fin,
          v.nombre,
          v.dpi,
          v.placa,
          a.id_casa,
          a.tipo_visita,
          a.motivo_servicio,
          a.motivo_excepcion,
          a.es_acceso_especial,
          a.estado_acceso,
          a.token_qr,
          a.fuera_horario,
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
      [normalizedAccessId],
    );

    return mapSpecialAccess(updatedRows[0]);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function rejectSpecialAccess(adminUserId, accessId, payload = {}) {
  const normalizedAccessId = Number(accessId);
  const motivoRechazo = normalizeString(payload.motivo) || "Rechazado por administrador";

  if (!Number.isInteger(normalizedAccessId) || normalizedAccessId <= 0) {
    const error = new Error("El acceso es invalido.");
    error.status = 400;
    throw error;
  }

  const rows = await query(
    `
      SELECT a.id_acceso, a.estado_acceso, a.motivo_excepcion, a.hora_inicio, a.hora_fin
      FROM ACCESO a
      WHERE a.id_acceso = ? AND a.es_acceso_especial = TRUE
      LIMIT 1
    `,
    [normalizedAccessId],
  );

  const access = rows[0];

  if (!access) {
    const error = new Error("Acceso especial no encontrado.");
    error.status = 404;
    throw error;
  }

  if (access.estado_acceso !== "PENDIENTE_APROBACION") {
    const error = new Error("Este acceso ya fue procesado.");
    error.status = 409;
    throw error;
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    await connection.execute(
      `
        UPDATE ACCESO
        SET estado_acceso = 'RECHAZADA'
        WHERE id_acceso = ?
      `,
      [normalizedAccessId],
    );

    await connection.execute(
      `
        INSERT INTO ACCESO_EXCEPCION (
          id_acceso,
          aprobado_por,
          motivo,
          hora_solicitada_inicio,
          hora_solicitada_fin,
          accion
        )
        VALUES (?, ?, ?, ?, ?, 'RECHAZADO')
      `,
      [
        normalizedAccessId,
        adminUserId,
        motivoRechazo,
        access.hora_inicio,
        access.hora_fin,
      ],
    );

    await connection.commit();

    return { id_acceso: normalizedAccessId, estado_acceso: "RECHAZADA" };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  getVisitScheduleConfig,
  isOutsideRestrictedHours,
  listHouses,
  listPendingSpecialAccesses,
  listSpecialAccessHistory,
  createSpecialAccess,
  approveSpecialAccess,
  rejectSpecialAccess,
};
