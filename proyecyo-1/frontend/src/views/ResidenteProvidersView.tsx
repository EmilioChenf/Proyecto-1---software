import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, BriefcaseBusiness, Clock3, Search, ShieldCheck } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { ProviderRegistrationForm } from "@/components/providers/ProviderRegistrationForm";
import { notifyResidentBadgesChanged } from "@/components/residente/residentBadges";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getOwnerProvidersRequest, updateOwnerProviderValidationRequest } from "@/services/providersService";
import type { AdminProviderRecord, TenantProviderStatus } from "@/types/providers";

type StatusFilter = TenantProviderStatus | "TODOS";

const statusFilters: { value: StatusFilter; label: string }[] = [
  { value: "TODOS", label: "Todos" },
  { value: "PENDIENTE", label: "Pendientes" },
  { value: "VALIDADO", label: "Aprobados" },
];

export function ResidenteProvidersView() {
  const [providers, setProviders] = useState<AdminProviderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("TODOS");
  const [validatingKey, setValidatingKey] = useState<string | null>(null);

  const load = useCallback(async (filters: { search: string; status: StatusFilter }) => {
    try {
      setLoading(true);
      setError("");
      setProviders(await getOwnerProvidersRequest(filters));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible cargar los proveedores.");
      setProviders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load({ search, status }), search ? 300 : 0);
    return () => window.clearTimeout(timeout);
  }, [load, search, status]);

  async function approve(provider: AdminProviderRecord) {
    const key = `${provider.id_casa}-${provider.id_servicio}`;
    try {
      setValidatingKey(key);
      setError("");
      setSuccess("");
      const updated = await updateOwnerProviderValidationRequest({
        id_servicio: provider.id_servicio,
        id_casa: provider.id_casa,
        estado: "VALIDADO",
        activo: true,
      });
      setProviders((current) =>
        current
          .map((item) =>
            item.id_servicio === updated.id_servicio && item.id_casa === updated.id_casa ? updated : item,
          )
          .filter((item) => status === "TODOS" || item.estado === status),
      );
      setSuccess(`${updated.nombre} fue aprobado para la unidad ${updated.casa_unidad}.`);
      notifyResidentBadgesChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible validar el proveedor.");
    } finally {
      setValidatingKey(null);
    }
  }

  const pendingCount = providers.filter((provider) => provider.estado === "PENDIENTE").length;

  return (
    <AppShell
      role="residente"
      title="Proveedores"
      subtitle="Registre sus proveedores y apruebe los que registran los inquilinos de su unidad."
    >
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Error en proveedores</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {success ? (
        <Alert className="border-emerald-200 bg-emerald-50 text-emerald-800" role="status">
          <AlertTitle>Proveedor aprobado</AlertTitle>
          <AlertDescription className="text-emerald-700">{success}</AlertDescription>
        </Alert>
      ) : null}

      {/* HU-C06.1: el propietario tambien registra proveedores; quedan validados de inmediato. */}
      <ProviderRegistrationForm
        role="residente"
        description="Autoriza un proveedor para tu unidad con fecha y horario. Queda aprobado y con su QR listo."
        onRegistered={async () => {
          await load({ search, status });
          notifyResidentBadgesChanged();
        }}
      />

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Validación de proveedores">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-5 md:flex-row md:items-center md:justify-between">
          <label className="relative block md:w-80">
            <span className="sr-only">Buscar proveedor</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nombre, tipo o descripción"
              className="pl-9"
            />
          </label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por estado">
            {statusFilters.map((filter) => (
              <button
                key={filter.value}
                type="button"
                aria-pressed={status === filter.value}
                onClick={() => setStatus(filter.value)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  status === filter.value ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5">
          {loading ? (
            <p className="py-8 text-center text-sm text-slate-500">Cargando proveedores...</p>
          ) : providers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 py-10 text-center">
              <BriefcaseBusiness className="mx-auto size-8 text-slate-300" aria-hidden="true" />
              <p className="mt-3 font-semibold text-slate-900">Sin proveedores</p>
              <p className="mt-1 text-sm text-slate-500">
                {search || status !== "TODOS"
                  ? "No hay proveedores que coincidan con el filtro."
                  : "No hay proveedores asociados a su unidad."}
              </p>
            </div>
          ) : (
            <>
              <p className="mb-3 text-sm text-slate-500">
                {providers.length} proveedor{providers.length === 1 ? "" : "es"} · {pendingCount} pendiente
                {pendingCount === 1 ? "" : "s"}
              </p>
              <ul className="space-y-3">
                {providers.map((provider) => {
                  const key = `${provider.id_casa}-${provider.id_servicio}`;
                  const isPending = provider.estado === "PENDIENTE";
                  const isValidating = validatingKey === key;

                  return (
                    <li
                      key={key}
                      className="grid gap-4 rounded-2xl border border-slate-200 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="font-semibold text-slate-900">{provider.nombre}</h2>
                          {provider.tipo_servicio ? (
                            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">
                              {provider.tipo_servicio}
                            </span>
                          ) : null}
                          {isPending ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                              <Clock3 className="size-3" aria-hidden="true" />
                              Pendiente
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                              <BadgeCheck className="size-3" aria-hidden="true" />
                              Aprobado
                            </span>
                          )}
                          {!provider.activo ? (
                            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">Inactivo</span>
                          ) : null}
                        </div>
                        {provider.descripcion ? <p className="mt-1 text-sm text-slate-500">{provider.descripcion}</p> : null}
                        <p className="mt-2 text-xs text-slate-500">
                          Unidad {provider.casa_unidad} · Registrado por {provider.registrado_por || "sin registro"}
                        </p>
                      </div>

                      {isPending ? (
                        <Button
                          type="button"
                          onClick={() => void approve(provider)}
                          disabled={validatingKey !== null}
                          className="h-10 rounded-xl bg-blue-600 text-white hover:bg-blue-700"
                          aria-label={`Aprobar ${provider.nombre}`}
                        >
                          {isValidating ? (
                            <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden="true" />
                          ) : (
                            <ShieldCheck className="size-4" aria-hidden="true" />
                          )}
                          {isValidating ? "Aprobando..." : "Aprobar"}
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </section>
    </AppShell>
  );
}
