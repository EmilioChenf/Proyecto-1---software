const { pool, query } = require("../database/mysql");
const { logger } = require("../utils/safeLogger");

// Alertas automáticas de visitas (revisión cada minuto, hora de Guatemala):
// 1) QR expirado sin usar: la visita autorizada llegó a su hora de fin y nunca ingresó.
//    Se avisa a quien la autorizó (campana, push y correo) para que cree otra si aún la necesita.
// 2) Salida pendiente: la visita ingresó y ya pasó su hora de fin sin registrar salida.
//    Se avisa a los guardias y a quien la autorizó.
// Cada aviso se envía una sola vez (columnas aviso_qr_expirado_en y alerta_salida_pendiente_en).
const TIMEZONE = "America/Guatemala";
const INTERVAL_MS = 60 * 1000;

function guatemalaNow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(now).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  const yesterday = new Date(now.getTime() - 86400000);
  const y = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(yesterday).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour.replace(/^24/, "00")}:${parts.minute}:${parts.second}`, yesterday: `${y.year}-${y.month}-${y.day}` };
}

const hhmm = (time) => String(time || "").slice(0, 5);

async function notify(connection, userId, idAcceso, tipo, titulo, mensaje) {
  await connection.execute(
    "INSERT INTO NOTIFICACION (id_usuario, id_acceso, tipo, titulo, mensaje, leido) VALUES (?, ?, ?, ?, ?, FALSE)",
    [userId, idAcceso, tipo, titulo.slice(0, 150), mensaje.slice(0, 255)],
  );
}

// Toma la visita solo si nadie más la avisó (evita duplicados entre réplicas o ejecuciones simultáneas).
async function claim(connection, column, idAcceso, expectedState) {
  const [result] = await connection.execute(
    `UPDATE ACCESO SET ${column} = UTC_TIMESTAMP() WHERE id_acceso = ? AND ${column} IS NULL AND estado_acceso = ?`,
    [idAcceso, expectedState],
  );
  return result.affectedRows === 1;
}

async function processVisitAlerts({ now = new Date() } = {}) {
  const gt = guatemalaNow(now);
  const stats = { qr_expirados: 0, salidas_pendientes: 0 };
  // Solo visitas de hoy y ayer: las antiguas no deben disparar avisos.
  const pastEnd = `(a.fecha < ? OR (a.fecha = ? AND a.hora_fin < ?)) AND a.fecha >= ?`;
  const params = [gt.date, gt.date, gt.time, gt.yesterday];

  const expired = await query(
    `SELECT a.id_acceso, a.id_usuario_autoriza, a.fecha, a.hora_inicio, a.hora_fin, v.nombre
       FROM ACCESO a JOIN VISITANTE v ON v.id_visitante = a.id_visitante
      WHERE a.estado_acceso = 'AUTORIZADA' AND a.aviso_qr_expirado_en IS NULL
        AND a.cancelado_en IS NULL AND a.eliminado_en IS NULL AND ${pastEnd}
      ORDER BY a.id_acceso LIMIT 100`,
    params,
  );
  for (const visit of expired) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      if (await claim(connection, "aviso_qr_expirado_en", visit.id_acceso, "AUTORIZADA") && visit.id_usuario_autoriza) {
        await notify(connection, visit.id_usuario_autoriza, visit.id_acceso, "QR_EXPIRADO",
          `El QR de ${visit.nombre} expiró`,
          `La visita era hasta las ${hhmm(visit.hora_fin)} y no ingresó. Por seguridad el código ya no funciona: si aún viene, crea una nueva autorización.`);
        stats.qr_expirados += 1;
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      logger.error("No se pudo avisar un QR expirado.", { id_acceso: visit.id_acceso, code: error.code || null });
    } finally {
      connection.release();
    }
  }

  const overdue = await query(
    `SELECT a.id_acceso, a.id_usuario_autoriza, a.hora_fin, v.nombre, v.placa,
            CONCAT(COALESCE(CONCAT(c.torre, '-'), ''), c.numero) casa
       FROM ACCESO a JOIN VISITANTE v ON v.id_visitante = a.id_visitante JOIN CASA c ON c.id_casa = a.id_casa
      WHERE a.estado_acceso = 'INGRESO_REGISTRADO' AND a.alerta_salida_pendiente_en IS NULL
        AND a.eliminado_en IS NULL AND ${pastEnd}
      ORDER BY a.id_acceso LIMIT 100`,
    params,
  );
  if (overdue.length) {
    const guards = await query(
      "SELECT u.id_usuario FROM USUARIO u JOIN TIPO_USUARIO t ON t.id_tipo_usuario = u.id_tipo_usuario WHERE t.nombre = 'guardia' AND u.activo = 1",
    );
    for (const visit of overdue) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        if (await claim(connection, "alerta_salida_pendiente_en", visit.id_acceso, "INGRESO_REGISTRADO")) {
          const detail = `${visit.nombre}${visit.placa ? ` (placa ${visit.placa})` : ""} · casa ${visit.casa}`;
          for (const guard of guards) {
            await notify(connection, guard.id_usuario, visit.id_acceso, "SALIDA_PENDIENTE",
              "Visita sin salida registrada",
              `${detail}: su autorización terminó a las ${hhmm(visit.hora_fin)} y sigue dentro. Verifica y registra su salida.`);
          }
          if (visit.id_usuario_autoriza) {
            await notify(connection, visit.id_usuario_autoriza, visit.id_acceso, "SALIDA_PENDIENTE",
              `${visit.nombre} sigue dentro del residencial`,
              `Su visita era hasta las ${hhmm(visit.hora_fin)} y aún no registra salida en garita. Si ya se fue, avisa al guardia.`);
          }
          stats.salidas_pendientes += 1;
        }
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        logger.error("No se pudo avisar una salida pendiente.", { id_acceso: visit.id_acceso, code: error.code || null });
      } finally {
        connection.release();
      }
    }
  }
  return stats;
}

let timer = null;
function startVisitAlertsScheduler() {
  if (timer) return timer;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await processVisitAlerts(); } catch (error) { logger.error("Falló la revisión de alertas de visitas.", { code: error.code || null }); } finally { running = false; }
  };
  void run();
  timer = setInterval(run, INTERVAL_MS);
  timer.unref?.();
  return timer;
}

module.exports = { processVisitAlerts, startVisitAlertsScheduler, guatemalaNow };
