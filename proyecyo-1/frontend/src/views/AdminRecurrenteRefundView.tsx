import { useFeedbackState } from "@/hooks/useFeedbackState";
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Button } from '@/components/ui/button';
import * as Dialog from '@radix-ui/react-dialog';
import { refundEligibility, requestTotalRefund, verifyRefund, refundError, type RefundEligibility, type RefundState } from '@/services/recurrenteRefundService';
const money = (n: number) => `Q${(Number(n)/100).toFixed(2)} GTQ`;
const labels: Record<RefundState, string> = { SOLICITADO:'Solicitado',PENDIENTE:'Pendiente',CONFIRMADO:'Confirmado',FALLIDO:'Fallido',INCIERTO:'Incierto',REVISION:'Revisión',CANCELADO:'Cancelado' };
export function AdminRecurrenteRefundView() {
  const [params] = useSearchParams();
  const [id, setId] = useState(params.get('transaccion') || '');
  const [data, setData] = useState<RefundEligibility | null>(null);
  const [reason, setReason] = useState(''), [error, setError] = useFeedbackState("error", ''), [result, setResult] = useFeedbackState("success", '');
  const [busy,setBusy] = useState(false), [confirm,setConfirm] = useState(false);
  const pending = useRef(false), key = useRef<string | null>(null), mounted = useRef(true);
  async function load(transactionId: string = id) {
    if (pending.current) return;
    if (!/^[1-9]\d*$/.test(transactionId) || !Number.isSafeInteger(Number(transactionId))) { setError('Indica un ID de transacción válido.'); return; }
    pending.current=true;setBusy(true);setError('');setData(null);
    try { const response=await refundEligibility(Number(transactionId)); if(mounted.current) {setData(response);key.current=null;} }
    catch(e){if(mounted.current)setError(refundError(e));}
    finally{pending.current=false;if(mounted.current)setBusy(false);}
  }
  useEffect(()=>{mounted.current=true;if(params.get('transaccion'))void load(params.get('transaccion')!);return()=>{mounted.current=false;};},[]);
  async function perform(refundId?: number) {
    if(pending.current || !data) return;
    if(refundId==null && (!data.elegible || !reason.trim() || reason.length>500 || !confirm)) return;
    pending.current=true;setBusy(true);setError('');setResult('');
    const transactionId=data.id_transaccion;
    try {
      const response=refundId==null ? await requestTotalRefund(transactionId,reason.trim(),key.current ||= crypto.randomUUID()) : await verifyRefund(refundId);
      if(mounted.current)setResult(`Reembolso ${labels[response.refund.estado]}. ${response.refund.estado==='CONFIRMADO' ? 'Se aplicó el importe devuelto; el PAGO original se conserva.' : 'El saldo solo cambia con un reembolso confirmado.'}`);
    } catch(e){if(mounted.current)setError(refundError(e));}
    finally {
      // Refresh only local data; never resend POST, invoke retry or verify automatically.
      try{const response=await refundEligibility(transactionId);if(mounted.current)setData(response);}catch{if(mounted.current){setData(null);setError('No se pudo actualizar el historial. No repitas la solicitud financiera.');}}
      pending.current=false;if(mounted.current){setBusy(false);setConfirm(false);}
    }
  }
  return <AdminLayout title="Reembolsos de pagos" subtitle="Recurrente · Reembolso total">
    <div className="space-y-5">
      <p className="rounded border border-amber-300 bg-amber-50 p-4">Sandbox / Prueba. Se conserva el pago original y el reembolso confirmado reabre la misma cuota. Solo reembolsos totales.</p>
      <form onSubmit={e=>{e.preventDefault();void load();}} className="flex flex-wrap gap-3">
        <label>Transacción local (ID)<input value={id} onChange={e=>setId(e.target.value)} inputMode="numeric" disabled={busy} className="ml-2 rounded border p-2" /></label>
        <Button disabled={busy} type="submit">Consultar elegibilidad</Button>
      </form>
      {busy && <p role="status">Procesando operación…</p>}{error && <p role="alert">{error}</p>}{result && <p role="status">{result}</p>}
      {data && <section className="space-y-4 rounded-xl border bg-white p-5">
        <h2 className="font-bold">{data.concepto} · Cuota {data.id_cuota}</h2>
        <p>{data.residente} · {data.unidad} · {data.ambiente==='sandbox'?'Sandbox / Prueba':data.ambiente}</p>
        <p>PAGO {data.id_pago ?? 'Ninguno'} · {data.numero_comprobante || 'Sin comprobante'} · Transacción {data.id_transaccion} · Checkout {data.id_checkout}</p>
        <p>Fecha original: {data.fecha_pago || 'Sin pago'} · Vencimiento original: {data.fecha_limite} · Estado: {data.estado}</p>
        <dl className="grid gap-3 sm:grid-cols-2">{[['Original',data.original_centavos],['Devuelto',data.devuelto_centavos],['Reservado',data.reservado_centavos],['Disponible',data.disponible_centavos],['Abono neto',data.abono_neto_centavos]].map(([label,value])=><div key={String(label)}><dt>{label}</dt><dd>{money(Number(value))}</dd></div>)}</dl>
        {!data.elegible && <p role="status">{data.motivo_inhabilitacion==='REFUND_BLOCKED'?'Operación bloqueada por un reembolso pendiente, incierto o en revisión.':'Operación no elegible para reembolso total.'}</p>}
        <label className="block">Motivo administrativo<textarea className="mt-1 block w-full rounded border p-2" maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} disabled={busy || !data.elegible} /><span>{reason.length}/500. No incluyas datos de tarjeta.</span></label>
        <p>Antes de enviar se verificará la elegibilidad en Recurrente Sandbox.</p>
        <Button disabled={busy || !data.elegible || !reason.trim()} onClick={()=>setConfirm(true)}>Solicitar reembolso total</Button>
        <h3 className="font-semibold">Historial de reembolsos</h3>
        {!data.reembolsos.length && <p>Sin reembolsos registrados.</p>}
        {data.reembolsos.map(r=><article className="rounded border p-3" key={r.id_reembolso}><p>Reembolso {r.id_reembolso} · {labels[r.estado]} · {money(r.monto_centavos)}</p><p>{r.motivo || 'Registro histórico sin motivo'} · {r.id_externo || 'Sin referencia externa segura'}</p><p>Proveedor: {r.estado_proveedor || 'Sin resultado'} · {r.fecha_contable || 'Sin fecha de confirmación'}</p>{r.error_codigo && <p>Requiere atención: {r.error_codigo}</p>}
          {r.id_externo && ['PENDIENTE','INCIERTO','REVISION'].includes(r.estado) && <Button disabled={busy} onClick={()=>void perform(r.id_reembolso)}>Verificar reembolso conocido</Button>}
        </article>)}
      </section>}
      <Dialog.Root open={confirm} onOpenChange={open=>{if(!busy)setConfirm(open);}}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" /><Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(95vw,32rem)] -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-xl bg-white p-6"><div className="space-y-2"><Dialog.Title className="font-bold">Confirmar reembolso total</Dialog.Title><Dialog.Description>Se devolverá {money(data?.disponible_centavos || 0)}. El PAGO original se conserva; la deuda de la misma cuota se reabre únicamente al confirmar el reembolso.</Dialog.Description></div>
        <p>Motivo: {reason}</p><div className="flex justify-end gap-3"><Button variant="outline" disabled={busy} onClick={()=>setConfirm(false)}>Cancelar</Button><Button disabled={busy || !data?.elegible} onClick={()=>void perform()}>{busy?'Solicitando…':'Confirmar solicitud'}</Button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
    </div>
  </AdminLayout>;
}
