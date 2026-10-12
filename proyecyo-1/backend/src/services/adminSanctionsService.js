const { QUOTA_BALANCES_SQL } = require("./financialBalance");
const { query } = require("../database/mysql");

const RESIDENTIAL_TIMEZONE = "America/Guatemala";
const OVERDUE_FEE_RULE = {
  codigo: "CUOTA_VENCIDA",
  nombre: "Cuota vencida",
  descripcion: "Genera una sancion cuando una cuota supera su fecha limite sin pago completo.",
  monto_base: 50,
  porcentaje: 10,
};

function calculateSanctionAmount(amount) {
  const percentageAmount = Number(amount || 0) * (OVERDUE_FEE_RULE.porcentaje / 100);

  return Math.max(
    OVERDUE_FEE_RULE.monto_base,
    Math.round(percentageAmount * 100 + 1e-9) / 100,
  );
}

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

function normalizeSanctionStatus(value) {
  const normalized = normalizeString(value).toUpperCase();

  if (!normalized || normalized === "TODOS") {
    return null;
  }

  const allowed = ["PENDIENTE", "PAGADA", "ANULADA"];

  if (!allowed.includes(normalized)) {
    const error = new Error("El estado de sancion es invalido.");
    error.status = 400;
    throw error;
  }

  return normalized;
}

function buildHouseLabel(row) {
  const tower = normalizeString(row.torre);
  const number = normalizeString(row.numero);

  return tower ? `${tower}-${number}` : number;
}

function mapSanction(row) {
  return {
    id_sancion: row.id_sancion,
    casa_unidad: buildHouseLabel(row),
    residente: row.residente,
    codigo_regla: row.codigo_regla,
    motivo: row.motivo,
    detalle: row.detalle,
    monto: Number(row.monto || 0),
    estado: row.estado,
    generada_automaticamente: Boolean(row.generada_automaticamente),
    fecha_incumplimiento: row.fecha_incumplimiento,
    fecha_generacion: row.fecha_generacion,
    cuota_monto: row.cuota_monto === null ? null : Number(row.cuota_monto || 0),
    fecha_limite: row.fecha_limite,
    servicio: row.servicio,
  };
}

function mapSanctionHistory(row) {
  return {
    id_historial: row.id_historial,
    id_sancion: row.id_sancion,
    accion: row.accion,
    estado_anterior: row.estado_anterior,
    estado_nuevo: row.estado_nuevo,
    detalle: row.detalle,
    realizado_por: row.realizado_por_nombre || "Sistema",
    creado_en: row.creado_en,
    casa_unidad: buildHouseLabel(row),
    residente: row.residente,
    monto: Number(row.monto || 0),
    motivo: row.motivo,
  };
}

function appendSearchFilter(filters, params, search) {
  if (!search) {
    return;
  }

  const normalized = `%${search.toLowerCase()}%`;

  filters.push(`
    (
      LOWER(u.nombre) LIKE ?
      OR LOWER(s.motivo) LIKE ?
      OR LOWER(s.detalle) LIKE ?
      OR LOWER(
        CONCAT(
          COALESCE(c.torre, ''),
          CASE WHEN c.torre IS NOT NULL AND c.torre <> '' THEN '-' ELSE '' END,
          c.numero
        )
      ) LIKE ?
    )
  `);
  params.push(normalized, normalized, normalized, normalized);
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

async function getSanctionSummary() {
  const rows = await query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN estado = 'PENDIENTE' THEN 1 ELSE 0 END) AS pendientes,
      SUM(CASE WHEN estado = 'PAGADA' THEN 1 ELSE 0 END) AS pagadas,
      SUM(CASE WHEN estado = 'ANULADA' THEN 1 ELSE 0 END) AS anuladas,
      SUM(CASE WHEN estado = 'PENDIENTE' THEN monto ELSE 0 END) AS monto_pendiente
    FROM SANCION
  `);

  const summary = rows[0] || {};

  return {
    total: Number(summary.total || 0),
    pendientes: Number(summary.pendientes || 0),
    pagadas: Number(summary.pagadas || 0),
    anuladas: Number(summary.anuladas || 0),
    monto_pendiente: Number(summary.monto_pendiente || 0),
  };
}

async function listSanctionRules() {
  return [
    {
      codigo: OVERDUE_FEE_RULE.codigo,
      nombre: OVERDUE_FEE_RULE.nombre,
      descripcion: OVERDUE_FEE_RULE.descripcion,
      condicion: "fecha_limite < fecha actual y total pagado < monto de cuota",
      sancion: `Q${OVERDUE_FEE_RULE.monto_base} minimo o ${OVERDUE_FEE_RULE.porcentaje}% de la cuota vencida`,
      activa: true,
    },
  ];
}

async function syncGeneratedSanctionHistory(userId) {
  await query(
    `
      INSERT INTO SANCION_HISTORIAL (
        id_sancion,
        accion,
        estado_anterior,
        estado_nuevo,
        detalle,
        realizado_por
      )
      SELECT
        s.id_sancion,
        'GENERACION_AUTOMATICA',
        NULL,
        s.estado,
        CONCAT('Sancion generada por regla ', s.codigo_regla, '.'),
        ?
      FROM SANCION s
      LEFT JOIN SANCION_HISTORIAL h
        ON h.id_sancion = s.id_sancion
        AND h.accion = 'GENERACION_AUTOMATICA'
      WHERE s.codigo_regla = ?
        AND h.id_historial IS NULL
    `,
    [userId, OVERDUE_FEE_RULE.codigo],
  );
}

async function applyAutomaticSanctions(userId) {
  const currentDate = getCurrentDateInTimezone();
  const result = await query(
    `
      INSERT IGNORE INTO SANCION (
        id_casa,
        id_cuota,
        codigo_regla,
        motivo,
        detalle,
        monto,
        estado,
        generada_automaticamente,
        fecha_incumplimiento,
        creado_por
      )
      SELECT
        cu.id_casa,
        cu.id_cuota,
        ?,
        ?,
        CONCAT(
          'La cuota de ', srv.nombre,
          ' por Q', FORMAT(cu.monto, 2),
          ' vencio el ', DATE_FORMAT(cu.fecha_limite, '%Y-%m-%d'),
          ' y no registra pago completo.'
        ),
        GREATEST(?, ROUND(cu.monto * (? / 100), 2)),
        'PENDIENTE',
        TRUE,
        cu.fecha_limite,
        ?
      FROM (${QUOTA_BALANCES_SQL}) cu
      INNER JOIN SERVICIO srv
        ON srv.id_servicio = cu.id_servicio
      WHERE cu.fecha_limite < ?
        AND cu.capital_pendiente > 0
        AND cu.sobrepago = 0 AND cu.reembolso_inconsistente = 0
    `,
    [
      OVERDUE_FEE_RULE.codigo,
      OVERDUE_FEE_RULE.nombre,
      OVERDUE_FEE_RULE.monto_base,
      OVERDUE_FEE_RULE.porcentaje,
      userId,
      currentDate,
    ],
  );
  await syncGeneratedSanctionHistory(userId);

  return {
    generadas: Number(result.affectedRows || 0),
    fecha_revision: currentDate,
  };
}

async function listSanctions(filters = {}) {
  const search = normalizeString(filters.search).toLowerCase();
  const house = normalizeString(filters.house).toLowerCase();
  const status = normalizeSanctionStatus(filters.status);
  const sqlFilters = [];
  const params = [];

  appendSearchFilter(sqlFilters, params, search);
  appendHouseFilter(sqlFilters, params, house);

  if (status) {
    sqlFilters.push("s.estado = ?");
    params.push(status);
  }

  const whereClause = sqlFilters.length ? `WHERE ${sqlFilters.join(" AND ")}` : "";
  const rows = await query(
    `
      SELECT
        s.id_sancion,
        s.codigo_regla,
        s.motivo,
        s.detalle,
        s.monto,
        s.estado,
        s.generada_automaticamente,
        DATE_FORMAT(s.fecha_incumplimiento, '%Y-%m-%d') AS fecha_incumplimiento,
        DATE_FORMAT(s.fecha_generacion, '%Y-%m-%d %H:%i') AS fecha_generacion,
        c.numero,
        c.torre,
        COALESCE(JSON_UNQUOTE(JSON_EXTRACT(cu.responsable_snapshot,'$.nombre')),u.nombre,'Responsable pendiente de confirmar') AS residente,
        cu.monto AS cuota_monto,
        DATE_FORMAT(cu.fecha_limite, '%Y-%m-%d') AS fecha_limite,
        srv.nombre AS servicio
      FROM SANCION s
      INNER JOIN CASA c
        ON c.id_casa = s.id_casa
      LEFT JOIN CUOTA cu ON cu.id_cuota=s.id_cuota
      LEFT JOIN RESIDENTE r ON r.id_residente=c.id_residente
      LEFT JOIN USUARIO u ON u.id_usuario=cu.id_responsable OR
        (cu.id_responsable IS NULL AND c.relaciones_confirmadas_en IS NULL AND u.id_usuario=r.id_usuario)
      LEFT JOIN SERVICIO srv
        ON srv.id_servicio = cu.id_servicio
      ${whereClause}
      ORDER BY s.fecha_generacion DESC, s.id_sancion DESC
    `,
    params,
  );

  return rows.map(mapSanction);
}

async function listSanctionHistory(filters = {}) {
  const search = normalizeString(filters.search).toLowerCase();
  const house = normalizeString(filters.house).toLowerCase();
  const status = normalizeSanctionStatus(filters.status);
  const sqlFilters = [];
  const params = [];

  appendSearchFilter(sqlFilters, params, search);
  appendHouseFilter(sqlFilters, params, house);

  if (status) {
    sqlFilters.push("h.estado_nuevo = ?");
    params.push(status);
  }

  const whereClause = sqlFilters.length ? `WHERE ${sqlFilters.join(" AND ")}` : "";
  const rows = await query(
    `
      SELECT
        h.id_historial,
        h.id_sancion,
        h.accion,
        h.estado_anterior,
        h.estado_nuevo,
        h.detalle,
        DATE_FORMAT(h.creado_en, '%Y-%m-%d %H:%i') AS creado_en,
        actor.nombre AS realizado_por_nombre,
        s.motivo,
        s.monto,
        c.numero,
        c.torre,
        COALESCE(JSON_UNQUOTE(JSON_EXTRACT(cu.responsable_snapshot,'$.nombre')),u.nombre,'Responsable pendiente de confirmar') AS residente
      FROM SANCION_HISTORIAL h
      INNER JOIN SANCION s
        ON s.id_sancion = h.id_sancion
      INNER JOIN CASA c
        ON c.id_casa = s.id_casa
      LEFT JOIN CUOTA cu ON cu.id_cuota=s.id_cuota
      LEFT JOIN RESIDENTE r ON r.id_residente=c.id_residente
      LEFT JOIN USUARIO u ON u.id_usuario=cu.id_responsable OR
        (cu.id_responsable IS NULL AND c.relaciones_confirmadas_en IS NULL AND u.id_usuario=r.id_usuario)
      LEFT JOIN USUARIO actor
        ON actor.id_usuario = h.realizado_por
      ${whereClause}
      ORDER BY h.creado_en DESC, h.id_historial DESC
      LIMIT 100
    `,
    params,
  );

  return rows.map(mapSanctionHistory);
}

async function updateSanctionStatus(id, status, userId = null) {
  const sanctionId = Number(id);
  const normalizedStatus = normalizeSanctionStatus(status);

  if (!Number.isInteger(sanctionId) || sanctionId <= 0) {
    const error = new Error("La sancion solicitada es invalida.");
    error.status = 400;
    throw error;
  }

  if (!normalizedStatus) {
    const error = new Error("Selecciona un estado valido para la sancion.");
    error.status = 400;
    throw error;
  }

  const currentRows = await query(
    `
      SELECT estado
      FROM SANCION
      WHERE id_sancion = ?
      LIMIT 1
    `,
    [sanctionId],
  );

  if (currentRows.length === 0) {
    const error = new Error("No se encontro la sancion solicitada.");
    error.status = 404;
    throw error;
  }

  const previousStatus = currentRows[0].estado;

  const result = await query(
    `
      UPDATE SANCION
      SET estado = ?
      WHERE id_sancion = ?
    `,
    [normalizedStatus, sanctionId],
  );

  if (Number(result.affectedRows || 0) === 0) {
    const error = new Error("No se encontro la sancion solicitada.");
    error.status = 404;
    throw error;
  }

  if (previousStatus !== normalizedStatus) {
    await query(
      `
        INSERT INTO SANCION_HISTORIAL (
          id_sancion,
          accion,
          estado_anterior,
          estado_nuevo,
          detalle,
          realizado_por
        )
        VALUES (?, 'CAMBIO_ESTADO', ?, ?, ?, ?)
      `,
      [
        sanctionId,
        previousStatus,
        normalizedStatus,
        `Estado actualizado de ${previousStatus} a ${normalizedStatus}.`,
        userId,
      ],
    );
  }

  const rows = await listSanctions({});
  return rows.find((sanction) => sanction.id_sancion === sanctionId) || null;
}

module.exports = {
  getSanctionSummary,
  listSanctionRules,
  applyAutomaticSanctions,
  listSanctions,
  listSanctionHistory,
  updateSanctionStatus,
  __private__: {
    buildHouseLabel,
    calculateSanctionAmount,
    mapSanction,
    normalizeSanctionStatus,
  },
};
