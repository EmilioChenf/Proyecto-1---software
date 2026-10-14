import { apiRequest } from './api';
export type ReportCapability = { id: string; title: string; formats: string[]; maxRows: number; usesDates: boolean;
  columns: string[]; filters: { key: string; label: string; options?: string[] }[] };
export const getReportCatalog = (signal?: AbortSignal) => apiRequest<ReportCapability[]>('/admin/reportes/catalogo', { signal });
