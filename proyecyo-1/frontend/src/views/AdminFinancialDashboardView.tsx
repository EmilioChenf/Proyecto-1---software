import { useFeedbackState } from "@/hooks/useFeedbackState";
import { useEffect, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Button } from '@/components/ui/button';
import { FinancialCharts } from '@/components/admin/FinancialCharts';
import { getFinancialDashboard, financialMoney, type FinancialDashboard } from '@/services/financialDashboardService';

export function AdminFinancialDashboardView() {
  const [today] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala' }).format(new Date()));
  const [desde, setDesde] = useState(`${today.slice(0, 7)}-01`);
  const [hasta, setHasta] = useState(today);
  const [range, setRange] = useState({ desde, hasta });
  const [data, setData] = useState<FinancialDashboard | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useFeedbackState("error", '');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true); setError(''); setData(null);
    getFinancialDashboard(range.desde, range.hasta, controller.signal).then(value => {
      if (!controller.signal.aborted) setData(value);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'No fue posible consultar las finanzas.');
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [range, retry]);
  return <AdminLayout title="Dashboard financiero" subtitle="Cobros del período y saldos actuales del residencial.">
    <form className="mb-6 flex flex-wrap items-end gap-3" onSubmit={event => {
      event.preventDefault();
      if (desde > hasta) { setError('La fecha inicial no puede ser posterior a la final.'); return; }
      setRange({ desde, hasta });
    }}>
      <label>Desde<input required className="block rounded border p-2" type="date" value={desde} max={hasta} onChange={event => setDesde(event.target.value)} /></label>
      <label>Hasta<input required className="block rounded border p-2" type="date" value={hasta} min={desde} onChange={event => setHasta(event.target.value)} /></label>
      <Button type="submit" disabled={busy}>Consultar</Button>
    </form>
    {busy && <p role="status">Consultando finanzas…</p>}
    {error && <div><p role="alert" className="text-rose-700">{error}</p><Button type="button" variant="outline" className="mt-3" disabled={busy} onClick={() => setRetry(value => value + 1)}>Reintentar consulta</Button></div>}
    {data && <div className="space-y-6">
      <section aria-label="Movimientos del período">
        <h2 className="mb-3 text-lg font-semibold">Movimientos: {data.periodo.desde} a {data.periodo.hasta}</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {([['Cobros registrados', data.movimientos.cobrado], ['Devoluciones confirmadas', data.movimientos.devuelto],
            ['Ingreso neto', data.movimientos.neto], ['Recargos registrados', data.recargos.registrado]] as const).map(([label, value]) =>
            <article key={label} className="rounded-xl border bg-white p-4"><h3 className="text-sm text-slate-600">{label}</h3><p className="mt-2 text-2xl font-semibold">{financialMoney(value)}</p></article>)}
        </div>
        <p className="mt-2 text-sm">{data.movimientos.cantidad_pagos} pagos aplicados en el período.</p>
      </section>
      <section aria-label="Saldos actuales">
        <h2 className="mb-3 text-lg font-semibold">Saldos al {data.fecha_corte}</h2>
        <p className="mb-3 text-sm text-slate-600">Incluyen todos los abonos y devoluciones aplicados. El filtro de fechas solo cambia los movimientos.</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {([['Saldo pendiente', data.saldos.pendiente], ['Capital pendiente', data.saldos.capital_pendiente],
            ['Recargos pendientes', data.saldos.recargo_pendiente], ['Saldo en mora', data.saldos.mora]] as const).map(([label, value]) =>
            <article key={label} className="rounded-xl border bg-white p-4"><h3 className="text-sm text-slate-600">{label}</h3><p className="mt-2 text-2xl font-semibold">{financialMoney(value)}</p></article>)}
        </div>
        <p className="mt-3">{data.saldos.cuotas_morosas} cuotas en mora · {data.saldos.responsables_morosos} responsables identificados.</p>
        {data.saldos.cuotas_sin_responsable > 0 && <p>{data.saldos.cuotas_sin_responsable} cuotas en mora sin responsable confirmado.</p>}
        {(data.saldos.sobrepago > 0 || data.saldos.reembolso_inconsistente > 0) && <p role="alert" className="mt-3 text-amber-800">Hay importes que requieren revisión: sobrepagos {financialMoney(data.saldos.sobrepago)}; devoluciones superiores a cobros {financialMoney(data.saldos.reembolso_inconsistente)}.</p>}
      </section>
      <FinancialCharts data={data} />
    </div>}
  </AdminLayout>;
}
