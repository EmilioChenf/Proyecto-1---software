const { query } = require("../database/mysql");

const DONE_KEY = "configuracion_inicial_completada";

/** Avance de la configuración inicial del residencial (lo usa el asistente de primeros pasos). */
async function getSetupStatus() {
  const [config] = await query(
    `SELECT
       (SELECT valor FROM CONFIGURACION WHERE clave = 'residencial_nombre') nombre,
       (SELECT valor FROM CONFIGURACION WHERE clave = 'residencial_logo_url') logo,
       (SELECT valor FROM CONFIGURACION WHERE clave = ?) completada,
       (SELECT valor FROM CONFIGURACION WHERE clave = 'primeros_pasos_visitas') horarios,
       (SELECT COUNT(*) FROM TARIFA_MANTENIMIENTO) tarifas,
       (SELECT COUNT(*) FROM AMENIDAD WHERE activo = 1) amenidades,
       (SELECT COUNT(*) FROM CASA) viviendas,
       (SELECT COUNT(*) FROM USUARIO u JOIN TIPO_USUARIO t ON t.id_tipo_usuario = u.id_tipo_usuario WHERE t.nombre IN ('residente', 'inquilino')) personas,
       (SELECT COUNT(*) FROM USUARIO u JOIN TIPO_USUARIO t ON t.id_tipo_usuario = u.id_tipo_usuario WHERE t.nombre = 'guardia') guardias`,
    [DONE_KEY],
  );
  const steps = [
    { id: "marca", label: "Nombre y marca del residencial", done: Boolean(config.nombre && config.nombre !== "NexusResidencial") },
    { id: "mantenimiento", label: "Cuota de mantenimiento", done: Number(config.tarifas) > 0 },
    { id: "visitas", label: "Horario de visitas", done: config.horarios === "true" },
    { id: "amenidades", label: "Amenidades", done: Number(config.amenidades) > 0 },
    { id: "viviendas", label: "Viviendas y residentes", done: Number(config.viviendas) > 0 && Number(config.personas) > 0 },
    { id: "guardias", label: "Usuarios de garita", done: Number(config.guardias) > 0 },
  ];
  return {
    pasos: steps,
    completados: steps.filter((step) => step.done).length,
    total: steps.length,
    oculto: config.completada === "true",
    conteos: { viviendas: Number(config.viviendas), personas: Number(config.personas), amenidades: Number(config.amenidades), guardias: Number(config.guardias) },
  };
}

async function setSetupHidden(hidden) {
  await query("INSERT INTO CONFIGURACION (clave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)", [DONE_KEY, hidden ? "true" : "false"]);
  return getSetupStatus();
}

async function markStepReviewed(step) {
  if (step !== "visitas") throw Object.assign(new Error("Paso inválido."), { status: 400 });
  await query("INSERT INTO CONFIGURACION (clave, valor) VALUES ('primeros_pasos_visitas', 'true') ON DUPLICATE KEY UPDATE valor = 'true'");
  return getSetupStatus();
}

module.exports = { getSetupStatus, setSetupHidden, markStepReviewed };
