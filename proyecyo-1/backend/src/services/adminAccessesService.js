const { query } = require("../database/mysql");
const { sqlUtcTimeToGuatemala } = require("../utils/guatemalaTime");
const { isVisitWindowExpired } = require("../utils/visitWindow");

const RESIDENTIAL_TIMEZONE = "America/Guatemala";

function normalizeString(value) {
  return String(value || "").trim();
}

function getCurrentDateInTimezone() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: RESIDENTIAL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function normalizeAccessType(value) {
  const normalized = normalizeString(value).toUpperCase();

  if (!normalized || normalized === "TODOS") {
    return null;
  }

  const allowed = ["RESIDENTE", "VISITANTE", "PROVEEDOR"];

  if (!allowed.includes(normalized)) {
    const error = new Error("El filtro de tipo es invalido.");
    error.status = 400;
    throw error;
  }

  return normalized;
}

function normalizeAccessStatus(value) {
  const normalized = normalizeString(value).toUpperCase();

  if (!normalized || normalized === "TODOS") {
    return null;
  }

  const allowed = ["APROBADO", "PENDIENTE", "RECHAZADO"];

  if (!allowed.includes(normalized)) {
    const error = new Error("El filtro de estado es invalido.");
    error.status = 400;
    throw error;
  }

  return normalized;
}

function mapAccessType(tipoVisita) {
  const normalized = normalizeString(tipoVisita).toUpperCase();

  if (normalized === "PROVEEDOR") {
    return "PROVEEDOR";
  }

  if (normalized === "RESIDENTE") {
    return "RESIDENTE";
  }

  return "VISITANTE";
}

function mapAccessStatus(estadoAcceso) {
  const normalized = normalizeString(estadoAcceso).toUpperCase();

  if (["AUTORIZADA", "INGRESO_REGISTRADO", "SALIDA_REGISTRADA", "APROBADA"].includes(normalized)) {
    return "APROBADO";
  }

  if (normalized === "PENDIENTE_APROBACION") {
    return "PENDIENTE";
  }

  if (normalized === "PENDIENTE") {
    return "PENDIENTE";
  }

  if (["CANCELADA", "RECHAZADA"].includes(normalized)) {
    return "RECHAZADO";
  }

  return "PENDIENTE";
}

function buildHouseLabel(row) {
  const tower = normalizeString(row.torre);
  const number = normalizeString(row.numero);

  return tower ? `${tower}-${number}` : number;
}

function buildAuthorizerLabel(row) {
  return normalizeString(row.autorizado_por) || "Sin registro";
}

// HU-C04.5: estado operativo exacto, sin perder los movimientos. "estado" conserva
// la agrupacion historica (APROBADO/PENDIENTE/RECHAZADO) que usan filtros y graficas.
function describeAccessDetail(row) {
  const normalized = normalizeString(row.estado_acceso).toUpperCase();
  if (normalized === "AUTORIZADA" && row.fecha && row.hora_fin && isVisitWindowExpired(row.fecha, row.hora_fin)) {
    return "VENCIDA";
  }
  return normalized || "PENDIENTE_APROBACION";
}

function mapAdminAccess(row) {
  return {
    id_acceso: row.id_acceso,
    fecha: row.fecha,
    hora: row.hora || "--:--",
    hora_salida: row.hora_salida || null,
    tipo: mapAccessType(row.tipo_visita),
    nombre: row.nombre,
    casa_unidad: buildHouseLabel(row),
    placa: normalizeString(row.placa) || "-",
    estado: mapAccessStatus(row.estado_acceso),
    estado_detalle: describeAccessDetail(row),
    hora_ingreso: row.hora_ingreso || null,
    cancelado_por: row.cancelado_por || null,
    eliminado_por_residente: Boolean(row.eliminado_en),
    autorizado_por: buildAuthorizerLabel(row),
    es_acceso_especial: Boolean(row.es_acceso_especial),
    fuera_horario: Boolean(row.fuera_horario),
    guardia_ingreso: row.guardia_ingreso || null,
    guardia_salida: row.guardia_salida || null,
  };
}

function appendSearchFilter(filters, params, search) {
  if (!search) {
    return;
  }

  const normalizedSearch = `%${search.toLowerCase()}%`;

  filters.push(`
    (
      LOWER(v.nombre) LIKE ?
      OR LOWER(COALESCE(v.placa, '')) LIKE ?
      OR LOWER(
        CONCAT(
          COALESCE(c.torre, ''),
          CASE WHEN c.torre IS NOT NULL AND c.torre <> '' THEN '-' ELSE '' END,
          c.numero
        )
      ) LIKE ?
    )
  `);

  params.push(normalizedSearch, normalizedSearch, normalizedSearch);
}

function appendHouseFilter(filters, params, house) {
  if (!house) {
    return;
  }

  const normalized = `%${house.toLowerCase()}%`;

  filters.push(`
    LOWER(
      CONCAT(
        COALESCE(c.torre, ''),
        CASE WHEN c.torre IS NOT NULL AND c.torre <> '' THEN '-' ELSE '' END,
        c.numero
      )
    ) LIKE ?
  `);

  params.push(normalized);
}

function appendPlateFilter(filters, params, plate) {
  if (!plate) {
    return;
  }

  const normalized = `%${plate.toLowerCase()}%`;
  filters.push("LOWER(COALESCE(v.placa, '')) LIKE ?");
  params.push(normalized);
}

function appendTypeFilter(filters, accessType) {
  if (!accessType) {
    return;
  }

  if (accessType === "PROVEEDOR") {
    filters.push("UPPER(COALESCE(a.tipo_visita, '')) = 'PROVEEDOR'");
    return;
  }

  if (accessType === "RESIDENTE") {
    filters.push("UPPER(COALESCE(a.tipo_visita, '')) = 'RESIDENTE'");
    return;
  }

  filters.push(`
    (
      a.tipo_visita IS NULL
      OR UPPER(a.tipo_visita) IN ('VISITA', 'DELIVERY', 'VISITANTE')
    )
  `);
}

function appendStatusFilter(filters, accessStatus) {
  if (!accessStatus) {
    return;
  }

  if (accessStatus === "APROBADO") {
    filters.push("UPPER(COALESCE(a.estado_acceso, '')) IN ('AUTORIZADA', 'INGRESO_REGISTRADO', 'SALIDA_REGISTRADA', 'APROBADA')");
    return;
  }

  if (accessStatus === "PENDIENTE") {
    filters.push("UPPER(COALESCE(a.estado_acceso, '')) IN ('PENDIENTE', 'PENDIENTE_APROBACION')");
    return;
  }

  filters.push("UPPER(COALESCE(a.estado_acceso, '')) IN ('CANCELADA', 'RECHAZADA')");
}

async function getAdminAccessSummary() {
  const currentDate = getCurrentDateInTimezone();
  const rows = await query(
    `
      SELECT
        COUNT(DISTINCT a.id_acceso) AS total_dia,
        COUNT(DISTINCT
          CASE
            WHEN UPPER(COALESCE(a.estado_acceso, '')) IN ('AUTORIZADA', 'INGRESO_REGISTRADO', 'SALIDA_REGISTRADA', 'APROBADA')
              THEN a.id_acceso
          END
        ) AS aprobados,
        COUNT(DISTINCT
          CASE
            WHEN UPPER(COALESCE(a.estado_acceso, '')) IN ('PENDIENTE', 'PENDIENTE_APROBACION')
              THEN a.id_acceso
          END
        ) AS pendientes,
        COUNT(DISTINCT
          CASE
            WHEN UPPER(COALESCE(a.estado_acceso, '')) IN ('CANCELADA', 'RECHAZADA')
              THEN a.id_acceso
          END
        ) AS rechazados
      FROM ACCESO a
      WHERE a.fecha = ?
    `,
    [currentDate],
  );

  const summary = rows[0] || {};

  return {
    total_dia: Number(summary.total_dia || 0),
    aprobados: Number(summary.aprobados || 0),
    pendientes: Number(summary.pendientes || 0),
    rechazados: Number(summary.rechazados || 0),
  };
}

function createHourlyAccessBuckets() {
  return Array.from({ length: 24 }, (_unused, hour) => ({
    hora: `${String(hour).padStart(2, "0")}:00`,
    total: 0,
    aprobados: 0,
    pendientes: 0,
    rechazados: 0,
  }));
}

// SCRUM-172: Agrupar accesos por hora del dia actual.
// La hora de referencia es: hora_ingreso del registro si existe, sino hora_inicio del acceso.
// hora_ingreso se guarda en UTC (CURTIME()); se convierte a Guatemala para no mezclar escalas.
// Esto representa la ventana en que se espera/registra el acceso.
async function getAdminAccessHourlyChart() {
  const currentDate = getCurrentDateInTimezone();
  const rows = await query(
    `
      SELECT
        HOUR(COALESCE(${sqlUtcTimeToGuatemala("ra.hora_ingreso")}, a.hora_inicio)) AS hora,
        COUNT(DISTINCT a.id_acceso) AS total,
        COUNT(DISTINCT
          CASE
            WHEN UPPER(COALESCE(a.estado_acceso, '')) IN ('AUTORIZADA', 'INGRESO_REGISTRADO', 'SALIDA_REGISTRADA', 'APROBADA')
              THEN a.id_acceso
          END
        ) AS aprobados,
        COUNT(DISTINCT
          CASE
            WHEN UPPER(COALESCE(a.estado_acceso, '')) IN ('PENDIENTE', 'PENDIENTE_APROBACION')
              THEN a.id_acceso
          END
        ) AS pendientes,
        COUNT(DISTINCT
          CASE
            WHEN UPPER(COALESCE(a.estado_acceso, '')) IN ('CANCELADA', 'RECHAZADA')
              THEN a.id_acceso
          END
        ) AS rechazados
      FROM ACCESO a
      LEFT JOIN REGISTRO_ACCESO ra
        ON ra.id_acceso = a.id_acceso
      WHERE a.fecha = ?
        AND COALESCE(${sqlUtcTimeToGuatemala("ra.hora_ingreso")}, a.hora_inicio) IS NOT NULL
      GROUP BY HOUR(COALESCE(${sqlUtcTimeToGuatemala("ra.hora_ingreso")}, a.hora_inicio))
      ORDER BY hora ASC
    `,
    [currentDate],
  );

  const buckets = createHourlyAccessBuckets();

  rows.forEach((row) => {
    const hour = Number(row.hora);

    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      return;
    }

    buckets[hour] = {
      hora: `${String(hour).padStart(2, "0")}:00`,
      total: Number(row.total || 0),
      aprobados: Number(row.aprobados || 0),
      pendientes: Number(row.pendientes || 0),
      rechazados: Number(row.rechazados || 0),
    };
  });

  return buckets;
}

function getDateNDaysAgo(daysAgo) {
  // Convertir a fecha base GT y restar dias
  const isoCurrent = getCurrentDateInTimezone();
  const [year, month, day] = isoCurrent.split("-").map(Number);
  const base = new Date(Date.UTC(year, month - 1, day));
  base.setUTCDate(base.getUTCDate() - daysAgo);
  return base.toISOString().slice(0, 10);
}

// SCRUM-173: Agrupar accesos por dia (ultimos 7 dias)
async function getAdminAccessDailyChart() {
  const endDate = getCurrentDateInTimezone();
  const startDate = getDateNDaysAgo(6); // 7 dias incluyendo hoy

  const rows = await query(
    `
      SELECT
        DATE_FORMAT(a.fecha, '%Y-%m-%d') AS fecha,
        COUNT(DISTINCT a.id_acceso) AS total,
        COUNT(DISTINCT
          CASE
            WHEN UPPER(COALESCE(a.estado_acceso, '')) IN ('AUTORIZADA', 'INGRESO_REGISTRADO', 'SALIDA_REGISTRADA', 'APROBADA')
              THEN a.id_acceso
          END
        ) AS aprobados,
        COUNT(DISTINCT
          CASE
            WHEN UPPER(COALESCE(a.estado_acceso, '')) IN ('PENDIENTE', 'PENDIENTE_APROBACION')
              THEN a.id_acceso
          END
        ) AS pendientes,
        COUNT(DISTINCT
          CASE
            WHEN UPPER(COALESCE(a.estado_acceso, '')) IN ('CANCELADA', 'RECHAZADA')
              THEN a.id_acceso
          END
        ) AS rechazados
      FROM ACCESO a
      WHERE a.fecha BETWEEN ? AND ?
      GROUP BY a.fecha
      ORDER BY a.fecha ASC
    `,
    [startDate, endDate],
  );

  // Crear buckets para los 7 dias con totales en cero
  const buckets = [];
  for (let i = 6; i >= 0; i -= 1) {
    buckets.push({
      fecha: getDateNDaysAgo(i),
      total: 0,
      aprobados: 0,
      pendientes: 0,
      rechazados: 0,
    });
  }

  // Llenar buckets con los datos de la BD
  rows.forEach((row) => {
    const bucket = buckets.find((b) => b.fecha === row.fecha);
    if (bucket) {
      bucket.total = Number(row.total || 0);
      bucket.aprobados = Number(row.aprobados || 0);
      bucket.pendientes = Number(row.pendientes || 0);
      bucket.rechazados = Number(row.rechazados || 0);
    }
  });

  return buckets;
}

async function listAdminAccesses(filters = {}, reportRange = null) {
  const currentDate = getCurrentDateInTimezone();
  const search = normalizeString(filters.search).toLowerCase();
  const house = normalizeString(filters.house).toLowerCase();
  const plate = normalizeString(filters.plate).toLowerCase();
  const accessType = normalizeAccessType(filters.type);
  const accessStatus = normalizeAccessStatus(filters.status);
  const sqlFilters = reportRange ? ["1 = 1"] : ["a.fecha = ?"];
  const params = reportRange ? [] : [currentDate];
  if (reportRange?.desde) {
    sqlFilters.push("a.fecha >= ?");
    params.push(reportRange.desde);
  }
  if (reportRange?.hasta) {
    sqlFilters.push("a.fecha <= ?");
    params.push(reportRange.hasta);
  }

  appendSearchFilter(sqlFilters, params, search);
  appendHouseFilter(sqlFilters, params, house);
  appendPlateFilter(sqlFilters, params, plate);
  appendTypeFilter(sqlFilters, accessType);
  appendStatusFilter(sqlFilters, accessStatus);

  const rows = await query(
    `
      SELECT
        a.id_acceso,
        DATE_FORMAT(a.fecha, '%Y-%m-%d') AS fecha,
        COALESCE(
          TIME_FORMAT(${sqlUtcTimeToGuatemala("ra.hora_ingreso")}, '%H:%i'),
          TIME_FORMAT(a.hora_inicio, '%H:%i'),
          '--:--'
        ) AS hora,
        TIME_FORMAT(${sqlUtcTimeToGuatemala("ra.hora_salida")}, '%H:%i') AS hora_salida,
        TIME_FORMAT(${sqlUtcTimeToGuatemala("ra.hora_ingreso")}, '%H:%i') AS hora_ingreso,
        TIME_FORMAT(a.hora_fin, '%H:%i') AS hora_fin,
        a.tipo_visita,
        a.estado_acceso,
        a.es_acceso_especial,
        a.fuera_horario,
        a.eliminado_en,
        cancelador.nombre AS cancelado_por,
        v.nombre,
        v.placa,
        c.numero,
        c.torre,
        autorizante.nombre AS autorizado_por,
        gi.nombre AS guardia_ingreso,
        gs.nombre AS guardia_salida
      FROM ACCESO a
      INNER JOIN VISITANTE v
        ON v.id_visitante = a.id_visitante
      INNER JOIN CASA c
        ON c.id_casa = a.id_casa
      LEFT JOIN USUARIO autorizante
        ON autorizante.id_usuario = a.id_usuario_autoriza
      LEFT JOIN USUARIO cancelador
        ON cancelador.id_usuario = a.id_usuario_cancela
      LEFT JOIN REGISTRO_ACCESO ra
        ON ra.id_acceso = a.id_acceso
      -- HU-C08: guardia ejecutor de la entrada/salida (NULL en registros historicos).
      LEFT JOIN USUARIO gi
        ON gi.id_usuario = ra.id_guardia_ingreso
      LEFT JOIN USUARIO gs
        ON gs.id_usuario = ra.id_guardia_salida
      WHERE ${sqlFilters.join(" AND ")}
      ORDER BY
        a.fecha DESC,
        COALESCE(${sqlUtcTimeToGuatemala("ra.hora_ingreso")}, a.hora_inicio, '00:00:00') DESC,
        a.id_acceso DESC
      ${reportRange ? "LIMIT 10001" : ""}
    `,
    params,
  );

  return rows.map(mapAdminAccess);
}

module.exports = {
  getAdminAccessSummary,
  getAdminAccessHourlyChart,
  getAdminAccessDailyChart,
  listAdminAccesses,
};
