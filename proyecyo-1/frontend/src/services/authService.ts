import { apiRequest } from "./api";
import type { ChangePasswordPayload, ChangePasswordResponse, LoginPayload, LoginResponse } from "@/types/auth";

export function loginRequest(payload: LoginPayload) {
  return apiRequest<LoginResponse>("/login", {
    method: "POST",
    body: payload,
  });
}

// Consulta el rol y estado actuales del usuario para refrescar sus permisos.
export function getSessionRequest() {
  return apiRequest<LoginResponse>("/auth/session");
}

export function changePasswordRequest(payload: ChangePasswordPayload) {
  return apiRequest<ChangePasswordResponse>("/auth/password/change", {
    method: "POST",
    body: payload,
  });
}

export function logoutRequest() {
  return apiRequest<{ message: string }>("/auth/logout", { method: "POST" });
}
