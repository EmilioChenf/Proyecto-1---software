import { apiRequest } from "@/services/api";

export type SetupStatus = { pasos: Array<{ id: string; label: string; done: boolean }>; completados: number; total: number; oculto: boolean; conteos: { viviendas: number; personas: number; amenidades: number; guardias: number } };
export const getSetupStatusRequest = () => apiRequest<SetupStatus>("/admin/configuracion/primeros-pasos");
export const hideSetupRequest = (oculto: boolean) => apiRequest<SetupStatus>("/admin/configuracion/primeros-pasos/oculto", { method: "PUT", body: { oculto } });
export const markSetupStepRequest = (paso: string) => apiRequest<SetupStatus>(`/admin/configuracion/primeros-pasos/${paso}/revisado`, { method: "POST" });
