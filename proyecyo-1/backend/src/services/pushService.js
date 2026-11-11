const { query } = require("../database/mysql");
const { logger } = require("../utils/safeLogger");

// Notificaciones push a la app instalada (PWA). Se activan con VAPID_PUBLIC_KEY y
// VAPID_PRIVATE_KEY en las variables del servidor; sin ellas el sistema sigue igual (solo campana y correo).
const BATCH = 50;
const MAX_AGE_HOURS = 24;
let webpush = null;

function pushConfig() {
  const publicKey = String(process.env.VAPID_PUBLIC_KEY || "").trim();
  const privateKey = String(process.env.VAPID_PRIVATE_KEY || "").trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: String(process.env.VAPID_SUBJECT || "mailto:soporte@nexusresidencial.com").trim() };
}

function client() {
  const config = pushConfig();
  if (!config) return null;
  if (!webpush) {
    webpush = require("web-push");
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  }
  return webpush;
}

function validateSubscription(body = {}) {
  const endpoint = String(body.endpoint || "");
  const p256dh = String(body.keys?.p256dh || "");
  const auth = String(body.keys?.auth || "");
  if (!/^https:\/\/\S+$/.test(endpoint) || endpoint.length > 500) throw Object.assign(new Error("Suscripción inválida."), { status: 400 });
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(p256dh) || !/^[A-Za-z0-9_-]{8,100}$/.test(auth)) throw Object.assign(new Error("Suscripción inválida."), { status: 400 });
  return { endpoint, p256dh, auth };
}

async function subscribe(userId, body, userAgent = "") {
  const sub = validateSubscription(body);
  await query(
    `INSERT INTO PUSH_SUSCRIPCION (id_usuario, endpoint, p256dh, auth, dispositivo) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id_usuario = VALUES(id_usuario), p256dh = VALUES(p256dh), auth = VALUES(auth), dispositivo = VALUES(dispositivo)`,
    [userId, sub.endpoint, sub.p256dh, sub.auth, String(userAgent).slice(0, 120) || null],
  );
  return { suscrito: true };
}

async function unsubscribe(userId, endpoint) {
  await query("DELETE FROM PUSH_SUSCRIPCION WHERE id_usuario = ? AND endpoint = ?", [userId, String(endpoint || "")]);
  return { suscrito: false };
}

function pathFor(row) {
  const { TYPE_LABELS } = require("./notificationEmailService");
  const role = row.rol;
  const known = TYPE_LABELS?.[row.tipo]?.paths?.[role];
  return known || (role === "admin" ? "/admin" : role ? `/${role}/notificaciones` : "/");
}

/** Envía como push las notificaciones nuevas de usuarios con la app instalada. */
async function processPushBatch({ db = query, sender = null } = {}) {
  const push = sender || client();
  const stats = { sent: 0, skipped: 0, failed: 0 };
  if (!push) return stats;
  await db(`UPDATE NOTIFICACION SET push_estado = 'OMITIDO' WHERE push_estado = 'PENDIENTE' AND creado_en < DATE_SUB(NOW(), INTERVAL ${MAX_AGE_HOURS} HOUR)`);
  const rows = await db(
    `SELECT n.id_notificacion, n.id_usuario, n.tipo, n.titulo, n.mensaje, tu.nombre rol
       FROM NOTIFICACION n JOIN USUARIO u ON u.id_usuario = n.id_usuario LEFT JOIN TIPO_USUARIO tu ON tu.id_tipo_usuario = u.id_tipo_usuario
      WHERE n.push_estado = 'PENDIENTE' ORDER BY n.id_notificacion LIMIT ${BATCH}`,
  );
  for (const row of rows) {
    const claimed = await db("UPDATE NOTIFICACION SET push_estado = 'ENVIANDO' WHERE id_notificacion = ? AND push_estado = 'PENDIENTE'", [row.id_notificacion]);
    if (claimed && claimed.affectedRows === 0) continue;
    const subs = await db("SELECT id_suscripcion, endpoint, p256dh, auth FROM PUSH_SUSCRIPCION WHERE id_usuario = ?", [row.id_usuario]);
    if (!subs.length) { await db("UPDATE NOTIFICACION SET push_estado = 'OMITIDO' WHERE id_notificacion = ?", [row.id_notificacion]); stats.skipped += 1; continue; }
    const payload = JSON.stringify({ title: row.titulo, body: row.mensaje, url: pathFor(row), tag: `nexus-${row.id_notificacion}` });
    let delivered = 0;
    for (const sub of subs) {
      try {
        await push.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 86400 });
        delivered += 1;
      } catch (error) {
        // 404/410: el dispositivo ya no existe (app desinstalada o permiso retirado).
        if ([404, 410].includes(error.statusCode)) await db("DELETE FROM PUSH_SUSCRIPCION WHERE id_suscripcion = ?", [sub.id_suscripcion]);
        else logger.error("No se pudo enviar una notificación push.", { id_notificacion: row.id_notificacion, status: error.statusCode || null });
      }
    }
    await db("UPDATE NOTIFICACION SET push_estado = ? WHERE id_notificacion = ?", [delivered ? "ENVIADO" : "FALLIDO", row.id_notificacion]);
    stats[delivered ? "sent" : "failed"] += 1;
  }
  return stats;
}

let timer = null;
function startPushScheduler() {
  if (timer || !pushConfig()) return;
  let running = false;
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await processPushBatch(); } catch (error) { logger.error("Falló el envío de notificaciones push.", { code: error.code || null }); } finally { running = false; }
  }, 15000);
  timer.unref?.();
}

module.exports = { pushConfig, subscribe, unsubscribe, processPushBatch, startPushScheduler, validateSubscription };
