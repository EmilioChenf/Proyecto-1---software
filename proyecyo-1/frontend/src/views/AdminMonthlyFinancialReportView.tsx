import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Clock, Printer, Receipt, RefreshCw, Search, TrendingUp, Users, Wallet } from "lucide-react";

import { AdminLayout } from "@/components/admin/AdminLayout";
import { FinancialReviewNotice } from "@/components/payments/FinancialReviewNotice";
import { Button } from "@/components/ui/button";
import { useFeedbackState } from "@/hooks/useFeedbackState";
import { apiRequest } from "@/services/api";
import type { FinancialReview } from "@/types/financialBalance";

type Report = {
  resumen: { total_cobrado: number; total_devuelto_periodo?: number; cobrado_neto_periodo?: number; total_pendiente: number; total_mora: number; cantidad_pagos: number; usuarios_morosos: number } & FinancialReview;
  reembolsos?: Array<{ id_reembolso: number; id_cuota: number; monto_centavos: number; fecha_reembolso: string }>;
  pagos?: Array<{ id_pago: number; id_cuota: number; monto_pagado: number; fecha_pago: string }>;
  detalle: Array<{ id_casa: number; unidad: string; usuario: string; concepto: string; monto: number; recargo: number; pagado: number; reembolsado?: number; abono_neto?: number; pendiente: number; fecha_limite: string; estado: string }>;
};

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const money = (value: number) => new Intl.NumberFormat("es-GT", { style: "currency", currency: "GTQ" }).format(value || 0);
const shortDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}/.test(value || "")) return value || "—";
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return `${day} ${MONTHS[month - 1].slice(0, 3).toLowerCase()} ${year}`;
};

type StatusTone = "paid" | "late" | "pending";
function statusTone(status: string): StatusTone {
  const value = status.toUpperCase();
  if (value.startsWith("PAGAD")) return "paid";
  if (/VENC|MORA|ATRAS/.test(value)) return "late";
  return "pending";
}
const STATUS_BADGE: Record<StatusTone, string> = {
  paid: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  late: "bg-rose-50 text-rose-700 ring-rose-600/20",
  pending: "bg-amber-50 text-amber-700 ring-amber-600/20",
};
const STATUS_FILTERS: Array<{ id: "todos" | StatusTone; label: string }> = [
  { id: "todos", label: "Todas" },
  { id: "paid", label: "Pagadas" },
  { id: "pending", label: "Pendientes" },
  { id: "late", label: "Vencidas" },
];

export function AdminMonthlyFinancialReportView() {
  const now = new Date();
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [anio, setAnio] = useState(now.getFullYear());
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useFeedbackState("error", "");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"todos" | StatusTone>("todos");

  async function load(month = mes, year = anio) {
    try {
      setLoading(true);
      setError("");
      setReport(await apiRequest<Report>(`/admin/reportes/financiero-mensual?mes=${month}&anio=${year}`));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "No fue posible cargar el reporte.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  function goTo(month: number, year: number) {
    setMes(month);
    setAnio(year);
    void load(month, year);
  }
  const shift = (delta: number) => {
    const index = anio * 12 + (mes - 1) + delta;
    goTo((index % 12) + 1, Math.floor(index / 12));
  };

  const summary = report?.resumen;
  const net = summary ? summary.cobrado_neto_periodo ?? summary.total_cobrado : 0;
  // Avance de cobro de las cuotas del mes (abonos netos frente a lo que falta).
  const totals = useMemo(() => {
    const rows = report?.detalle ?? [];
    const paid = rows.reduce((sum, row) => sum + Number(row.abono_neto ?? row.pagado ?? 0), 0);
    const pending = rows.reduce((sum, row) => sum + Number(row.pendiente || 0), 0);
    const byConcept = new Map<string, { emitido: number; pendiente: number }>();
    for (const row of rows) {
      const current = byConcept.get(row.concepto) ?? { emitido: 0, pendiente: 0 };
      current.emitido += Number(row.monto || 0) + Number(row.recargo || 0);
      current.pendiente += Number(row.pendiente || 0);
      byConcept.set(row.concepto, current);
    }
    return { paid, pending, percent: paid + pending > 0 ? Math.round((paid / (paid + pending)) * 100) : 0, concepts: [...byConcept.entries()].sort((a, b) => b[1].emitido - a[1].emitido) };
  }, [report]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (report?.detalle ?? []).filter((row) =>
      (statusFilter === "todos" || statusTone(row.estado) === statusFilter) &&
      (!term || `${row.unidad} ${row.usuario} ${row.concepto}`.toLowerCase().includes(term)));
  }, [report, search, statusFilter]);

  const movements = [
    ...(report?.pagos ?? []).map((p) => ({ key: `p${p.id_pago}`, date: p.fecha_pago, kind: "pago" as const, text: `Pago #${p.id_pago} · Cuota #${p.id_cuota} · ${p.fecha_pago} · ${money(p.monto_pagado)}`, amount: p.monto_pagado })),
    ...(report?.reembolsos ?? []).map((r) => ({ key: `r${r.id_reembolso}`, date: r.fecha_reembolso, kind: "reembolso" as const, text: `Reembolso #${r.id_reembolso} · Cuota #${r.id_cuota} · ${r.fecha_reembolso} · Devuelto ${money(r.monto_centavos / 100)}`, amount: r.monto_centavos / 100 })),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  return (
    <AdminLayout title="Reporte financiero mensual" subtitle="Cuánto se cobró, cuánto falta y quién está atrasado, mes por mes.">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm print:hidden">
        <div className="flex items-center gap-1">
          <Button type="button" variant="outline" size="icon" aria-label="Mes anterior" onClick={() => shift(-1)}><ChevronLeft className="size-4" /></Button>
          <div className="flex items-center gap-2 px-3">
            <CalendarDays className="size-4 text-slate-400" />
            <select aria-label="Mes" value={mes} onChange={(e) => goTo(Number(e.target.value), anio)} className="rounded-lg bg-transparent py-1.5 text-lg font-semibold text-slate-900 outline-none">
              {MONTHS.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
            </select>
            <input aria-label="Año" type="number" value={anio} onChange={(e) => setAnio(Number(e.target.value))} onBlur={() => void load()} onKeyDown={(e) => { if (e.key === "Enter") void load(); }}
              className="w-20 rounded-lg bg-transparent py-1.5 text-lg font-semibold text-slate-900 outline-none" />
          </div>
          <Button type="button" variant="outline" size="icon" aria-label="Mes siguiente" onClick={() => shift(1)}><ChevronRight className="size-4" /></Button>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => void load()}><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />Consultar</Button>
          <Button type="button" variant="outline" onClick={() => window.print()}><Printer className="size-4" />Imprimir</Button>
        </div>
      </div>

      {error ? <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error}</p> : null}

      {loading ? (
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-slate-100" />)}<p className="sr-only">Cargando reporte...</p></div>
      ) : report && summary ? (
        <>
          <FinancialReviewNotice {...summary} />

          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Kpi tone="emerald" icon={<Wallet className="size-5" />} label="Cobrado neto del mes" value={money(net)} hint={`${summary.cantidad_pagos} pago(s) recibidos`} />
            <Kpi tone="amber" icon={<Clock className="size-5" />} label="Pendiente por cobrar" value={money(summary.total_pendiente)} hint="Saldo actual de las cuotas" />
            <Kpi tone="rose" icon={<AlertTriangle className="size-5" />} label="En mora" value={money(summary.total_mora)} hint={`${summary.usuarios_morosos} usuario(s) atrasado(s)`} />
            <Kpi tone="blue" icon={<TrendingUp className="size-5" />} label="Avance de cobro" value={`${totals.percent}%`} hint="De las cuotas del mes">
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${totals.percent}%` }} /></div>
            </Kpi>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.4fr]">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Resumen del período</h2>
              <dl className="mt-3 divide-y divide-slate-100 text-sm">
                {[["Total cobrado", money(summary.total_cobrado), "Bruto, antes de devoluciones"], ["Total devuelto", money(summary.total_devuelto_periodo || 0), "Reembolsos del mes"], ["Total neto del mes", money(net), "Cobrado menos devuelto"], ["Pagos", String(summary.cantidad_pagos), "Cantidad de pagos"], ["Usuarios morosos", String(summary.usuarios_morosos), "Con saldo vencido"]].map(([label, value, hint]) => (
                  <div key={label} className="flex items-center justify-between gap-3 py-2.5">
                    <dt><span className="block text-slate-700">{label}</span><span className="text-xs text-slate-400">{hint}</span></dt>
                    <dd className="font-semibold tabular-nums text-slate-900">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs leading-5 text-slate-500">Cobrado y cantidad de pagos corresponden al mes. El cobrado es bruto; los reembolsos y el neto del período se muestran por separado. Los saldos de las cuotas son actuales y usan todos los movimientos confirmados.</p>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Por concepto</h2>
              {totals.concepts.length === 0 ? <p className="mt-3 text-sm text-slate-500">No hay cuotas que venzan en este mes.</p> : (
                <ul className="mt-4 space-y-4">
                  {totals.concepts.map(([concept, value]) => {
                    const paidPart = value.emitido > 0 ? Math.max(0, Math.min(100, ((value.emitido - value.pendiente) / value.emitido) * 100)) : 0;
                    return (
                      <li key={concept}>
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="font-medium text-slate-800">{concept}</span>
                          <span className="tabular-nums text-slate-500">{money(value.emitido - value.pendiente)} <span className="text-slate-300">/</span> {money(value.emitido)}</span>
                        </div>
                        <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${paidPart}%` }} /></div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>

          <section className="mt-4 rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Receipt className="size-4 text-slate-400" />Cuotas del mes <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{rows.length}</span></h2>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-xl bg-slate-100 p-1">
                  {STATUS_FILTERS.map((filter) => (
                    <button key={filter.id} type="button" onClick={() => setStatusFilter(filter.id)}
                      className={`rounded-lg px-3 py-1 text-xs font-medium ${statusFilter === filter.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>{filter.label}</button>
                  ))}
                </div>
                <label className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <input aria-label="Buscar unidad o usuario" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar unidad o usuario"
                    className="h-9 w-56 rounded-xl border border-slate-200 pl-9 pr-3 text-sm" />
                </label>
              </div>
            </div>
            {report.detalle.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">Sin resultados para el periodo.</p>
              : rows.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">Ninguna cuota coincide con los filtros.</p> : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <tr>{["Unidad", "Usuario", "Concepto", "Vence", "Pagado bruto", "Devuelto", "Abono neto", "Pendiente", "Estado"].map((head, index) => <th key={head} className={`px-4 py-3 ${index >= 4 && index <= 7 ? "text-right" : ""}`}>{head}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.map((row, index) => (
                        <tr key={`${row.id_casa}-${index}`} className="hover:bg-slate-50/60">
                          <td className="px-4 py-3 font-semibold text-slate-900">{row.unidad}</td>
                          <td className={`px-4 py-3 ${/no confirmado/i.test(row.usuario) ? "italic text-slate-400" : "text-slate-700"}`}>{row.usuario}</td>
                          <td className="px-4 py-3 text-slate-700">{row.concepto}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-slate-600">{shortDate(row.fecha_limite)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{money(row.pagado)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-500">{money(row.reembolsado || 0)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{money(row.abono_neto ?? row.pagado)}</td>
                          <td className={`px-4 py-3 text-right font-semibold tabular-nums ${row.pendiente > 0 ? "text-amber-700" : "text-slate-400"}`}>{money(row.pendiente)}</td>
                          <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${STATUS_BADGE[statusTone(row.estado)]}`}>{row.estado}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </section>

          {report.pagos ? (
            <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Users className="size-4 text-slate-400" />Movimientos del mes</h2>
              {movements.length === 0 ? <p className="mt-3 text-sm text-slate-500">No hay pagos en el mes seleccionado.</p> : (
                <ul className="mt-3 divide-y divide-slate-100">
                  {movements.map((move) => (
                    <li key={move.key} className="flex items-center gap-3 py-2.5">
                      <span className={`grid size-8 shrink-0 place-items-center rounded-full ${move.kind === "pago" ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>
                        {move.kind === "pago" ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
                      </span>
                      <p className="min-w-0 flex-1 text-sm text-slate-700">{move.text}</p>
                      <span className={`text-sm font-semibold tabular-nums ${move.kind === "pago" ? "text-emerald-700" : "text-rose-700"}`}>{move.kind === "pago" ? "+" : "−"}{money(move.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </>
      ) : null}
    </AdminLayout>
  );
}

const KPI_TONES = {
  emerald: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  rose: "bg-rose-50 text-rose-600",
  blue: "bg-blue-50 text-blue-600",
} as const;

function Kpi({ tone, icon, label, value, hint, children }: { tone: keyof typeof KPI_TONES; icon: ReactNode; label: string; value: string; hint: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <span className={`grid size-9 place-items-center rounded-xl ${KPI_TONES[tone]}`}>{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
      {children}
    </div>
  );
}
