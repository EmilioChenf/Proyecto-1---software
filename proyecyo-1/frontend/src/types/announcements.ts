export type AnnouncementRecipientType = "todos" | "residente" | "inquilino" | "guardia" | "admin";

export interface AnnouncementRecord {
  id_comunicado: number;
  titulo: string;
  descripcion: string;
  tipo_destinatario: AnnouncementRecipientType;
  total_destinatarios: number;
  enviado_en: string;
  creado_por: number;
  creado_por_nombre: string | null;
}

export interface AnnouncementPayload {
  titulo: string;
  descripcion: string;
  tipo_usuario: AnnouncementRecipientType;
}

export interface VisitScheduleConfig {
  inicio: string;
  fin: string;
}

export interface HouseOption {
  id_casa: number;
  numero: string;
  torre: string | null;
  etiqueta: string;
  propietario: string;
}

export interface SpecialAccessRecord {
  id_acceso: number;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  nombre: string;
  dpi: string;
  placa: string;
  casa: string;
  id_casa: number;
  tipo_visita: string;
  motivo_excepcion: string;
  es_acceso_especial: boolean;
  estado_acceso: string;
  token_qr?: string | null;
  qr_value?: string | null;
  fuera_horario: boolean;
  horario_permitido?: VisitScheduleConfig;
  requiere_aprobacion?: boolean;
}

export interface SpecialAccessPayload {
  nombre: string;
  dpi: string;
  placa: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  id_casa: number;
  motivo_excepcion: string;
  tipo_visita?: "VISITA" | "DELIVERY" | "PROVEEDOR";
  medio_ingreso?: "VEHICULO" | "PEATONAL";
  motivo_servicio?: string;
}

export interface SpecialAccessExceptionRecord {
  id_excepcion: number;
  id_acceso: number;
  accion: "APROBADO" | "RECHAZADO";
  motivo: string;
  hora_solicitada_inicio: string;
  hora_solicitada_fin: string;
  visitante: string;
  casa: string;
  aprobado_por: number;
  aprobado_por_nombre: string;
  creado_en: string;
}
