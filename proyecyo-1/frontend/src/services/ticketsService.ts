import { apiRequest } from "@/services/api";

export type TicketStatus = "ABIERTO" | "EN_PROCESO" | "RESUELTO" | "CERRADO";
export type TicketPriority = "BAJA" | "MEDIA" | "ALTA" | "URGENTE";
export type Ticket = {
  id_ticket: number; titulo: string; descripcion: string; categoria: string; prioridad: TicketPriority; estado: TicketStatus;
  ubicacion: string; reportado_por: string; casa: string | null; creado_en: string; actualizado_en: string | null; resuelto_en: string | null;
  tiene_foto: boolean; comentarios: number;
};
export type TicketDetail = Ticket & { foto: string | null; historial: Array<{ id_comentario: number; comentario: string; estado_nuevo: TicketStatus | null; autor: string; es_administracion: boolean; creado_en: string }> };
export type TicketSummary = Record<TicketStatus, number> & { horas_promedio_resolucion: number | null };

export const listMyTicketsRequest = () => apiRequest<Ticket[]>("/tickets");
export const getMyTicketRequest = (id: number) => apiRequest<TicketDetail>(`/tickets/${id}`);
export const createTicketRequest = (body: { titulo: string; descripcion: string; categoria: string; ubicacion: string; foto: string | null }) => apiRequest<TicketDetail>("/tickets", { method: "POST", body });
export const commentMyTicketRequest = (id: number, body: { comentario: string; reabrir?: boolean }) => apiRequest<TicketDetail>(`/tickets/${id}/comentarios`, { method: "POST", body });
export const listAdminTicketsRequest = (filters: { estado?: string; categoria?: string; q?: string } = {}) =>
  apiRequest<Ticket[]>(`/admin/tickets?${new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as Array<[string, string]>).toString()}`);
export const getAdminTicketRequest = (id: number) => apiRequest<TicketDetail>(`/admin/tickets/${id}`);
export const getTicketSummaryRequest = () => apiRequest<TicketSummary>("/admin/tickets/resumen");
export const updateAdminTicketRequest = (id: number, body: { estado?: string; prioridad?: string; comentario?: string }) => apiRequest<TicketDetail>(`/admin/tickets/${id}`, { method: "PATCH", body });
