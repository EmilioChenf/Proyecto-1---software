// HU-C06: mismas reglas que el backend (utils/providerAccessValidation y visitWindow)
// para que el usuario vea el error junto al campo antes de enviar.
import { getVehiclePlateError, normalizeVehiclePlate } from "@/utils/vehiclePlate";
import { GUATEMALA_TIMEZONE, guatemalaToday } from "@/utils/guatemalaTime";

export type ProviderEntryMode = "VEHICULO" | "PEATONAL";

export const providerEntryModeLabels: Record<ProviderEntryMode, string> = {
  VEHICULO: "En vehículo",
  PEATONAL: "A pie",
};

/** Margen para la hora de inicio, igual que el backend. */
export const START_GRACE_MINUTES = 10;

export const VISITOR_DOCUMENT_REQUIRED_MESSAGE = "El DPI/documento del visitante es obligatorio (13 dígitos).";

export function normalizeDpi(value: string) {
  return value.replace(/[\s-]/g, "");
}

export function getDpiError(value: string) {
  const normalized = normalizeDpi(value.trim());
  if (!normalized) return "";
  return /^\d{13}$/.test(normalized) ? "" : "El DPI debe contener exactamente 13 dígitos numéricos.";
}

export interface ProviderIdentifierInput {
  medio_ingreso: ProviderEntryMode;
  placa: string;
  dpi: string;
}

export interface ProviderIdentifierErrors {
  placa?: string;
  dpi?: string;
}

export function getProviderIdentifierErrors({ medio_ingreso, placa, dpi }: ProviderIdentifierInput): ProviderIdentifierErrors {
  const errors: ProviderIdentifierErrors = {};
  const plate = normalizeVehiclePlate(placa);
  const plateFormatError = getVehiclePlateError(placa);
  const dpiFormatError = getDpiError(dpi);

  if (plateFormatError) errors.placa = plateFormatError;
  if (dpiFormatError) errors.dpi = dpiFormatError;

  if (medio_ingreso === "VEHICULO" && !plate) {
    errors.placa = "La placa es obligatoria cuando el proveedor ingresa en vehículo.";
  }
  if (medio_ingreso === "PEATONAL" && !normalizeDpi(dpi.trim())) {
    errors.dpi = "El DPI es obligatorio cuando el proveedor ingresa a pie.";
  }

  return errors;
}

/** Hora actual de Guatemala en HH:MM. */
export function guatemalaCurrentTime(now: Date = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: GUATEMALA_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(now)
    .replace(/^24/, "00");
}

function toMinutes(time: string) {
  const [hours, minutes] = time.split(":");
  return Number(hours) * 60 + Number(minutes);
}

export interface PastWindowErrors {
  fecha?: string;
  hora_inicio?: string;
  hora_fin?: string;
}

/**
 * Errores de fecha/horario pasado. Con allowStartedWindow (edicion que conserva el
 * inicio) solo se exige que la vigencia siga abierta.
 */
export function getPastVisitWindowErrors(
  fecha: string,
  horaInicio: string,
  horaFin: string,
  { now = new Date(), allowStartedWindow = false }: { now?: Date; allowStartedWindow?: boolean } = {},
): PastWindowErrors {
  if (!fecha) return {};
  const today = guatemalaToday(0, now);
  const current = guatemalaCurrentTime(now);

  if (fecha < today) {
    return { fecha: "La fecha seleccionada ya pasó. Elige hoy o una fecha futura." };
  }
  if (fecha > today) return {};

  if (horaFin && toMinutes(horaFin) <= toMinutes(current)) {
    return { hora_fin: "El horario seleccionado ya terminó; no se puede generar un QR vencido." };
  }
  if (!allowStartedWindow && horaInicio && toMinutes(horaInicio) < toMinutes(current) - START_GRACE_MINUTES) {
    return { hora_inicio: `La hora de inicio ya pasó. Elige una hora a partir de las ${current}.` };
  }
  return {};
}

export function getPastVisitWindowError(...args: Parameters<typeof getPastVisitWindowErrors>) {
  const errors = getPastVisitWindowErrors(...args);
  return errors.fecha || errors.hora_inicio || errors.hora_fin || "";
}

export interface VisitScheduleInput {
  tipo_visita: string;
  medio_ingreso?: ProviderEntryMode;
  placa: string;
  dpi: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
}

/**
 * Primer error de HU-C06 para un acceso del asistente de visitas: identificador del
 * proveedor segun su medio de ingreso y fecha/horario no pasados.
 */
export function getVisitAccessRuleError(
  payload: VisitScheduleInput,
  options: { now?: Date; allowStartedWindow?: boolean } = {},
) {
  // HU-C03.1: la visita personal (la que forma visitantes frecuentes) exige DPI.
  if (payload.tipo_visita === "VISITA") {
    if (!normalizeDpi(payload.dpi.trim())) return VISITOR_DOCUMENT_REQUIRED_MESSAGE;
    const dpiError = getDpiError(payload.dpi);
    if (dpiError) return dpiError;
  }

  if (payload.tipo_visita === "PROVEEDOR") {
    const errors = getProviderIdentifierErrors({
      medio_ingreso: payload.medio_ingreso ?? (payload.placa.trim() ? "VEHICULO" : "PEATONAL"),
      placa: payload.placa,
      dpi: payload.dpi,
    });
    const identifierError = errors.placa || errors.dpi;
    if (identifierError) return identifierError;
  }

  return getPastVisitWindowError(payload.fecha, payload.hora_inicio, payload.hora_fin, options);
}
