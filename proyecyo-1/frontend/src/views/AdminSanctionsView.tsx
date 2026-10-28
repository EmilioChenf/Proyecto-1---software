import { useFeedbackState } from "@/hooks/useFeedbackState";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Ban,
  ClipboardList,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
  WalletCards,
} from "lucide-react";

import { AdminLayout } from "@/components/admin/AdminLayout";
import {
  generateAdminSanctionsRequest,
  getAdminSanctionHistoryRequest,
  getAdminSanctionRulesRequest,
  getAdminSanctionSummaryRequest,
  getAdminSanctionsRequest,
  updateAdminSanctionStatusRequest,
} from "@/services/adminSanctionsService";
import type {
  AdminSanctionFilterStatus,
  AdminSanctionHistoryRecord,
  AdminSanctionRecord,
  AdminSanctionRule,
  AdminSanctionStatus,
  AdminSanctionSummary,
} from "@/types/sanctions";
import { formatUtcTimestamp } from "@/utils/guatemalaTime";

const fieldClassName =
  "h-10 rounded-xl border border-slate-200 bg-white px-3 text-[0.82rem] text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100";

const statusOptions: Array<{ value: AdminSanctionFilterStatus; label: string }> = [
  { value: "TODOS", label: "Todos los estados" },
  { value: "PENDIENTE", label: "Pendiente" },
  { value: "PAGADA", label: "Pagada" },
  { value: "ANULADA", label: "Anulada" },
];

const statusStyles: Record<AdminSanctionStatus, string> = {
  PENDIENTE: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
  PAGADA: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
  ANULADA: "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200",
};

const statusLabels: Record<AdminSanctionStatus, string> = {
  PENDIENTE: "Pendiente",
  PAGADA: "Pagada",
  ANULADA: "Anulada",
};

const historyActionLabels: Record<AdminSanctionHistoryRecord["accion"], string> = {
  GENERACION_AUTOMATICA: "Generacion automatica",
  CAMBIO_ESTADO: "Cambio de estado",
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-GT", {
    style: "currency",
    currency: "GTQ",
  }).format(value);
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  accentClassName,
}: {
  label: string;
  value: string;
  icon: typeof ShieldAlert;
  accentClassName: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[0.82rem] text-slate-500">{label}</p>
          <p className={`mt-2 text-3xl font-medium tracking-tight ${accentClassName}`}>{value}</p>
        </div>
        <div className="rounded-xl bg-blue-50 p-2.5 text-blue-600">
          <Icon className="size-5" />
        </div>
      </div>
    </article>
  );
}

function RulesPanel({ rules }: { rules: AdminSanctionRule[] }) {
  return (
    <section className="mt-5 rounded-[20px] border border-slate-200 bg-white px-5 py-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
      <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
        <div className="flex size-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
          <ClipboardList className="size-5" />
        </div>
        <div>
          <h2 className="text-[1rem] font-semibold text-slate-950">Reglas automaticas</h2>
          <p className="mt-1 text-[0.82rem] text-slate-500">
            Condiciones activas para generar sanciones por incumplimiento.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {rules.map((rule) => (
          <article key={rule.codigo} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-950">{rule.nombre}</p>
                <p className="mt-1 text-[0.8rem] text-slate-600">{rule.descripcion}</p>
              </div>
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[0.7rem] font-medium text-emerald-700">
                Activa
              </span>
            </div>
            <dl className="mt-3 grid gap-2 text-[0.78rem] text-slate-600">
              <div>
                <dt className="font-medium text-slate-800">Condicion</dt>
                <dd className="mt-0.5">{rule.condicion}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-800">Sancion</dt>
                <dd className="mt-0.5">{rule.sancion}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

export function AdminSanctionsView() {
  const [summary, setSummary] = useState<AdminSanctionSummary>({
    total: 0,
    pendientes: 0,
    pagadas: 0,
    anuladas: 0,
    monto_pendiente: 0,
  });
  const [rules, setRules] = useState<AdminSanctionRule[]>([]);
  const [sanctions, setSanctions] = useState<AdminSanctionRecord[]>([]);
  const [history, setHistory] = useState<AdminSanctionHistoryRecord[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [house, setHouse] = useState("");
  const [debouncedHouse, setDebouncedHouse] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<AdminSanctionFilterStatus>("TODOS");
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useFeedbackState("error", "");
  const [successMessage, setSuccessMessage] = useFeedbackState("success", "");

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search);
      setDebouncedHouse(house);
    }, 350);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [house, search]);

  const filters = useMemo(
    () => ({
      search: debouncedSearch,
      house: debouncedHouse,
      status: selectedStatus,
    }),
    [debouncedHouse, debouncedSearch, selectedStatus],
  );

  const loadSanctionsModule = useCallback(async () => {
    try {
      setIsLoading(true);
      setErrorMessage("");

      const [summaryResponse, rulesResponse, sanctionsResponse, historyResponse] = await Promise.all([
        getAdminSanctionSummaryRequest(),
        getAdminSanctionRulesRequest(),
        getAdminSanctionsRequest(filters),
        getAdminSanctionHistoryRequest(filters),
      ]);

      setSummary(summaryResponse);
      setRules(rulesResponse);
      setSanctions(sanctionsResponse);
      setHistory(historyResponse);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "No fue posible cargar las sanciones.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void loadSanctionsModule();
  }, [loadSanctionsModule]);

  const handleGenerateSanctions = useCallback(async () => {
    try {
      setIsGenerating(true);
      setErrorMessage("");
      setSuccessMessage("");

      const result = await generateAdminSanctionsRequest();
      setSuccessMessage(
        result.generadas === 1
          ? "Se genero 1 sancion automatica."
          : `Se generaron ${result.generadas} sanciones automaticas.`,
      );
      await loadSanctionsModule();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "No fue posible generar sanciones automaticas.",
      );
    } finally {
      setIsGenerating(false);
    }
  }, [loadSanctionsModule]);

  const handleStatusChange = useCallback(
    async (sanctionId: number, status: AdminSanctionStatus) => {
      try {
        setUpdatingId(sanctionId);
        setErrorMessage("");
        setSuccessMessage("");
        await updateAdminSanctionStatusRequest(sanctionId, status);
        await loadSanctionsModule();
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "No fue posible actualizar la sancion.",
        );
      } finally {
        setUpdatingId(null);
      }
    },
    [loadSanctionsModule],
  );

  return (
    <AdminLayout
      title="Sanciones"
      subtitle="Aplicacion automatica de sanciones por incumplimiento"
      actions={
        <button
          type="button"
          onClick={handleGenerateSanctions}
          disabled={isGenerating}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-60"
        >
          {isGenerating ? <RefreshCw className="size-4 animate-spin" /> : <Play className="size-4" />}
          {isGenerating ? "Generando..." : "Generar automaticas"}
        </button>
      }
    >
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Pendientes"
          value={String(summary.pendientes)}
          icon={ShieldAlert}
          accentClassName="text-amber-600"
        />
        <SummaryCard
          label="Monto pendiente"
          value={formatCurrency(summary.monto_pendiente)}
          icon={WalletCards}
          accentClassName="text-slate-950"
        />
        <SummaryCard
          label="Pagadas"
          value={String(summary.pagadas)}
          icon={BadgeCheck}
          accentClassName="text-emerald-600"
        />
        <SummaryCard
          label="Anuladas"
          value={String(summary.anuladas)}
          icon={Ban}
          accentClassName="text-slate-500"
        />
      </section>

      <RulesPanel rules={rules} />

      <section className="mt-5 rounded-[20px] border border-slate-200 bg-white px-4 py-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
        <h2 className="mb-3 text-[0.92rem] font-semibold text-slate-800">Filtros de sanciones</h2>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por residente, motivo o detalle..."
              aria-label="Buscar sanciones"
              className={`${fieldClassName} w-full pl-11`}
            />
          </div>
          <input
            value={house}
            onChange={(event) => setHouse(event.target.value)}
            placeholder="Filtrar por casa/unidad..."
            aria-label="Filtrar sanciones por casa o unidad"
            className={`${fieldClassName} min-w-[220px]`}
          />
          <select
            value={selectedStatus}
            onChange={(event) => setSelectedStatus(event.target.value as AdminSanctionFilterStatus)}
            className={`${fieldClassName} min-w-[190px]`}
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="mt-5 rounded-[20px] border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
        {successMessage ? (
          <div className="border-b border-emerald-100 bg-emerald-50 px-5 py-3 text-sm text-emerald-700">
            {successMessage}
          </div>
        ) : null}
        {errorMessage ? (
          <div className="border-b border-rose-100 bg-rose-50 px-5 py-3 text-sm text-rose-700">
            {errorMessage}
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="min-w-[1080px] w-full">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.1em] text-slate-500">
                <th className="px-5 py-3 font-semibold">Unidad</th>
                <th className="px-5 py-3 font-semibold">Residente</th>
                <th className="px-5 py-3 font-semibold">Regla</th>
                <th className="px-5 py-3 font-semibold">Detalle</th>
                <th className="px-5 py-3 font-semibold">Fecha</th>
                <th className="px-5 py-3 font-semibold">Monto</th>
                <th className="px-5 py-3 font-semibold">Estado</th>
                <th className="px-5 py-3 font-semibold">Accion</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-slate-500">
                    Cargando sanciones...
                  </td>
                </tr>
              ) : sanctions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-slate-500">
                    No hay sanciones que coincidan con los filtros actuales.
                  </td>
                </tr>
              ) : (
                sanctions.map((sanction) => (
                  <tr key={sanction.id_sancion} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-5 py-3 text-sm font-medium text-slate-950">
                      {sanction.casa_unidad}
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-600">{sanction.residente}</td>
                    <td className="px-5 py-3">
                      <span className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-[0.7rem] font-medium text-blue-700">
                        {sanction.motivo}
                      </span>
                    </td>
                    <td className="max-w-[360px] px-5 py-3 text-sm text-slate-600">
                      <p className="line-clamp-2">{sanction.detalle}</p>
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-500">
                      {sanction.fecha_incumplimiento}
                    </td>
                    <td className="px-5 py-3 text-sm font-semibold text-slate-950">
                      {formatCurrency(sanction.monto)}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-[0.7rem] font-medium ${statusStyles[sanction.estado]}`}
                      >
                        {statusLabels[sanction.estado]}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <select
                        value={sanction.estado}
                        disabled={updatingId === sanction.id_sancion}
                        onChange={(event) =>
                          void handleStatusChange(
                            sanction.id_sancion,
                            event.target.value as AdminSanctionStatus,
                          )
                        }
                        className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-[0.78rem] text-slate-700 outline-none transition focus:border-blue-500 disabled:opacity-60"
                        aria-label={`Actualizar estado de sancion ${sanction.id_sancion}`}
                      >
                        <option value="PENDIENTE">Pendiente</option>
                        <option value="PAGADA">Pagada</option>
                        <option value="ANULADA">Anulada</option>
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-5 rounded-[20px] border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-[1rem] font-semibold text-slate-950">Historial de sanciones</h2>
          <p className="mt-1 text-[0.82rem] text-slate-500">
            Ultimos eventos registrados para generacion y cambios de estado.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[920px] w-full">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.1em] text-slate-500">
                <th className="px-5 py-3 font-semibold">Fecha</th>
                <th className="px-5 py-3 font-semibold">Unidad</th>
                <th className="px-5 py-3 font-semibold">Residente</th>
                <th className="px-5 py-3 font-semibold">Evento</th>
                <th className="px-5 py-3 font-semibold">Estado</th>
                <th className="px-5 py-3 font-semibold">Detalle</th>
                <th className="px-5 py-3 font-semibold">Responsable</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-slate-500">
                    Cargando historial...
                  </td>
                </tr>
              ) : history.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-slate-500">
                    Aun no hay eventos en el historial de sanciones.
                  </td>
                </tr>
              ) : (
                history.map((event) => (
                  <tr key={event.id_historial} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-5 py-3 text-sm text-slate-500">{formatUtcTimestamp(event.creado_en)}</td>
                    <td className="px-5 py-3 text-sm font-medium text-slate-950">
                      {event.casa_unidad}
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-600">{event.residente}</td>
                    <td className="px-5 py-3">
                      <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[0.7rem] font-medium text-slate-700">
                        {historyActionLabels[event.accion]}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-600">
                      {event.estado_anterior
                        ? `${statusLabels[event.estado_anterior]} -> ${statusLabels[event.estado_nuevo]}`
                        : statusLabels[event.estado_nuevo]}
                    </td>
                    <td className="max-w-[320px] px-5 py-3 text-sm text-slate-600">
                      <p className="line-clamp-2">{event.detalle}</p>
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-500">{event.realizado_por}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AdminLayout>
  );
}
