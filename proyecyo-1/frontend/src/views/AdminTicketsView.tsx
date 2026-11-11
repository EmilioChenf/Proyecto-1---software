import { useEffect, useMemo, useState } from "react";
import { Clock, Image as ImageIcon, Loader2, MessageSquare, Search, Wrench, X } from "lucide-react";

import { AdminLayout } from "@/components/admin/AdminLayout";
import { TicketTimeline } from "@/components/tickets/TicketTimeline";
import { PRIORITY_META, STATUS_META, TICKET_CATEGORIES, categoryLabel } from "@/components/tickets/ticketLabels";
import { Button } from "@/components/ui/button";
import { getAdminTicketRequest, getTicketSummaryRequest, listAdminTicketsRequest, updateAdminTicketRequest, type Ticket, type TicketDetail, type TicketPriority, type TicketStatus, type TicketSummary } from "@/services/ticketsService";
import { notifyError, notifySuccess } from "@/utils/feedback";

const COLUMNS: TicketStatus[] = ["ABIERTO", "EN_PROCESO", "RESUELTO"];

/** Tablero de reportes de fallas y mantenimiento para la administración. */
export function AdminTicketsView() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [summary, setSummary] = useState<TicketSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [selected, setSelected] = useState<TicketDetail | null>(null);
  const [answer, setAnswer] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const [list, totals] = await Promise.all([listAdminTicketsRequest({ categoria: category, q: search }), getTicketSummaryRequest()]);
      setTickets(list); setSummary(totals);
    } catch (reason) { void notifyError(reason, "No fue posible cargar los reportes."); } finally { setLoading(false); }
  }
  useEffect(() => { const timer = setTimeout(() => void load(), 250); return () => clearTimeout(timer); }, [category, search]);

  const byStatus = useMemo(() => Object.fromEntries([...COLUMNS, "CERRADO"].map((status) => [status, tickets.filter((t) => t.estado === status)])) as Record<TicketStatus, Ticket[]>, [tickets]);

  async function open(id: number) {
    try { setSelected(await getAdminTicketRequest(id)); setAnswer(""); } catch (reason) { void notifyError(reason, "No fue posible abrir el reporte."); }
  }

  async function update(changes: { estado?: TicketStatus; prioridad?: TicketPriority; comentario?: string }) {
    if (!selected) return;
    setSaving(true);
    try {
      const updated = await updateAdminTicketRequest(selected.id_ticket, changes);
      setSelected(updated); setAnswer("");
      await load();
      void notifySuccess(changes.estado ? `Reporte #${updated.id_ticket} ${STATUS_META[updated.estado].label.toLowerCase()}. Se avisó a ${updated.reportado_por}.` : "Respuesta enviada al residente.");
    } catch (reason) { void notifyError(reason, "No fue posible actualizar el reporte."); } finally { setSaving(false); }
  }

  return (
    <AdminLayout title="Fallas y mantenimiento" subtitle="Reportes de residentes e inquilinos, desde que llegan hasta que se resuelven.">
      <div className="grid gap-3 sm:grid-cols-4">
        {[["Abiertos", summary?.ABIERTO, "text-amber-600"], ["En proceso", summary?.EN_PROCESO, "text-blue-600"], ["Resueltos", summary?.RESUELTO, "text-emerald-600"], ["Tiempo promedio de solución", summary?.horas_promedio_resolucion == null ? "—" : `${summary.horas_promedio_resolucion} h`, "text-slate-900"]].map(([label, value, tone]) => (
          <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-medium text-slate-500">{label}</p><p className={`mt-1 text-2xl font-bold ${tone}`}>{value ?? 0}</p></div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <label className="relative min-w-56 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input aria-label="Buscar reportes" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por título, lugar o persona" className="h-10 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm" /></label>
        <select aria-label="Categoría" value={category} onChange={(e) => setCategory(e.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm"><option value="">Todas las categorías</option>{TICKET_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}</select>
        <label className="flex items-center gap-2 px-2 text-sm text-slate-600"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />Ver cerrados ({byStatus.CERRADO?.length ?? 0})</label>
      </div>

      {loading ? <p className="mt-6 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" />Cargando reportes…</p> : (
        <div className={`mt-4 grid gap-4 ${showClosed ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
          {[...COLUMNS, ...(showClosed ? ["CERRADO" as const] : [])].map((status) => (
            <section key={status} className="rounded-2xl bg-slate-100/70 p-3">
              <h2 className="mb-3 flex items-center gap-2 px-1 text-sm font-semibold text-slate-700"><span className={`size-2 rounded-full ${STATUS_META[status].dot}`} />{STATUS_META[status].label}<span className="rounded-full bg-white px-2 text-xs text-slate-500">{byStatus[status]?.length ?? 0}</span></h2>
              <ul className="space-y-2">
                {(byStatus[status] ?? []).map((ticket) => (
                  <li key={ticket.id_ticket}>
                    <button type="button" onClick={() => void open(ticket.id_ticket)} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow">
                      <div className="flex items-start justify-between gap-2"><p className="font-semibold text-slate-900">{categoryLabel(ticket.categoria).emoji} {ticket.titulo}</p><span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${PRIORITY_META[ticket.prioridad].badge}`}>{PRIORITY_META[ticket.prioridad].label}</span></div>
                      <p className="mt-1 text-xs text-slate-500">{ticket.reportado_por}{ticket.casa ? ` · Casa ${ticket.casa}` : ""}{ticket.ubicacion ? ` · ${ticket.ubicacion}` : ""}</p>
                      <p className="mt-2 flex items-center gap-3 text-xs text-slate-400"><span className="flex items-center gap-1"><Clock className="size-3" />{ticket.creado_en}</span>{ticket.tiene_foto ? <ImageIcon className="size-3.5" /> : null}{ticket.comentarios ? <span className="flex items-center gap-1"><MessageSquare className="size-3" />{ticket.comentarios}</span> : null}</p>
                    </button>
                  </li>
                ))}
                {(byStatus[status] ?? []).length === 0 ? <li className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-xs text-slate-400">Sin reportes</li> : null}
              </ul>
            </section>
          ))}
        </div>
      )}

      {selected ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/40" onClick={() => setSelected(null)}>
          <aside role="dialog" aria-label={`Reporte ${selected.titulo}`} className="h-full w-full max-w-xl overflow-y-auto bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between"><p className="flex items-center gap-2 text-sm font-semibold text-slate-500"><Wrench className="size-4" />Gestionar reporte</p><button type="button" aria-label="Cerrar" onClick={() => setSelected(null)}><X className="size-5 text-slate-400" /></button></div>
            <div className="mb-5 grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2">
              <div><p className="mb-1.5 text-xs font-medium text-slate-500">Estado</p><div className="flex flex-wrap gap-1.5">{(["ABIERTO", "EN_PROCESO", "RESUELTO", "CERRADO"] as TicketStatus[]).map((status) => (
                <button key={status} type="button" disabled={saving || selected.estado === status} onClick={() => void update({ estado: status, comentario: answer.trim() || undefined })}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${selected.estado === status ? STATUS_META[status].badge : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-100"}`}>{STATUS_META[status].label}</button>
              ))}</div></div>
              <div><p className="mb-1.5 text-xs font-medium text-slate-500">Prioridad</p><div className="flex flex-wrap gap-1.5">{(["BAJA", "MEDIA", "ALTA", "URGENTE"] as TicketPriority[]).map((priority) => (
                <button key={priority} type="button" disabled={saving || selected.prioridad === priority} onClick={() => void update({ prioridad: priority })}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${selected.prioridad === priority ? PRIORITY_META[priority].badge + " ring-1 ring-inset ring-current" : "bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-100"}`}>{PRIORITY_META[priority].label}</button>
              ))}</div></div>
              <label className="text-sm font-medium text-slate-700 sm:col-span-2">Respuesta al residente<textarea aria-label="Respuesta al residente" value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={1000} placeholder="Ej. El electricista viene mañana a las 9:00" className="mt-1.5 min-h-20 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" /></label>
              <div className="sm:col-span-2"><Button type="button" disabled={saving || answer.trim().length < 2} onClick={() => void update({ comentario: answer.trim() })}>{saving ? "Guardando…" : "Enviar respuesta"}</Button><span className="ml-3 text-xs text-slate-500">Al cambiar el estado, la respuesta escrita se envía junto con el cambio.</span></div>
            </div>
            <TicketTimeline ticket={selected} />
          </aside>
        </div>
      ) : null}
    </AdminLayout>
  );
}
