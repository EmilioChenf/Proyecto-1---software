import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Home,
  ReceiptText,
  RefreshCw,
  WalletCards,
  Download,
  LoaderCircle,
} from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { FinancialReviewNotice } from "@/components/payments/FinancialReviewNotice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { downloadTenantPaymentReceiptRequest, getTenantAccountStatementRequest, payTenantObligationRequest } from "@/services/tenantAccountService";
import { savePaymentReceipt } from "@/services/paymentReceiptService";
import {createTenantCheckoutRequest,redirectToRecurrente} from '@/services/recurrenteCheckoutService';
import type { AccountQuotaStatus } from "@/types/account";
import { quotaStatusLabels, quotaStatusStyles } from "@/utils/quotaStatus";
import type { TenantAccountQuota, TenantAccountStatement } from "@/types/tenantAccount";
import { confirmAction } from "@/utils/feedback";

type TenantAccountFilter = "TODAS" | AccountQuotaStatus;

const filterLabels: Record<TenantAccountFilter, string> = {
  TODAS: "Todas",
  PENDIENTE: "Pendientes",
  VENCIDA: "Vencidas",
  PAGADA: "Pagadas",
};

const statusLabels = quotaStatusLabels;
const statusStyles = quotaStatusStyles;

const emptyStatement: TenantAccountStatement = {
  casa: {
    id_casa: 0,
    unidad: "Sin unidad",
    propietario: "Sin propietario",
  },
  resumen: {
    total_cuotas: 0,
    cuotas_pagadas: 0,
    cuotas_pendientes: 0,
    cuotas_vencidas: 0,
    saldo_pendiente: 0,
    alquiler_pendiente: 0,
    cuotas_adicionales_pendientes: 0,
    total_pagado: 0,
    proximo_vencimiento: null,
    actualizado_en: "",
  },
  alquiler: [],
  cuotas_adicionales: [],
  pagos: [],
  recargos: [],
  periodo: { desde: null, hasta: null },
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-GT", {
    style: "currency",
    currency: "GTQ",
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) {
    return "Sin fecha";
  }

  return new Intl.DateTimeFormat("es-GT", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(new Date(`${value}T00:00:00`));
}

function formatUpdatedAt(value: string) {
  if (!value) {
    return "Sin actualizar";
  }

  return new Intl.DateTimeFormat("es-GT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getProgress(quota: TenantAccountQuota) {
  if (quota.monto <= 0) {
    return 0;
  }

  return Math.min(100, Math.round(((quota.abono_neto ?? quota.monto_pagado) / quota.monto) * 100));
}

function filterQuotas(quotas: TenantAccountQuota[], filter: TenantAccountFilter) {
  if (filter === "TODAS") {
    return quotas;
  }

  return quotas.filter((quota) => quota.estado === filter);
}

function QuotaTable({
  title,
  description,
  quotas,
  onPay,
  payingId,
}: {
  title: string;
  description: string;
  quotas: TenantAccountQuota[];
  onPay: (quota: TenantAccountQuota) => void;
  payingId: number | null;
}) {
  return (
    <Card className="border-slate-200 bg-white">
      <CardHeader className="border-b border-slate-200">
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-slate-500">{description}</p>
      </CardHeader>
      <CardContent className="p-0">
        {quotas.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">
            No hay cuotas para mostrar.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-[0.1em] text-slate-500">
                  <th className="px-5 py-3 font-semibold">Concepto</th>
                  <th className="px-5 py-3 font-semibold">Vencimiento</th>
                  <th className="px-5 py-3 font-semibold">Monto</th>
                  <th className="px-5 py-3 font-semibold">Pagado</th>
                  <th className="px-5 py-3 font-semibold">Saldo</th>
                  <th className="px-5 py-3 font-semibold">Estado</th>
                  <th className="px-5 py-3 font-semibold">Acción</th>
                </tr>
              </thead>
              <tbody>
                {quotas.map((quota) => (
                  <tr key={quota.id_cuota} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-5 py-4">
                      <p className="font-medium text-slate-950">{quota.servicio}</p>
                      <p className="text-sm text-slate-500">{quota.tipo_servicio}</p>
                      {quota.periodo&&<p className="text-sm text-slate-500">Período {quota.periodo.slice(0,7)}{quota.numero_cuota?` · Cuota #${quota.numero_cuota}`:''}</p>}
                      <div className="mt-3 h-2 w-44 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-blue-700"
                          style={{ width: `${getProgress(quota)}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-600">
                      {formatDate(quota.fecha_limite)}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-600">
                      {formatCurrency(quota.monto)}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-600">
                      {formatCurrency(quota.monto_pagado)}
                        {(quota.reembolsado || 0)>0 && <p>Devuelto {formatCurrency(quota.reembolsado || 0)} · Neto {formatCurrency(quota.abono_neto || 0)}</p>}
                      <p className="mt-1 text-xs text-slate-400">
                        {quota.ultimo_pago ? `Ultimo pago ${formatDate(quota.ultimo_pago)}` : "Sin pagos"}
                      </p>
                    </td>
                    <td className="px-5 py-4 text-sm font-semibold text-slate-950">
                      {formatCurrency(quota.saldo_pendiente)}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusStyles[quota.estado]}`}
                      >
                        {statusLabels[quota.estado]}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      {quota.estado !== "PAGADA" ? <Button type="button" disabled={payingId !== null} onClick={() => onPay(quota)}>{payingId === quota.id_cuota ? "Procesando..." : "Pagar"}</Button> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function InquilinoAccountView() {
  const [statement, setStatement] = useState<TenantAccountStatement>(emptyStatement);
  const [selectedFilter, setSelectedFilter] = useState<TenantAccountFilter>("TODAS");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [downloadMessage, setDownloadMessage] = useState("");
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [payingId, setPayingId] = useState<number | null>(null);
  const [paymentMessage, setPaymentMessage] = useState("");

  async function payQuota(quota: TenantAccountQuota) {
    const confirmed = await confirmAction({
      title: `¿Pagar ${quota.servicio}?`,
      text: `${statement.modelo_contractual ? "Pago mediante Recurrente." : "Pago simulado para fines académicos."} Monto base: ${formatCurrency(quota.monto_base)} · Recargos: ${formatCurrency(quota.recargo)} · Total: ${formatCurrency(quota.saldo_pendiente)}`,
      confirmText: "Confirmar pago",
    });
    if (!confirmed) return;
    try {
      setPayingId(quota.id_cuota); setErrorMessage(""); setPaymentMessage("");
      if(statement.modelo_contractual){const checkout=await createTenantCheckoutRequest(quota.id_cuota);redirectToRecurrente(checkout.checkout_url);return;}
      const payment = await payTenantObligationRequest(quota.id_cuota);
      setPaymentMessage(`Pago realizado: ${payment.numero_comprobante}`);
      await loadAccount({ silent: true });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No fue posible registrar el pago simulado.");
    } finally { setPayingId(null); }
  }

  async function downloadReceipt(id: number, reference: string) {
    try {
      setDownloadingId(id); setDownloadMessage("");
      savePaymentReceipt(await downloadTenantPaymentReceiptRequest(id), reference);
      setDownloadMessage("Comprobante descargado correctamente.");
    } catch (error) {
      setDownloadMessage(error instanceof Error ? error.message : "No fue posible descargar el comprobante.");
    } finally { setDownloadingId(null); }
  }

  async function loadAccount({ silent = false } = {}) {
    if (silent) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      const response = await getTenantAccountStatementRequest({ desde, hasta });
      setStatement(response);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "No fue posible cargar el estado de cuenta.",
      );
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    void loadAccount();

    const intervalId = window.setInterval(() => {
      void loadAccount({ silent: true });
    }, 30000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const filteredRent = useMemo(
    () => filterQuotas(statement.alquiler, selectedFilter),
    [selectedFilter, statement.alquiler],
  );
  const filteredAdditionalQuotas = useMemo(
    () => filterQuotas(statement.cuotas_adicionales, selectedFilter),
    [selectedFilter, statement.cuotas_adicionales],
  );

  const summaryCards = [
    {
      label: "Saldo pendiente",
      value: formatCurrency(statement.resumen.saldo_pendiente),
      helper: `${statement.resumen.cuotas_pendientes + statement.resumen.cuotas_vencidas} cuotas por cubrir`,
      icon: WalletCards,
      iconClassName: "bg-sky-50 text-sky-700",
    },
    {
      label: "Alquiler",
      value: formatCurrency(statement.resumen.alquiler_pendiente),
      helper: statement.alquiler.length ? "Saldo mensual registrado" : "Sin alquiler registrado",
      icon: Home,
      iconClassName: "bg-indigo-50 text-indigo-700",
    },
    {
      label: "Cuotas adicionales",
      value: formatCurrency(statement.resumen.cuotas_adicionales_pendientes),
      helper: `${statement.cuotas_adicionales.length} conceptos asociados`,
      icon: ReceiptText,
      iconClassName: "bg-amber-50 text-amber-700",
    },
    {
      label: "Cuotas vencidas",
      value: String(statement.resumen.cuotas_vencidas),
      helper: statement.resumen.cuotas_vencidas === 0 ? "Sin mora activa" : "Requieren atencion",
      icon: AlertTriangle,
      iconClassName: "bg-rose-50 text-rose-700",
    },
    {
      label: "Pagado",
      value: formatCurrency(statement.resumen.total_pagado),
      helper: "Pagos aplicados al estado de cuenta",
      icon: CheckCircle2,
      iconClassName: "bg-emerald-50 text-emerald-700",
    },
  ];

  return (
    <AppShell
      role="inquilino"
      title="Estado de Cuenta"
      subtitle="Alquiler, cuotas adicionales, vencimientos y pagos aplicados a tu unidad."
    >
      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white px-4 py-4 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-900">
            Unidad {statement.casa.unidad} - Propietario: {statement.casa.propietario}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Ultima actualizacion: {formatUpdatedAt(statement.resumen.actualizado_en)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => void loadAccount({ silent: true })}
            disabled={isRefreshing}
          >
            <RefreshCw className={`size-4 ${isRefreshing ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
        </div>
      </div>

      {errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>Error en estado de cuenta</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {(statement.reembolsos || []).map(r=><p key={r.id_reembolso}>Reembolso #{r.id_reembolso} · {r.servicio} · {r.fecha_reembolso} · Devuelto {formatCurrency(r.monto_centavos/100)}</p>)}
      <FinancialReviewNotice {...statement.resumen} />
      <p className="my-3 text-sm text-slate-500">El saldo incluye todos los abonos confirmados. Las fechas filtran los movimientos.</p>
      {statement.resumen.cuotas_vencidas > 0 ? (
        <Alert className="border-rose-200 bg-rose-50 text-rose-800">
          <AlertTriangle className="size-5" />
          <AlertTitle>Saldo vencido pendiente</AlertTitle>
          <AlertDescription>
            Revisa las cuotas vencidas para mantener tu unidad sin restricciones.
          </AlertDescription>
        </Alert>
      ) : null}

      {!statement.modelo_contractual&&<Alert className="border-sky-200 bg-sky-50 text-sky-800"><AlertTitle>Pago simulado para fines académicos.</AlertTitle><AlertDescription>No se solicitan ni almacenan datos bancarios.</AlertDescription></Alert>}
      {statement.mensaje&&<p role="status">{statement.mensaje}</p>}
      {paymentMessage ? <Alert className="border-emerald-200 bg-emerald-50 text-emerald-800"><AlertTitle>Pago realizado</AlertTitle><AlertDescription>{paymentMessage}. El comprobante está disponible en Pagos realizados.</AlertDescription></Alert> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {summaryCards.map(({ label, value, helper, icon: Icon, iconClassName }) => (
          <Card key={label} className="border-slate-200 bg-white/95">
            <CardContent className="flex min-h-[142px] items-start justify-between gap-4 p-5">
              <div>
                <p className="text-sm text-slate-500">{label}</p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{isLoading ? "..." : value}</p>
                <p className="mt-2 text-sm text-slate-500">{helper}</p>
              </div>
              <div className={`rounded-lg p-3 ${iconClassName}`}>
                <Icon className="size-6" />
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card className="border-slate-200 bg-white">
        <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-medium text-slate-950">
              Proximo vencimiento:{" "}
              {statement.resumen.proximo_vencimiento
                ? formatDate(statement.resumen.proximo_vencimiento)
                : "Sin saldos pendientes"}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              La informacion se refresca automaticamente cada 30 segundos.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {(Object.keys(filterLabels) as TenantAccountFilter[]).map((filter) => (
              <Button
                key={filter}
                type="button"
                variant={selectedFilter === filter ? "default" : "outline"}
                onClick={() => setSelectedFilter(filter)}
                className="min-w-[94px]"
              >
                {filterLabels[filter]}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <QuotaTable
        title="Alquiler"
        description="Cuotas de renta mensual registradas para tu unidad."
        quotas={filteredRent}
        onPay={(quota) => void payQuota(quota)}
        payingId={payingId}
      />

      <Card className="border-slate-200 bg-white">
        <CardHeader><CardTitle>Pagos realizados</CardTitle><p className="text-sm text-slate-500">Descarga el comprobante oficial de tus pagos.</p></CardHeader>
        <CardContent>
          {downloadMessage ? <p className="mb-3 text-sm text-slate-600">{downloadMessage}</p> : null}
          {statement.pagos.length === 0 ? <p className="text-sm text-slate-500">No hay pagos registrados.</p> : (
            <div className="space-y-2">{statement.pagos.map((payment) => (
              <div key={payment.id_pago} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div><p className="font-medium">{payment.servicio}</p><p className="text-sm text-slate-500">{payment.numero_comprobante} · {formatCurrency(payment.monto_pagado)} · {formatDate(payment.fecha_pago)}</p></div>
                <Button type="button" variant="outline" disabled={downloadingId !== null}
                  onClick={() => void downloadReceipt(payment.id_pago, payment.numero_comprobante)}>
                  {downloadingId === payment.id_pago ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                  {downloadingId === payment.id_pago ? "Descargando..." : "Descargar PDF"}
                </Button>
              </div>
            ))}</div>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-200 bg-white"><CardHeader><CardTitle>Filtros del historial</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3"><input aria-label="Desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded-md border p-2" />
          <input aria-label="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded-md border p-2" />
          <Button type="button" onClick={() => void loadAccount()}>Aplicar filtro</Button></CardContent></Card>

      <Card className="border-slate-200 bg-white"><CardHeader><CardTitle>Recargos</CardTitle></CardHeader><CardContent>
        {statement.recargos.length === 0 ? <p className="text-sm text-slate-500">No hay recargos en el periodo.</p> : statement.recargos.map((item) =>
          <div key={item.id_recargo} className="flex justify-between border-b py-3 text-sm"><span>{item.servicio} · {formatDate(item.fecha_aplicacion)}</span><strong>{formatCurrency(item.monto_recargo)}</strong></div>)}
      </CardContent></Card>

      <QuotaTable
        title="Cuotas adicionales"
        description="Servicios, mantenimientos y cargos complementarios de la unidad."
        quotas={filteredAdditionalQuotas}
        onPay={(quota) => void payQuota(quota)}
        payingId={payingId}
      />
    </AppShell>
  );
}
