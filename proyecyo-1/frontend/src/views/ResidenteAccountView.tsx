import { useFeedbackState } from "@/hooks/useFeedbackState";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  RefreshCw,
  WalletCards,
} from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { FinancialReviewNotice } from "@/components/payments/FinancialReviewNotice";
import { RecurrenteReceipts } from "@/components/payments/RecurrenteReceipts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getResidentAccountStatementRequest } from "@/services/accountService";
import { createResidentCheckoutRequest, redirectToRecurrente } from "@/services/recurrenteCheckoutService";
import { getErrorMessage } from "@/utils/errorMessages";
import type { AccountQuota, AccountQuotaStatus, AccountStatement } from "@/types/account";
import { quotaStatusLabels, quotaStatusStyles } from "@/utils/quotaStatus";

type AccountFilter = "TODAS" | AccountQuotaStatus;

const filterLabels: Record<AccountFilter, string> = {
  TODAS: "Todas",
  PENDIENTE: "Pendientes",
  VENCIDA: "Vencidas",
  PAGADA: "Pagadas",
};

const statusLabels = quotaStatusLabels;
const statusStyles = quotaStatusStyles;

const emptyStatement: AccountStatement = {
  resumen: {
    total_cuotas: 0,
    cuotas_pagadas: 0,
    cuotas_pendientes: 0,
    cuotas_vencidas: 0,
    saldo_pendiente: 0,
    total_pagado: 0,
    proximo_vencimiento: null,
    actualizado_en: "",
  },
  cuotas: [],
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

function getProgress(quota: AccountQuota) {
  if (quota.monto <= 0) {
    return 0;
  }

  return Math.min(100, Math.round(((quota.abono_neto ?? quota.monto_pagado) / quota.monto) * 100));
}

export function ResidenteAccountView() {
  const [statement, setStatement] = useState<AccountStatement>(emptyStatement);
  const [selectedFilter, setSelectedFilter] = useState<AccountFilter>("TODAS");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useFeedbackState("error", "");
  const [payingQuotaId, setPayingQuotaId] = useState<number | null>(null);
  const [checkoutError, setCheckoutError] = useFeedbackState("error", "");
  const checkoutInProgress = useRef(false);

  async function payQuota(quota: AccountQuota) {
    if (checkoutInProgress.current) return;
    checkoutInProgress.current = true;
    setPayingQuotaId(quota.id_cuota);
    setCheckoutError("");
    try {
      const checkout = await createResidentCheckoutRequest(quota.id_cuota);
      redirectToRecurrente(checkout.checkout_url);
      // Keep the action disabled while navigation completes; creation never confirms a payment.
    } catch (error) {
      setCheckoutError(getErrorMessage(error, "No fue posible abrir el checkout de Recurrente."));
      checkoutInProgress.current = false;
      setPayingQuotaId(null);
    }
  }

  async function loadAccount({ silent = false } = {}) {
    if (silent) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      const response = await getResidentAccountStatementRequest();
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

  const filteredQuotas = useMemo(() => {
    if (selectedFilter === "TODAS") {
      return statement.cuotas;
    }

    return statement.cuotas.filter((quota) => quota.estado === selectedFilter);
  }, [selectedFilter, statement.cuotas]);

  const summaryCards = [
    {
      label: "Saldo pendiente",
      value: formatCurrency(statement.resumen.saldo_pendiente),
      helper: `${statement.resumen.cuotas_pendientes + statement.resumen.cuotas_vencidas} cuotas por cubrir`,
      icon: WalletCards,
      iconClassName: "bg-sky-50 text-sky-700",
    },
    {
      label: "Cuotas pagadas",
      value: String(statement.resumen.cuotas_pagadas),
      helper: `${formatCurrency(statement.resumen.total_pagado)} registrado`,
      icon: CheckCircle2,
      iconClassName: "bg-emerald-50 text-emerald-700",
    },
    {
      label: "Cuotas vencidas",
      value: String(statement.resumen.cuotas_vencidas),
      helper:
        statement.resumen.cuotas_vencidas === 0
          ? "Sin mora activa"
          : "Requieren atencion",
      icon: AlertTriangle,
      iconClassName: "bg-rose-50 text-rose-700",
    },
    {
      label: "Proximo vencimiento",
      value: statement.resumen.proximo_vencimiento
        ? formatDate(statement.resumen.proximo_vencimiento)
        : "Al dia",
      helper: "Se refresca automaticamente",
      icon: CalendarClock,
      iconClassName: "bg-amber-50 text-amber-700",
    },
  ];

  return (
    <AppShell
      role="residente"
      title="Estado de Cuenta"
      subtitle="Resumen actualizado de cuotas, pagos aplicados y saldos pendientes."
    >
      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white px-4 py-4 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-900">
            Ultima actualizacion: {formatUpdatedAt(statement.resumen.actualizado_en)}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            La informacion se consulta nuevamente cada 30 segundos mientras esta pantalla esta abierta.
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

      <Alert className="border-sky-200 bg-sky-50 text-sky-800">
        <AlertTitle>Pago electrónico con Recurrente — Sandbox</AlertTitle>
        <AlertDescription>Se abrirá el checkout hospedado. El pago quedará pendiente de verificación.</AlertDescription>
      </Alert>

      {checkoutError ? (
        <Alert variant="destructive">
          <AlertTitle>No se pudo abrir el checkout</AlertTitle>
          <AlertDescription>{checkoutError}</AlertDescription>
        </Alert>
      ) : null}

      <FinancialReviewNotice {...statement.resumen} />
      {statement.resumen.cuotas_vencidas > 0 ? (
        <Alert className="border-rose-200 bg-rose-50 text-rose-800">
          <AlertTriangle className="size-5" />
          <AlertTitle>Cuotas vencidas pendientes</AlertTitle>
          <AlertDescription>
            Revisa los servicios marcados como vencidos para regularizar el saldo de tu unidad.
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
        <CardHeader className="gap-4 border-b border-slate-200">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Detalle de cuotas</CardTitle>
              <p className="mt-1 text-sm text-slate-500">
                Consulta cuotas pagadas, pendientes y vencidas por servicio.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {(Object.keys(filterLabels) as AccountFilter[]).map((filter) => (
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
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {filteredQuotas.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-slate-500">
              No hay cuotas para el filtro seleccionado.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-[0.1em] text-slate-500">
                    <th className="px-5 py-3 font-semibold">Servicio</th>
                    <th className="px-5 py-3 font-semibold">Unidad</th>
                    <th className="px-5 py-3 font-semibold">Vencimiento</th>
                    <th className="px-5 py-3 font-semibold">Monto</th>
                    <th className="px-5 py-3 font-semibold">Pagado</th>
                    <th className="px-5 py-3 font-semibold">Saldo</th>
                    <th className="px-5 py-3 font-semibold">Estado</th>
                    <th className="px-5 py-3 font-semibold">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredQuotas.map((quota) => (
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
                      <td className="px-5 py-4 text-sm text-slate-600">{quota.casa_unidad}</td>
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
                        {quota.estado !== "PAGADA" ? (
                          <Button type="button" disabled={payingQuotaId !== null || quota.requiere_revision} onClick={() => void payQuota(quota)}>
                            {payingQuotaId === quota.id_cuota ? "Abriendo checkout..." : "Pagar"}
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      {!isLoading && statement.resumen.total_pagado > 0 && <RecurrenteReceipts totalPaid={statement.resumen.total_pagado} />}
    </AppShell>
  );
}
