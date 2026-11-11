const { env } = require("../config/env");
const { query } = require("../database/mysql");
const { sendEmail, renderEmailLayout, isEmailConfigured, currentBrand } = require("./emailService");
const { logger } = require("../utils/safeLogger");

// Despachador de correos de notificaciones.
//
// Cada fila nueva de NOTIFICACION nace con correo_estado = 'PENDIENTE' (sin importar
// que modulo la cree: visitas, pagos, comunicados, reservas, sanciones...). Este
// proceso las toma por lotes, envia la copia al correo del usuario y la marca:
//   ENVIADO  -> se entrego al servidor de correo
//   OMITIDO  -> usuario inactivo, sin correo, o notificacion demasiado antigua
//   FALLIDO  -> agoto los reintentos
// Si el correo falla, la notificacion dentro de la app no se ve afectada.

const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 5;
const MAX_AGE_HOURS = 24; // no enviar avisos viejos acumulados (p. ej. antes de configurar Gmail)
const LEASE_MINUTES = 10; // si el proceso se cae a mitad de envio, la fila se libera

const ROLE_PATHS = {
  residente: "/residente/notificaciones",
  inquilino: "/inquilino/notificaciones",
  guardia: "/guardia/alertas",
  admin: "/admin",
};

const TYPE_LABELS = {
  LLEGADA_VISITA: { tag: "Visitas", button: "Ver mis visitas", paths: { residente: "/residente/visitas", inquilino: "/inquilino/visitas" } },
  SALIDA_VISITA: { tag: "Visitas", button: "Ver mis visitas", paths: { residente: "/residente/visitas", inquilino: "/inquilino/visitas" } },
  ACCESO_CANCELADO: { tag: "Garita", button: "Ver alertas" },
  ACCESO_ESPECIAL: { tag: "Garita", button: "Ver alertas" },
  COMUNICADO: { tag: "Comunicado", button: "Leer en NexusResidencial", paths: { residente: "/residente/comunicados", inquilino: "/inquilino/comunicados" } },
  RESERVA_CANCELADA: { tag: "Reservas", button: "Ver mis reservas", paths: { residente: "/residente/amenidades", inquilino: "/inquilino/reservas" } },
  RECORDATORIO_RESERVA: { tag: "Reservas", button: "Ver mis reservas", paths: { residente: "/residente/amenidades", inquilino: "/inquilino/reservas" } },
  ACCESO_EMERGENCIA: { tag: "Emergencia", button: "Revisar solicitud", paths: { admin: "/admin/accesos-especiales", residente: "/residente/visitas", inquilino: "/inquilino/visitas" } },
  TICKET: { tag: "Mantenimiento", button: "Ver el reporte", paths: { admin: "/admin/fallas", residente: "/residente/fallas", inquilino: "/inquilino/fallas" } },
  SOLICITUD_AUTORIZACION: { tag: "Solicitudes", button: "Ver solicitud", paths: { inquilino: "/inquilino/permisos" } },
};

function frontendBase() {
  return String(env.FRONTEND_ORIGIN || "").split(",")[0].trim().replace(/\/$/, "");
}

function describe(notification) {
  const role = String(notification.rol || "").toLowerCase();
  const tipo = String(notification.tipo || "").toUpperCase();
  const known = TYPE_LABELS[tipo];
  // Avisos financieros (recordatorios de pago, cuotas por vencer o vencidas, recargos...).
  const financial = !known && /PAGO|CUOTA|MORA|RECARGO|VENC|SALDO|COBRO|REEMBOLSO/.test(tipo);
  const tag = known ? known.tag : financial ? "Pagos" : "Aviso";
  const financialPath = role === "inquilino" ? "/inquilino/estado-cuenta" : "/residente/pagos";
  const path = (known && known.paths && known.paths[role]) || (financial ? financialPath : null) || ROLE_PATHS[role] || "/login";
  const button = known ? known.button : financial ? "Ver mi estado de cuenta" : "Abrir NexusResidencial";
  return { tag, path, button };
}

function buildNotificationEmail(notification, brand = null) {
  const { tag, path, button } = describe(notification);
  const url = `${frontendBase()}${path}`;
  const greeting = `Hola${notification.nombre ? ` ${notification.nombre}` : ""},`;
  const subject = `[${tag}] ${notification.titulo}`.slice(0, 200);
  return {
    subject,
    text: `${greeting}\n\n${notification.titulo}\n${notification.mensaje}\n\nAbrir NexusResidencial: ${url}`,
    html: renderEmailLayout({ heading: notification.titulo, greeting, paragraphs: [notification.mensaje], buttonText: button, buttonUrl: url, brand }),
  };
}

function createNotificationEmailDispatcher({ db = query, send = sendEmail, configured = isEmailConfigured, log = logger, brandOf = currentBrand } = {}) {
  let running = false;

  async function claim(id) {
    const result = await db(
      `UPDATE NOTIFICACION SET correo_estado = 'ENVIANDO', correo_proximo_intento = DATE_ADD(NOW(), INTERVAL ${LEASE_MINUTES} MINUTE)
       WHERE id_notificacion = ? AND correo_estado = 'PENDIENTE'`,
      [id],
    );
    return Number(result && result.affectedRows) === 1;
  }

  async function processBatch() {
    if (running || !configured()) return { sent: 0, failed: 0, skipped: 0 };
    running = true;
    const stats = { sent: 0, failed: 0, skipped: 0 };
    try {
      // Libera envios que quedaron a medias y descarta avisos demasiado antiguos.
      await db(`UPDATE NOTIFICACION SET correo_estado = 'PENDIENTE' WHERE correo_estado = 'ENVIANDO' AND correo_proximo_intento <= NOW()`);
      await db(
        `UPDATE NOTIFICACION SET correo_estado = 'OMITIDO', correo_error = 'ANTIGUA'
         WHERE correo_estado = 'PENDIENTE' AND creado_en < DATE_SUB(NOW(), INTERVAL ${MAX_AGE_HOURS} HOUR)`,
      );

      const rows = await db(
        `SELECT n.id_notificacion, n.tipo, n.titulo, n.mensaje, n.correo_intentos,
                u.nombre, u.correo, u.activo, tu.nombre AS rol
         FROM NOTIFICACION n
         INNER JOIN USUARIO u ON u.id_usuario = n.id_usuario
         LEFT JOIN TIPO_USUARIO tu ON tu.id_tipo_usuario = u.id_tipo_usuario
         WHERE n.correo_estado = 'PENDIENTE' AND (n.correo_proximo_intento IS NULL OR n.correo_proximo_intento <= NOW())
         ORDER BY n.id_notificacion
         LIMIT ${BATCH_SIZE}`,
      );

      for (const row of rows) {
        if (!row.activo || !row.correo) {
          await db(`UPDATE NOTIFICACION SET correo_estado = 'OMITIDO', correo_error = ? WHERE id_notificacion = ? AND correo_estado = 'PENDIENTE'`,
            [row.activo ? "SIN_CORREO" : "USUARIO_INACTIVO", row.id_notificacion]);
          stats.skipped += 1;
          continue;
        }
        if (!(await claim(row.id_notificacion))) continue;
        try {
          const email = buildNotificationEmail(row, await brandOf());
          const result = await send({ to: row.correo, ...email });
          if (result && result.delivered === false) throw new Error(result.reason || "NO_ENTREGADO");
          await db(`UPDATE NOTIFICACION SET correo_estado = 'ENVIADO', correo_enviado_en = NOW(), correo_intentos = correo_intentos + 1,
                    correo_error = NULL, correo_proximo_intento = NULL WHERE id_notificacion = ?`, [row.id_notificacion]);
          stats.sent += 1;
        } catch (error) {
          const attempts = Number(row.correo_intentos || 0) + 1;
          const finalFailure = attempts >= MAX_ATTEMPTS;
          await db(
            `UPDATE NOTIFICACION SET correo_estado = ?, correo_intentos = ?, correo_error = ?,
             correo_proximo_intento = ${finalFailure ? "NULL" : "DATE_ADD(NOW(), INTERVAL ? MINUTE)"} WHERE id_notificacion = ?`,
            finalFailure
              ? ["FALLIDO", attempts, String(error.code || error.message || "ERROR").slice(0, 160), row.id_notificacion]
              : ["PENDIENTE", attempts, String(error.code || error.message || "ERROR").slice(0, 160), attempts * attempts, row.id_notificacion],
          );
          stats.failed += 1;
          log.error(`No se pudo enviar el correo de la notificacion ${row.id_notificacion} (intento ${attempts}).`, error);
        }
      }
    } finally {
      running = false;
    }
    return stats;
  }

  return { processBatch };
}

let timer = null;

function startNotificationEmailScheduler() {
  if (timer || env.NODE_ENV === "test") return null;
  if (!env.EMAIL_NOTIFICATIONS_ENABLED) {
    console.log("Correos de notificaciones desactivados (EMAIL_NOTIFICATIONS_ENABLED=false).");
    return null;
  }
  if (!isEmailConfigured()) {
    console.warn("Correos de notificaciones inactivos: configure SMTP_USER y SMTP_PASS (clave de aplicacion de Gmail).");
    return null;
  }
  const dispatcher = createNotificationEmailDispatcher();
  const tick = () => dispatcher.processBatch().catch((error) => logger.error("Fallo el despachador de correos de notificaciones.", error));
  timer = setInterval(tick, Math.max(5000, env.EMAIL_NOTIFICATIONS_INTERVAL_MS));
  if (typeof timer.unref === "function") timer.unref();
  setTimeout(tick, 3000);
  console.log(`Correos de notificaciones activos (cada ${Math.round(Math.max(5000, env.EMAIL_NOTIFICATIONS_INTERVAL_MS) / 1000)} s).`);
  return timer;
}

module.exports = { createNotificationEmailDispatcher, buildNotificationEmail, startNotificationEmailScheduler, MAX_ATTEMPTS };
