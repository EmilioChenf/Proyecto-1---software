import { apiRequest } from "@/services/api";

export type IntegrationStatus = {
  recurrente: { modo: string; configurado: boolean; llave: string | null; sandbox_id: string | null; webhook_configurado: boolean; url_webhook: string; conexion: { ok: boolean; mensaje: string } | null };
  fel: { modo: string; datos_completos: boolean; certificador: string | null };
  produccion: Array<{ paso: string; responsable: string }>;
};
export type FiscalSettings = { modo: "DESACTIVADO" | "SIMULADO"; nit: string; nombre_emisor: string; nombre_comercial: string; direccion: string; regimen: "GENERAL" | "PEQUENO_CONTRIBUYENTE"; certificador: string; completos?: boolean };

export const getIntegrationStatusRequest = (probar = false) => apiRequest<IntegrationStatus>(`/admin/pagos/integracion${probar ? "?probar=1" : ""}`);
export const getFiscalSettingsRequest = () => apiRequest<FiscalSettings>("/admin/configuracion/fiscal");
export const updateFiscalSettingsRequest = (body: FiscalSettings) => apiRequest<FiscalSettings>("/admin/configuracion/fiscal", { method: "PUT", body });
