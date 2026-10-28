import { useFeedbackState } from "@/hooks/useFeedbackState";
import { useEffect, useRef, useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Button } from '@/components/ui/button';
import { listRecurrenteTransactions, verifyRecurrenteTransactions, reconciliationError } from '@/services/recurrenteReconciliationService';
import type { ReconciliationFilters, ReconciliationResponse, ReconciliationResult } from '@/types/recurrenteReconciliation';

const labels: Record<ReconciliationResult, string> = { CONCILIADA: 'Conciliada', DIFERENCIA: 'Diferencia', PENDIENTE: 'Pendiente', ERROR_DE_VERIFICACION: 'Error de verificación' };
const colors: Record<ReconciliationResult, string> = { CONCILIADA: 'bg-green-100 text-green-900', DIFERENCIA: 'bg-red-100 text-red-900', PENDIENTE: 'bg-amber-100 text-amber-900', ERROR_DE_VERIFICACION: 'bg-slate-200 text-slate-900' };
const reasons: Record<string, string> = {
  CAMBIO_CONCURRENTE: 'La información local cambió durante la consulta. Verifica nuevamente.',
  CAMBIO_DURANTE_VERIFICACION_EXTERNA: 'El checkout cambió entre las consultas al proveedor.',
  SIN_EVIDENCIA_EXTERNA: 'Todavía no se ha consultado al proveedor.', EVIDENCIA_INCOMPLETA: 'Faltan datos verificables.',
  OPERACION_EN_PROGRESO: 'La operación sigue en progreso.', SIN_INTENTO_LOCAL: 'Todavía no existe un intento registrado.',
  OPERACION_INCIERTA: 'La operación tiene un resultado incierto.', REEMBOLSO_REQUIERE_HU18: 'El reembolso requiere revisión en el flujo correspondiente.',
  REFERENCIA_NO_LOCALIZADA: 'La referencia no fue localizada en la cuenta Sandbox verificada.', TIMEOUT: 'El proveedor no respondió a tiempo.',
  AUTENTICACION_PROVEEDOR: 'No fue posible autenticar la consulta al proveedor.', LIMITE_PROVEEDOR: 'El proveedor limitó las consultas.',
  RESPUESTA_INVALIDA: 'El proveedor devolvió una respuesta inválida.', PROVEEDOR_NO_DISPONIBLE: 'El proveedor no está disponible.',
  NO_CONFIGURADO: 'La verificación Sandbox no está configurada.', CONTEXTO_SANDBOX_INVALIDO: 'No fue posible validar el Sandbox esperado.',
  SIN_DESENLACE: 'El intento todavía no tiene un resultado definitivo.', REFERENCIA_INVALIDA: 'La referencia externa no es válida.',
};
const money = (cents: number | null, currency: string | null) => cents == null ? 'Sin dato' : `${(cents / 100).toFixed(2)} ${currency || ''}`;
const text = (value: unknown) => value == null ? 'Sin dato' : String(value);
export function AdminRecurrenteReconciliationView() {
  const [filters, setFilters] = useState<ReconciliationFilters>({});
  const [discover, setDiscover] = useState(false), [data, setData] = useState<ReconciliationResponse | null>(null);
  const [busy, setBusy] = useState<'local' | 'external' | null>(null), [error, setError] = useFeedbackState("error", '');
  const pending = useRef(false), mounted = useRef(true);
  async function query(external = false, selected = filters) {
    if (pending.current) return;
    if (external && discover && (!selected.desde || !selected.hasta)) { setError('Selecciona ambas fechas para explorar operaciones externas.'); return; }
    pending.current = true; setBusy(external ? 'external' : 'local'); setError(''); setData(null);
    try {
      const result = external ? await verifyRecurrenteTransactions(selected, discover) : await listRecurrenteTransactions(selected);
      if (mounted.current) setData(result);
    } catch (e) { if (mounted.current) setError(reconciliationError(e)); }
    finally { pending.current = false; if (mounted.current) setBusy(null); }
  }
  useEffect(() => { mounted.current = true; void query(false, {}); return () => { mounted.current = false; }; }, []);
  const change = (key: keyof ReconciliationFilters, value: string) => setFilters(current => ({ ...current, [key]: value }));
  return <AdminLayout title="Conciliación de pagos" subtitle="Recurrente Sandbox · Consulta administrativa">
    <div className="space-y-5">
      <p className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm">Esta consulta compara registros. No confirma pagos ni modifica saldos. Las fechas corresponden a America/Guatemala.</p>
      <form className="rounded-xl border bg-white p-4" onSubmit={event => { event.preventDefault(); void query(); }}>
        <fieldset disabled={busy !== null} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(['desde', 'hasta'] as const).map(key => <label key={key}>{key === 'desde' ? 'Desde' : 'Hasta'}<input className="mt-1 block w-full rounded border p-2" type="date" value={filters[key] || ''} onChange={e => change(key, e.target.value)} /></label>)}
          <label>Estado local<select className="mt-1 block w-full rounded border p-2" value={filters.estado_local || ''} onChange={e => change('estado_local', e.target.value)}><option value="">Todos</option>{['PENDIENTE','CONFIRMADA','FALLIDA','CANCELADA','CONFIRMADO','EXPIRADO','INCIERTO','CREADO','FALLIDO','CANCELADO','REEMBOLSADA_PARCIAL','REEMBOLSADA'].map(s => <option key={s}>{s}</option>)}</select></label>
          <label>Resultado de conciliación<select className="mt-1 block w-full rounded border p-2" value={filters.resultado || ''} onChange={e => change('resultado', e.target.value)}><option value="">Todos</option>{Object.entries(labels).map(([s, label]) => <option key={s} value={s}>{label}</option>)}</select></label>
          <label>Residente (ID)<input className="mt-1 block w-full rounded border p-2" type="number" min="1" value={filters.residente || ''} onChange={e => change('residente', e.target.value)} /></label>
          <label>Referencia<input className="mt-1 block w-full rounded border p-2" placeholder="ID, UUID, ch_, in_, pa_ o NXR-" value={filters.referencia || ''} onChange={e => change('referencia', e.target.value)} /></label>
          <label className="sm:col-span-2"><input type="checkbox" checked={discover} onChange={e => setDiscover(e.target.checked)} /> Explorar candidatos externos sin asociación en el período</label>
        </fieldset>
        <div className="mt-4 flex flex-wrap gap-3"><Button type="submit" disabled={busy !== null}>Consultar registros locales</Button><Button type="button" disabled={busy !== null} onClick={() => void query(true)}>{busy === 'external' ? 'Verificando con Recurrente…' : 'Verificar con Recurrente'}</Button></div>
      </form>
      {busy && <p role="status">{busy === 'external' ? 'Verificando operaciones…' : 'Cargando registros locales…'}</p>}
      {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-4">{error}</p>}
      {data && <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{([['Conciliadas',data.resumen.conciliadas],['Diferencias',data.resumen.diferencias],['Pendientes',data.resumen.pendientes],['Errores de verificación',data.resumen.errores_verificacion]] as const).map(([label,value]) => <div className="rounded-xl border bg-white p-4" key={label}><p>{label}</p><strong className="text-2xl">{value}</strong></div>)}</div>
        <p>{data.verificado ? 'Comparación con Recurrente realizada.' : 'Información local; todavía sin verificación externa.'} {data.completo ? 'Alcance solicitado completo.' : `Alcance parcial. Límite local: ${data.limite_operaciones} operaciones.`} {data.resumen.sin_fecha} operación(es) sin fecha verificable.</p>
        {data.exploracion_externa.solicitada && <p>Exploración externa: {data.exploracion_externa.completa ? 'completa' : 'parcial'}. {!data.exploracion_externa.completa && 'No puede afirmarse que se encontraron todas las operaciones.'}</p>}
        <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-left text-sm"><caption className="p-3 text-left">Operaciones de NexusResidencial ({data.operaciones.length})</caption><thead><tr>{['Operación','Residente / cuota','Fecha','Monto','Clasificación','Detalle'].map(h => <th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>
          {data.operaciones.map(op => <tr className="border-t align-top" key={op.clave}><td className="p-3"><p>Transacción {op.id_transaccion ?? '—'}</p><p>Checkout {op.id_checkout}</p>{op.interno.intent_id || op.interno.checkout_id}</td><td className="p-3">{op.residente} · {op.unidad}<br />Cuota {op.id_cuota} · {op.concepto}</td><td className="p-3">{op.fecha_operacion || 'Sin fecha verificable'}</td><td className="p-3">{money(op.interno.monto_centavos, op.interno.moneda)}</td><td className="p-3"><span className={`rounded px-2 py-1 ${colors[op.clasificacion]}`}>{labels[op.clasificacion]}</span><p className="mt-2">{op.motivo && (reasons[op.motivo] || 'La operación requiere revisión.')}</p></td><td className="p-3"><details><summary className="cursor-pointer">Ver comparación</summary><div className="mt-3 min-w-72 space-y-3">
            <div><p>Referencia local: {op.referencia_local}</p><p>{op.numero_comprobante || 'Sin comprobante'}</p><p>PAGO: {op.id_pago ?? 'Ninguno'}</p><p>Saldo actual: {money(op.saldo_actual_centavos, 'GTQ')}</p></div>
            <table className="w-full"><thead><tr><th>Campo</th><th>Interno</th><th>Externo</th></tr></thead><tbody>{[
              ['Intent',op.interno.intent_id,op.externo?.intent_id], ['Checkout',op.interno.checkout_id,op.externo?.checkout_id], ['Estado del intento',op.interno.estado_transaccion,op.externo?.estado_intento],
              ['Estado del checkout',op.interno.estado_checkout,op.externo?.estado_checkout], ['Estado proveedor almacenado',op.interno.estado_proveedor,op.externo?.estado_checkout],
              ['Monto',money(op.interno.monto_centavos,op.interno.moneda),money(op.externo?.monto_centavos ?? null,op.externo?.moneda ?? null)],
              ['Ambiente',op.interno.ambiente,op.externo?.ambiente],['Referencia de pago',op.interno.pago_externo,op.externo?.pago_externo],['Fecha contable / timestamp',op.interno.fecha_pago,op.externo?.fecha_original],
            ].map(([field,a,b]) => <tr key={String(field)}><th className="pr-2">{field}</th><td className="pr-2">{text(a)}</td><td>{text(b)}</td></tr>)}</tbody></table>
            {op.diferencias.length > 0 && <ul>{op.diferencias.map((d,i) => <li key={i}>{d.campo}: interno {text(d.interno)} / externo {text(d.externo)}</li>)}</ul>}
            {op.faltantes.length > 0 && <p>Datos faltantes: {op.faltantes.join(', ')}</p>}
            {op.externo?.motivo && <p>Motivo del intento: {op.externo.motivo} ({op.externo.motivo_codigo})</p>}
            {op.cobertura_reembolsos && <p>Cobertura de reembolsos incompleta: solo se verifican referencias conocidas; no se demuestra ausencia de reembolsos externos.</p>}
            {(op.reembolsos?.length || 0)>0 && <p>Devuelto: {money(op.devuelto_centavos || 0,"GTQ")} · Abono neto: {money(op.abono_neto_centavos ?? null,"GTQ")}</p>}
            {op.id_transaccion && <a className="underline" href={`/admin/pagos/reembolsos?transaccion=${op.id_transaccion}`}>Consultar reembolsos</a>}
            <p>Eventos recibidos: {op.eventos.length}</p>
          </div></details></td></tr>)}
          {data.operaciones.length === 0 && <tr><td className="p-4" colSpan={6}>Sin operaciones para la selección.</td></tr>}
        </tbody></table></div>
        {data.exploracion_externa.solicitada && <section className="rounded-xl border bg-white p-4"><h2 className="font-semibold">Candidatos externos sin asociación</h2><p className="text-sm">Son pendientes de identificación; no demuestran una deuda ni un pago de un residente.</p><ul>{data.externas_sin_asociacion.map(c => <li className="mt-2" key={`${c.tipo}:${c.id_externo}`}>{c.tipo} · {c.id_externo} · {c.estado || 'Sin estado'} · {money(c.monto_centavos,c.moneda)} · {c.fecha_operacion || 'Sin fecha verificable'} · Pendiente</li>)}</ul>{!data.externas_sin_asociacion.length && <p>Sin candidatos en el alcance explorado.</p>}</section>}
      </>}
    </div>
  </AdminLayout>;
}
