import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  History,
  KeyRound,
  ShieldAlert,
  XCircle,
} from "lucide-react";

import { AdminLayout } from "@/components/admin/AdminLayout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  approveSpecialAccessRequest,
  createSpecialAccessRequest,
  getHousesRequest,
  getPendingSpecialAccessesRequest,
  getSpecialAccessHistoryRequest,
  getVisitScheduleConfigRequest,
  rejectSpecialAccessRequest,
} from "@/services/specialAccessesService";
import type {
  HouseOption,
  SpecialAccessExceptionRecord,
  SpecialAccessRecord,
  VisitScheduleConfig,
} from "@/types/announcements";
import { ProviderEntryModeField } from "@/components/providers/ProviderEntryModeField";
import { getVehiclePlateError, normalizeVehiclePlate } from "@/utils/vehiclePlate";
import { getDpiError, getVisitAccessRuleError, type ProviderEntryMode } from "@/utils/providerAccess";
import { formatUtcTimestamp } from "@/utils/guatemalaTime";

function createInitialForm() {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Guatemala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  return {
    nombre: "",
    dpi: "",
    placa: "",
    fecha: today,
    hora_inicio: "22:30",
    hora_fin: "23:30",
    id_casa: 0,
    motivo_excepcion: "",
    tipo_visita: "VISITA" as "VISITA" | "DELIVERY" | "PROVEEDOR",
    medio_ingreso: "VEHICULO" as ProviderEntryMode,
    motivo_servicio: "",
  };
}

function isOutsideSchedule(horaInicio: string, horaFin: string, schedule: VisitScheduleConfig | null) {
  if (!schedule) return false;
  const toMinutes = (value: string) => {
    const [hours, minutes] = value.split(":");
    return Number(hours) * 60 + Number(minutes);
  };
  return (
    toMinutes(horaInicio) < toMinutes(schedule.inicio) ||
    toMinutes(horaFin) > toMinutes(schedule.fin)
  );
}

function formatDateTime(value: string) {
  if (!value) return "--";
  // creado_en es un instante UTC; se muestra en hora de Guatemala.
  return formatUtcTimestamp(value, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function AdminSpecialAccessView() {
  const [form, setForm] = useState(createInitialForm);
  const [houses, setHouses] = useState<HouseOption[]>([]);
  const [schedule, setSchedule] = useState<VisitScheduleConfig | null>(null);
  const [pendingAccesses, setPendingAccesses] = useState<SpecialAccessRecord[]>([]);
  const [history, setHistory] = useState<SpecialAccessExceptionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const outsideSchedule = useMemo(
    () => isOutsideSchedule(form.hora_inicio, form.hora_fin, schedule),
    [form.hora_fin, form.hora_inicio, schedule],
  );

  async function loadModule() {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const [scheduleResponse, housesResponse, pendingResponse, historyResponse] =
        await Promise.all([
          getVisitScheduleConfigRequest(),
          getHousesRequest(),
          getPendingSpecialAccessesRequest(),
          getSpecialAccessHistoryRequest(),
        ]);
      setSchedule(scheduleResponse);
      setHouses(housesResponse);
      setPendingAccesses(pendingResponse);
      setHistory(historyResponse);
      if (housesResponse.length > 0 && !form.id_casa) {
        setForm((current) => ({ ...current, id_casa: housesResponse[0].id_casa }));
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "No fue posible cargar accesos especiales.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadModule();
  }, []);

  async function handleCreateSpecialAccess() {
    const plateError = getVehiclePlateError(form.placa);
    if (plateError) {
      setErrorMessage(plateError);
      return;
    }

    const isProvider = form.tipo_visita === "PROVEEDOR";
    if (!isProvider && !form.dpi.trim()) {
      setErrorMessage("El nombre y DPI del visitante son obligatorios.");
      return;
    }
    const dpiError = getDpiError(form.dpi);
    if (dpiError) {
      setErrorMessage(dpiError);
      return;
    }
    if (isProvider && !form.motivo_servicio.trim()) {
      setErrorMessage("Indica el servicio que realizara el proveedor.");
      return;
    }
    // HU-C06: identificador del proveedor y vigencia no pasada.
    const accessRuleError = getVisitAccessRuleError(form);
    if (accessRuleError) {
      setErrorMessage(accessRuleError);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const { medio_ingreso: medioIngreso, motivo_servicio: motivoServicio, ...base } = form;
      const created = await createSpecialAccessRequest({
        ...base,
        id_casa: Number(form.id_casa),
        ...(form.tipo_visita === "PROVEEDOR" ? { medio_ingreso: medioIngreso, motivo_servicio: motivoServicio } : {}),
      });
      if (created.requiere_aprobacion) {
        setPendingAccesses((current) => [created, ...current]);
        setSuccessMessage(
          "Acceso especial registrado. Quedo pendiente de aprobacion manual y se notifico al guardia.",
        );
      } else {
        setSuccessMessage("Acceso especial creado y notificado al guardia.");
        setHistory(await getSpecialAccessHistoryRequest());
      }
      setForm((current) => ({ ...createInitialForm(), id_casa: current.id_casa }));
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "No fue posible crear el acceso especial.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleApprove(accessId: number) {
    setProcessingId(accessId);
    setErrorMessage("");
    try {
      await approveSpecialAccessRequest(accessId);
      setPendingAccesses((current) => current.filter((item) => item.id_acceso !== accessId));
      setHistory(await getSpecialAccessHistoryRequest());
      setSuccessMessage("Acceso especial aprobado y notificado al guardia.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "No fue posible aprobar el acceso especial.",
      );
    } finally {
      setProcessingId(null);
    }
  }

  async function handleReject(accessId: number) {
    setProcessingId(accessId);
    setErrorMessage("");
    try {
      await rejectSpecialAccessRequest(accessId, "Rechazado por administrador");
      setPendingAccesses((current) => current.filter((item) => item.id_acceso !== accessId));
      setHistory(await getSpecialAccessHistoryRequest());
      setSuccessMessage("Acceso especial rechazado y registrado en historial.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "No fue posible rechazar el acceso especial.",
      );
    } finally {
      setProcessingId(null);
    }
  }

  return (
    <AdminLayout
      title="Accesos especiales"
      subtitle="Accesos especiales para administrador con validacion de horarios."
    >
      {errorMessage ? (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {successMessage ? (
        <Alert className="mb-4 border-emerald-200 bg-emerald-50 text-emerald-800">
          <CheckCircle2 className="size-4" />
          <AlertTitle>Operacion completada</AlertTitle>
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-5 text-blue-600" />
              Crear opcion acceso especial
            </CardTitle>
            <CardDescription>Validar horarios restringidos al registrar la excepcion.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {schedule ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Horario permitido: {schedule.inicio} - {schedule.fin}
                {outsideSchedule ? " • Requiere aprobacion manual." : null}
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <select
                value={form.tipo_visita}
                onChange={(e) => setForm((c) => ({ ...c, tipo_visita: e.target.value as typeof c.tipo_visita }))}
                aria-label="Tipo de acceso"
                className="h-11 rounded-xl border border-slate-200 px-4 outline-none focus:border-blue-300 md:col-span-2"
              >
                <option value="VISITA">Visita</option>
                <option value="DELIVERY">Delivery</option>
                <option value="PROVEEDOR">Proveedor</option>
              </select>
              {form.tipo_visita === "PROVEEDOR" ? (
                <>
                  <ProviderEntryModeField
                    value={form.medio_ingreso}
                    onChange={(value) => setForm((c) => ({ ...c, medio_ingreso: value }))}
                    className="h-11 w-full rounded-xl border border-slate-200 px-4 outline-none focus:border-blue-300"
                  />
                  <input
                    value={form.motivo_servicio}
                    onChange={(e) => setForm((c) => ({ ...c, motivo_servicio: e.target.value }))}
                    placeholder="Servicio que realizara"
                    aria-label="Servicio que realizara"
                    maxLength={120}
                    className="h-11 self-end rounded-xl border border-slate-200 px-4 outline-none focus:border-blue-300"
                  />
                </>
              ) : null}
              <input
                value={form.nombre}
                onChange={(e) => setForm((c) => ({ ...c, nombre: e.target.value }))}
                placeholder={form.tipo_visita === "PROVEEDOR" ? "Nombre del proveedor" : "Nombre visitante"}
                className="h-11 rounded-xl border border-slate-200 px-4 outline-none focus:border-blue-300"
              />
              <input
                value={form.dpi}
                onChange={(e) => setForm((c) => ({ ...c, dpi: e.target.value }))}
                placeholder={form.tipo_visita === "PROVEEDOR" && form.medio_ingreso === "VEHICULO" ? "DPI (opcional)" : "DPI"}
                aria-label="DPI"
                className="h-11 rounded-xl border border-slate-200 px-4 outline-none focus:border-blue-300"
              />
              <input
                value={form.placa}
                onChange={(e) => setForm((c) => ({ ...c, placa: e.target.value.toUpperCase() }))}
                onBlur={() => setForm((c) => ({ ...c, placa: normalizeVehiclePlate(c.placa) }))}
                placeholder="P-123ABC"
                maxLength={14}
                aria-label="Placa del vehiculo"
                aria-invalid={Boolean(getVehiclePlateError(form.placa))}
                className="h-11 rounded-xl border border-slate-200 px-4 outline-none focus:border-blue-300"
              />
              {getVehiclePlateError(form.placa) ? (
                <p className="text-xs text-rose-600 md:col-span-2">{getVehiclePlateError(form.placa)}</p>
              ) : null}
              <select
                value={form.id_casa}
                onChange={(e) => setForm((c) => ({ ...c, id_casa: Number(e.target.value) }))}
                className="h-11 rounded-xl border border-slate-200 px-4 outline-none focus:border-blue-300"
              >
                {houses.map((house) => (
                  <option key={house.id_casa} value={house.id_casa}>
                    {house.etiqueta} • {house.propietario}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={form.fecha}
                min={createInitialForm().fecha}
                onChange={(e) => setForm((c) => ({ ...c, fecha: e.target.value }))}
                className="h-11 rounded-xl border border-slate-200 px-4 outline-none focus:border-blue-300"
              />
              <input
                type="time"
                value={form.hora_inicio}
                onChange={(e) => setForm((c) => ({ ...c, hora_inicio: e.target.value }))}
                className="h-11 rounded-xl border border-slate-200 px-4 outline-none focus:border-blue-300"
              />
              <input
                type="time"
                value={form.hora_fin}
                onChange={(e) => setForm((c) => ({ ...c, hora_fin: e.target.value }))}
                className="h-11 rounded-xl border border-slate-200 px-4 outline-none focus:border-blue-300"
              />
            </div>

            <textarea
              value={form.motivo_excepcion}
              onChange={(e) => setForm((c) => ({ ...c, motivo_excepcion: e.target.value }))}
              rows={4}
              placeholder="Motivo de excepcion..."
              className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-300"
            />

            <Button
              type="button"
              onClick={() => void handleCreateSpecialAccess()}
              disabled={isSubmitting}
              className="rounded-xl"
            >
              {isSubmitting ? "Guardando..." : "Crear acceso especial"}
            </Button>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-amber-600" />
              Crear aprobacion manual
            </CardTitle>
            <CardDescription>Pendientes fuera de horario restringido.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <div className="rounded-xl border border-slate-200 p-4 text-sm text-slate-500">
                Cargando pendientes...
              </div>
            ) : pendingAccesses.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                No hay accesos especiales pendientes.
              </div>
            ) : (
              pendingAccesses.map((access) => (
                <article
                  key={access.id_acceso}
                  className="rounded-xl border border-amber-200 bg-amber-50 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-950">{access.nombre}</p>
                      <p className="mt-1 text-sm text-slate-600">
                        {access.casa} • {access.fecha} • {access.hora_inicio} - {access.hora_fin}
                      </p>
                      <p className="mt-2 text-sm text-slate-700">{access.motivo_excepcion}</p>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
                      <Clock3 className="size-3.5" />
                      Especial
                    </span>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleApprove(access.id_acceso)}
                      disabled={processingId === access.id_acceso}
                      className="rounded-xl"
                    >
                      Aprobar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void handleReject(access.id_acceso)}
                      disabled={processingId === access.id_acceso}
                      className="rounded-xl"
                    >
                      Rechazar
                    </Button>
                  </div>
                </article>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-5 border-slate-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-5 text-blue-600" />
            Registrar excepcion en historial
          </CardTitle>
          <CardDescription>Historial de aprobaciones y rechazos.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {history.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
              Aun no hay excepciones registradas.
            </div>
          ) : (
            history.map((item) => (
              <article
                key={item.id_excepcion}
                className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <p className="font-medium text-slate-950">
                    {item.visitante} • {item.casa}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {item.hora_solicitada_inicio} - {item.hora_solicitada_fin} • {item.motivo}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatDateTime(item.creado_en)} • {item.aprobado_por_nombre}
                  </p>
                </div>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                    item.accion === "APROBADO"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-rose-100 text-rose-700"
                  }`}
                >
                  {item.accion === "APROBADO" ? (
                    <CheckCircle2 className="size-3.5" />
                  ) : (
                    <XCircle className="size-3.5" />
                  )}
                  {item.accion === "APROBADO" ? "Aprobado" : "Rechazado"}
                </span>
              </article>
            ))
          )}
        </CardContent>
      </Card>

      {outsideSchedule ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-amber-700">
          <AlertTriangle className="size-4" />
          El horario seleccionado esta fuera del rango permitido.
        </div>
      ) : null}
    </AdminLayout>
  );
}
