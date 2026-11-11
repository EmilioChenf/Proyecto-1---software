import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CalendarRange, CreditCard, Download, FileSpreadsheet, FileText, Gavel, KeyRound, Loader2, RefreshCw, SlidersHorizontal, Ticket, X } from "lucide-react";

import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { useFeedbackState } from "@/hooks/useFeedbackState";
import { getReportCatalog, type ReportCapability } from "@/services/reportCatalogService";
import { downloadReport } from "@/services/reportExportService";
import { notifyInfo, notifySuccess } from "@/utils/feedback";

// Presentacion de cada reporte del catalogo del backend (icono, color y para que sirve).
const REPORT_STYLE: Record<string, { icon: ReactNode; tint: string; description: string }> = {
  accesos: { icon: <KeyRound className="size-5" />, tint: "bg-blue-50 text-blue-600", description: "Ingresos y salidas de visitas, proveedores y residentes." },
  pagos: { icon: <CreditCard className="size-5" />, tint: "bg-emerald-50 text-emerald-600", description: "Pagos aplicados a cuotas, con su responsable y origen." },
  reservas: { icon: <Ticket className="size-5" />, tint: "bg-violet-50 text-violet-600", description: "Reservas de amenidades y su estado." },
  morosos: { icon: <AlertTriangle className="size-5" />, tint: "bg-amber-50 text-amber-600", description: "Deuda vencida vigente por unidad y responsable." },
  sanciones: { icon: <Gavel className="size-5" />, tint: "bg-rose-50 text-rose-600", description: "Sanciones aplicadas, montos y estado." },
};
const FALLBACK_STYLE = { icon: <FileText className="size-5" />, tint: "bg-slate-100 text-slate-600", description: "Exporta los registros del módulo." };

const GT = "America/Guatemala";
const isoDay = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: GT, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
function shiftDays(day: string, days: number) {
  const value = new Date(`${day}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function presets() {
  const today = isoDay(new Date());
  const monthStart = `${today.slice(0, 7)}-01`;
  const previousMonthEnd = shiftDays(monthStart, -1);
  return [
    { id: "hoy", label: "Hoy", desde: today, hasta: today },
    { id: "7", label: "Últimos 7 días", desde: shiftDays(today, -6), hasta: today },
    { id: "mes", label: "Este mes", desde: monthStart, hasta: today },
    { id: "anterior", label: "Mes pasado", desde: `${previousMonthEnd.slice(0, 7)}-01`, hasta: previousMonthEnd },
    { id: "todo", label: "Todo el historial", desde: "", hasta: "" },
  ];
}

export function AdminReportsView() {
  const [report, setReport] = useState("accesos");
  const [format, setFormat] = useState("pdf");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useFeedbackState("error", "");
  const [catalog, setCatalog] = useState<ReportCapability[]>([]);
  const [catalogBusy, setCatalogBusy] = useState(true);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useFeedbackState("info", "");
  const downloadController = useRef<AbortController | null>(null);
  const selected = catalog.find((item) => item.id === report);
  const usesDates = selected?.usesDates !== false;
  const activePreset = presets().find((preset) => preset.desde === desde && preset.hasta === hasta)?.id;
  const activeFilters = Object.values(filters).filter(Boolean).length;

  useEffect(() => {
    const controller = new AbortController();
    setCatalogBusy(true);
    setError("");
    getReportCatalog(controller.signal)
      .then((items) => { if (!controller.signal.aborted) setCatalog(items); })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "No fue posible cargar los reportes."); })
      .finally(() => { if (!controller.signal.aborted) setCatalogBusy(false); });
    return () => { controller.abort(); downloadController.current?.abort(); };
  }, [catalogRetry]);

  async function download() {
    const controller = new AbortController();
    downloadController.current = controller;
    try {
      setBusy(true);
      setError("");
      setFeedback("");
      if (usesDates && desde && hasta && desde > hasta) throw new Error("La fecha inicial no puede ser posterior a la fecha final.");
      await downloadReport({ reporte: report, formato: format, desde: usesDates ? desde : "", hasta: usesDates ? hasta : "", ...filters }, controller.signal);
      const result = controller.signal.aborted ? "Exportación cancelada." : `Descarga de ${selected?.title} iniciada en ${format.toUpperCase()}.`;
      setFeedback(result);
      void (controller.signal.aborted ? notifyInfo(result) : notifySuccess(result));
    } catch (failure) {
      if (controller.signal.aborted) { setFeedback("Exportación cancelada."); void notifyInfo("Exportación cancelada."); }
      else setError(failure instanceof Error ? failure.message : "No fue posible exportar.");
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || catalogBusy;
  const periodText = !usesDates ? "Deuda vigente a hoy" : desde || hasta ? `${desde || "inicio"} → ${hasta || "hoy"}` : "Todo el historial";

  return (
    <AdminLayout title="Reportes" subtitle="Elige qué quieres exportar, el período y el formato. Los datos salen directo de la base del residencial.">
      <form className="grid gap-5 xl:grid-cols-[1fr_340px]" onSubmit={(event) => { event.preventDefault(); void download(); }}>
        <div className="space-y-5">
          <Section step="1" title="¿Qué reporte necesitas?">
            {catalogBusy ? <p role="status" className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" />Cargando reportes…</p> : null}
            <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <legend className="sr-only">Reporte</legend>
              {catalog.map((item) => {
                const style = REPORT_STYLE[item.id] ?? FALLBACK_STYLE;
                const active = item.id === report;
                return (
                  <label key={item.id} className={`relative flex cursor-pointer gap-3 rounded-2xl border p-4 transition ${active ? "border-blue-500 bg-blue-50/60 ring-2 ring-blue-500/20" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"}`}>
                    <input type="radio" name="reporte" value={item.id} checked={active} className="sr-only" aria-label={item.title}
                      onChange={() => { setReport(item.id); setFilters({}); setError(""); }} />
                    <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${style.tint}`}>{style.icon}</span>
                    <span className="min-w-0">
                      <span className="block font-semibold text-slate-900">{item.title}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-slate-500">{style.description}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
            {!catalogBusy && catalog.length === 0 ? (
              <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 p-4 text-sm">
                {!error ? <p role="status">No hay reportes disponibles.</p> : null}
                <Button type="button" variant="outline" onClick={() => setCatalogRetry((value) => value + 1)}><RefreshCw className="size-4" />Reintentar catálogo</Button>
              </div>
            ) : null}
          </Section>

          <Section step="2" title="Período" icon={<CalendarRange className="size-4" />}>
            {usesDates ? (
              <div className="mb-4 flex flex-wrap gap-2">
                {presets().map((preset) => (
                  <button key={preset.id} type="button" disabled={disabled} onClick={() => { setDesde(preset.desde); setHasta(preset.hasta); }}
                    className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${activePreset === preset.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
                    {preset.label}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-700">Desde
                <input disabled={!usesDates || disabled} aria-describedby="report-date-help" type="date" max={hasta || undefined} value={desde} onChange={(event) => setDesde(event.target.value)}
                  className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm disabled:bg-slate-100 disabled:text-slate-400" />
              </label>
              <label className="text-sm font-medium text-slate-700">Hasta
                <input disabled={!usesDates || disabled} aria-describedby="report-date-help" type="date" min={desde || undefined} value={hasta} onChange={(event) => setHasta(event.target.value)}
                  className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm disabled:bg-slate-100 disabled:text-slate-400" />
              </label>
            </div>
            <p id="report-date-help" className="mt-3 text-xs leading-5 text-slate-500">{!usesDates
              ? "Morosidad muestra toda la deuda vencida vigente. Las fechas no limitan las cuotas ni los abonos usados para calcular su saldo."
              : "Fechas y horas de Guatemala. El período incluye ambos días; deje las fechas vacías para consultar todo el historial."}</p>
          </Section>

          {selected?.filters.length ? (
            <Section step="3" title="Filtros opcionales" icon={<SlidersHorizontal className="size-4" />}
              action={activeFilters ? <button type="button" onClick={() => setFilters({})} className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900"><X className="size-3.5" />Limpiar filtros</button> : null}>
              <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {selected.filters.map((filter) => (
                  <label className="text-sm font-medium text-slate-700" key={filter.key}>{filter.label}
                    {filter.options ? (
                      <select value={filters[filter.key] || ""} onChange={(event) => setFilters((current) => ({ ...current, [filter.key]: event.target.value }))}
                        className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                        <option value="">Todos</option>{filter.options.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    ) : (
                      <input maxLength={150} value={filters[filter.key] || ""} placeholder="Todos" onChange={(event) => setFilters((current) => ({ ...current, [filter.key]: event.target.value }))}
                        className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm" />
                    )}
                  </label>
                ))}
              </fieldset>
            </Section>
          ) : null}
        </div>

        <aside className="h-fit space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:sticky xl:top-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Formato</p>
            <fieldset disabled={disabled} className="mt-2 grid grid-cols-2 gap-2">
              <legend className="sr-only">Formato</legend>
              {[{ id: "pdf", label: "PDF", hint: "Para imprimir", icon: <FileText className="size-4" /> }, { id: "xlsx", label: "Excel", hint: "Para analizar", icon: <FileSpreadsheet className="size-4" /> }].map((option) => (
                <label key={option.id} className={`cursor-pointer rounded-xl border p-3 text-center transition ${format === option.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>
                  <input type="radio" name="formato" value={option.id} checked={format === option.id} onChange={() => setFormat(option.id)} className="sr-only" aria-label={option.label} />
                  <span className="flex items-center justify-center gap-1.5 font-semibold">{option.icon}{option.label}</span>
                  <span className={`text-xs ${format === option.id ? "text-slate-300" : "text-slate-500"}`}>{option.hint}</span>
                </label>
              ))}
            </fieldset>
          </div>

          <dl className="space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Reporte</dt><dd className="text-right font-medium text-slate-900">{selected?.title || "—"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Período</dt><dd className="text-right font-medium text-slate-900">{periodText}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Filtros</dt><dd className="text-right font-medium text-slate-900">{activeFilters ? `${activeFilters} activo(s)` : "Ninguno"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Límite</dt><dd className="text-right font-medium text-slate-900">{selected?.maxRows.toLocaleString("en-US") || "10,000"} registros</dd></div>
          </dl>

          {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
          {busy || feedback ? <p role="status" className="rounded-xl bg-blue-50 p-3 text-sm text-blue-800">{busy ? "Preparando el archivo para descargar…" : feedback}</p> : null}

          <Button type="submit" className="h-11 w-full" disabled={busy || catalogBusy || !selected}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {busy ? "Generando..." : "Exportar"}
          </Button>
          {busy ? <Button type="button" variant="outline" className="w-full" onClick={() => downloadController.current?.abort()}>Cancelar exportación</Button> : null}
        </aside>
      </form>
    </AdminLayout>
  );
}

function Section({ step, title, icon, action, children }: { step: string; title: string; icon?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-base font-semibold text-slate-900">
          <span className="grid size-7 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white">{step}</span>
          {title}
          {icon ? <span className="text-slate-400">{icon}</span> : null}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
