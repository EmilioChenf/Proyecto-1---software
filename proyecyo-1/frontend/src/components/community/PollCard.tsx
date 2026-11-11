import { CheckCircle2, Clock, Lock } from "lucide-react";

import type { Poll } from "@/services/communityService";

/** Tarjeta de votación: botones para votar o barras con resultados. */
export function PollCard({ poll, onVote, busy = false, actions }: { poll: Poll; onVote?: (optionId: number) => void; busy?: boolean; actions?: React.ReactNode }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-lg font-bold text-slate-900">{poll.titulo}</h3>
        <span className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${poll.abierta ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
          {poll.abierta ? <Clock className="size-3.5" /> : <Lock className="size-3.5" />}{poll.abierta ? `Cierra ${poll.fecha_cierre}` : "Cerrada"}
        </span>
      </div>
      {poll.descripcion ? <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{poll.descripcion}</p> : null}
      <ul className="mt-4 space-y-2">
        {poll.opciones.map((option) => {
          const mine = poll.mi_voto === option.id_opcion;
          if (poll.puede_votar && onVote) {
            return <li key={option.id_opcion}><button type="button" disabled={busy} onClick={() => onVote(option.id_opcion)} className="w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-left text-sm font-medium text-slate-800 transition hover:border-slate-900 hover:bg-slate-50">{option.texto}</button></li>;
          }
          const pct = poll.total_votos && option.votos != null ? Math.round((option.votos / poll.total_votos) * 100) : 0;
          return (
            <li key={option.id_opcion} className={`rounded-xl border px-4 py-2.5 ${mine ? "border-slate-900" : "border-slate-200"}`}>
              <div className="flex items-center justify-between text-sm"><span className="flex items-center gap-1.5 font-medium text-slate-800">{mine ? <CheckCircle2 className="size-4 text-emerald-600" aria-label="Tu voto" /> : null}{option.texto}</span>
                {poll.mostrar_resultados ? <span className="text-slate-600">{pct}% <span className="text-xs text-slate-400">({option.votos} {option.votos === 1 ? "voto" : "votos"})</span></span> : null}</div>
              {poll.mostrar_resultados ? <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#2a78d6]" style={{ width: `${pct}%` }} /></div> : null}
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>{poll.total_votos} de {poll.viviendas} viviendas votaron ({poll.participacion}%) · un voto por vivienda</span>
        {poll.mi_voto && !poll.mostrar_resultados ? <span>Tu voto quedó registrado. Los resultados se verán al cerrar.</span> : null}
        {poll.sin_vivienda ? <span className="text-amber-700">Tu usuario no tiene vivienda asignada para votar.</span> : null}
      </div>
      {actions ? <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">{actions}</div> : null}
    </article>
  );
}
