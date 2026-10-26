// HU-C06.6 y C06.7: una autorizacion de acceso nunca nace en el pasado y nunca se
// emite un QR cuya vigencia ya termino. La referencia es la hora de Guatemala.
const { GUATEMALA_TIMEZONE, guatemalaToday } = require("./guatemalaTime");

// Margen para la hora de inicio: los formularios proponen la hora actual y el usuario
// tarda unos minutos en enviarlos. Pasado este margen el inicio se considera pasado.
const START_GRACE_MINUTES = 10;

function guatemalaCurrentMinute(now = new Date()) {
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: GUATEMALA_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  // Algunos motores devuelven "24:05" a medianoche.
  return `${time.replace(/^24/, "00")}:00`;
}

function toSeconds(time) {
  const [hours, minutes, seconds = "0"] = String(time).split(":");
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

function visitWindowError(message, code) {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  return error;
}

/** true cuando la vigencia (fecha + hora de fin) ya termino en Guatemala. */
function isVisitWindowExpired(fecha, horaFin, now = new Date()) {
  const today = guatemalaToday(now);
  if (fecha < today) return true;
  if (fecha > today) return false;
  return toSeconds(horaFin) <= toSeconds(guatemalaCurrentMinute(now));
}

/**
 * Rechaza fechas y horarios pasados. Con allowStartedWindow (edicion de un acceso que
 * ya empezo y no cambio su inicio) solo se exige que la vigencia siga abierta.
 */
function ensureVisitWindowNotPast(fecha, horaInicio, horaFin, { now = new Date(), allowStartedWindow = false } = {}) {
  const today = guatemalaToday(now);
  const currentMinute = guatemalaCurrentMinute(now);

  if (fecha < today) {
    throw visitWindowError(
      "La fecha seleccionada ya pasó. Elige hoy o una fecha futura.",
      "VISIT_DATE_IN_PAST",
    );
  }

  if (fecha === today && toSeconds(horaFin) <= toSeconds(currentMinute)) {
    throw visitWindowError(
      "El horario seleccionado ya terminó; no se puede generar un QR vencido.",
      "VISIT_WINDOW_EXPIRED",
    );
  }

  const earliestStart = toSeconds(currentMinute) - START_GRACE_MINUTES * 60;
  if (!allowStartedWindow && fecha === today && toSeconds(horaInicio) < earliestStart) {
    throw visitWindowError(
      `La hora de inicio ya pasó. Elige una hora a partir de las ${currentMinute.slice(0, 5)}.`,
      "VISIT_TIME_IN_PAST",
    );
  }
}

module.exports = {
  START_GRACE_MINUTES,
  guatemalaCurrentMinute,
  isVisitWindowExpired,
  ensureVisitWindowNotPast,
};
