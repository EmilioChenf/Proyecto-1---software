import type { ProviderEntryMode } from "@/utils/providerAccess";

export type VisitType = "VISITA" | "DELIVERY" | "PROVEEDOR";

export interface VisitRecord {
  id_acceso: number;
  id_visitante: number;
  nombre: string;
  dpi: string;
  placa: string;
  foto?: string | null;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  hora_salida?: string | null;
  /** HU-C04.5: hora real de ingreso (Guatemala), si la garita lo registro. */
  hora_ingreso?: string | null;
  tipo_visita: VisitType;
  medio_ingreso?: ProviderEntryMode | null;
  motivo_servicio?: string;
  observaciones?: string;
  token_qr?: string | null;
  qr_value?: string | null;
  estado_acceso?: "AUTORIZADA" | "INGRESO_REGISTRADO" | "SALIDA_REGISTRADA" | "CANCELADA" | "PENDIENTE_APROBACION" | "RECHAZADA";
  qr_status?: "VALID" | "USED" | "EXIT_REGISTERED" | "EXPIRED" | "NOT_YET_VALID" | "CANCELLED" | "PENDING_APPROVAL";
  es_acceso_especial?: boolean;
  fuera_horario?: boolean;
  motivo_excepcion?: string;
  casa?: string;
}

export interface FrequentVisitor {
  id_visitante: number;
  nombre: string;
  dpi: string;
  placa: string;
  total_visitas: number;
  ultima_fecha: string | null;
  /** HU-C03.5: vivienda mostrada al confirmar el acceso rapido. */
  casa?: string;
}

export interface VisitPayload {
  nombre: string;
  dpi: string;
  placa: string;
  foto?: string | null;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  tipo_visita: VisitType;
  medio_ingreso?: ProviderEntryMode;
  motivo_servicio?: string;
  observaciones?: string;
}

export interface GuardQrValidationPayload {
  qrToken: string;
}
