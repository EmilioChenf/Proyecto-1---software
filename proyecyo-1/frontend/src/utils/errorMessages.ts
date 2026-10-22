export type FieldError = { field: string; message: string };

type ErrorPayload = {
  message?: unknown;
  error?: unknown;
  errors?: unknown;
  errores?: unknown;
};

const STATUS_MESSAGES: Record<number, string> = {
  400: "Revisa la información ingresada.",
  401: "Tu sesión ha expirado. Inicia sesión nuevamente.",
  403: "No tienes permisos para realizar esta acción.",
  404: "No se encontró la información solicitada.",
  409: "Ya existe un registro con esta información.",
  422: "Algunos datos ingresados no son válidos.",
  429: "Demasiados intentos. Espera unos minutos e intenta nuevamente.",
  500: "Ocurrió un problema en el servidor. Intenta nuevamente.",
};

const TECHNICAL_DETAIL = /(select|insert|update|delete)\s+.+\s+from|sqlstate|mysql|stack|node_modules|\.js:\d+|password|token|secret/i;

export function sanitizeErrorMessage(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const message = value.trim();
  if (!message || message.length > 240 || TECHNICAL_DETAIL.test(message)) return fallback;
  return message;
}

export function getFieldErrors(payload: unknown): FieldError[] {
  if (!payload || typeof payload !== "object") return [];
  const source = payload as ErrorPayload;
  const candidates = Array.isArray(source.errores) ? source.errores : Array.isArray(source.errors) ? source.errors : [];
  return candidates.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const field = String((item as FieldError).field || "").trim();
    const message = sanitizeErrorMessage((item as FieldError).message, "Dato inválido.");
    return field ? [{ field, message }] : [];
  });
}

export function getApiErrorMessage(status: number, payload: unknown) {
  const fallback = STATUS_MESSAGES[status] || (status >= 500 ? STATUS_MESSAGES[500] : "No fue posible completar la operación.");
  if (!payload || typeof payload !== "object") return fallback;
  const source = payload as ErrorPayload;
  const direct = source.message ?? source.error;
  if (direct) return sanitizeErrorMessage(direct, fallback);
  return getFieldErrors(payload)[0]?.message || fallback;
}

export function getErrorMessage(error: unknown, fallback = "No fue posible completar la operación.") {
  if (error instanceof Error) return sanitizeErrorMessage(error.message, fallback);
  return fallback;
}
