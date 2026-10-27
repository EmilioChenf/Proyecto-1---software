import { apiRequest } from "@/services/api";
import { notifyAccessCountersChanged } from "@/utils/accessCounterUpdates";
import type {
  FrequentVisitor,
  GuardQrValidationPayload,
  VisitPayload,
  VisitRecord,
} from "@/types/visits";

export function getVisitsRequest() {
  return apiRequest<VisitRecord[]>("/visitas");
}

export function getFrequentVisitorsRequest() {
  return apiRequest<FrequentVisitor[]>("/visitantes-frecuentes");
}

export async function createVisitRequest(payload: VisitPayload) {
  const visit = await apiRequest<VisitRecord>("/visitas", {
    method: "POST",
    body: payload,
  });
  notifyAccessCountersChanged();
  return visit;
}

export async function updateVisitRequest(id: number, payload: VisitPayload) {
  const visit = await apiRequest<VisitRecord>(`/visitas/${id}`, {
    method: "PATCH",
    body: payload,
  });
  notifyAccessCountersChanged();
  return visit;
}

/** HU-C04: `desactivada` indica que la visita tenia historial y solo se retiro de la lista. */
export async function deleteVisitRequest(id: number) {
  const visit = await apiRequest<VisitRecord & { desactivada?: boolean }>(`/visitas/${id}`, {
    method: "DELETE",
  });
  notifyAccessCountersChanged();
  return visit;
}

export async function cancelVisitRequest(id: number) {
  const visit = await apiRequest<VisitRecord>(`/visitas/${id}/cancelar`, {
    method: "PATCH",
  });
  notifyAccessCountersChanged();
  return visit;
}

export function deleteFrequentVisitorRequest(id: number) {
  return apiRequest<{ id_visitante: number; nombre: string; desactivado?: boolean }>(`/visitantes-frecuentes/${id}`, {
    method: "DELETE",
  });
}

export function updateFrequentVisitorRequest(id: number, payload: { nombre?: string; dpi?: string; placa?: string }) {
  return apiRequest<{ id_visitante: number; nombre: string; dpi: string | null; placa: string | null }>(`/visitantes-frecuentes/${id}`, {
    method: "PATCH",
    body: payload,
  });
}

export function getGuardVisitsRequest() {
  return apiRequest<VisitRecord[]>("/guardia/visitas");
}

export function validateQrRequest(payload: GuardQrValidationPayload) {
  return apiRequest<VisitRecord>("/guardia/validar-qr", {
    method: "POST",
    body: payload,
  });
}

export async function registerQrEntryRequest(payload: GuardQrValidationPayload) {
  const visit = await apiRequest<VisitRecord>("/guardia/registrar-ingreso", {
    method: "POST",
    body: payload,
  });
  notifyAccessCountersChanged();
  return visit;
}

export async function registerQrExitRequest(payload: GuardQrValidationPayload) {
  const visit = await apiRequest<VisitRecord>("/guardia/registrar-salida", {
    method: "POST",
    body: payload,
  });
  notifyAccessCountersChanged();
  return visit;
}
