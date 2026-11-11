export type UserRole = "admin" | "guardia" | "residente" | "inquilino";

export interface AuthUser {
  id: number;
  email: string;
  role: UserRole;
  token?: string;
  /** Solo para roles personalizados: el panel muestra únicamente sus módulos. */
  rol_personalizado?: { id: number; nombre: string };
  permisos?: Record<string, "VER" | "EDITAR">;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export type LoginResponse = AuthUser;

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

// El backend revoca todas las sesiones previas y devuelve una nueva para este dispositivo.
export interface ChangePasswordResponse extends AuthUser {
  message: string;
  token: string;
}
