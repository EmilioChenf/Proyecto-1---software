import { useEffect, useState } from 'react';
import { ResidentLayout } from '@/components/residente/ResidentLayout';
import { Button } from '@/components/ui/button';
import { getResidentActivity, activityLabels, type ActivityPage } from '@/services/residentActivityService';

export function ResidentActivityView() {
  const [draft, setDraft] = useState({ tipo: '', desde: '', hasta: '' });
  const [filters, setFilters] = useState(draft);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ActivityPage | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true); setError(''); setData(null);
    getResidentActivity(filters, page, controller.signal).then(result => {
      if (!controller.signal.aborted) setData(result);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'No fue posible consultar tu actividad.');
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [filters, page, retry]);
  return <ResidentLayout title="Mi actividad" subtitle="Pagos, reservas, visitas y sanciones vinculados a tu cuenta.">
    <form className="mb-5 flex flex-wrap items-end gap-3" onSubmit={event => {
      event.preventDefault();
      if (draft.desde && draft.hasta && draft.desde > draft.hasta) { setError('Revisa el orden de las fechas.'); return; }
      setPage(1); setFilters({ ...draft });
    }}>
      <label>Tipo de actividad<select className="block rounded border p-2" value={draft.tipo} onChange={event => setDraft({ ...draft, tipo: event.target.value })}>
        <option value="">Todas</option>{Object.entries(activityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <label>Desde<input type="date" className="block rounded border p-2" max={draft.hasta || undefined} value={draft.desde} onChange={event => setDraft({ ...draft, desde: event.target.value })} /></label>
      <label>Hasta<input type="date" className="block rounded border p-2" min={draft.desde || undefined} value={draft.hasta} onChange={event => setDraft({ ...draft, hasta: event.target.value })} /></label>
      <Button type="submit" disabled={busy}>Filtrar</Button>
    </form>
    <p className="mb-4 text-sm text-slate-600">Orden de fecha más reciente a más antigua. Las reservas y visitas muestran su fecha programada; los pagos sin fecha aparecen al final.</p>
    {busy && <p role="status">Cargando actividad…</p>}
    {error && <div><p role="alert" className="text-rose-700">{error}</p><Button type="button" variant="outline" className="mt-3" disabled={busy} onClick={() => setRetry(value => value + 1)}>Reintentar consulta</Button></div>}
    {data && <>
      {data.items.length === 0 ? <p role="status">No hay actividad para estos filtros.</p> :
        <ol aria-label="Historial de actividad" className="space-y-3">{data.items.map(item => <li key={item.id} className="rounded-xl border bg-white p-4">
          <div className="flex flex-wrap justify-between gap-2 text-sm text-slate-600">
            <span>{activityLabels[item.tipo]}</span><span>{item.fecha ? <time dateTime={item.fecha}>{item.fecha}{item.hora ? ` ${item.hora.slice(0, 5)}` : ''}</time> : 'Fecha no registrada'}</span>
          </div>
          <h2 className="mt-2 break-words font-semibold">{item.titulo}</h2>
          <p className="mt-1 text-sm">Estado: {item.estado.replaceAll('_', ' ')}</p>
          <details className="mt-3"><summary className="cursor-pointer text-blue-700">Detalle de {activityLabels[item.tipo].toLowerCase()}</summary>
            <p className="mt-2 break-words text-sm">{item.detalle || 'Sin detalle adicional.'}</p>
            {item.monto !== null && <p className="mt-2">Monto registrado: {new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(item.monto)}</p>}
          </details>
        </li>)}</ol>}
      <nav aria-label="Paginación de actividad" className="mt-5 flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" disabled={page === 1 || busy} onClick={() => setPage(value => value - 1)}>Anterior</Button>
        <span>Página {data.page}</span>
        <Button type="button" variant="outline" disabled={!data.hasMore || busy} onClick={() => setPage(value => value + 1)}>Siguiente</Button>
      </nav>
    </>}
  </ResidentLayout>;
}
