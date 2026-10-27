export type AdminAccessType = "RESIDENTE" | "VISITANTE" | "PROVEEDOR";

export type AdminAccessStatus = "APROBADO" | "PENDIENTE" | "RECHAZADO";

export type AdminAccessFilterType = AdminAccessType | "TODOS";

export type AdminAccessFilterStatus = AdminAccessStatus | "TODOS";

export interface AdminAccessSummary {
  total_dia: number;
  aprobados: number;
  pendientes: number;
  rechazados: number;
}

export interface AdminAccessHourlyPoint {
  hora: string;
  total: number;
  aprobados: number;
  pendientes: number;
  rechazados: number;
}

// SCRUM-173: Punto de datos para grafica diaria (ultimos 7 dias)
export interface AdminAccessDailyPoint {
  fecha: string;
  total: number;
  aprobados: number;
  pendientes: number;
  rechazados: number;
}

export interface AdminAccessRecord {
  id_acceso: number;
  fecha: string;
  hora: string;
  hora_salida?: string | null;
  tipo: AdminAccessType;
  nombre: string;
  casa_unidad: string;
  placa: string;
  estado: AdminAccessStatus;
  /** HU-C04.5: estado exacto (CANCELADA, VENCIDA, SALIDA_REGISTRADA, ...). */
  estado_detalle?: string;
  hora_ingreso?: string | null;
  cancelado_por?: string | null;
  eliminado_por_residente?: boolean;
  autorizado_por: string;
  es_acceso_especial?: boolean;
  fuera_horario?: boolean;
  /** HU-C08: guardia que registro la entrada/salida (null en historicos). */
  guardia_ingreso?: string | null;
  guardia_salida?: string | null;
}

export interface AdminAccessFilters {
  search?: string;
  house?: string;
  plate?: string;
  type?: AdminAccessFilterType;
  status?: AdminAccessFilterStatus;
}
