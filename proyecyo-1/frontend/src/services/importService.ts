import { apiDownload, apiRequest } from "@/services/api";

export type ImportRow = { fila: number; estado: "NUEVA" | "NUEVO" | "YA_EXISTE" | "ERROR"; errores: string[]; vivienda?: string; nombre?: string; correo?: string; monto?: number; fecha_limite?: string | null };
export type ImportPreview = { viviendas: ImportRow[]; residentes: ImportRow[]; inquilinos: ImportRow[]; saldos: ImportRow[]; resumen: { listas: number; existentes: number; errores: number; ejemplos_ignorados: number } };
export type ImportReport = { viviendas: number; residentes: number; inquilinos: number; saldos: number; omitidas: number; invitaciones: number; fallidas: Array<{ hoja: string; fila: number; error: string }> };

export async function downloadImportTemplate() {
  const blob = await apiDownload("/admin/importar/plantilla");
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: "plantilla-importacion-nexus.xlsx" });
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const previewImportRequest = (archivo: string) => apiRequest<ImportPreview>("/admin/importar/vista-previa", { method: "POST", body: { archivo } });
export const applyImportRequest = (archivo: string, invitar: boolean) => apiRequest<ImportReport>("/admin/importar/aplicar", { method: "POST", body: { archivo, invitar } });
