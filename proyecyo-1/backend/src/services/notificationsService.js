const { query } = require("../database/mysql");
// Recheck financial visibility when reading already delivered notifications.
// Personal payment events remain available to their historical actor.
const FINANCIAL_VISIBILITY_SQL = `AND (
  (e.id_cuota IS NULL AND NOT EXISTS(SELECT 1 FROM RECORDATORIO_PAGO rp WHERE rp.id_notificacion=n.id_notificacion))
  OR EXISTS(SELECT 1 FROM CUOTA fq JOIN CASA fc ON fc.id_casa=fq.id_casa
    LEFT JOIN RESIDENTE fr ON fr.id_residente=fc.id_residente
    WHERE fq.id_cuota=COALESCE(e.id_cuota,(SELECT rp.id_cuota FROM RECORDATORIO_PAGO rp WHERE rp.id_notificacion=n.id_notificacion LIMIT 1))
      AND (fq.id_responsable=n.id_usuario OR (fq.id_responsable IS NULL AND fc.relaciones_confirmadas_en IS NULL AND fr.id_usuario=n.id_usuario)))
  OR (e.id_pago IS NOT NULL AND EXISTS(SELECT 1 FROM PAGO fp LEFT JOIN TRANSACCION_RECURRENTE ft ON ft.id_pago=fp.id_pago
    WHERE fp.id_pago=e.id_pago AND (fp.id_actor=n.id_usuario OR ft.id_usuario=n.id_usuario)))
)`;

function normalizeNotification(row) {
  return {
    id_notificacion: row.id_notificacion,
    id_usuario: row.id_usuario,
    id_acceso: row.id_acceso,
    tipo: row.tipo,
    titulo: row.titulo,
    mensaje: row.mensaje,
    accion_codigo: ['ESTADO_CUENTA','COMPROBANTE_PAGO'].includes(row.accion_codigo) ? row.accion_codigo : null,
    id_pago: row.id_pago || null,
    leido: Boolean(row.leido),
    creado_en: row.creado_en,
    leido_en: row.leido_en || null,
    visitante: row.visitante || null,
    casa: row.casa || null,
  };
}

// Columnas y joins compartidos por el listado reciente y el paginado; siempre
// se filtra por n.id_usuario del usuario autenticado.
const NOTIFICATION_SELECT = `
      SELECT
        n.id_notificacion,
        n.id_usuario,
        n.id_acceso,
        n.tipo,
        n.titulo,
        n.mensaje,
        e.accion_codigo,e.id_pago,
        n.leido,
        DATE_FORMAT(n.creado_en, '%Y-%m-%d %H:%i:%s') AS creado_en,
        DATE_FORMAT(n.leido_en, '%Y-%m-%d %H:%i:%s') AS leido_en,
        v.nombre AS visitante,
        CONCAT(
          COALESCE(c.torre, ''),
          CASE WHEN c.torre IS NOT NULL AND c.torre <> '' THEN '-' ELSE '' END,
          c.numero
        ) AS casa
      FROM NOTIFICACION n
      LEFT JOIN ENTREGA_NOTIFICACION_FINANCIERA e ON e.id_notificacion=n.id_notificacion AND e.id_usuario=n.id_usuario
      LEFT JOIN ACCESO a ON a.id_acceso = n.id_acceso
      LEFT JOIN VISITANTE v ON v.id_visitante = a.id_visitante
      LEFT JOIN CASA c ON c.id_casa = a.id_casa`;

/** Ultimas 20 notificaciones (vista previa del dashboard y alertas de garita). */
async function listNotifications(userId) {
  const rows = await query(
    `${NOTIFICATION_SELECT}
      WHERE n.id_usuario = ?
      ${FINANCIAL_VISIBILITY_SQL}
      ORDER BY n.creado_en DESC, n.id_notificacion DESC
      LIMIT 20
    `,
    [userId],
  );

  return rows.map(normalizeNotification);
}

const PAGE_FILTERS = {
  TODOS: "",
  SIN_LEER: " AND n.leido = FALSE",
  COMUNICADOS: " AND n.tipo = 'COMUNICADO'",
  OTROS: " AND n.tipo <> 'COMUNICADO'",
};
const CURSOR_PATTERN = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\|(\d+)$/;

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

/**
 * Pagina estable (keyset) de notificaciones del usuario autenticado.
 * Orden determinista: creado_en DESC, id_notificacion DESC. El cursor es
 * "YYYY-MM-DD HH:mm:ss|id" de la ultima fila recibida.
 */
async function listNotificationsPage(userId, options = {}) {
  const filter = String(options.filtro || "TODOS").toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(PAGE_FILTERS, filter)) throw badRequest("El filtro de avisos es invalido.");
  const requestedLimit = options.limit === undefined || options.limit === "" ? 20 : Number(options.limit);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 50) throw badRequest("El limite debe estar entre 1 y 50.");

  const params = [userId];
  let cursorSql = "";
  if (options.cursor) {
    const match = CURSOR_PATTERN.exec(String(options.cursor));
    if (!match) throw badRequest("El cursor de avisos es invalido.");
    cursorSql = " AND (n.creado_en < ? OR (n.creado_en = ? AND n.id_notificacion < ?))";
    params.push(match[1], match[1], Number(match[2]));
  }

  // Se pide una fila extra para saber si existe otra pagina sin contar toda la tabla.
  const rows = await query(
    `${NOTIFICATION_SELECT}
      WHERE n.id_usuario = ?${PAGE_FILTERS[filter]}${cursorSql} ${FINANCIAL_VISIBILITY_SQL}
      ORDER BY n.creado_en DESC, n.id_notificacion DESC
      LIMIT ${requestedLimit + 1}
    `,
    params,
  );

  const items = rows.slice(0, requestedLimit).map(normalizeNotification);
  const last = items[items.length - 1];
  return {
    items,
    next_cursor: rows.length > requestedLimit && last ? `${last.creado_en}|${last.id_notificacion}` : null,
  };
}

async function countUnreadNotifications(userId) {
  const rows = await query(
    `
      SELECT COUNT(*) AS total
      FROM NOTIFICACION n
      LEFT JOIN ENTREGA_NOTIFICACION_FINANCIERA e ON e.id_notificacion=n.id_notificacion AND e.id_usuario=n.id_usuario
      WHERE n.id_usuario = ? AND n.leido = FALSE ${FINANCIAL_VISIBILITY_SQL}
    `,
    [userId],
  );

  return Number(rows[0]?.total || 0);
}

async function markNotificationAsRead(userId, notificationId) {
  const normalizedId = Number(notificationId);

  if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
    const error = new Error("La notificacion es invalida.");
    error.status = 400;
    throw error;
  }

  await query(
    `
      UPDATE NOTIFICACION
      SET leido = TRUE,
          leido_en = COALESCE(leido_en, NOW())
      WHERE id_notificacion = ? AND id_usuario = ?
    `,
    [normalizedId, userId],
  );

  const rows = await query(
    `
      SELECT
        n.id_notificacion,
        n.id_usuario,
        n.id_acceso,
        n.tipo,
        n.titulo,
        n.mensaje,
        e.accion_codigo,e.id_pago,
        n.leido,
        DATE_FORMAT(n.creado_en, '%Y-%m-%d %H:%i:%s') AS creado_en,
        DATE_FORMAT(n.leido_en, '%Y-%m-%d %H:%i:%s') AS leido_en,
        v.nombre AS visitante,
        CONCAT(
          COALESCE(c.torre, ''),
          CASE WHEN c.torre IS NOT NULL AND c.torre <> '' THEN '-' ELSE '' END,
          c.numero
        ) AS casa
      FROM NOTIFICACION n
      LEFT JOIN ENTREGA_NOTIFICACION_FINANCIERA e ON e.id_notificacion=n.id_notificacion AND e.id_usuario=n.id_usuario
      LEFT JOIN ACCESO a ON a.id_acceso = n.id_acceso
      LEFT JOIN VISITANTE v ON v.id_visitante = a.id_visitante
      LEFT JOIN CASA c ON c.id_casa = a.id_casa
      WHERE n.id_notificacion = ? AND n.id_usuario = ?
      ${FINANCIAL_VISIBILITY_SQL}
      LIMIT 1
    `,
    [normalizedId, userId],
  );

  if (!rows[0]) {
    const error = new Error("Notificacion no encontrada.");
    error.status = 404;
    throw error;
  }

  return normalizeNotification(rows[0]);
}

async function markAllNotificationsAsRead(userId) {
  await query(
    `
      UPDATE NOTIFICACION
      SET leido = TRUE,
          leido_en = COALESCE(leido_en, NOW())
      WHERE id_usuario = ? AND leido = FALSE
    `,
    [userId],
  );

  return { unread: await countUnreadNotifications(userId) };
}

module.exports = {
  listNotifications,
  listNotificationsPage,
  countUnreadNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
};
