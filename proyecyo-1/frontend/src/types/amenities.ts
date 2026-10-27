export interface Amenity {
  id_amenidad: number;
  nombre: string;
  descripcion: string;
  hora_apertura: string;
  hora_cierre: string;
  intervalo_minutos: number;
  activo: boolean;
}

export interface AmenityReservation {
  reservation_key: string;
  id_usuario: number;
  id_amenidad: number;
  amenidad_nombre: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  estado: "PENDIENTE" | "CONFIRMADA" | "CANCELADA";
  estado_actual: "PENDIENTE" | "CONFIRMADA" | "EN_CURSO" | "FINALIZADA" | "CANCELADA";
  usuario_nombre?: string;
  usuario_rol?: "residente" | "inquilino" | "admin" | "guardia";
  unidad?: string;
  /** HU-C05.5/C05.9: autoria (solo en vistas de administrador). */
  creada_por_nombre?: string | null;
  creada_por_admin?: boolean;
  cancelada_por_nombre?: string | null;
  cancelada_en?: string | null;
  motivo_cancelacion?: string | null;
}

export interface AmenityReservationHistory {
  id_historial: number;
  accion: string;
  detalle: string;
  amenidad_nombre: string;
  fecha_anterior: string;
  hora_inicio_anterior: string;
  hora_fin_anterior: string;
  fecha_nueva: string;
  hora_inicio_nueva: string;
  hora_fin_nueva: string;
  estado_anterior: string;
  estado_nuevo: string;
  realizado_por_nombre: string;
  realizado_por_rol?: string | null;
  motivo?: string | null;
  creado_en: string;
}

export interface AmenityAvailabilitySlot {
  hora_inicio: string;
  hora_fin: string;
  disponible: boolean;
  reserva: AmenityReservation | null;
}

export interface AmenityAvailabilityResponse {
  amenidad: Amenity;
  fecha: string;
  slots: AmenityAvailabilitySlot[];
  reservas: AmenityReservation[];
}

export interface AmenityConflictResponse {
  conflicto: boolean;
  reserva: AmenityReservation | null;
  limite_alcanzado: boolean;
  limite_reservas: number;
  reservas_activas_usuario: number | null;
  mensaje_limite: string | null;
}

export interface ReservableUserOption {
  id_usuario: number;
  nombre: string;
  rol: "residente" | "inquilino";
  unidad: string;
}

export interface CreateAmenityReservationPayload {
  id_usuario?: number;
  id_amenidad: number;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
}

export interface UpdateAmenitySchedulePayload {
  descripcion?: string;
  hora_apertura: string;
  hora_cierre: string;
  intervalo_minutos: number;
  activo: boolean;
}

export interface AmenityStatsItem {
  id_amenidad: number;
  nombre: string;
  total_reservas: number;
  activas: number;
  canceladas: number;
  ranking: number;
}

export interface AmenityStatsResponse {
  from: string;
  to: string;
  total_reservas: number;
  reservas_activas: number;
  reservas_canceladas: number;
  por_amenidad: AmenityStatsItem[];
  ranking: AmenityStatsItem[];
}
