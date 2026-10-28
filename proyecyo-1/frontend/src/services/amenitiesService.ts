import { apiRequest } from "@/services/api";
import { publishReservationChange } from "@/hooks/useReservationUpdates";

function changed<T>(result: T) { publishReservationChange(); return result; }
import type {
  Amenity,
  AmenityAvailabilityResponse,
  AmenityConflictResponse,
  AmenityReservation,
  AmenityReservationHistory,
  AmenityStatsResponse,
  CreateAmenityReservationPayload,
  ReservableUserOption,
  UpdateAmenitySchedulePayload,
} from "@/types/amenities";

type ReservationFilters = {
  from: string;
  to: string;
  id_amenidad?: number | null;
  id_usuario?: number | null;
  estado?: string;
  unidad?: string;
};

function buildReservationQuery(filters: ReservationFilters) {
  const query = new URLSearchParams({
    from: filters.from,
    to: filters.to,
  });

  if (filters.id_amenidad) {
    query.set("id_amenidad", String(filters.id_amenidad));
  }

  if (filters.id_usuario) {
    query.set("id_usuario", String(filters.id_usuario));
  }
  if (filters.estado) query.set("estado", filters.estado);
  if (filters.unidad) query.set("unidad", filters.unidad);

  return query.toString();
}

function buildAvailabilityQuery(idAmenidad: number, fecha: string) {
  return new URLSearchParams({
    id_amenidad: String(idAmenidad),
    fecha,
  }).toString();
}

function buildConflictQuery(payload: CreateAmenityReservationPayload) {
  const query = new URLSearchParams({
    id_amenidad: String(payload.id_amenidad),
    fecha: payload.fecha,
    hora_inicio: payload.hora_inicio,
    hora_fin: payload.hora_fin,
  });

  if (payload.id_usuario) {
    query.set("id_usuario", String(payload.id_usuario));
  }

  return query.toString();
}

export function getAmenitiesRequest() {
  return apiRequest<Amenity[]>("/amenidades");
}

export function getAmenitiesReservationsRequest(filters: ReservationFilters) {
  return apiRequest<AmenityReservation[]>(
    `/reservas/amenidades?${buildReservationQuery(filters)}`,
  );
}

export function getAmenityAvailabilityRequest(idAmenidad: number, fecha: string) {
  return apiRequest<AmenityAvailabilityResponse>(
    `/reservas/amenidades/disponibilidad?${buildAvailabilityQuery(idAmenidad, fecha)}`,
  );
}

export function getUnifiedAmenityAvailabilityRequest(fecha: string) {
  return apiRequest<{ fecha: string; amenidades: AmenityAvailabilityResponse[] }>(
    `/reservas/amenidades/disponibilidad-general?fecha=${encodeURIComponent(fecha)}`,
  );
}

export function validateAmenityConflictRequest(payload: CreateAmenityReservationPayload) {
  return apiRequest<AmenityConflictResponse>(
    `/reservas/amenidades/conflicto?${buildConflictQuery(payload)}`,
  );
}

export function createAmenitiesReservationRequest(payload: CreateAmenityReservationPayload) {
  return apiRequest<AmenityReservation>("/reservas/amenidades", {
    method: "POST",
    body: payload,
  }).then(changed);
}

export function updateAmenitiesReservationRequest(
  reservationKey: string,
  payload: CreateAmenityReservationPayload,
) {
  return apiRequest<AmenityReservation>(`/reservas/amenidades/${encodeURIComponent(reservationKey)}`, {
    method: "PATCH",
    body: payload,
  }).then(changed);
}

export function cancelAmenitiesReservationRequest(reservationKey: string) {
  return apiRequest<AmenityReservation>(
    `/reservas/amenidades/${encodeURIComponent(reservationKey)}/cancelar`,
    { method: "PATCH" },
  ).then(changed);
}

export function getAmenitiesReservationHistoryRequest() {
  return apiRequest<AmenityReservationHistory[]>("/reservas/amenidades/historial");
}

export function getTenantAmenitiesReservationsRequest(filters: Pick<ReservationFilters, "from" | "to">) {
  return apiRequest<AmenityReservation[]>(`/inquilino/reservas/amenidades?${buildReservationQuery(filters)}`);
}

export function getTenantAmenitiesHistoryRequest() {
  return apiRequest<AmenityReservationHistory[]>("/inquilino/reservas/amenidades/historial");
}

export function getAdminAmenitiesRequest() {
  return apiRequest<Amenity[]>("/admin/amenidades");
}

export function getAdminAmenitiesUsersRequest() {
  return apiRequest<ReservableUserOption[]>("/admin/amenidades/usuarios");
}

export function updateAmenityScheduleRequest(
  idAmenidad: number,
  payload: UpdateAmenitySchedulePayload,
) {
  return apiRequest<Amenity>(`/admin/amenidades/${idAmenidad}/horario`, {
    method: "PUT",
    body: payload,
  }).then(changed);
}

export function getAdminAmenitiesReservationsRequest(filters: ReservationFilters) {
  return apiRequest<AmenityReservation[]>(
    `/admin/reservas/amenidades?${buildReservationQuery(filters)}`,
  );
}

export function getAdminAmenityAvailabilityRequest(idAmenidad: number, fecha: string) {
  return apiRequest<AmenityAvailabilityResponse>(
    `/admin/reservas/amenidades/disponibilidad?${buildAvailabilityQuery(idAmenidad, fecha)}`,
  );
}

export function validateAdminAmenityConflictRequest(payload: CreateAmenityReservationPayload) {
  return apiRequest<AmenityConflictResponse>(
    `/admin/reservas/amenidades/conflicto?${buildConflictQuery(payload)}`,
  );
}

export function createAdminAmenitiesReservationRequest(payload: CreateAmenityReservationPayload) {
  return apiRequest<AmenityReservation>("/admin/reservas/amenidades", {
    method: "POST",
    body: payload,
  }).then(changed);
}

/** HU-C05.4: cancelacion administrativa con motivo opcional. */
export function adminCancelAmenitiesReservationRequest(reservationKey: string, motivo?: string) {
  return apiRequest<AmenityReservation>(
    `/admin/reservas/amenidades/${encodeURIComponent(reservationKey)}/cancelar`,
    { method: "PATCH", body: motivo ? { motivo } : {} },
  ).then(changed);
}

export function getAdminAmenityStatsRequest(filters: ReservationFilters) {
  return apiRequest<AmenityStatsResponse>(
    `/admin/amenidades/estadisticas?${buildReservationQuery(filters)}`,
  );
}
