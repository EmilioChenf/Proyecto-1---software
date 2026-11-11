import type { TicketPriority, TicketStatus } from "@/services/ticketsService";

export const TICKET_CATEGORIES: Array<{ id: string; label: string; emoji: string }> = [
  { id: "ELECTRICIDAD", label: "Electricidad", emoji: "💡" },
  { id: "AGUA_PLOMERIA", label: "Agua y plomería", emoji: "🚰" },
  { id: "AREAS_COMUNES", label: "Áreas comunes", emoji: "🏊" },
  { id: "SEGURIDAD", label: "Seguridad", emoji: "🛡️" },
  { id: "JARDINERIA", label: "Jardinería", emoji: "🌳" },
  { id: "LIMPIEZA", label: "Limpieza", emoji: "🧹" },
  { id: "OTRO", label: "Otro", emoji: "📝" },
];
export const categoryLabel = (id: string) => TICKET_CATEGORIES.find((c) => c.id === id) ?? TICKET_CATEGORIES[TICKET_CATEGORIES.length - 1];
export const STATUS_META: Record<TicketStatus, { label: string; badge: string; dot: string }> = {
  ABIERTO: { label: "Abierto", badge: "bg-amber-50 text-amber-700 ring-amber-600/20", dot: "bg-amber-500" },
  EN_PROCESO: { label: "En proceso", badge: "bg-blue-50 text-blue-700 ring-blue-600/20", dot: "bg-blue-500" },
  RESUELTO: { label: "Resuelto", badge: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", dot: "bg-emerald-500" },
  CERRADO: { label: "Cerrado", badge: "bg-slate-100 text-slate-600 ring-slate-500/20", dot: "bg-slate-400" },
};
export const PRIORITY_META: Record<TicketPriority, { label: string; badge: string }> = {
  BAJA: { label: "Baja", badge: "bg-slate-100 text-slate-600" },
  MEDIA: { label: "Media", badge: "bg-sky-50 text-sky-700" },
  ALTA: { label: "Alta", badge: "bg-orange-50 text-orange-700" },
  URGENTE: { label: "Urgente", badge: "bg-rose-50 text-rose-700" },
};
