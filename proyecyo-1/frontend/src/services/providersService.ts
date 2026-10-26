import { apiRequest } from "@/services/api";
import type {
  AdminProviderFilters,
  AdminProviderHistoryRecord,
  AdminProviderRecord,
  ProviderRegistrationPayload,
  ProviderRegistrationResult,
  ProviderRegistrationRole,
  TenantProvider,
  TenantProviderFilters,
  TenantProviderHistoryFilters,
  TenantProviderHistoryRecord,
} from "@/types/providers";
import { buildQuery } from "@/utils/queryString";

export function getTenantProvidersRequest(filters: TenantProviderFilters = {}) {
  const query = buildQuery(filters);
  const url = query ? `/inquilino/proveedores?${query}` : "/inquilino/proveedores";
  return apiRequest<TenantProvider[]>(url);
}

export function getTenantProviderHistoryRequest(filters: TenantProviderHistoryFilters = {}) {
  const query = buildQuery(filters);
  const url = query
    ? `/inquilino/proveedores/historial?${query}`
    : "/inquilino/proveedores/historial";
  return apiRequest<TenantProviderHistoryRecord[]>(url);
}

// HU-C06.2: cada rol registra en su propia ruta, con los mismos permisos que el backend.
const providerRegistrationPaths: Record<ProviderRegistrationRole, string> = {
  admin: "/admin/proveedores",
  residente: "/residente/proveedores",
  inquilino: "/inquilino/proveedores",
};

export function registerProviderRequest(role: ProviderRegistrationRole, payload: ProviderRegistrationPayload) {
  return apiRequest<ProviderRegistrationResult>(providerRegistrationPaths[role], {
    method: "POST",
    body: payload,
  });
}

export function updateTenantProviderRequest(serviceId: number, activo: boolean) {
  return apiRequest<TenantProvider>(`/inquilino/proveedores/${serviceId}`, {
    method: "PATCH",
    body: { activo },
  });
}

export function getOwnerProvidersRequest(filters: TenantProviderFilters = {}) {
  const query = buildQuery(filters);
  const url = query ? `/residente/proveedores?${query}` : "/residente/proveedores";
  return apiRequest<AdminProviderRecord[]>(url);
}

export function updateOwnerProviderValidationRequest(payload: {
  id_servicio: number;
  id_casa: number;
  estado: "VALIDADO" | "PENDIENTE";
  activo?: boolean;
}) {
  return apiRequest<AdminProviderRecord>(`/residente/proveedores/${payload.id_servicio}`, {
    method: "PATCH",
    body: payload,
  });
}

export function getAdminProvidersRequest(filters: AdminProviderFilters = {}) {
  const query = buildQuery(filters);
  const url = query ? `/admin/proveedores?${query}` : "/admin/proveedores";
  return apiRequest<AdminProviderRecord[]>(url);
}

export function getAdminProviderHistoryRequest(filters: AdminProviderFilters = {}) {
  const query = buildQuery(filters);
  const url = query ? `/admin/proveedores/historial?${query}` : "/admin/proveedores/historial";
  return apiRequest<AdminProviderHistoryRecord[]>(url);
}

export function updateAdminProviderRequest(payload: {
  id_servicio: number;
  id_casa: number;
  estado: "VALIDADO" | "PENDIENTE";
  activo: boolean;
}) {
  return apiRequest<AdminProviderRecord>(`/admin/proveedores/${payload.id_servicio}`, {
    method: "PATCH",
    body: payload,
  });
}
