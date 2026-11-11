const { pool, query } = require("../database/mysql");
const { ensureValidTime: ensureStrictTime } = require("../utils/dateTimeValidation");
const { ensureBoolean } = require("../utils/booleanValidation");

const CONFIG_KEYS = {
  HORA_APERTURA: "visitas_hora_apertura",
  HORA_CIERRE: "visitas_hora_cierre",
  DURACION_MAXIMA_HORAS: "visitas_duracion_maxima_horas",
  ACTIVO: "visitas_activo",
  DIAS_HABILITADOS: "visitas_dias_habilitados",
};

const DEFAULT_VISIT_SCHEDULE = {
  hora_apertura: "06:00",
  hora_cierre: "22:00",
  duracion_maxima_horas: 4,
  activo: true,
  dias_habilitados: [1, 2, 3, 4, 5, 6, 0],
};

const GENERAL_CONFIG_KEYS = {
  NOMBRE: "residencial_nombre",
  DIRECCION: "residencial_direccion",
  CORREO: "residencial_correo_contacto",
  TELEFONO: "residencial_telefono_contacto",
  ZONA_HORARIA: "residencial_zona_horaria",
  MONEDA: "residencial_moneda",
};

const DEFAULT_GENERAL_CONFIG = {
  nombre: "NexusResidencial",
  direccion: "",
  correo_contacto: "administracion@nexusresidencial.local",
  telefono_contacto: "",
  zona_horaria: "America/Guatemala",
  moneda: "GTQ",
};

function normalizeString(value) {
  return String(value || "").trim();
}

function ensureValidTime(value, fieldName) {
  return ensureStrictTime(value, fieldName).slice(0, 5);
}

function toMinutes(time) {
  const normalized = time.length === 5 ? `${time}:00` : time;
  const [hours, minutes] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
}

function ensureValidDurationHours(value) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 12) {
    const error = new Error("La duracion maxima debe ser un entero entre 1 y 12 horas.");
    error.status = 400;
    throw error;
  }

  return parsed;
}

async function getConfigMap() {
  const rows = await query(
    `
      SELECT clave, valor
      FROM CONFIGURACION
      WHERE clave IN (?, ?, ?, ?, ?)
    `,
    [
      CONFIG_KEYS.HORA_APERTURA,
      CONFIG_KEYS.HORA_CIERRE,
      CONFIG_KEYS.DURACION_MAXIMA_HORAS,
      CONFIG_KEYS.ACTIVO,
      CONFIG_KEYS.DIAS_HABILITADOS,
    ],
  );

  return Object.fromEntries(rows.map((row) => [row.clave, row.valor]));
}

function mapVisitScheduleConfig(configMap) {
  let diasHabilitados = DEFAULT_VISIT_SCHEDULE.dias_habilitados;
  try {
    const parsed = JSON.parse(configMap[CONFIG_KEYS.DIAS_HABILITADOS] || "[]");
    if (Array.isArray(parsed) && parsed.length) diasHabilitados = parsed;
  } catch {
    diasHabilitados = DEFAULT_VISIT_SCHEDULE.dias_habilitados;
  }
  return {
    hora_apertura: ensureValidTime(
      configMap[CONFIG_KEYS.HORA_APERTURA] || DEFAULT_VISIT_SCHEDULE.hora_apertura,
      "hora de apertura",
    ),
    hora_cierre: ensureValidTime(
      configMap[CONFIG_KEYS.HORA_CIERRE] || DEFAULT_VISIT_SCHEDULE.hora_cierre,
      "hora de cierre",
    ),
    duracion_maxima_horas: ensureValidDurationHours(
      configMap[CONFIG_KEYS.DURACION_MAXIMA_HORAS] ?? DEFAULT_VISIT_SCHEDULE.duracion_maxima_horas,
    ),
    activo: ensureBoolean(
      configMap[CONFIG_KEYS.ACTIVO],
      DEFAULT_VISIT_SCHEDULE.activo,
    ),
    dias_habilitados: diasHabilitados,
  };
}

function validateVisitSchedulePayload(payload) {
  const horaApertura = ensureValidTime(
    payload.hora_apertura ?? DEFAULT_VISIT_SCHEDULE.hora_apertura,
    "hora de apertura",
  );
  const horaCierre = ensureValidTime(
    payload.hora_cierre ?? DEFAULT_VISIT_SCHEDULE.hora_cierre,
    "hora de cierre",
  );
  const duracionMaximaHoras = ensureValidDurationHours(
    payload.duracion_maxima_horas ?? DEFAULT_VISIT_SCHEDULE.duracion_maxima_horas,
  );
  const activo = ensureBoolean(payload.activo, DEFAULT_VISIT_SCHEDULE.activo);
  const diasHabilitados = [...new Set(payload.dias_habilitados ?? DEFAULT_VISIT_SCHEDULE.dias_habilitados)]
    .map(Number);
  if (!diasHabilitados.length || diasHabilitados.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    const error = new Error("Selecciona al menos un dia valido para las visitas.");
    error.status = 400;
    throw error;
  }

  if (horaApertura >= horaCierre) {
    const error = new Error("La hora de cierre debe ser mayor a la hora de apertura.");
    error.status = 400;
    throw error;
  }

  const windowMinutes = toMinutes(horaCierre) - toMinutes(horaApertura);

  if (windowMinutes < duracionMaximaHoras * 60) {
    const error = new Error(
      "La duracion maxima no puede ser mayor al rango horario permitido para visitas.",
    );
    error.status = 400;
    throw error;
  }

  return {
    hora_apertura: horaApertura,
    hora_cierre: horaCierre,
    duracion_maxima_horas: duracionMaximaHoras,
    activo,
    dias_habilitados: diasHabilitados,
  };
}

async function getVisitScheduleConfig() {
  const configMap = await getConfigMap();
  return mapVisitScheduleConfig(configMap);
}

async function updateVisitScheduleConfig(payload) {
  const validated = validateVisitSchedulePayload(payload);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const entries = [
      [CONFIG_KEYS.HORA_APERTURA, validated.hora_apertura],
      [CONFIG_KEYS.HORA_CIERRE, validated.hora_cierre],
      [CONFIG_KEYS.DURACION_MAXIMA_HORAS, String(validated.duracion_maxima_horas)],
      [CONFIG_KEYS.ACTIVO, validated.activo ? "true" : "false"],
      [CONFIG_KEYS.DIAS_HABILITADOS, JSON.stringify(validated.dias_habilitados)],
    ];

    for (const [clave, valor] of entries) {
      await connection.execute(
        `
          INSERT INTO CONFIGURACION (clave, valor)
          VALUES (?, ?)
          ON DUPLICATE KEY UPDATE valor = VALUES(valor)
        `,
        [clave, valor],
      );
    }

    await connection.commit();
    return validated;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function validateVisitTimesAgainstSchedule(horaInicio, horaFin, schedule, fecha) {
  if (!schedule.activo) {
    const error = new Error("Las autorizaciones de visita estan temporalmente deshabilitadas.");
    error.status = 403;
    throw error;
  }
  if (fecha) {
    const day = new Date(`${fecha}T12:00:00Z`).getUTCDay();
    if (!schedule.dias_habilitados.includes(day)) {
      const error = new Error("El dia seleccionado no esta habilitado para visitas.");
      error.status = 400;
      throw error;
    }
  }

  const startMinutes = toMinutes(horaInicio);
  const endMinutes = toMinutes(horaFin);
  const openingMinutes = toMinutes(schedule.hora_apertura);
  const closingMinutes = toMinutes(schedule.hora_cierre);
  const maxDurationMinutes = schedule.duracion_maxima_horas * 60;

  if (startMinutes < openingMinutes || endMinutes > closingMinutes) {
    const error = new Error(
      `Las visitas se autorizan de ${schedule.hora_apertura} a ${schedule.hora_cierre}. El horario debe estar entre ${schedule.hora_apertura} y ${schedule.hora_cierre}; fuera de ese horario usa «Solicitar acceso de emergencia».`,
    );
    error.status = 400;
    throw error;
  }

  if (endMinutes - startMinutes > maxDurationMinutes) {
    const error = new Error(
      `La visita no puede durar mas de ${schedule.duracion_maxima_horas} hora(s). Si necesitas más tiempo, registra otra visita a continuación.`,
    );
    error.status = 400;
    throw error;
  }
}

async function assertVisitTimesAllowed(horaInicio, horaFin, fecha) {
  const schedule = await getVisitScheduleConfig();
  validateVisitTimesAgainstSchedule(horaInicio, horaFin, schedule, fecha);
  return schedule;
}

function validateGeneralConfiguration(payload) {
  const value = {
    nombre: normalizeString(payload.nombre),
    direccion: normalizeString(payload.direccion),
    correo_contacto: normalizeString(payload.correo_contacto).toLowerCase(),
    telefono_contacto: normalizeString(payload.telefono_contacto),
    zona_horaria: normalizeString(payload.zona_horaria),
    moneda: normalizeString(payload.moneda).toUpperCase(),
  };
  if (value.nombre.length < 3 || value.nombre.length > 120) {
    const error = new Error("El nombre del residencial debe tener entre 3 y 120 caracteres.");
    error.status = 400;
    throw error;
  }
  if (value.direccion.length > 200) {
    const error = new Error("La direccion no puede superar 200 caracteres.");
    error.status = 400;
    throw error;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.correo_contacto)) {
    const error = new Error("El correo de contacto no es valido.");
    error.status = 400;
    throw error;
  }
  if (value.telefono_contacto && !/^[+\d][\d\s()-]{6,24}$/.test(value.telefono_contacto)) {
    const error = new Error("El telefono de contacto no es valido.");
    error.status = 400;
    throw error;
  }
  try {
    new Intl.DateTimeFormat("es-GT", { timeZone: value.zona_horaria }).format();
  } catch {
    const error = new Error("La zona horaria no es valida.");
    error.status = 400;
    throw error;
  }
  if (!["GTQ", "USD"].includes(value.moneda)) {
    const error = new Error("La moneda debe ser GTQ o USD.");
    error.status = 400;
    throw error;
  }
  return value;
}

async function getGeneralConfiguration() {
  const rows = await query(
    `SELECT clave, valor FROM CONFIGURACION WHERE clave IN (?, ?, ?, ?, ?, ?)`,
    Object.values(GENERAL_CONFIG_KEYS),
  );
  const config = Object.fromEntries(rows.map((row) => [row.clave, row.valor]));
  return {
    nombre: config[GENERAL_CONFIG_KEYS.NOMBRE] ?? DEFAULT_GENERAL_CONFIG.nombre,
    direccion: config[GENERAL_CONFIG_KEYS.DIRECCION] ?? DEFAULT_GENERAL_CONFIG.direccion,
    correo_contacto: config[GENERAL_CONFIG_KEYS.CORREO] ?? DEFAULT_GENERAL_CONFIG.correo_contacto,
    telefono_contacto: config[GENERAL_CONFIG_KEYS.TELEFONO] ?? DEFAULT_GENERAL_CONFIG.telefono_contacto,
    zona_horaria: config[GENERAL_CONFIG_KEYS.ZONA_HORARIA] ?? DEFAULT_GENERAL_CONFIG.zona_horaria,
    moneda: config[GENERAL_CONFIG_KEYS.MONEDA] ?? DEFAULT_GENERAL_CONFIG.moneda,
  };
}

async function updateGeneralConfiguration(payload) {
  const validated = validateGeneralConfiguration(payload);
  const values = [
    [GENERAL_CONFIG_KEYS.NOMBRE, validated.nombre],
    [GENERAL_CONFIG_KEYS.DIRECCION, validated.direccion],
    [GENERAL_CONFIG_KEYS.CORREO, validated.correo_contacto],
    [GENERAL_CONFIG_KEYS.TELEFONO, validated.telefono_contacto],
    [GENERAL_CONFIG_KEYS.ZONA_HORARIA, validated.zona_horaria],
    [GENERAL_CONFIG_KEYS.MONEDA, validated.moneda],
  ];
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const [key, value] of values) {
      await connection.execute(
        "INSERT INTO CONFIGURACION (clave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)",
        [key, value],
      );
    }
    await connection.commit();
    return validated;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  getVisitScheduleConfig,
  updateVisitScheduleConfig,
  assertVisitTimesAllowed,
  validateVisitTimesAgainstSchedule,
  validateVisitSchedulePayload,
  DEFAULT_VISIT_SCHEDULE,
  CONFIG_KEYS,
  DEFAULT_GENERAL_CONFIG,
  GENERAL_CONFIG_KEYS,
  getGeneralConfiguration,
  updateGeneralConfiguration,
  validateGeneralConfiguration,
};
