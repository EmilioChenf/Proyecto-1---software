import { apiRequest } from './api';
export type ActivityKind = 'pago' | 'reserva' | 'visita' | 'sancion';
export type ResidentActivity = { id: string; tipo: ActivityKind; fecha: string | null; hora: string | null;
  titulo: string; estado: string; monto: number | null; detalle: string | null };
export type ActivityPage = { items: ResidentActivity[]; page: number; limit: number; hasMore: boolean };
export type ActivityFilters = { tipo: string; desde: string; hasta: string };
export const activityLabels: Record<ActivityKind, string> = { pago: 'Pago', reserva: 'Reserva', visita: 'Visita', sancion: 'Sanción' };
export function getResidentActivity(filters: ActivityFilters, page: number, signal?: AbortSignal) {
  return apiRequest<ActivityPage>(`/residente/actividad?${new URLSearchParams({ ...filters, page: String(page), limit: '20' })}`, { signal });
}
