import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, CheckCircle2, Clock3, Download, RefreshCw, Search, XCircle } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AdminLayout } from "@/components/admin/AdminLayout";
import { downloadReport } from "@/services/reportExportService";
import {
  getAdminAccessDailyChartRequest,
  getAdminAccessHourlyChartRequest,
  getAdminAccessesRequest,
  getAdminAccessSummaryRequest,
} from "@/services/adminAccessesService";
import type {
  AdminAccessDailyPoint,
  AdminAccessFilterStatus,
  AdminAccessFilterType,
  AdminAccessHourlyPoint,
  AdminAccessRecord,
  AdminAccessStatus,
  AdminAccessSummary,
  AdminAccessType,
} from "@/types/accesses";
import { subscribeToAccessCounterUpdates } from "@/utils/accessCounterUpdates";

const typeOptions: Array<{ value: AdminAccessFilterType; label: string }> = [
  { value: "TODOS", label: "Todos los tipos" },
  { value: "RESIDENTE", label: "Residente" },
  { value: "VISITANTE", label: "Visitante" },
  { value: "PROVEEDOR", label: "Proveedor" },
];

const statusOptions: Array<{ value: AdminAccessFilterStatus; label: string }> = [
  { value: "TODOS", label: "Todos los estados" },
  { value: "APROBADO", label: "Aprobado" },
  { value: "PENDIENTE", label: "Pendiente" },
  { value: "RECHAZADO", label: "Rechazado" },
];

const typeBadgeStyles: Record<AdminAccessType, string> = {
  RESIDENTE: "bg-blue-100 text-blue-700",
  VISITANTE: "bg-fuchsia-100 text-fuchsia-700",
  PROVEEDOR: "bg-amber-100 text-amber-700",
};

const typeLabels: Record<AdminAccessType, string> = {
  RESIDENTE: "Residente",
  VISITANTE: "Visitante",
  PROVEEDOR: "Proveedor",
};

const statusStyles: Record<
  AdminAccessStatus,
  {
    className: string;
    iconClassName: string;
    dotClassName: string;
    icon: typeof CheckCircle2;
    label: string;
  }
> = {
  APROBADO: {
    className: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
    iconClassName: "text-emerald-600",
    dotClassName: "bg-emerald-500",
    icon: CheckCircle2,
    label: "Aprobado",
  },
  PENDIENTE: {
    className: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
    iconClassName: "text-amber-500",
    dotClassName: "bg-amber-500 animate-pulse",
    icon: Clock3,
    label: "Pendiente",
  },
  RECHAZADO: {
    className: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200",
    iconClassName: "text-rose-600",
    dotClassName: "bg-rose-500",
    icon: XCircle,
    label: "Rechazado",
  },
};

const cardAccentStyles = {
  total: "text-slate-950",
  approved: "text-emerald-600",
  pending: "text-amber-500",
  rejected: "text-rose-600",
};

const fieldClassName =
  "h-10 rounded-xl border border-slate-200 bg-white px-3 text-[0.82rem] text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100";

function formatRefreshTime(date: Date | null) {
  if (!date) {
    return "Sin sincronizar";
  }

  return new Intl.DateTimeFormat("es-GT", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function SummaryCard({
  label,
  value,
  accentClassName,
}: {
  label: string;
  value: number;
  accentClassName: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
      <p className="text-[0.82rem] text-slate-500">{label}</p>
      <p className={`mt-1.5 text-3xl font-medium tracking-tight ${accentClassName}`}>{value}</p>
    </article>
  );
}

function AccessHourlyTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: AdminAccessHourlyPoint }>;
  label?: string;
}) {
  if (!active || !payload?.length) {
    return null;
  }

  const point = payload[0].payload;

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-slate-900">{label}</p>
      <p className="mt-1 text-slate-600">Total: {point.total}</p>
      <div className="mt-1.5 grid gap-1 text-[0.72rem]">
        <span className="text-emerald-600">Aprobados: {point.aprobados}</span>
        <span className="text-amber-600">Pendientes: {point.pendientes}</span>
        <span className="text-rose-600">Rechazados: {point.rechazados}</span>
      </div>
    </div>
  );
}

function AdminAccessHourlyChart({
  data,
  isLoading,
}: {
  data: AdminAccessHourlyPoint[];
  isLoading: boolean;
}) {
  const visibleData = useMemo(() => data.filter((point) => point.total > 0), [data]);
  const chartData = visibleData.length > 0 ? visibleData : data;
  const busiestHour = useMemo(
    () =>
      data.reduce<AdminAccessHourlyPoint>(
        (current, point) => (point.total > current.total ? point : current),
        { hora: "--:--", total: 0, aprobados: 0, pendientes: 0, rechazados: 0 },
      ),
    [data],
  );

  return (
    <section
      className="mt-5 rounded-[20px] border border-slate-200 bg-white px-4 py-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]"
      aria-labelledby="admin-accesses-hourly-chart-heading"
    >
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <BarChart3 className="size-5" />
          </div>
          <div>
            <h2
              id="admin-accesses-hourly-chart-heading"
              className="text-[0.98rem] font-semibold text-slate-900"
            >
              Accesos por hora
            </h2>
            <p className="mt-1 text-[0.8rem] text-slate-500">
              Distribucion de ingresos registrados durante el dia.
            </p>
          </div>
        </div>

        <div className="rounded-xl bg-slate-50 px-3 py-2 text-right">
          <p className="text-[0.72rem] font-medium uppercase tracking-[0.08em] text-slate-500">
            Hora con mayor movimiento
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-950">
            {busiestHour.total ? `${busiestHour.hora} - ${busiestHour.total} accesos` : "Sin accesos"}
          </p>
        </div>
      </div>

      <div className="h-[290px] pt-4">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            Cargando grafica de accesos...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="hora"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#64748b", fontSize: 12 }}
                interval={chartData.length > 12 ? 1 : 0}
              />
              <YAxis
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#64748b", fontSize: 12 }}
              />
              <Tooltip content={<AccessHourlyTooltip />} cursor={{ fill: "#eff6ff" }} />
              <Bar dataKey="total" name="Accesos" fill="#2563eb" radius={[8, 8, 0, 0]} maxBarSize={42} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

// SCRUM-174: Grafica estadistica diaria (ultimos 7 dias)
function formatDayLabel(fecha: string) {
  // Devuelve formato "Lun 14" para etiquetas compactas en el eje X
  try {
    const date = new Date(`${fecha}T00:00:00`);
    const day = new Intl.DateTimeFormat("es-GT", { weekday: "short" }).format(date);
    const num = new Intl.DateTimeFormat("es-GT", { day: "numeric" }).format(date);
    const cleanDay = day.replace(/\.$/, "");
    return `${cleanDay.charAt(0).toUpperCase()}${cleanDay.slice(1)} ${num}`;
  } catch {
    return fecha;
  }
}

function AccessDailyTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: AdminAccessDailyPoint & { etiqueta: string } }>;
}) {
  if (!active || !payload?.length) {
    return null;
  }

  const point = payload[0].payload;

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-slate-900">{point.etiqueta}</p>
      <p className="mt-1 text-slate-600">Total: {point.total}</p>
      <div className="mt-1.5 grid gap-1 text-[0.72rem]">
        <span className="text-emerald-600">Aprobados: {point.aprobados}</span>
        <span className="text-amber-600">Pendientes: {point.pendientes}</span>
        <span className="text-rose-600">Rechazados: {point.rechazados}</span>
      </div>
    </div>
  );
}

function AdminAccessDailyChart({
  data,
  isLoading,
}: {
  data: AdminAccessDailyPoint[];
  isLoading: boolean;
}) {
  const chartData = useMemo(
    () => data.map((point) => ({ ...point, etiqueta: formatDayLabel(point.fecha) })),
    [data],
  );

  const totalSemana = useMemo(
    () => data.reduce((sum, point) => sum + point.total, 0),
    [data],
  );

  return (
    <section
      className="mt-5 rounded-[20px] border border-slate-200 bg-white px-4 py-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]"
      aria-labelledby="admin-accesses-daily-chart-heading"
    >
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <BarChart3 className="size-5" />
          </div>
          <div>
            <h2
              id="admin-accesses-daily-chart-heading"
              className="text-[0.98rem] font-semibold text-slate-900"
            >
              Accesos por dia (ultimos 7 dias)
            </h2>
            <p className="mt-1 text-[0.8rem] text-slate-500">
              Tendencia diaria para identificar patrones semanales.
            </p>
          </div>
        </div>

        <div className="rounded-xl bg-slate-50 px-3 py-2 text-right">
          <p className="text-[0.72rem] font-medium uppercase tracking-[0.08em] text-slate-500">
            Total de la semana
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-950">
            {totalSemana} accesos
          </p>
        </div>
      </div>

      <div className="h-[260px] pt-4">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            Cargando grafica diaria...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="etiqueta"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#64748b", fontSize: 12 }}
              />
              <YAxis
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#64748b", fontSize: 12 }}
              />
              <Tooltip content={<AccessDailyTooltip />} cursor={{ fill: "#ecfdf5" }} />
              <Bar dataKey="total" name="Accesos" fill="#10b981" radius={[8, 8, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

const REFRESH_INTERVAL_MS = 10000;

export function AdminAccessesView() {
  const [summary, setSummary] = useState<AdminAccessSummary>({
    total_dia: 0,
    aprobados: 0,
    pendientes: 0,
    rechazados: 0,
  });
  const [hourlyChartData, setHourlyChartData] = useState<AdminAccessHourlyPoint[]>(
    Array.from({ length: 24 }, (_unused, hour) => ({
      hora: `${String(hour).padStart(2, "0")}:00`,
      total: 0,
      aprobados: 0,
      pendientes: 0,
      rechazados: 0,
    })),
  );
  // SCRUM-174: estado para la grafica diaria (ultimos 7 dias)
  const [dailyChartData, setDailyChartData] = useState<AdminAccessDailyPoint[]>([]);
  const [isDailyChartLoading, setIsDailyChartLoading] = useState(true);
  const [accesses, setAccesses] = useState<AdminAccessRecord[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [house, setHouse] = useState("");
  const [debouncedHouse, setDebouncedHouse] = useState("");
  const [plate, setPlate] = useState("");
  const [debouncedPlate, setDebouncedPlate] = useState("");
  const [selectedType, setSelectedType] = useState<AdminAccessFilterType>("TODOS");
  const [selectedStatus, setSelectedStatus] = useState<AdminAccessFilterStatus>("TODOS");
  const [isLoading, setIsLoading] = useState(true);
  const [isChartLoading, setIsChartLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const latestRequestRef = useRef(0);
  const [isExporting, setIsExporting] = useState(false);

  async function exportPdf() {
    setIsExporting(true);
    setErrorMessage("");
    try {
      await downloadReport({ reporte: "accesos", formato: "pdf", vista: "hoy", search, house, plate, type: selectedType, status: selectedStatus });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No fue posible exportar el reporte.");
    } finally {
      setIsExporting(false);
    }
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search);
      setDebouncedHouse(house);
      setDebouncedPlate(plate);
    }, 350);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [house, plate, search]);

  const filters = useMemo(
    () => ({
      search: debouncedSearch,
      house: debouncedHouse,
      plate: debouncedPlate,
      type: selectedType,
      status: selectedStatus,
    }),
    [debouncedHouse, debouncedPlate, debouncedSearch, selectedStatus, selectedType],
  );

  const loadAccessModule = useCallback(
    async (options: { silent?: boolean } = {}) => {
      const { silent = false } = options;
      const requestId = latestRequestRef.current + 1;
      latestRequestRef.current = requestId;

      try {
        if (silent) {
          setIsRefreshing(true);
        } else {
          setIsLoading(true);
          setIsChartLoading(true);
          setIsDailyChartLoading(true);
        }
        setErrorMessage("");

        // SCRUM-174: cargar grafica diaria en paralelo con el resto
        const [
          summaryResponse,
          hourlyChartResponse,
          dailyChartResponse,
          accessesResponse,
        ] = await Promise.all([
          getAdminAccessSummaryRequest(),
          getAdminAccessHourlyChartRequest(),
          getAdminAccessDailyChartRequest(),
          getAdminAccessesRequest(filters),
        ]);

        if (requestId !== latestRequestRef.current) {
          return;
        }

        setSummary(summaryResponse);
        setHourlyChartData(hourlyChartResponse);
        setDailyChartData(dailyChartResponse);
        setAccesses(accessesResponse);
        setLastUpdatedAt(new Date());
      } catch (error) {
        if (requestId !== latestRequestRef.current) {
          return;
        }
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "No fue posible cargar el Control de Accesos.",
        );
      } finally {
        if (requestId === latestRequestRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
          setIsChartLoading(false);
          setIsDailyChartLoading(false);
        }
      }
    },
    [filters],
  );

  useEffect(() => {
    void loadAccessModule();

    const intervalId = window.setInterval(() => {
      void loadAccessModule({ silent: true });
    }, REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadAccessModule]);

  useEffect(() => {
    const refresh = () => void loadAccessModule({ silent: true });
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };
    const unsubscribe = subscribeToAccessCounterUpdates(refresh);

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      unsubscribe();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadAccessModule]);

  const handleManualRefresh = useCallback(() => {
    void loadAccessModule({ silent: true });
  }, [loadAccessModule]);

  return (
    <AdminLayout
      title="Control de Accesos"
      subtitle="Registro de ingresos y salidas del dia"
      actions={
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
            <span className="size-2 animate-pulse rounded-full bg-emerald-500" />
            En vivo
          </span>
          <span className="text-sm text-slate-500">
            Actualizado: {formatRefreshTime(lastUpdatedAt)}
          </span>
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={isRefreshing || isLoading}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            aria-label="Actualizar ahora"
          >
            <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            {isRefreshing ? "Actualizando..." : "Actualizar"}
          </button>
        </div>
      }
    >
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Total del dia"
          value={summary.total_dia}
          accentClassName={cardAccentStyles.total}
        />
        <SummaryCard
          label="Aprobados"
          value={summary.aprobados}
          accentClassName={cardAccentStyles.approved}
        />
        <SummaryCard
          label="Pendientes"
          value={summary.pendientes}
          accentClassName={cardAccentStyles.pending}
        />
        <SummaryCard
          label="Rechazados"
          value={summary.rechazados}
          accentClassName={cardAccentStyles.rejected}
        />
      </section>

      <AdminAccessHourlyChart data={hourlyChartData} isLoading={isChartLoading} />
      <AdminAccessDailyChart data={dailyChartData} isLoading={isDailyChartLoading} />

      <section
        className="mt-5 rounded-[20px] border border-slate-200 bg-white px-4 py-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]"
        aria-labelledby="admin-accesses-filters-heading"
      >
        <h2
          id="admin-accesses-filters-heading"
          className="mb-3 text-[0.92rem] font-semibold text-slate-800"
        >
          Filtros de accesos
        </h2>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nombre..."
              aria-label="Buscar accesos por nombre"
              className={`${fieldClassName} w-full pl-11`}
            />
          </div>

          <input
            value={house}
            onChange={(event) => setHouse(event.target.value)}
            placeholder="Filtrar por casa/unidad..."
            aria-label="Filtrar accesos por casa o unidad"
            className={`${fieldClassName} min-w-[210px]`}
          />

          <input
            value={plate}
            onChange={(event) => setPlate(event.target.value)}
            placeholder="Filtrar por placa..."
            aria-label="Filtrar accesos por placa"
            className={`${fieldClassName} min-w-[200px]`}
          />

          <select
            value={selectedType}
            onChange={(event) => setSelectedType(event.target.value as AdminAccessFilterType)}
            className={`${fieldClassName} min-w-[190px]`}
          >
            {typeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={selectedStatus}
            onChange={(event) => setSelectedStatus(event.target.value as AdminAccessFilterStatus)}
            className={`${fieldClassName} min-w-[190px]`}
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => void exportPdf()}
            disabled={isExporting}
            className="inline-flex h-10 min-w-[150px] items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-medium text-white transition hover:bg-blue-700"
          >
            <Download className="size-4" />
            {isExporting ? "Generando..." : "Exportar PDF"}
          </button>
        </div>
      </section>

      <section className="mt-5 rounded-[20px] border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
        {errorMessage ? (
          <div className="border-b border-rose-100 bg-rose-50 px-5 py-3 text-sm text-rose-700">
            {errorMessage}
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.1em] text-slate-500">
                <th className="px-5 py-3 font-semibold" title="Hora de ingreso">Hora ingreso</th>
                <th className="px-5 py-3 font-semibold" title="Hora de salida si fue registrada">Hora salida</th>
                <th className="px-5 py-3 font-semibold">Tipo</th>
                <th className="px-5 py-3 font-semibold">Nombre</th>
                <th className="px-5 py-3 font-semibold">Casa / Unidad</th>
                <th className="px-5 py-3 font-semibold">Placa</th>
                <th className="px-5 py-3 font-semibold">Estado</th>
                <th className="px-5 py-3 font-semibold">Autorizado por</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-slate-500">
                    Cargando accesos del dia...
                  </td>
                </tr>
              ) : accesses.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-slate-500">
                    No hay accesos que coincidan con los filtros actuales.
                  </td>
                </tr>
              ) : (
                accesses.map((access) => {
                  const statusMeta = statusStyles[access.estado];
                  const StatusIcon = statusMeta.icon;

                  return (
                    <tr key={access.id_acceso} className="border-b border-slate-100 last:border-b-0">
                      <td className="px-5 py-3 text-sm text-slate-900">
                        <div className="flex items-center gap-2">
                          <Clock3 className="size-4 text-slate-400" />
                          <span>{access.hora}</span>
                        </div>
                        {access.guardia_ingreso ? <p className="text-xs text-slate-400">por {access.guardia_ingreso}</p> : null}
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-500">
                        {access.hora_salida ? access.hora_salida : <span className="text-slate-300">--:--</span>}
                        {access.guardia_salida ? <p className="text-xs text-slate-400">por {access.guardia_salida}</p> : null}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-[0.7rem] font-medium ${typeBadgeStyles[access.tipo]}`}
                        >
                          {typeLabels[access.tipo]}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-950">
                        <div className="flex items-center gap-2">
                          <span>{access.nombre}</span>
                          {access.es_acceso_especial ? (
                            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[0.65rem] font-medium text-violet-700">
                              Especial
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-500">{access.casa_unidad}</td>
                      <td className="px-5 py-3 text-sm text-slate-500">{access.placa}</td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.7rem] font-medium ${statusMeta.className}`}
                        >
                          <span className={`size-1.5 rounded-full ${statusMeta.dotClassName}`} />
                          <StatusIcon className={`size-3.5 ${statusMeta.iconClassName}`} />
                          {statusMeta.label}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-500">{access.autorizado_por}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AdminLayout>
  );
}
