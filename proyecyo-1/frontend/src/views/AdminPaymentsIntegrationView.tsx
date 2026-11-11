import { useEffect, useState } from "react";
import { CheckCircle2, CircleDashed, CreditCard, Loader2, PlugZap, ReceiptText, XCircle } from "lucide-react";

import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getFiscalSettingsRequest, getIntegrationStatusRequest, updateFiscalSettingsRequest, type FiscalSettings, type IntegrationStatus } from "@/services/paymentsIntegrationService";
import { notifyError, notifySuccess } from "@/utils/feedback";

function Check({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) {
  return <li className="flex items-start gap-2.5 py-1.5">{ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="Listo" /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-slate-400" aria-label="Pendiente" />}<span><span className="text-sm font-medium text-slate-800">{label}</span>{hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}</span></li>;
}

/** Pagos en línea (Recurrente) y factura electrónica (FEL): estado, prueba de conexión y datos fiscales. */
export function AdminPaymentsIntegrationView() {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [fiscal, setFiscal] = useState<FiscalSettings | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([getIntegrationStatusRequest(), getFiscalSettingsRequest()]).then(([s, f]) => { setStatus(s); setFiscal(f); })
      .catch((reason) => void notifyError(reason, "No fue posible cargar el estado de pagos."));
  }, []);

  async function test() {
    setTesting(true);
    try { setStatus(await getIntegrationStatusRequest(true)); } catch (reason) { void notifyError(reason, "No fue posible probar la conexión."); } finally { setTesting(false); }
  }
  async function saveFiscal() {
    if (!fiscal) return;
    setSaving(true);
    try {
      setFiscal(await updateFiscalSettingsRequest(fiscal));
      setStatus(await getIntegrationStatusRequest());
      void notifySuccess(fiscal.modo === "SIMULADO" ? "Datos fiscales guardados. Los comprobantes mostrarán la factura simulada." : "Datos fiscales guardados.");
    } catch (reason) { void notifyError(reason, "No fue posible guardar los datos fiscales."); } finally { setSaving(false); }
  }

  if (!status || !fiscal) return <AdminLayout title="Pagos en línea y factura" subtitle="Cobros con tarjeta y factura electrónica."><p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" />Cargando…</p></AdminLayout>;
  const r = status.recurrente;
  const field = (key: keyof FiscalSettings) => (e: { target: { value: string } }) => setFiscal({ ...fiscal, [key]: e.target.value });

  return (
    <AdminLayout title="Pagos en línea y factura" subtitle="Cobros con tarjeta mediante Recurrente y factura electrónica (FEL).">
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-2"><CreditCard className="size-5 text-blue-600" /><h2 className="font-semibold text-slate-900">Pagos con tarjeta (Recurrente)</h2></div>
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800">Modo pruebas</span></div>
          <p className="mt-1 text-sm text-slate-600">Los residentes ya pueden pagar en línea en ambiente de pruebas (tarjetas de prueba, sin cobro real).</p>
          <ul className="mt-3 divide-y divide-slate-100">
            <Check ok={r.configurado} label="Llave secreta y sandbox configurados" hint={r.configurado ? `Llave ${r.llave} · Sandbox ${r.sandbox_id}` : "Variables RECURRENTE_SECRET_KEY y RECURRENTE_SANDBOX_ID en el servidor."} />
            <Check ok={r.webhook_configurado} label="Confirmación automática de pagos (webhook)" hint={`Registra en Recurrente: ${r.url_webhook}`} />
          </ul>
          {r.conexion ? <p className={`mt-3 flex items-center gap-2 rounded-xl p-3 text-sm ${r.conexion.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{r.conexion.ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}{r.conexion.mensaje}</p> : null}
          <Button type="button" variant="outline" className="mt-3" disabled={!r.configurado || testing} onClick={() => void test()}><PlugZap className="size-4" />{testing ? "Probando…" : "Probar conexión"}</Button>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-2"><ReceiptText className="size-5 text-emerald-600" /><h2 className="font-semibold text-slate-900">Factura electrónica (FEL)</h2></div>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${fiscal.modo === "SIMULADO" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{fiscal.modo === "SIMULADO" ? "Simulación" : "Desactivada"}</span></div>
          <p className="mt-1 text-sm text-slate-600">En simulación cada comprobante muestra una factura de prueba sin validez fiscal. La factura real se activa al contratar un certificador autorizado por SAT.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">NIT del emisor<Input aria-label="NIT del emisor" className="mt-1.5" value={fiscal.nit} onChange={field("nit")} placeholder="1234567-8" /></label>
            <label className="text-sm font-medium text-slate-700">Régimen<select aria-label="Régimen" value={fiscal.regimen} onChange={field("regimen")} className="mt-1.5 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"><option value="GENERAL">General (IVA 12%)</option><option value="PEQUENO_CONTRIBUYENTE">Pequeño contribuyente</option></select></label>
            <label className="text-sm font-medium text-slate-700 sm:col-span-2">Razón social<Input aria-label="Razón social" className="mt-1.5" value={fiscal.nombre_emisor} onChange={field("nombre_emisor")} placeholder="Asociación de Propietarios Las Brisas" /></label>
            <label className="text-sm font-medium text-slate-700 sm:col-span-2">Dirección fiscal<Input aria-label="Dirección fiscal" className="mt-1.5" value={fiscal.direccion} onChange={field("direccion")} /></label>
            <label className="text-sm font-medium text-slate-700">Certificador (cuando se contrate)<Input aria-label="Certificador" className="mt-1.5" value={fiscal.certificador} onChange={field("certificador")} placeholder="Infile, Digifact…" /></label>
            <label className="flex items-end gap-2 pb-2 text-sm text-slate-700"><input type="checkbox" checked={fiscal.modo === "SIMULADO"} onChange={(e) => setFiscal({ ...fiscal, modo: e.target.checked ? "SIMULADO" : "DESACTIVADO" })} />Mostrar factura simulada en comprobantes</label>
          </div>
          <Button type="button" className="mt-3" disabled={saving} onClick={() => void saveFiscal()}>{saving ? "Guardando…" : "Guardar datos fiscales"}</Button>
        </section>
      </div>

      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-slate-900">Para cobrar dinero real (cuando el residencial lo contrate)</h2>
        <ol className="mt-3 grid gap-2 md:grid-cols-2">{status.produccion.map((item, index) => (
          <li key={item.paso} className="flex gap-3 rounded-xl bg-slate-50 p-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white">{index + 1}</span><span className="text-sm text-slate-700">{item.paso}<span className="mt-0.5 block text-xs text-slate-500">Responsable: {item.responsable}</span></span></li>
        ))}</ol>
      </section>
    </AdminLayout>
  );
}
