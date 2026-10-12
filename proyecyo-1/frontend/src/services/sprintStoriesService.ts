import { apiRequest } from "@/services/api";
import type {
  AuthorizationDecision,
  AuthorizationRequest,
  OwnerAuthorizationRequest,
  GuardAccessHistoryRecord,
  Regulation,
  TenantPermission,
} from "@/types/sprintStories";

export function getTenantPermissionsRequest() {
  return apiRequest<TenantPermission[]>("/inquilino/permisos");
}

export function getTenantAuthorizationRequestsRequest() {
  return apiRequest<AuthorizationRequest[]>("/inquilino/autorizaciones");
}

export function createTenantAuthorizationRequest(payload: { accion: string; motivo: string }) {
  return apiRequest<AuthorizationRequest>("/inquilino/autorizaciones", {
    method: "POST",
    body: payload,
  });
}

/** Solicitudes de inquilinos de las unidades del residente autenticado. */
export function getOwnerAuthorizationRequestsRequest(estado: "PENDIENTE" | "TODAS" = "PENDIENTE") {
  return apiRequest<OwnerAuthorizationRequest[]>(`/residente/solicitudes-autorizacion?estado=${estado}`);
}

export function resolveOwnerAuthorizationRequest(id: number, decision: AuthorizationDecision, respuesta = "") {
  return apiRequest<OwnerAuthorizationRequest>(`/residente/solicitudes-autorizacion/${id}`, {
    method: "PATCH",
    body: { decision, respuesta },
  });
}
export function getCompanyAuthorizationRequestsRequest(){return apiRequest<OwnerAuthorizationRequest[]>('/admin/solicitudes-arrendatarios?estado=TODAS');}
export function resolveCompanyAuthorizationRequest(id:number,decision:AuthorizationDecision,respuesta=''){return apiRequest<OwnerAuthorizationRequest>(`/admin/solicitudes-arrendatarios/${id}`,{method:'PATCH',body:{decision,respuesta}});}

export function getResidentRegulationsRequest(filters: { search?: string; category?: string } = {}) {
  const query = new URLSearchParams();

  if (filters.search?.trim()) {
    query.set("search", filters.search.trim());
  }

  if (filters.category?.trim()) {
    query.set("category", filters.category.trim());
  }

  const queryString = query.toString();
  return apiRequest<Regulation[]>(
    queryString ? `/residente/reglamentos?${queryString}` : "/residente/reglamentos",
  );
}

export function getGuardAccessHistoryRequest(
  filters: { date?: string; status?: string; search?: string } = {},
) {
  const query = new URLSearchParams();

  if (filters.date) {
    query.set("date", filters.date);
  }

  if (filters.status && filters.status !== "TODOS") {
    query.set("status", filters.status);
  }

  if (filters.search?.trim()) {
    query.set("search", filters.search.trim());
  }

  const queryString = query.toString();
  return apiRequest<GuardAccessHistoryRecord[]>(
    queryString ? `/guardia/historial-accesos?${queryString}` : "/guardia/historial-accesos",
  );
}
