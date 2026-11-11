import { useEffect, useRef, useState } from "react";
import { Camera, ChevronRight, Loader2, Plus, Send, Wrench, X } from "lucide-react";

import { ResidentLayout } from "@/components/residente/ResidentLayout";
import { TenantLayout } from "@/components/inquilino/TenantLayout";
import { TicketTimeline } from "@/components/tickets/TicketTimeline";
import { STATUS_META, TICKET_CATEGORIES, categoryLabel } from "@/components/tickets/ticketLabels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { commentMyTicketRequest, createTicketRequest, getMyTicketRequest, listMyTicketsRequest, type Ticket, type TicketDetail } from "@/services/ticketsService";
import { notifyError, notifySuccess } from "@/utils/feedback";
import { resizeImageFile } from "@/utils/imageResize";

const EMPTY = { titulo: "", descripcion: "", categoria: "ELECTRICIDAD", ubicacion: "", foto: null as string | null };

/** Reportes de fallas del residente o inquilino: crear con foto y dar seguimiento. */
export function ResidentTicketsView({ role = "residente" }: { role?: "residente" | "inquilino" }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<TicketDetail | null>(null);
  const [comment, setComment] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    try { setTickets(await listMyTicketsRequest()); } catch (reason) { void notifyError(reason, "No fue posible cargar tus reportes."); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    try { const foto = await resizeImageFile(file); setForm((current) => ({ ...current, foto })); } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible usar la foto."); }
  }

  async function submit() {
    if (form.titulo.trim().length < 4) { setError("Describe brevemente qué falla (mínimo 4 letras)."); return; }
    setBusy(true); setError("");
    try {
      const ticket = await createTicketRequest(form);
      setForm(EMPTY); setCreating(false); setSelected(ticket);
      await load();
      void notifySuccess("La administración recibió tu reporte. Te avisaremos cada vez que cambie de estado.", "Reporte enviado");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible enviar el reporte.");
    } finally { setBusy(false); }
  }

  async function sendComment(reopen = false) {
    if (!selected || comment.trim().length < 2) return;
    try {
      setSelected(await commentMyTicketRequest(selected.id_ticket, { comentario: comment.trim(), reabrir: reopen }));
      setComment("");
      await load();
    } catch (reason) { void notifyError(reason, "No fue posible enviar el comentario."); }
  }

  const open = async (id: number) => { try { setSelected(await getMyTicketRequest(id)); } catch (reason) { void notifyError(reason, "No fue posible abrir el reporte."); } };

  const content = (
      <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
        <section className="space-y-3">
          <Button type="button" className="h-12 w-full rounded-2xl text-base" onClick={() => { setCreating(true); setSelected(null); setError(""); }}><Plus className="size-5" />Reportar una falla</Button>
          {loading ? <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" />Cargando…</p> : tickets.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500"><Wrench className="mx-auto mb-2 size-8 text-slate-300" />Aún no has reportado fallas.</div>
          ) : (
            <ul className="space-y-2">{tickets.map((ticket) => (
              <li key={ticket.id_ticket}>
                <button type="button" onClick={() => void open(ticket.id_ticket)} className={`flex w-full items-center gap-3 rounded-2xl border bg-white p-4 text-left transition hover:border-slate-300 ${selected?.id_ticket === ticket.id_ticket ? "border-slate-900" : "border-slate-200"}`}>
                  <span className="text-2xl" aria-hidden>{categoryLabel(ticket.categoria).emoji}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-slate-900">{ticket.titulo}</span><span className="text-xs text-slate-500">#{ticket.id_ticket} · {ticket.creado_en}{ticket.comentarios ? ` · ${ticket.comentarios} respuesta(s)` : ""}</span></span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${STATUS_META[ticket.estado].badge}`}>{STATUS_META[ticket.estado].label}</span>
                  <ChevronRight className="size-4 text-slate-400" />
                </button>
              </li>
            ))}</ul>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {creating ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between"><h2 className="text-lg font-bold text-slate-900">Nuevo reporte</h2><button type="button" aria-label="Cerrar" onClick={() => setCreating(false)}><X className="size-5 text-slate-400" /></button></div>
              <div>
                <p className="text-sm font-medium text-slate-700">¿De qué se trata?</p>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">{TICKET_CATEGORIES.map((category) => (
                  <button key={category.id} type="button" aria-pressed={form.categoria === category.id} onClick={() => setForm((current) => ({ ...current, categoria: category.id }))}
                    className={`rounded-xl border p-2.5 text-center text-xs font-medium ${form.categoria === category.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>
                    <span className="block text-xl">{category.emoji}</span>{category.label}
                  </button>
                ))}</div>
              </div>
              <label className="block text-sm font-medium text-slate-700">¿Qué falla?<Input aria-label="Título del reporte" className="mt-1.5" maxLength={120} placeholder="Ej. Se fundió la lámpara del parqueo" value={form.titulo} onChange={(e) => setForm((c) => ({ ...c, titulo: e.target.value }))} /></label>
              <label className="block text-sm font-medium text-slate-700">¿Dónde?<Input aria-label="Ubicación" className="mt-1.5" maxLength={120} placeholder="Ej. Parqueo de visitas, frente a la casa 12" value={form.ubicacion} onChange={(e) => setForm((c) => ({ ...c, ubicacion: e.target.value }))} /></label>
              <label className="block text-sm font-medium text-slate-700">Detalles (opcional)<textarea aria-label="Detalles" maxLength={1000} value={form.descripcion} onChange={(e) => setForm((c) => ({ ...c, descripcion: e.target.value }))} className="mt-1.5 min-h-24 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
              <div>
                <input ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Foto de la falla" onChange={(e) => void pickPhoto(e.target.files?.[0])} />
                {form.foto ? (
                  <div className="relative overflow-hidden rounded-2xl border border-slate-200"><img src={form.foto} alt="Foto adjunta" className="max-h-60 w-full object-cover" /><button type="button" onClick={() => setForm((c) => ({ ...c, foto: null }))} className="absolute right-2 top-2 rounded-full bg-white/90 p-1.5 shadow"><X className="size-4" /></button></div>
                ) : (
                  <button type="button" onClick={() => fileRef.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 p-5 text-sm font-medium text-slate-600 hover:bg-slate-50"><Camera className="size-5" />Tomar o subir una foto</button>
                )}
              </div>
              {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
              <Button type="button" className="w-full" disabled={busy} onClick={() => void submit()}>{busy ? "Enviando…" : "Enviar reporte"}</Button>
            </div>
          ) : selected ? (
            <div className="space-y-4">
              <TicketTimeline ticket={selected} />
              <div className="border-t border-slate-100 pt-4">
                <label className="block text-sm font-medium text-slate-700">Agregar un comentario<textarea aria-label="Comentario" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} className="mt-1.5 min-h-20 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Ej. Sigue sin funcionar desde anoche" /></label>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => void sendComment(false)} disabled={comment.trim().length < 2}><Send className="size-4" />Enviar</Button>
                  {["RESUELTO", "CERRADO"].includes(selected.estado) ? <Button type="button" variant="outline" onClick={() => void sendComment(true)} disabled={comment.trim().length < 2}>Sigue fallando · reabrir</Button> : null}
                </div>
              </div>
            </div>
          ) : (
            <div className="grid h-full min-h-60 place-items-center text-center text-sm text-slate-500"><div><Wrench className="mx-auto mb-2 size-10 text-slate-300" />Elige un reporte para ver su avance o crea uno nuevo.</div></div>
          )}
        </section>
      </div>
  );
  const subtitle = "Avisa a la administración y sigue el avance hasta que se resuelva.";
  return role === "inquilino"
    ? <TenantLayout title="Reportar una falla" subtitle={subtitle}>{content}</TenantLayout>
    : <ResidentLayout title="Reportar una falla" subtitle={subtitle}>{content}</ResidentLayout>;
}
