import { useEffect, useState } from "react";
import { Loader2, Table2 } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { AdminLayout } from "@/components/admin/AdminLayout";
import { getIndicatorsRequest, type Indicators } from "@/services/indicatorsService";
import { notifyError } from "@/utils/feedback";

// Paleta categórica validada (slot 1 azul, slot 2 naranja); textos en tinta neutra.
const SERIES_1 = "#2a78d6";
const SERIES_2 = "#eb6834";
const AXIS = { fontSize: 12, fill: "#64748b" };
const GRID = "#eef2f7";
const money = (value: number) => `Q${value.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortDay = (iso: string) => { const [, m, d] = iso.split("-"); return `${Number(d)}/${Number(m)}`; };

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

function Card({ title, subtitle, children, action }: { title: string; subtitle: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="font-semibold text-slate-900">{title}</h2><p className="text-xs text-slate-500">{subtitle}</p></div>{action}</div>
      {children}
    </section>
  );
}

/** Indicadores del negocio: morosidad, ocupación de amenidades, visitas y fallas. */
export function AdminIndicatorsView() {
  const [data, setData] = useState<Indicators | null>(null);
  const [months, setMonths] = useState(6);
  const [days, setDays] = useState(30);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    let alive = true;
    getIndicatorsRequest(months, days).then((result) => { if (alive) setData(result); }).catch((reason) => void notifyError(reason, "No fue posible cargar los indicadores."));
    return () => { alive = false; };
  }, [months, days]);

  const filters = (
    <div className="flex flex-wrap gap-2">
      <select aria-label="Meses" value={months} onChange={(e) => setMonths(Number(e.target.value))} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm">{[3, 6, 12].map((m) => <option key={m} value={m}>Últimos {m} meses</option>)}</select>
      <select aria-label="Días" value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm">{[7, 30, 90].map((d) => <option key={d} value={d}>Últimos {d} días</option>)}</select>
    </div>
  );

  if (!data) {
    return <AdminLayout title="Indicadores" subtitle="Cómo va el residencial, mes a mes." actions={filters}><p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" />Calculando indicadores…</p></AdminLayout>;
  }

  const { resumen } = data;
  const delinquency = data.morosidad.map((item) => ({ ...item, porcentaje: item.porcentaje ?? 0 }));
  return (
    <AdminLayout title="Indicadores" subtitle="Cómo va el residencial, mes a mes. Ideal para presentar a la junta directiva." actions={filters}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Morosidad del último mes" value={resumen.morosidad_actual == null ? "—" : `${resumen.morosidad_actual}%`} hint={resumen.morosidad_promedio == null ? "Sin cuotas vencidas en el periodo" : `Promedio del periodo: ${resumen.morosidad_promedio}%`} />
        <Tile label="Ocupación de amenidades" value={`${resumen.ocupacion_amenidades}%`} hint={`Horas reservadas de las disponibles (${data.periodo.dias} días)`} />
        <Tile label="Visitas por día" value={String(resumen.visitas_promedio_dia)} hint={resumen.dia_mas_concurrido ? `Día más concurrido: ${resumen.dia_mas_concurrido}` : "Sin visitas en el periodo"} />
        <Tile label="Viviendas ocupadas" value={`${resumen.viviendas_ocupadas} de ${resumen.viviendas}`} hint={resumen.viviendas ? `${Math.round((resumen.viviendas_ocupadas / resumen.viviendas) * 100)}% del residencial` : undefined} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Morosidad mes a mes" subtitle="Porcentaje de lo que vencía en el mes que no se pagó a tiempo"
          action={<button type="button" onClick={() => setShowTable((v) => !v)} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"><Table2 className="size-3.5" />{showTable ? "Ver gráfica" : "Ver tabla"}</button>}>
          {showTable ? (
            <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-500"><th className="py-1.5">Mes</th><th>Emitido</th><th>Pagado a tiempo</th><th>Pendiente hoy</th><th>Morosidad</th></tr></thead>
              <tbody>{data.morosidad.map((row) => <tr key={row.mes} className="border-t border-slate-100"><td className="py-1.5">{row.etiqueta}</td><td>{money(row.emitido)}</td><td>{money(row.pagado_a_tiempo)}</td><td>{money(row.pendiente_hoy)}</td><td className="font-semibold">{row.porcentaje == null ? "—" : `${row.porcentaje}%`}</td></tr>)}</tbody></table></div>
          ) : (
            <div className="h-64"><ResponsiveContainer width="100%" height="100%">
              <BarChart data={delinquency} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barCategoryGap="30%">
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="etiqueta" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} unit="%" domain={[0, (max: number) => Math.max(10, Math.ceil(max / 10) * 10)]} />
                <Tooltip cursor={{ fill: "#f1f5f9" }} formatter={(value: number, _n, item) => [`${value}% · ${money(item.payload.emitido - item.payload.pagado_a_tiempo)} tarde`, "Morosidad"]} />
                <Bar dataKey="porcentaje" name="Morosidad" fill={SERIES_1} radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer></div>
          )}
        </Card>

        <Card title="Visitas por día" subtitle={`Ingresos registrados en garita, últimos ${data.periodo.dias} días`}>
          <div className="h-64"><ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.visitas} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="dia" tickFormatter={shortDay} tick={AXIS} axisLine={false} tickLine={false} minTickGap={24} />
              <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip labelFormatter={(label: string) => `Día ${shortDay(label)}`} formatter={(value: number) => [value, "Visitas"]} />
              <Area type="monotone" dataKey="visitas" name="Visitas" stroke={SERIES_1} strokeWidth={2} fill={SERIES_1} fillOpacity={0.12} activeDot={{ r: 5 }} />
            </AreaChart>
          </ResponsiveContainer></div>
        </Card>

        <Card title="Ocupación de amenidades" subtitle="Horas reservadas sobre el horario disponible">
          {data.ocupacion.length === 0 ? <p className="text-sm text-slate-500">No hay amenidades activas.</p> : (
            <ul className="space-y-3">{[...data.ocupacion].sort((a, b) => b.porcentaje - a.porcentaje).map((item) => (
              <li key={item.id_amenidad} title={`${item.reservas} reservas · ${item.horas_reservadas} h`}>
                <div className="flex justify-between text-sm"><span className="font-medium text-slate-800">{item.nombre}</span><span className="text-slate-600">{item.porcentaje}% <span className="text-xs text-slate-400">· {item.reservas} reservas</span></span></div>
                <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${Math.max(item.porcentaje, item.porcentaje > 0 ? 2 : 0)}%`, background: SERIES_1 }} /></div>
              </li>
            ))}</ul>
          )}
        </Card>

        <Card title="Fallas reportadas y resueltas" subtitle="Reportes de residentes por mes">
          <div className="h-64"><ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.fallas} margin={{ top: 8, right: 8, left: -20, bottom: 0 }} barGap={2}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="etiqueta" tick={AXIS} axisLine={false} tickLine={false} />
              <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip cursor={{ fill: "#f1f5f9" }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: "#475569" }} />
              <Bar dataKey="abiertas" name="Reportadas" fill={SERIES_1} radius={[4, 4, 0, 0]} maxBarSize={24} />
              <Bar dataKey="resueltas" name="Resueltas" fill={SERIES_2} radius={[4, 4, 0, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer></div>
        </Card>
      </div>
    </AdminLayout>
  );
}
