import { apiRequest } from "@/services/api";
import type { ModuleLevel } from "@/config/roleModules";

export type RoleModule = { id: string; label: string; solo_lectura: boolean };
export type CustomRole = { id: number; nombre: string; descripcion: string | null; color: string; usuarios: number; permisos: Record<string, ModuleLevel> };
export type RolePayload = { nombre: string; descripcion: string; color: string; permisos: Record<string, ModuleLevel | "NINGUNO"> };

export const listRolesRequest = () => apiRequest<{ roles: CustomRole[]; modulos: RoleModule[]; colores: string[] }>("/admin/roles");
export const createRoleRequest = (body: RolePayload) => apiRequest<CustomRole>("/admin/roles", { method: "POST", body });
export const updateRoleRequest = (id: number, body: RolePayload) => apiRequest<CustomRole>(`/admin/roles/${id}`, { method: "PUT", body });
export const deleteRoleRequest = (id: number) => apiRequest<CustomRole>(`/admin/roles/${id}`, { method: "DELETE" });
