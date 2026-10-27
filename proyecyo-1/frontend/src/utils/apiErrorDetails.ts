import { ApiError } from "@/services/api";

// El backend devuelve { message, code?, errores?, existing? }; ApiError conserva ese
// cuerpo en `payload`. Estas funciones leen el codigo estable y el registro existente.

export interface ExistingVisitor {
  id_visitante: number | null;
  nombre: string | null;
  dpi: string | null;
  placa: string | null;
}

function payloadOf(error: unknown) {
  return error instanceof ApiError && error.payload && typeof error.payload === "object"
    ? (error.payload as { code?: unknown; existing?: unknown })
    : null;
}

/** Codigo estable del backend (DUPLICATE_VISIT, VISITOR_DATA_CONFLICT, ...). */
export function getApiErrorCode(error: unknown) {
  const code = payloadOf(error)?.code;
  return typeof code === "string" ? code : undefined;
}

/** HU-C03.2: visitante ya registrado que el backend pide confirmar antes de actualizar. */
export function getExistingVisitor(error: unknown): ExistingVisitor | null {
  const existing = payloadOf(error)?.existing;
  if (!existing || typeof existing !== "object") return null;
  const source = existing as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);
  return {
    id_visitante: typeof source.id_visitante === "number" ? source.id_visitante : null,
    nombre: text(source.nombre),
    dpi: text(source.dpi),
    placa: text(source.placa),
  };
}
