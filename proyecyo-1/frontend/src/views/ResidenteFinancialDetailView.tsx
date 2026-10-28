import { useFeedbackState } from "@/hooks/useFeedbackState";
import { useCallback, useEffect, useState } from "react";
import { Download, LoaderCircle } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { FinancialReviewNotice } from "@/components/payments/FinancialReviewNotice";
import { Input } from "@/components/ui/input";
import { downloadResidentPaymentReceiptRequest, getFinancialDetailRequest } from "@/services/financialDetailService";
import { savePaymentReceipt } from "@/services/paymentReceiptService";
import type { FinancialDetail } from "@/types/financialDetail";
import { quotaStatusLabels, quotaStatusStyles } from "@/utils/quotaStatus";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-GT", {
    style: "currency",
    currency: "GTQ",
  }).format(value);
}

const summaryCards: Array<{ key: "total_cargos" | "total_recargos" | "total_pagado" | "saldo_pendiente"; label: string; accent: string }> = [
  { key: "total_cargos", label: "Total cargos", accent: "text-slate-950" },
  { key: "total_recargos", label: "Total recargos", accent: "text-amber-600" },
  { key: "total_pagado", label: "Total pagado", accent: "text-emerald-600" },
  { key: "saldo_pendiente", label: "Saldo pendiente", accent: "text-rose-600" },
];

export function ResidenteFinancialDetailView() {
  const [detail, setDetail] = useState<FinancialDetail | null>(null);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useFeedbackState("error", "");
  const [downloadError, setDownloadError] = useFeedbackState("error", "");
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  async function downloadReceipt(id: number, reference: string) {
    try {
      setDownloadingId(id); setDownloadError("");
      savePaymentReceipt(await downloadResidentPaymentReceiptRequest(id), reference);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "No fue posible descargar el comprobante.");
    } finally { setDownloadingId(null); }
  }

  const loadDetail = useCallback(async () => {
    try {
      setIsLoading(true);
      setErrorMessage("");
      const response = await getFinancialDetailRequest({ desde, hasta });
      setDetail(response);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "No fue posible cargar el detalle financiero.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [desde, hasta]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  return (
    <AppShell
      role="residente"
      title="Detalle de cargos y pagos"
      subtitle="Historial financiero de su unidad: cargos, recargos y pagos realizados."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="desde" className="text-xs font-medium text-slate-500">
            Desde
          </label>
          <Input id="desde" type="date" value={desde} onChange={(event) => setDesde(event.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="hasta" className="text-xs font-medium text-slate-500">
            Hasta
          </label>
          <Input id="hasta" type="date" value={hasta} onChange={(event) => setHasta(event.target.value)} />
        </div>
      </div>

      {errorMessage ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {errorMessage}
        </div>
      ) : isLoading || !detail ? (
        <p className="text-sm text-slate-500">Cargando detalle financiero...</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {summaryCards.map((card) => (
              <div key={card.key} className="rounded-xl border border-slate-200 bg-white p-5">
                <p className="text-sm text-slate-500">{card.label}</p>
                <p className={`mt-2 text-2xl font-semibold ${card.accent}`}>
                  {formatCurrency(detail.resumen[card.key])}
                </p>
              </div>
            ))}
          </div>

          {(detail.resumen.total_reembolsado || 0)>0 && <p>Pagado bruto {formatCurrency(detail.resumen.total_pagado)} · Devuelto {formatCurrency(detail.resumen.total_reembolsado || 0)} · Abono neto {formatCurrency(detail.resumen.abono_neto || 0)}</p>}
          {(detail.reembolsos || []).map(r=><p key={r.id_reembolso}>Reembolso #{r.id_reembolso} · {r.servicio} · {r.fecha_reembolso} · Devuelto {formatCurrency(r.monto_centavos/100)}</p>)}
          <FinancialReviewNotice {...detail.resumen} />
          <p className="text-sm text-slate-500">Los totales incluyen todos los abonos confirmados. Las fechas filtran los movimientos de pagos y recargos.</p>
          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-slate-950">Cargos</h3>
              <p className="text-sm text-slate-500">Cuotas asignadas a su unidad {detail.unidad}.</p>
            </div>
            <div className="overflow-x-auto">
              {detail.cargos.length === 0 ? (
                <p className="p-5 text-sm text-slate-500">No hay cargos en el periodo seleccionado.</p>
              ) : (
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.1em] text-slate-500">
                      <th className="px-5 py-3 font-semibold">Servicio</th>
                      <th className="px-5 py-3 font-semibold">Monto</th>
                      <th className="px-5 py-3 font-semibold">Recargo</th>
                      <th className="px-5 py-3 font-semibold">Pagado</th>
                      <th className="px-5 py-3 font-semibold">Saldo</th>
                      <th className="px-5 py-3 font-semibold">Vencimiento</th>
                      <th className="px-5 py-3 font-semibold">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.cargos.map((cargo) => (
                      <tr key={cargo.id_cuota} className="border-b border-slate-100 last:border-b-0">
                        <td className="px-5 py-3 text-sm text-slate-950">{cargo.servicio}</td>
                        <td className="px-5 py-3 text-sm text-slate-500">{formatCurrency(cargo.monto)}</td>
                        <td className="px-5 py-3 text-sm text-slate-500">{formatCurrency(cargo.recargo)}</td>
                        <td className="px-5 py-3 text-sm text-slate-500">{formatCurrency(cargo.pagado)}{(cargo.reembolsado || 0)>0 && <p>Devuelto {formatCurrency(cargo.reembolsado || 0)} · Neto {formatCurrency(cargo.abono_neto || 0)}</p>}</td>
                        <td className="px-5 py-3 text-sm text-slate-700">{formatCurrency(cargo.saldo)}</td>
                        <td className="px-5 py-3 text-sm text-slate-500">{cargo.fecha_limite}</td>
                        <td className="px-5 py-3">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-[0.7rem] font-medium ring-1 ${quotaStatusStyles[cargo.estado]}`}
                          >
                            {quotaStatusLabels[cargo.estado]}
                          </span>
                          {cargo.pago_parcial ? <p className="mt-1 text-[0.7rem] text-slate-500">Pago parcial</p> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-slate-950">Recargos</h3>
              <p className="text-sm text-slate-500">Recargos aplicados por cuotas vencidas.</p>
            </div>
            <div className="overflow-x-auto">
              {detail.recargos.length === 0 ? (
                <p className="p-5 text-sm text-slate-500">No hay recargos en el periodo seleccionado.</p>
              ) : (
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.1em] text-slate-500">
                      <th className="px-5 py-3 font-semibold">Servicio</th>
                      <th className="px-5 py-3 font-semibold">Tipo</th>
                      <th className="px-5 py-3 font-semibold">Monto original</th>
                      <th className="px-5 py-3 font-semibold">Recargo</th>
                      <th className="px-5 py-3 font-semibold">Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.recargos.map((recargo) => (
                      <tr key={recargo.id_recargo} className="border-b border-slate-100 last:border-b-0">
                        <td className="px-5 py-3 text-sm text-slate-950">{recargo.servicio}</td>
                        <td className="px-5 py-3 text-sm text-slate-500">{recargo.tipo_regla}</td>
                        <td className="px-5 py-3 text-sm text-slate-500">
                          {formatCurrency(recargo.monto_original)}
                        </td>
                        <td className="px-5 py-3 text-sm text-amber-600">
                          {formatCurrency(recargo.monto_recargo)}
                        </td>
                        <td className="px-5 py-3 text-sm text-slate-500">{recargo.fecha_aplicacion}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-slate-950">Pagos realizados</h3>
              <p className="text-sm text-slate-500">Pagos registrados para su unidad.</p>
            </div>
            {downloadError ? <p className="mx-5 mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{downloadError}</p> : null}
            <div className="overflow-x-auto">
              {detail.pagos.length === 0 ? (
                <p className="p-5 text-sm text-slate-500">No hay pagos en el periodo seleccionado.</p>
              ) : (
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.1em] text-slate-500">
                      <th className="px-5 py-3 font-semibold">Servicio</th>
                      <th className="px-5 py-3 font-semibold">Monto pagado</th>
                      <th className="px-5 py-3 font-semibold">Fecha de pago</th>
                      <th className="px-5 py-3 font-semibold">Comprobante</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.pagos.map((pago) => (
                      <tr key={pago.id_pago} className="border-b border-slate-100 last:border-b-0">
                        <td className="px-5 py-3 text-sm text-slate-950">{pago.servicio}</td>
                        <td className="px-5 py-3 text-sm text-emerald-600">
                          {formatCurrency(pago.monto_pagado)}
                        </td>
                        <td className="px-5 py-3 text-sm text-slate-500">{pago.fecha_pago}</td>
                        <td className="px-5 py-3">
                          <button type="button" disabled={downloadingId !== null}
                            onClick={() => void downloadReceipt(pago.id_pago, pago.numero_comprobante)}
                            aria-label={`Descargar comprobante ${pago.numero_comprobante}`}
                            className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs disabled:opacity-60">
                            {downloadingId === pago.id_pago ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                            {downloadingId === pago.id_pago ? "Descargando..." : "Descargar PDF"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}
