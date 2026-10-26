import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, BriefcaseBusiness, Clock3, Power, RefreshCw, Search } from "lucide-react";

import { AdminLayout } from "@/components/admin/AdminLayout";
import { ProviderRegistrationForm, type ProviderHouseOption } from "@/components/providers/ProviderRegistrationForm";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  getAdminProviderHistoryRequest,
  getAdminProvidersRequest,
  updateAdminProviderRequest,
} from "@/services/providersService";
import { getHousesRequest } from "@/services/specialAccessesService";
import type {
  AdminProviderActivityFilter,
  AdminProviderHistoryRecord,
  AdminProviderRecord,
  TenantProviderStatus,
} from "@/types/providers";
import { formatUtcTimestamp } from "@/utils/guatemalaTime";

type ProviderStatusFilter = TenantProviderStatus | "TODOS";

const providerStatusStyles: Record<TenantProviderStatus, string> = {
  VALIDADO: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  PENDIENTE: "bg-amber-50 text-amber-700 ring-amber-200",
};

function formatDateTime(dateTime: string | null) {
  if (!dateTime) {
    return "Sin registro";
  }

  // Registro/cambios de proveedores son instantes UTC (CURRENT_TIMESTAMP).
  return formatUtcTimestamp(dateTime, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function HistoryRow({ entry }: { entry: AdminProviderHistoryRecord }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900">{entry.proveedor_nombre}</h3>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
              {entry.casa_unidad}
            </span>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
              {entry.accion}
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-600">{entry.detalle}</p>
        </div>
        <div className="rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-600">
          <p>{entry.realizado_por_nombre} ({entry.realizado_por_rol})</p>
          <p className="mt-1">{formatDateTime(entry.creado_en)}</p>
        </div>
      </div>
    </article>
  );
}

export function AdminProvidersView() {
  const [providers, setProviders] = useState<AdminProviderRecord[]>([]);
  const [history, setHistory] = useState<AdminProviderHistoryRecord[]>([]);
  const [search, setSearch] = useState("");
  const [house, setHouse] = useState("");
  const [actor, setActor] = useState("");
  const [date, setDate] = useState("");
  const [status, setStatus] = useState<ProviderStatusFilter>("TODOS");
  const [activity, setActivity] = useState<AdminProviderActivityFilter>("TODOS");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [updatingProviderKey, setUpdatingProviderKey] = useState("");
  const [houseOptions, setHouseOptions] = useState<ProviderHouseOption[]>([]);

  async function loadData(options: { silent?: boolean } = {}) {
    const { silent = false } = options;

    try {
      if (silent) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      setErrorMessage("");
      const [providersResponse, historyResponse] = await Promise.all([
        getAdminProvidersRequest({ search, house, user: actor, date, status, activity }),
        getAdminProviderHistoryRequest({ user: actor, date, status }),
      ]);

      setProviders(providersResponse);
      setHistory(historyResponse);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "No fue posible cargar el modulo de proveedores.",
      );
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [search, house, actor, date, status, activity]);

  // HU-C06.1: el administrador registra proveedores para cualquier casa.
  useEffect(() => {
    let active = true;
    getHousesRequest()
      .then((houses) => {
        if (active) {
          setHouseOptions(houses.map((item) => ({ id_casa: item.id_casa, etiqueta: `${item.etiqueta} • ${item.propietario}` })));
        }
      })
      .catch(() => {
        if (active) setHouseOptions([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const frequentProviders = useMemo(
    () => providers.filter((provider) => provider.frecuencia_cambios >= 2),
    [providers],
  );

  async function handleReview(provider: AdminProviderRecord, nextStatus: TenantProviderStatus) {
    const providerKey = `${provider.id_casa}-${provider.id_servicio}`;

    try {
      setUpdatingProviderKey(providerKey);
      await updateAdminProviderRequest({
        id_servicio: provider.id_servicio,
        id_casa: provider.id_casa,
        estado: nextStatus,
        activo: provider.activo,
      });
      await loadData({ silent: true });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "No fue posible actualizar el estado del proveedor.",
      );
    } finally {
      setUpdatingProviderKey("");
    }
  }

  async function handleToggle(provider: AdminProviderRecord) {
    const providerKey = `${provider.id_casa}-${provider.id_servicio}`;

    try {
      setUpdatingProviderKey(providerKey);
      await updateAdminProviderRequest({
        id_servicio: provider.id_servicio,
        id_casa: provider.id_casa,
        estado: provider.estado,
        activo: !provider.activo,
      });
      await loadData({ silent: true });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "No fue posible cambiar la actividad del proveedor.",
      );
    } finally {
      setUpdatingProviderKey("");
    }
  }

  return (
    <AdminLayout
      title="Proveedores e Historial"
      subtitle="Registro y validacion administrativa de proveedores, con revision de cambios"
      actions={
        <button
          type="button"
          onClick={() => void loadData({ silent: true })}
          disabled={isRefreshing || isLoading}
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`size-4 ${isRefreshing ? "animate-spin" : ""}`} />
          {isRefreshing ? "Actualizando..." : "Actualizar"}
        </button>
      }
    >
      <ProviderRegistrationForm
        role="admin"
        houses={houseOptions}
        description="Registra un proveedor para cualquier casa. Queda validado y con su QR listo para el guardia."
        onRegistered={() => loadData({ silent: true })}
      />

      <section className="grid gap-3 lg:grid-cols-5">
        <div className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar proveedor o tipo..."
            className="h-11 rounded-2xl border-slate-100 bg-white pl-11"
          />
        </div>
        <Input
          value={house}
          onChange={(event) => setHouse(event.target.value)}
          placeholder="Casa o unidad"
          className="h-11 rounded-2xl border-slate-100 bg-white"
        />
        <Input
          value={actor}
          onChange={(event) => setActor(event.target.value)}
          placeholder="Usuario que hizo el cambio"
          className="h-11 rounded-2xl border-slate-100 bg-white"
        />
        <Input
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="h-11 rounded-2xl border-slate-100 bg-white"
        />
      </section>

      <section className="mt-3 grid gap-3 lg:grid-cols-2">
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as ProviderStatusFilter)}
          className="h-11 rounded-2xl border border-slate-100 bg-white px-4 text-sm outline-none focus:border-blue-300"
        >
          <option value="TODOS">Todos los estados</option>
          <option value="VALIDADO">Aprobado / validado</option>
          <option value="PENDIENTE">Pendiente</option>
        </select>
        <select
          value={activity}
          onChange={(event) => setActivity(event.target.value as AdminProviderActivityFilter)}
          className="h-11 rounded-2xl border border-slate-100 bg-white px-4 text-sm outline-none focus:border-blue-300"
        >
          <option value="TODOS">Activos e inactivos</option>
          <option value="ACTIVO">Solo activos</option>
          <option value="INACTIVO">Solo inactivos</option>
        </select>
      </section>

      {errorMessage ? (
        <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {errorMessage}
        </div>
      ) : null}

      <section className="mt-5 rounded-[20px] border border-slate-200 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Lista de proveedores frecuentes</h2>
            <p className="text-sm text-slate-500">Incluye estado aprobado/pendiente y control activo/inactivo.</p>
          </div>
          <div className="rounded-2xl bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700">
            Frecuentes: {frequentProviders.length}
          </div>
        </div>

        <div className="mt-4 space-y-4">
          {isLoading ? (
            <div className="rounded-2xl bg-slate-50 p-6 text-sm text-slate-500">
              Cargando proveedores...
            </div>
          ) : providers.length === 0 ? (
            <div className="rounded-2xl bg-slate-50 p-6 text-sm text-slate-500">
              No hay proveedores que coincidan con los filtros.
            </div>
          ) : (
            providers.map((provider) => {
              const providerKey = `${provider.id_casa}-${provider.id_servicio}`;
              const isUpdating = updatingProviderKey === providerKey;

              return (
                <article
                  key={providerKey}
                  className="rounded-3xl border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-5 shadow-sm"
                >
                  <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
                    <div>
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex size-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
                          <BriefcaseBusiness className="size-5" />
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold text-slate-900">{provider.nombre}</h3>
                          <p className="text-sm text-slate-500">{provider.tipo_servicio}</p>
                        </div>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ring-1 ${providerStatusStyles[provider.estado]}`}
                        >
                          <BadgeCheck className="size-3.5" />
                          {provider.estado === "VALIDADO" ? "Aprobado" : "Pendiente"}
                        </span>
                      </div>

                      <p className="mt-3 text-sm text-slate-600">{provider.descripcion}</p>

                      <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium">
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
                          Unidad: {provider.casa_unidad}
                        </span>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
                          Propietario: {provider.propietario_nombre}
                        </span>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
                          Registro: {formatDateTime(provider.fecha_registro)}
                        </span>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
                          Ultimo cambio: {provider.ultimo_cambio_por}
                        </span>
                      </div>
                    </div>

                    <div className="rounded-3xl bg-slate-50 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Actividad</p>
                          <p className={`mt-1 text-sm font-semibold ${provider.activo ? "text-emerald-700" : "text-slate-500"}`}>
                            {provider.activo ? "Activo" : "Inactivo"}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleToggle(provider)}
                          disabled={isUpdating}
                          className={`inline-flex h-10 min-w-[110px] items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold text-white transition ${
                            provider.activo
                              ? "bg-emerald-600 hover:bg-emerald-700"
                              : "bg-slate-400 hover:bg-slate-500"
                          } disabled:opacity-60`}
                        >
                          {isUpdating ? (
                            <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          ) : (
                            <Power className="size-4" />
                          )}
                          {provider.activo ? "Desactivar" : "Activar"}
                        </button>
                      </div>

                      <div className="mt-4 grid gap-2">
                        <Button
                          type="button"
                          onClick={() => void handleReview(provider, "VALIDADO")}
                          disabled={isUpdating || provider.estado === "VALIDADO"}
                          className="h-10 rounded-2xl bg-blue-600 text-white hover:bg-blue-700"
                        >
                          Aprobar proveedor
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void handleReview(provider, "PENDIENTE")}
                          disabled={isUpdating || provider.estado === "PENDIENTE"}
                          className="h-10 rounded-2xl"
                        >
                          Marcar pendiente
                        </Button>
                      </div>

                      <p className="mt-4 text-xs text-slate-500">
                        Historial total: {provider.frecuencia_cambios} cambios. Ultimo movimiento el{" "}
                        {formatDateTime(provider.ultimo_cambio_en)}.
                      </p>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>

      <section className="mt-5 rounded-[20px] border border-slate-200 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <Clock3 className="size-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Historial de cambios</h2>
            <p className="text-sm text-slate-500">Registro cronologico de lo que hicieron inquilinos y administradores.</p>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {isLoading ? (
            <div className="rounded-2xl bg-slate-50 p-6 text-sm text-slate-500">
              Cargando historial...
            </div>
          ) : history.length === 0 ? (
            <div className="rounded-2xl bg-slate-50 p-6 text-sm text-slate-500">
              Todavia no hay cambios registrados.
            </div>
          ) : (
            history.slice(0, 10).map((entry) => <HistoryRow key={entry.id_historial} entry={entry} />)
          )}
        </div>
      </section>
    </AdminLayout>
  );
}
