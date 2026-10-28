import { useFeedbackState } from "@/hooks/useFeedbackState";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BellRing,
  CalendarClock,
  Clock,
  Play,
  RefreshCw,
  Search,
  Send,
  TriangleAlert,
} from "lucide-react";

import { AdminLayout } from "@/components/admin/AdminLayout";
import {
  generateRemindersRequest,
  getReminderConfigRequest,
  getReminderSummaryRequest,
  getRemindersRequest,
  saveReminderConfigRequest,
} from "@/services/remindersService";
import type {
  ReminderConfig,
  ReminderFilterType,
  ReminderRecord,
  ReminderSummary,
  ReminderType,
} from "@/types/reminders";

const fieldClassName =
  "h-10 rounded-xl border border-slate-200 bg-white px-3 text-[0.82rem] text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100";

const typeOptions: Array<{ value: ReminderFilterType; label: string }> = [
  { value: "TODOS", label: "Todos los tipos" },
  { value: "PROXIMO_VENCIMIENTO", label: "Proximo vencimiento" },
  { value: "VENCIDO", label: "Vencido" },
];

const typeStyles: Record<ReminderType, string> = {
  PROXIMO_VENCIMIENTO: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200",
  VENCIDO: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200",
};

const typeLabels: Record<ReminderType, string> = {
  PROXIMO_VENCIMIENTO: "Proximo vencimiento",
  VENCIDO: "Vencido",
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
  icon: typeof BellRing;
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

export function AdminRemindersView() {
  const [summary, setSummary] = useState<ReminderSummary>({
    total: 0,
    proximos: 0,
    vencidos: 0,
    enviados_hoy: 0,
  });
  const [reminders, setReminders] = useState<ReminderRecord[]>([]);
  const [config, setConfig] = useState<ReminderConfig>({ activo: true, dias_antes: 3 });
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedType, setSelectedType] = useState<ReminderFilterType>("TODOS");
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [errorMessage, setErrorMessage] = useFeedbackState("error", "");
  const [successMessage, setSuccessMessage] = useFeedbackState("success", "");

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search);
    }, 350);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [search]);

  const filters = useMemo(
    () => ({ search: debouncedSearch, type: selectedType }),
    [debouncedSearch, selectedType],
  );

  const loadRemindersModule = useCallback(async () => {
    try {
      setIsLoading(true);
      setErrorMessage("");

      const [summaryResponse, configResponse, remindersResponse] = await Promise.all([
        getReminderSummaryRequest(),
        getReminderConfigRequest(),
        getRemindersRequest(filters),
      ]);

      setSummary(summaryResponse);
      setConfig(configResponse);
      setReminders(remindersResponse);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "No fue posible cargar los recordatorios.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void loadRemindersModule();
  }, [loadRemindersModule]);

  const handleGenerateReminders = useCallback(async () => {
    try {
      setIsGenerating(true);
      setErrorMessage("");
      setSuccessMessage("");

      const result = await generateRemindersRequest();

      if (!result.activo) {
        setSuccessMessage("Los recordatorios automaticos estan desactivados en la configuracion.");
      } else if (result.enviados === 0) {
        setSuccessMessage("No habia cuotas que requieran recordatorio en este momento.");
      } else {
        setSuccessMessage(
          result.enviados === 1
            ? "Se envio 1 recordatorio de pago."
            : `Se enviaron ${result.enviados} recordatorios de pago.`,
        );
      }

      await loadRemindersModule();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "No fue posible generar los recordatorios.",
      );
    } finally {
      setIsGenerating(false);
    }
  }, [loadRemindersModule]);

  const handleSaveConfig = useCallback(async () => {
    try {
      setIsSavingConfig(true);
      setErrorMessage("");
      setSuccessMessage("");

      const saved = await saveReminderConfigRequest(config);
      setConfig(saved);
      setSuccessMessage("Configuracion de recordatorios actualizada.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "No fue posible guardar la configuracion.",
      );
    } finally {
      setIsSavingConfig(false);
    }
  }, [config]);

  return (
    <AdminLayout
      title="Recordatorios de pago"
      subtitle="Envio automatico de recordatorios de cuotas proximas y vencidas"
      actions={
        <button
          type="button"
          onClick={handleGenerateReminders}
          disabled={isGenerating}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-60"
        >
          {isGenerating ? <RefreshCw className="size-4 animate-spin" /> : <Play className="size-4" />}
          {isGenerating ? "Enviando..." : "Enviar recordatorios"}
        </button>
      }
    >
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Total enviados"
          value={String(summary.total)}
          icon={BellRing}
          accentClassName="text-slate-950"
        />
        <SummaryCard
          label="Proximos a vencer"
          value={String(summary.proximos)}
          icon={CalendarClock}
          accentClassName="text-blue-600"
        />
        <SummaryCard
          label="Vencidos"
          value={String(summary.vencidos)}
          icon={TriangleAlert}
          accentClassName="text-rose-600"
        />
        <SummaryCard
          label="Enviados hoy"
          value={String(summary.enviados_hoy)}
          icon={Clock}
          accentClassName="text-emerald-600"
        />
      </section>

      <section className="mt-5 rounded-[20px] border border-slate-200 bg-white px-5 py-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
          <div className="flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <Send className="size-5" />
          </div>
          <div>
            <h2 className="text-[1rem] font-semibold text-slate-950">Configuracion de envio</h2>
            <p className="mt-1 text-[0.82rem] text-slate-500">
              Define si los recordatorios estan activos y cuantos dias antes del vencimiento se avisa.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={config.activo}
              onChange={(event) => setConfig((prev) => ({ ...prev, activo: event.target.checked }))}
              className="size-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-[0.85rem] font-medium text-slate-800">Recordatorios activos</span>
          </label>

          <div className="flex flex-col gap-1">
            <label htmlFor="dias-antes" className="text-[0.78rem] font-medium text-slate-600">
              Dias de anticipacion (0 a 60)
            </label>
            <input
              id="dias-antes"
              type="number"
              min={0}
              max={60}
              value={config.dias_antes}
              onChange={(event) =>
                setConfig((prev) => ({ ...prev, dias_antes: Number(event.target.value) }))
              }
              className={`${fieldClassName} w-40`}
            />
          </div>

          <button
            type="button"
            onClick={handleSaveConfig}
            disabled={isSavingConfig}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-blue-600 px-4 text-sm font-medium text-blue-700 transition hover:bg-blue-50 disabled:opacity-60"
          >
            {isSavingConfig ? "Guardando..." : "Guardar configuracion"}
          </button>
        </div>
      </section>

      <section className="mt-5 rounded-[20px] border border-slate-200 bg-white px-4 py-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
        <h2 className="mb-3 text-[0.92rem] font-semibold text-slate-800">Filtros de recordatorios</h2>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por residente o unidad..."
              aria-label="Buscar recordatorios"
              className={`${fieldClassName} w-full pl-11`}
            />
          </div>
          <select
            value={selectedType}
            onChange={(event) => setSelectedType(event.target.value as ReminderFilterType)}
            className={`${fieldClassName} min-w-[210px]`}
          >
            {typeOptions.map((option) => (
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

        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-[1.24rem] font-semibold text-slate-950">Historial de recordatorios</h2>
          <p className="mt-1 text-[0.82rem] text-slate-500">
            Recordatorios enviados a los residentes segun la configuracion vigente.
          </p>
        </div>

        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-6 text-center text-sm text-slate-500">Cargando recordatorios...</div>
          ) : reminders.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">
              No hay recordatorios que coincidan con los filtros.
            </div>
          ) : (
            <table className="min-w-[960px] w-full">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.1em] text-slate-500">
                  <th className="px-5 py-3 font-semibold">Unidad</th>
                  <th className="px-5 py-3 font-semibold">Residente</th>
                  <th className="px-5 py-3 font-semibold">Tipo</th>
                  <th className="px-5 py-3 font-semibold">Monto</th>
                  <th className="px-5 py-3 font-semibold">Vencimiento</th>
                  <th className="px-5 py-3 font-semibold">Enviado</th>
                </tr>
              </thead>
              <tbody>
                {reminders.map((reminder) => (
                  <tr key={reminder.id_recordatorio} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-5 py-3 text-sm text-slate-700">{reminder.casa_unidad}</td>
                    <td className="px-5 py-3 text-sm text-slate-950">{reminder.residente}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-[0.7rem] font-medium ${typeStyles[reminder.tipo]}`}
                      >
                        {typeLabels[reminder.tipo]}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-500">{formatCurrency(reminder.monto)}</td>
                    <td className="px-5 py-3 text-sm text-slate-500">{reminder.fecha_limite}</td>
                    <td className="px-5 py-3 text-sm text-slate-500">{reminder.enviado_en}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </AdminLayout>
  );
}
