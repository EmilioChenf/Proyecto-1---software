import { CheckCircle2, MessageSquare, Wrench } from "lucide-react";

import type { TicketDetail } from "@/services/ticketsService";
import { STATUS_META, categoryLabel } from "./ticketLabels";

/** Encabezado, foto e historial de un reporte (lo usan residente, inquilino y administración). */
export function TicketTimeline({ ticket }: { ticket: TicketDetail }) {
  const category = categoryLabel(ticket.categoria);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-slate-500">Reporte #{ticket.id_ticket} · {category.emoji} {category.label}{ticket.casa ? ` · Casa ${ticket.casa}` : ""}</p>
          <h3 className="mt-0.5 text-lg font-bold text-slate-900">{ticket.titulo}</h3>
          {ticket.ubicacion ? <p className="text-sm text-slate-600">📍 {ticket.ubicacion}</p> : null}
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${STATUS_META[ticket.estado].badge}`}>{STATUS_META[ticket.estado].label}</span>
      </div>
      {ticket.descripcion ? <p className="whitespace-pre-line rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{ticket.descripcion}</p> : null}
      {ticket.foto ? <a href={ticket.foto} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-2xl border border-slate-200"><img src={ticket.foto} alt={`Foto del reporte ${ticket.titulo}`} className="max-h-80 w-full object-cover" /></a> : null}
      <ol className="relative space-y-4 border-l-2 border-slate-100 pl-5">
        <li className="relative">
          <span className="absolute -left-[29px] grid size-6 place-items-center rounded-full bg-amber-100 text-amber-700"><Wrench className="size-3.5" /></span>
          <p className="text-sm font-medium text-slate-800">{ticket.reportado_por} reportó la falla</p>
          <p className="text-xs text-slate-500">{ticket.creado_en}</p>
        </li>
        {ticket.historial.map((item) => (
          <li key={item.id_comentario} className="relative">
            <span className={`absolute -left-[29px] grid size-6 place-items-center rounded-full ${item.estado_nuevo === "RESUELTO" ? "bg-emerald-100 text-emerald-700" : item.es_administracion ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
              {item.estado_nuevo === "RESUELTO" ? <CheckCircle2 className="size-3.5" /> : <MessageSquare className="size-3.5" />}
            </span>
            <p className="text-sm font-medium text-slate-800">{item.autor}{item.es_administracion ? " · Administración" : ""}{item.estado_nuevo ? <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${STATUS_META[item.estado_nuevo].badge}`}>{STATUS_META[item.estado_nuevo].label}</span> : null}</p>
            <p className="mt-0.5 whitespace-pre-line text-sm text-slate-600">{item.comentario}</p>
            <p className="text-xs text-slate-400">{item.creado_en}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
