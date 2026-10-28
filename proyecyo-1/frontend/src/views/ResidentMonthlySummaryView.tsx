import { useFeedbackState } from "@/hooks/useFeedbackState";
import { useEffect, useState } from "react";
import { BarChart3, CalendarDays, Clock3, KeyRound, UserRoundCheck, type LucideIcon } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/services/api";

type MonthlySummary = {
  visitas: { total: number };
  accesos: { total: number };
  reservas: { total: number; amenidades_utilizadas: number };
  actividades_recientes: { fecha: string; tipo: string; detalle: string }[];
};

const monthNames = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export function ResidentMonthlySummaryView() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState<MonthlySummary>();
  const [error, setError] = useFeedbackState("error", "");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError("");
    apiRequest<MonthlySummary>(`/residente/resumen-mensual?month=${month}&year=${year}`)
      .then(setData)
      .catch((reason) => setError(reason instanceof Error && reason.message ? reason.message : "No fue posible cargar el resumen."))
      .finally(() => setLoading(false));
  }, [month, year]);

  const cards: { label: string; value: number; icon: LucideIcon }[] = data
    ? [
        { label: "Visitas", value: data.visitas.total, icon: UserRoundCheck },
        { label: "Accesos", value: data.accesos.total, icon: KeyRound },
        { label: "Reservas", value: data.reservas.total, icon: CalendarDays },
        { label: "Amenidades", value: data.reservas.amenidades_utilizadas, icon: BarChart3 },
      ]
    : [];

  return (
    <AppShell role="residente" title="Resumen mensual" subtitle="Su actividad real de visitas, accesos y reservas por mes.">
      <div className="grid gap-3 sm:max-w-md sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Mes</span>
          <select
            value={month}
            onChange={(event) => setMonth(Number(event.target.value))}
            className="border-input h-11 w-full rounded-md border bg-input-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm"
          >
            {monthNames.map((name, index) => (
              <option key={name} value={index + 1}>{name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Año</span>
          <Input type="number" min={2000} max={2100} value={year} onChange={(event) => setYear(Number(event.target.value))} />
        </label>
      </div>

      {error ? (
        <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>
      ) : loading || !data ? (
        <p className="py-8 text-center text-sm text-slate-500">Cargando resumen...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {cards.map(({ label, value, icon: Icon }) => (
              <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xs font-medium text-slate-500 sm:text-sm">{label}</p>
                  <span className="rounded-xl bg-blue-50 p-2 text-blue-600" aria-hidden="true">
                    <Icon className="size-4 sm:size-5" />
                  </span>
                </div>
                <p className="mt-2 text-xl font-semibold text-slate-950 sm:text-[1.75rem]">{value}</p>
              </div>
            ))}
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Actividad reciente">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-950">
                <Clock3 className="size-4 text-blue-600" aria-hidden="true" />
                Actividad reciente
              </h2>
            </div>
            <div className="p-5">
              {data.actividades_recientes.length ? (
                <ul className="divide-y divide-slate-100">
                  {data.actividades_recientes.map((activity, index) => (
                    <li key={index} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm first:pt-0 last:pb-0">
                      <span className="text-slate-500">{activity.fecha}</span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">{activity.tipo}</span>
                      <span className="text-slate-900">{activity.detalle}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-sm text-slate-500">
                  Sin actividad en este mes.
                </p>
              )}
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}
