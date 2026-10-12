const { pool, query } = require("../database/mysql");
const { logger } = require("../utils/safeLogger");

const RESIDENTIAL_TIMEZONE = "America/Guatemala";
const REMINDER_TYPES = ["PROXIMO_VENCIMIENTO", "VENCIDO"];
const RESERVATION_NOTIFICATION_TYPE = "RECORDATORIO_RESERVA";
const RESERVATION_REMINDER_MINUTES = 60;

const CONFIG_KEYS = {
  activo: "recordatorios_activo",
  dias_antes: "recordatorios_dias_antes",
};

const DEFAULT_CONFIG = {
  activo: true,
  dias_antes: 3,
};
const REMINDER_INTERVAL_MS = 5 * 60 * 1000;
let reminderScheduler = null;
let schedulerRunInProgress = false;

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
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function normalizeReminderType(value) {
  const normalized = normalizeString(value).toUpperCase();

  if (!normalized || normalized === "TODOS") {
    return null;
  }

  if (!REMINDER_TYPES.includes(normalized)) {
    const error = new Error("El tipo de recordatorio es invalido.");
    error.status = 400;
    throw error;
  }

  return normalized;
}

function normalizeDaysBefore(value) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 60) {
    const error = new Error("Los dias de anticipacion deben estar entre 0 y 60.");
    error.status = 400;
    throw error;
  }

  return parsed;
}

function buildHouseLabel(row) {
  const tower = normalizeString(row.torre);
  const number = normalizeString(row.numero);

  return tower ? `${tower}-${number}` : number;
}

function formatCurrency(amount) {
  return new Intl.NumberFormat("es-GT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount || 0));
}

function buildReminderTemplate({ tipo, servicio, monto, fecha_limite, dias_para_vencer }) {
  const montoTexto = `Q${formatCurrency(monto)}`;
  const servicioTexto = servicio ? ` de ${servicio}` : "";

  if (tipo === "VENCIDO") {
    const diasVencida = Math.abs(Number(dias_para_vencer || 0));
    const plural = diasVencida === 1 ? "dia" : "dias";

    return {
      titulo: "Pago vencido pendiente",
      mensaje: `Su cuota${servicioTexto} por ${montoTexto} vencio el ${fecha_limite} (hace ${diasVencida} ${plural}). Consulte su saldo actual en el estado de cuenta.`,
    };
  }

  const dias = Number(dias_para_vencer || 0);
  const cuando = dias <= 0 ? "vence hoy" : dias === 1 ? "vence manana" : `vence en ${dias} dias`;

  return {
    titulo: "Recordatorio de pago proximo",
    mensaje: `Su cuota${servicioTexto} por ${montoTexto} ${cuando} (${fecha_limite}). Realice su pago a tiempo para mantenerse al dia.`,
  };
}

function mapReminder(row) {
  return {
    id_recordatorio: Number(row.id_recordatorio),
    casa_unidad: buildHouseLabel(row),
    residente: row.residente,
    correo: row.correo || null,
    tipo: row.tipo,
    titulo: row.titulo,
    mensaje: row.mensaje,
    monto: Number(row.monto || 0),
    fecha_limite: row.fecha_limite,
    dias_para_vencer: Number(row.dias_para_vencer || 0),
    servicio: row.servicio || null,
    enviado_en: row.enviado_en,
  };
}

async function getReminderConfig() {
  const rows = await query("SELECT clave, valor FROM CONFIGURACION WHERE clave IN (?, ?)", [
    CONFIG_KEYS.activo,
    CONFIG_KEYS.dias_antes,
  ]);
  const map = Object.fromEntries(rows.map((row) => [row.clave, row.valor]));

  return {
    activo: map[CONFIG_KEYS.activo] == null ? DEFAULT_CONFIG.activo : map[CONFIG_KEYS.activo] === "true",
    dias_antes:
      map[CONFIG_KEYS.dias_antes] == null
        ? DEFAULT_CONFIG.dias_antes
        : normalizeDaysBefore(map[CONFIG_KEYS.dias_antes]),
  };
}

async function saveReminderConfig(payload = {}) {
  const activo = Boolean(payload.activo);
  const diasAntes = normalizeDaysBefore(payload.dias_antes);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await connection.execute(
      "INSERT INTO CONFIGURACION (clave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)",
      [CONFIG_KEYS.activo, activo ? "true" : "false"],
    );
    await connection.execute(
      "INSERT INTO CONFIGURACION (clave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)",
      [CONFIG_KEYS.dias_antes, String(diasAntes)],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return { activo, dias_antes: diasAntes };
}

async function sendPaymentReminders(userId) {
  const { createFinancialNotificationsService } = require('./financialNotificationsService');
  const service = createFinancialNotificationsService();
  const generated = await service.generateDeadlines();
  const delivered = await service.consume();
  return { enviados: delivered.recordatorios, errores: delivered.errores, fecha_revision: generated.fecha_revision, activo: generated.activo };
}

const REMINDER_HISTORY_SQL = `SELECT id_recordatorio,id_casa,id_cuota,id_usuario,tipo,titulo,mensaje,monto,
  fecha_limite,dias_para_vencer,fecha_envio,enviado_en FROM RECORDATORIO_PAGO
  UNION ALL SELECT -e.id_entrega,q.id_casa,e.id_cuota,e.id_usuario,
    IF(e.tipo_evento='CUOTA_VENCIDA','VENCIDO','PROXIMO_VENCIMIENTO'),e.titulo,e.mensaje,
    CAST(e.monto_centavos/100 AS DECIMAL(20,2)),e.fecha_vencimiento,
    DATEDIFF(e.fecha_vencimiento,e.fecha_entrega),e.fecha_entrega,e.entregado_en
  FROM ENTREGA_NOTIFICACION_FINANCIERA e JOIN CUOTA q ON q.id_cuota=e.id_cuota
  WHERE e.estado='ENTREGADA' AND e.tipo_evento IN ('CUOTA_PROXIMA','CUOTA_HOY','CUOTA_VENCIDA')`;

async function getReminderSummary() {
  const rows = await query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN tipo = 'PROXIMO_VENCIMIENTO' THEN 1 ELSE 0 END) AS proximos,
      SUM(CASE WHEN tipo = 'VENCIDO' THEN 1 ELSE 0 END) AS vencidos,
      SUM(CASE WHEN fecha_envio = ? THEN 1 ELSE 0 END) AS enviados_hoy
    FROM (${REMINDER_HISTORY_SQL}) rp
  `, [getCurrentDateInTimezone()]);

  const summary = rows[0] || {};

  return {
    total: Number(summary.total || 0),
    proximos: Number(summary.proximos || 0),
    vencidos: Number(summary.vencidos || 0),
    enviados_hoy: Number(summary.enviados_hoy || 0),
  };
}

async function listReminders(filters = {}) {
  const search = normalizeString(filters.search).toLowerCase();
  const type = normalizeReminderType(filters.type);
  const sqlFilters = [];
  const params = [];

  if (search) {
    const like = `%${search}%`;
    sqlFilters.push(`
      (
        LOWER(u.nombre) LIKE ?
        OR LOWER(
          CONCAT(
            COALESCE(c.torre, ''),
            CASE WHEN c.torre IS NOT NULL AND c.torre <> '' THEN '-' ELSE '' END,
            c.numero
          )
        ) LIKE ?
      )
    `);
    params.push(like, like);
  }

  if (type) {
    sqlFilters.push("rp.tipo = ?");
    params.push(type);
  }

  const whereClause = sqlFilters.length ? `WHERE ${sqlFilters.join(" AND ")}` : "";
  const rows = await query(
    `
      SELECT
        rp.id_recordatorio,
        rp.tipo,
        rp.titulo,
        rp.mensaje,
        rp.monto,
        DATE_FORMAT(rp.fecha_limite, '%Y-%m-%d') AS fecha_limite,
        rp.dias_para_vencer,
        DATE_FORMAT(rp.enviado_en, '%Y-%m-%d %H:%i') AS enviado_en,
        c.numero,
        c.torre,
        u.nombre AS residente,
        u.correo,
        srv.nombre AS servicio
      FROM (${REMINDER_HISTORY_SQL}) rp
      INNER JOIN CASA c ON c.id_casa = rp.id_casa
      INNER JOIN USUARIO u ON u.id_usuario = rp.id_usuario
      LEFT JOIN CUOTA cu ON cu.id_cuota = rp.id_cuota
      LEFT JOIN SERVICIO srv ON srv.id_servicio = cu.id_servicio
      ${whereClause}
      ORDER BY rp.enviado_en DESC, rp.id_recordatorio DESC
      LIMIT 100
    `,
    params,
  );

  return rows.map(mapReminder);
}

async function sendReservationReminders() {
  const currentDate = getCurrentDateInTimezone();
  const reservations = await query(
    `
      SELECT r.id_usuario, r.id_amenidad,
        DATE_FORMAT(r.fecha, '%Y-%m-%d') AS fecha,
        TIME_FORMAT(r.hora_inicio, '%H:%i') AS hora_inicio,
        a.nombre AS amenidad
      FROM RESERVA r
      INNER JOIN AMENIDAD a ON a.id_amenidad = r.id_amenidad AND a.activo = TRUE
      INNER JOIN USUARIO u ON u.id_usuario = r.id_usuario AND u.activo = TRUE
      WHERE COALESCE(r.estado, 'CONFIRMADA') NOT IN ('CANCELADA', 'FINALIZADA')
        AND TIMESTAMP(r.fecha, r.hora_inicio) > NOW()
        AND TIMESTAMP(r.fecha, r.hora_inicio) <= DATE_ADD(NOW(), INTERVAL ? MINUTE)
      ORDER BY r.fecha, r.hora_inicio
    `,
    [RESERVATION_REMINDER_MINUTES],
  );
  let enviados = 0;

  for (const reservation of reservations) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [existing] = await connection.execute(
        `SELECT id_recordatorio FROM RECORDATORIO_RESERVA
         WHERE id_usuario = ? AND id_amenidad = ? AND fecha = ? AND hora_inicio = ? LIMIT 1`,
        [reservation.id_usuario, reservation.id_amenidad, reservation.fecha, reservation.hora_inicio],
      );
      if (existing.length) {
        await connection.rollback();
        continue;
      }
      const titulo = "Tu reserva comienza pronto";
      const mensaje = `Tu reserva de ${reservation.amenidad} comienza el ${reservation.fecha} a las ${reservation.hora_inicio}.`;
      const [notification] = await connection.execute(
        `INSERT INTO NOTIFICACION (id_usuario, id_acceso, tipo, titulo, mensaje, leido)
         VALUES (?, NULL, ?, ?, ?, FALSE)`,
        [reservation.id_usuario, RESERVATION_NOTIFICATION_TYPE, titulo, mensaje],
      );
      await connection.execute(
        `INSERT INTO RECORDATORIO_RESERVA
          (id_usuario, id_amenidad, id_notificacion, fecha, hora_inicio, fecha_envio)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [reservation.id_usuario, reservation.id_amenidad, notification.insertId, reservation.fecha, reservation.hora_inicio, currentDate],
      );
      await connection.commit();
      enviados += 1;
    } catch (error) {
      await connection.rollback();
      if (error?.code !== "ER_DUP_ENTRY") throw error;
    } finally {
      connection.release();
    }
  }
  return { enviados, fecha_revision: currentDate };
}

async function runScheduledReminders() {
  if (schedulerRunInProgress) return;
  schedulerRunInProgress = true;
  try {
    try {
      await require('./contractHouseRelations').syncEffectiveRelations();
      const billing=await require('./monthlyBillingService').generateMonthlyBilling({automatic:true});
      if(billing.fallidas)logger.error('Hay viviendas pendientes de reintento.',{procesadas:billing.procesadas,omitidas:billing.omitidas,fallidas:billing.fallidas,periodo:billing.periodo});
    } catch (error) { logger.error('No fue posible completar la facturación mensual.',error); }
    try {
      const result = await sendPaymentReminders(null);
      if (result.errores) logger.error('Hay entregas financieras pendientes de reintento.');
    } catch (error) {
      logger.error("No fue posible generar recordatorios de pago.", error);
    }
    try {
      await sendReservationReminders();
    } catch (error) {
      logger.error("No fue posible generar recordatorios de reserva.", error);
    }
  }
  finally { schedulerRunInProgress = false; }
}

function startReminderScheduler() {
  if (reminderScheduler) return reminderScheduler;
  void runScheduledReminders();
  reminderScheduler = setInterval(runScheduledReminders, REMINDER_INTERVAL_MS);
  reminderScheduler.unref?.();
  return reminderScheduler;
}

module.exports = {
  getReminderConfig,
  saveReminderConfig,
  sendPaymentReminders,
  sendReservationReminders,
  getReminderSummary,
  listReminders,
  startReminderScheduler,
  __private__: {
    buildHouseLabel,
    buildReminderTemplate,
    mapReminder,
    normalizeReminderType,
    normalizeDaysBefore,
    formatCurrency,
  },
};
