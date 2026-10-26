import type { ProviderEntryMode } from "@/utils/providerAccess";
import type { VisitRecord } from "@/types/visits";

export type TenantProviderStatus = "VALIDADO" | "PENDIENTE";

export interface TenantProvider {
  id_servicio: number;
  nombre: string;
  tipo_servicio: string;
  descripcion: string;
  activo: boolean;
  estado: TenantProviderStatus;
  casa_unidad: string;
  fecha_registro: string | null;
  actualizado_en: string | null;
  registrado_por: string | null;
}

export interface TenantProviderHistoryRecord {
  id_historial: number;
  id_servicio: number;
  proveedor_nombre: string;
  accion: string;
  detalle: string;
  activo_anterior: boolean | null;
  activo_nuevo: boolean | null;
  estado_anterior: TenantProviderStatus | null;
  estado_nuevo: TenantProviderStatus | null;
  realizado_por_usuario: number;
  realizado_por_nombre: string;
  realizado_por_rol: string;
  creado_en: string;
}

export interface TenantProviderFilters {
  search?: string;
  status?: TenantProviderStatus | "TODOS";
  date?: string;
}

export interface TenantProviderHistoryFilters {
  user?: string;
  date?: string;
  providerId?: number;
}

export type AdminProviderActivityFilter = "TODOS" | "ACTIVO" | "INACTIVO";

export interface AdminProviderRecord extends TenantProvider {
  id_casa: number;
  propietario_nombre: string;
  ultimo_cambio_por: string;
  ultimo_cambio_en: string;
  frecuencia_cambios: number;
}

export interface AdminProviderHistoryRecord {
  id_historial: number;
  id_servicio: number;
  proveedor_nombre: string;
  casa_unidad: string;
  accion: string;
  detalle: string;
  realizado_por_nombre: string;
  realizado_por_rol: string;
  estado_anterior: TenantProviderStatus | null;
  estado_nuevo: TenantProviderStatus | null;
  activo_anterior: boolean | null;
  activo_nuevo: boolean | null;
  creado_en: string;
}

export interface AdminProviderFilters {
  search?: string;
  house?: string;
  user?: string;
  date?: string;
  status?: TenantProviderStatus | "TODOS";
  activity?: AdminProviderActivityFilter;
}

// HU-C06: registro de proveedor (vinculo con la casa + acceso con QR) por rol.
export type ProviderRegistrationRole = "admin" | "residente" | "inquilino";

export interface ProviderRegistrationPayload {
  nombre: string;
  motivo_servicio: string;
  medio_ingreso: ProviderEntryMode;
  placa: string;
  dpi: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  observaciones?: string;
  id_casa?: number;
  confirmar_actualizacion?: boolean;
}

export interface ProviderRegistrationResult {
  proveedor: AdminProviderRecord | null;
  acceso: VisitRecord;
}
