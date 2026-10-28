import { useFeedbackState } from "@/hooks/useFeedbackState";
import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/services/api";
import { FinancialReviewNotice } from "@/components/payments/FinancialReviewNotice";
import type { FinancialReview } from "@/types/financialBalance";

type Report = {
  resumen: { total_cobrado: number; total_devuelto_periodo?: number; cobrado_neto_periodo?: number; total_pendiente: number; total_mora: number; cantidad_pagos: number; usuarios_morosos: number } & FinancialReview;
  reembolsos?: Array<{id_reembolso:number;id_cuota:number;monto_centavos:number;fecha_reembolso:string}>;
  pagos?: Array<{ id_pago: number; id_cuota: number; monto_pagado: number; fecha_pago: string }>;
  detalle: Array<{ id_casa:number; unidad:string; usuario:string; concepto:string; monto:number; recargo:number; pagado:number; reembolsado?:number; abono_neto?:number; pendiente:number; fecha_limite:string; estado:string }>;
};
const money = (value:number) => new Intl.NumberFormat("es-GT", { style:"currency", currency:"GTQ" }).format(value);
export function AdminMonthlyFinancialReportView() {
  const now = new Date(); const [mes,setMes]=useState(now.getMonth()+1); const [anio,setAnio]=useState(now.getFullYear());
  const [report,setReport]=useState<Report|null>(null); const [loading,setLoading]=useState(true); const [error, setError] = useFeedbackState("error", "");
  async function load(){try{setLoading(true);setError("");setReport(await apiRequest<Report>(`/admin/reportes/financiero-mensual?mes=${mes}&anio=${anio}`));}catch(e){setError(e instanceof Error?e.message:"No fue posible cargar el reporte.");}finally{setLoading(false);}}
  useEffect(()=>{void load();},[]);
  return <AdminLayout title="Reporte financiero mensual" subtitle="Pagos y mora del residencial por periodo.">
    <div className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-3"><select aria-label="Mes" value={mes} onChange={e=>setMes(Number(e.target.value))} className="rounded-md border p-2">{Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}</select><input aria-label="Año" type="number" value={anio} onChange={e=>setAnio(Number(e.target.value))} className="rounded-md border p-2"/><Button onClick={()=>void load()}>Consultar</Button></div>
    {error?<p className="mt-4 rounded-lg bg-rose-50 p-3 text-rose-700">{error}</p>:null}
    {report && !loading ? <><FinancialReviewNotice {...report.resumen} /><p className="mt-4 text-sm text-slate-500">Cobrado y cantidad de pagos corresponden al mes. El cobrado es bruto; los reembolsos y el neto del período se muestran por separado. Los saldos de las cuotas son actuales y usan todos los movimientos confirmados.</p></> : null}
    {loading?<p className="mt-4">Cargando reporte...</p>:report?<><div className="mt-4 grid gap-3 md:grid-cols-5">{[["Total cobrado",report.resumen.total_cobrado],["Total devuelto",report.resumen.total_devuelto_periodo || 0],["Total neto del mes",report.resumen.cobrado_neto_periodo ?? report.resumen.total_cobrado],["Total pendiente",report.resumen.total_pendiente],["Total en mora",report.resumen.total_mora],["Pagos",report.resumen.cantidad_pagos],["Usuarios morosos",report.resumen.usuarios_morosos]].map(([l,v])=><div key={String(l)} className="rounded-xl border bg-white p-4"><p className="text-sm text-slate-500">{l}</p><strong>{String(l).includes("Total")?money(Number(v)):v}</strong></div>)}</div><div className="mt-4 overflow-x-auto rounded-xl border bg-white">{report.detalle.length===0?<p className="p-5">Sin resultados para el periodo.</p>:<table className="min-w-full text-sm"><thead><tr>{["Unidad","Usuario","Concepto","Vence","Pagado bruto","Devuelto","Abono neto","Pendiente","Estado"].map(x=><th key={x} className="p-3 text-left">{x}</th>)}</tr></thead><tbody>{report.detalle.map((r,i)=><tr key={`${r.id_casa}-${i}`} className="border-t"><td className="p-3">{r.unidad}</td><td>{r.usuario}</td><td>{r.concepto}</td><td>{r.fecha_limite}</td><td>{money(r.pagado)}</td><td>{money(r.reembolsado || 0)}</td><td>{money(r.abono_neto ?? r.pagado)}</td><td>{money(r.pendiente)}</td><td>{r.estado}</td></tr>)}</tbody></table>}</div></>:null}
    {report && !loading && report.pagos ? <section className="mt-4 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">Movimientos del mes</h2>
      {report.pagos.length === 0 ? <p className="mt-2 text-sm text-slate-500">No hay pagos en el mes seleccionado.</p> :
        <ul className="mt-2 space-y-2">{report.pagos.map((p) => <li key={p.id_pago} className="text-sm">Pago #{p.id_pago} · Cuota #{p.id_cuota} · {p.fecha_pago} · {money(p.monto_pagado)}</li>)}</ul>}
      {(report.reembolsos || []).map(r=><p key={r.id_reembolso}>Reembolso #{r.id_reembolso} · Cuota #{r.id_cuota} · {r.fecha_reembolso} · Devuelto {money(r.monto_centavos/100)}</p>)}
    </section> : null}
  </AdminLayout>;
}
