import { useState } from "react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { downloadReport } from "@/services/reportExportService";
import { useEffect, useRef } from 'react';
import { getReportCatalog, type ReportCapability } from '@/services/reportCatalogService';

export function AdminReportsView() {
  const [report, setReport] = useState("accesos");
  const [format, setFormat] = useState("pdf");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [catalog, setCatalog] = useState<ReportCapability[]>([]);
  const [catalogBusy, setCatalogBusy] = useState(true);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState('');
  const downloadController = useRef<AbortController | null>(null);
  const selected = catalog.find(item => item.id === report);
  useEffect(() => {
    const controller = new AbortController();
    setCatalogBusy(true); setError('');
    getReportCatalog(controller.signal).then(items => { if (!controller.signal.aborted) setCatalog(items); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'No fue posible cargar los reportes.'); })
      .finally(() => { if (!controller.signal.aborted) setCatalogBusy(false); });
    return () => { controller.abort(); downloadController.current?.abort(); };
  }, [catalogRetry]);
  async function download() {
    const controller = new AbortController();
    downloadController.current = controller;
    try {
      setBusy(true);
      setError("");
      setFeedback('');
      if (selected?.usesDates && desde && hasta && desde > hasta) throw new Error("La fecha inicial no puede ser posterior a la fecha final.");
      await downloadReport({ reporte: report, formato: format, desde: selected?.usesDates ? desde : '', hasta: selected?.usesDates ? hasta : '', ...filters }, controller.signal);
      setFeedback(controller.signal.aborted ? 'Exportación cancelada.' : `Descarga de ${selected?.title} iniciada en ${format.toUpperCase()}.`);
    } catch (error) {
      if (controller.signal.aborted) setFeedback('Exportación cancelada.');
      else setError(error instanceof Error ? error.message : "No fue posible exportar.");
    } finally {
      setBusy(false);
    }
  }
  return <AdminLayout title="Reportes" subtitle="Exporta datos reales respetando el reporte y período seleccionados.">
    <form className="rounded-xl border bg-white p-6" onSubmit={event => { event.preventDefault(); void download(); }}>
      {catalogBusy && <p role="status">Cargando reportes…</p>}
      <fieldset disabled={busy || catalogBusy} className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">Reporte<select className="mt-1 w-full rounded-md border p-3" value={report} onChange={event => { setReport(event.target.value); setFilters({}); setError(''); }}>
          {catalog.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select></label>
        <label className="text-sm">Formato<select className="mt-1 w-full rounded-md border p-3" value={format} onChange={event => setFormat(event.target.value)}>
          <option value="pdf">PDF</option><option value="xlsx">Excel .xlsx</option>
        </select></label>
        <label className="text-sm">Desde<input disabled={selected?.usesDates === false} aria-describedby="report-date-help" className="mt-1 w-full rounded-md border p-2 disabled:bg-slate-100" type="date" max={hasta || undefined} value={desde} onChange={event => setDesde(event.target.value)} /></label>
        <label className="text-sm">Hasta<input disabled={selected?.usesDates === false} aria-describedby="report-date-help" className="mt-1 w-full rounded-md border p-2 disabled:bg-slate-100" type="date" min={desde || undefined} value={hasta} onChange={event => setHasta(event.target.value)} /></label>
        {selected?.filters.map(filter => <label className="text-sm" key={filter.key}>{filter.label}
          {filter.options ? <select className="mt-1 w-full rounded-md border p-3" value={filters[filter.key] || ''}
            onChange={event => setFilters(current => ({ ...current, [filter.key]: event.target.value }))}>
            <option value="">Todos</option>{filter.options.map(option => <option key={option} value={option}>{option}</option>)}
          </select> : <input className="mt-1 w-full rounded-md border p-3" maxLength={150} value={filters[filter.key] || ''}
            onChange={event => setFilters(current => ({ ...current, [filter.key]: event.target.value }))} />}
        </label>)}
      </fieldset>
      <p id="report-date-help" className="mt-4 text-sm text-slate-600">{selected?.usesDates === false
        ? 'Morosidad muestra toda la deuda vencida vigente. Las fechas no limitan las cuotas ni los abonos usados para calcular su saldo.'
        : 'Fechas y horas de Guatemala. El período incluye ambos días; deje las fechas vacías para consultar todo el historial.'}</p>
      <p className="mt-2 text-sm text-slate-600">Máximo {selected?.maxRows.toLocaleString('en-US') || '10,000'} registros por exportación.</p>
      {error && <p role="alert" className="mt-3 text-rose-700">{error}</p>}
      {!catalogBusy && catalog.length === 0 && <div className="mt-3">
        {!error && <p role="status">No hay reportes disponibles.</p>}
        <Button type="button" variant="outline" onClick={() => setCatalogRetry(value => value + 1)}>Reintentar catálogo</Button>
      </div>}
      {(busy || feedback) && <p role="status" className="mt-3 text-slate-700">{busy ? 'Preparando el archivo para descargar…' : feedback}</p>}
      <Button className="mt-5" type="submit" disabled={busy || catalogBusy || !selected}>{busy ? "Generando..." : "Exportar"}</Button>
      {busy && <Button className="ml-3 mt-5" type="button" variant="outline" onClick={() => downloadController.current?.abort()}>Cancelar exportación</Button>}
    </form>
  </AdminLayout>;
}
