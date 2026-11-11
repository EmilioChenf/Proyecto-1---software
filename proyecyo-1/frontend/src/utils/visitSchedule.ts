import type { VisitScheduleConfig } from "@/types/configuration";
import { validateTimeRange } from "@/utils/dateTimeValidation";

const RESIDENTIAL_TIMEZONE = "America/Guatemala";
const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
/** Minutos minimos que deben quedar antes del cierre para sugerir una visita hoy. */
const MIN_WINDOW_MINUTES = 30;
const DEFAULT_VISIT_MINUTES = 120;

function toMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function toTime(minutes: number) {
  const clamped = Math.max(0, Math.min(minutes, 23 * 60 + 59));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

function nowInResidential(now: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: RESIDENTIAL_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(hour) * 60 + Number(parts.minute) };
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function weekday(date: string) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function dayEnabled(schedule: VisitScheduleConfig, date: string) {
  return !schedule.dias_habilitados?.length || schedule.dias_habilitados.includes(weekday(date));
}

/** Texto corto de las reglas para mostrarlo antes de que el usuario elija horario. */
export function formatVisitScheduleSummary(schedule: VisitScheduleConfig) {
  return `${schedule.hora_apertura} a ${schedule.hora_cierre} · máximo ${schedule.duracion_maxima_horas} h por visita · el mismo día`;
}

/**
 * Explica por que un horario no se puede autorizar. Revisa primero lo que el usuario
 * suele no saber (medianoche, horario del residencial) antes del error generico.
 */
export function validateVisitTimesAgainstSchedule(
  horaInicio: string,
  horaFin: string,
  schedule: VisitScheduleConfig,
): string | null {
  if (!schedule.activo) {
    return "Las autorizaciones de visita están temporalmente deshabilitadas por la administración.";
  }

  if (horaInicio && horaFin && /^\d{2}:\d{2}/.test(horaInicio) && /^\d{2}:\d{2}/.test(horaFin) && horaFin < horaInicio) {
    return `La visita no puede pasar de la medianoche: debe empezar y terminar el mismo día, entre las ${schedule.hora_apertura} y las ${schedule.hora_cierre}. Si es urgente, usa «Solicitar acceso de emergencia».`;
  }

  const rangeError = validateTimeRange(horaInicio, horaFin);
  if (rangeError) return rangeError;

  const startMinutes = toMinutes(horaInicio);
  const endMinutes = toMinutes(horaFin);
  const openingMinutes = toMinutes(schedule.hora_apertura);
  const closingMinutes = toMinutes(schedule.hora_cierre);
  const maxDurationMinutes = schedule.duracion_maxima_horas * 60;

  if (startMinutes < openingMinutes || endMinutes > closingMinutes) {
    return `Las visitas se autorizan de ${schedule.hora_apertura} a ${schedule.hora_cierre}. Elige un horario dentro de ese rango o, si es urgente, usa «Solicitar acceso de emergencia».`;
  }

  if (endMinutes - startMinutes > maxDurationMinutes) {
    return `La visita no puede durar más de ${schedule.duracion_maxima_horas} hora(s). Si necesitas más tiempo, registra otra visita a continuación.`;
  }

  return null;
}

/** Aviso que se muestra antes de elegir horario cuando hoy ya no se pueden autorizar visitas. */
export function getVisitScheduleNotice(fecha: string, schedule: VisitScheduleConfig, now = new Date()): string | null {
  if (!schedule.activo) return "La administración deshabilitó temporalmente las autorizaciones de visita.";
  if (fecha && !dayEnabled(schedule, fecha)) {
    return `El ${DAY_NAMES[weekday(fecha)]} no está habilitado para visitas. Elige otro día o, si es urgente, solicita un acceso de emergencia.`;
  }
  const current = nowInResidential(now);
  if (fecha !== current.date) return null;
  const closing = toMinutes(schedule.hora_cierre);
  const opening = toMinutes(schedule.hora_apertura);
  if (current.minutes >= closing - MIN_WINDOW_MINUTES) {
    return `El horario de visitas de hoy ya terminó (${schedule.hora_apertura} a ${schedule.hora_cierre}). Programa la visita para mañana o, si es urgente, solicita un acceso de emergencia.`;
  }
  if (current.minutes < opening) {
    return `Las visitas de hoy empiezan a las ${schedule.hora_apertura}. Antes de esa hora solo se permiten accesos de emergencia aprobados por la administración.`;
  }
  return null;
}

/** Primer horario valido a partir de ahora: hoy si queda tiempo, si no el siguiente dia habilitado. */
export function suggestVisitWindow(schedule: VisitScheduleConfig | null, now = new Date()) {
  const current = nowInResidential(now);
  if (!schedule) {
    return { fecha: current.date, hora_inicio: toTime(current.minutes), hora_fin: toTime(current.minutes + DEFAULT_VISIT_MINUTES) };
  }
  const opening = toMinutes(schedule.hora_apertura);
  const closing = toMinutes(schedule.hora_cierre);
  const duration = Math.min(DEFAULT_VISIT_MINUTES, Math.max(30, schedule.duracion_maxima_horas * 60));

  if (dayEnabled(schedule, current.date) && current.minutes < closing - MIN_WINDOW_MINUTES) {
    const start = Math.max(current.minutes, opening);
    return { fecha: current.date, hora_inicio: toTime(start), hora_fin: toTime(Math.min(start + duration, closing)) };
  }

  let fecha = addDays(current.date, 1);
  for (let i = 0; i < 7 && !dayEnabled(schedule, fecha); i += 1) fecha = addDays(fecha, 1);
  return { fecha, hora_inicio: toTime(opening), hora_fin: toTime(Math.min(opening + duration, closing)) };
}
