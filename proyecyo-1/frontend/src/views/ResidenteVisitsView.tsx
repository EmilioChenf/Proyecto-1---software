import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  CalendarDays,
  Camera,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Pencil,
  ShieldCheck,
  Trash2,
  UserRoundPlus,
  X,
  Zap,
} from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { QrCodeCard } from "@/components/visits/QrCodeCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  createVisitRequest,
  deleteFrequentVisitorRequest,
  deleteVisitRequest,
  getFrequentVisitorsRequest,
  getVisitsRequest,
  updateFrequentVisitorRequest,
} from "@/services/visitsService";
import { getVisitScheduleConfigRequest } from "@/services/configurationService";
import type { FrequentVisitor, VisitPayload, VisitRecord, VisitType } from "@/types/visits";
import type { VisitScheduleConfig } from "@/types/configuration";
import {
  formatVisitScheduleSummary,
  validateVisitTimesAgainstSchedule,
} from "@/utils/visitSchedule";
import { getVehiclePlateError, normalizeVehiclePlate } from "@/utils/vehiclePlate";
import { confirmAction, notifyError, notifySuccess } from "@/utils/feedback";

type VisitFormState = VisitPayload & { confirmar_actualizacion?: boolean };

interface EditVisitorForm {
  nombre: string;
  dpi: string;
  placa: string;
}

const RESIDENTIAL_TIMEZONE = "America/Guatemala";

const steps = [
  { id: 1, label: "Datos del Visitante", description: "Informacion basica de identificacion" },
  { id: 2, label: "Horario y Acceso", description: "Define fecha, horario y tipo de visita" },
  { id: 3, label: "Confirmacion", description: "Revisa la informacion antes de autorizar" },
];

const visitTypeLabels: Record<VisitType, string> = {
  VISITA: "personal",
  DELIVERY: "delivery",
  PROVEEDOR: "proveedor",
};

function createInitialForm(): VisitFormState {
  const now = new Date();
  const finish = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const currentDate = getDateInTimezone(now);
  const startTime = getTimeInTimezone(now);
  const finishTime = getTimeInTimezone(finish);

  return {
    nombre: "",
    dpi: "",
    placa: "",
    foto: "",
    fecha: currentDate,
    hora_inicio: startTime,
    hora_fin: finishTime,
    tipo_visita: "VISITA",
    observaciones: "",
  };
}

function getDateInTimezone(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: RESIDENTIAL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function getTimeInTimezone(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: RESIDENTIAL_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("es-GT", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

function countTodayVisits(visits: VisitRecord[]) {
  const today = getDateInTimezone(new Date());
  return visits.filter((visit) => visit.fecha === today).length;
}

function getVisitStatusLabel(visit: VisitRecord) {
  if (visit.estado_acceso === "SALIDA_REGISTRADA" || visit.qr_status === "EXIT_REGISTERED") {
    return "Salida registrada";
  }

  if (visit.estado_acceso === "INGRESO_REGISTRADO" || visit.qr_status === "USED") {
    return "Ingreso registrado";
  }

  if (visit.estado_acceso === "CANCELADA" || visit.qr_status === "CANCELLED") {
    return "Cancelada";
  }

  if (visit.qr_status === "EXPIRED") {
    return "Vencida";
  }

  return "Autorizada";
}

export function ResidenteVisitsView() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<VisitFormState>(createInitialForm);
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [frequentVisitors, setFrequentVisitors] = useState<FrequentVisitor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [photoPreview, setPhotoPreview] = useState("");
  const [authorizingVisitorId, setAuthorizingVisitorId] = useState<number | null>(null);
  const [visitSchedule, setVisitSchedule] = useState<VisitScheduleConfig | null>(null);
  const [conflictVisitor, setConflictVisitor] = useState<{ id_visitante: number; nombre: string; dpi: string; placa: string } | null>(null);
  const [pendingPayload, setPendingPayload] = useState<VisitPayload | null>(null);
  const [editingVisitor, setEditingVisitor] = useState<FrequentVisitor | null>(null);
  const [editForm, setEditForm] = useState<EditVisitorForm>({ nombre: "", dpi: "", placa: "" });
  const [isEditSubmitting, setIsEditSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadData() {
      try {
        setIsLoading(true);
        const [visitsResult, frequentResult, scheduleResult] = await Promise.allSettled([
          getVisitsRequest(),
          getFrequentVisitorsRequest(),
          getVisitScheduleConfigRequest(),
        ]);

        if (!active) {
          return;
        }

        if (visitsResult.status === "fulfilled") {
          setVisits(visitsResult.value);
        } else {
          setErrorMessage(
            visitsResult.reason instanceof Error
              ? visitsResult.reason.message
              : "No fue posible cargar las visitas.",
          );
        }

        if (frequentResult.status === "fulfilled") {
          setFrequentVisitors(frequentResult.value);
        } else {
          setFrequentVisitors([]);
        }

        if (scheduleResult.status === "fulfilled") {
          setVisitSchedule(scheduleResult.value);
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    loadData();

    return () => {
      active = false;
    };
  }, []);

  const todayVisits = useMemo(() => countTodayVisits(visits), [visits]);
  const visitHistory = useMemo(
    () =>
      [...visits].sort((first, second) => {
        const secondDate = `${second.fecha}T${second.hora_inicio || "00:00"}`;
        const firstDate = `${first.fecha}T${first.hora_inicio || "00:00"}`;
        return secondDate.localeCompare(firstDate) || second.id_acceso - first.id_acceso;
      }),
    [visits],
  );

  function updateForm<K extends keyof VisitFormState>(field: K, value: VisitFormState[K]) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function validateVisitTimes(horaInicio: string, horaFin: string) {
    if (!visitSchedule) {
      return true;
    }

    const scheduleError = validateVisitTimesAgainstSchedule(horaInicio, horaFin, visitSchedule);

    if (scheduleError) {
      setErrorMessage(scheduleError);
      return false;
    }

    return true;
  }

  function validateStep() {
    if (step === 1) {
      if (!form.nombre.trim()) {
        setErrorMessage("El nombre del visitante es obligatorio.");
        return false;
      }

      if (!form.dpi && !form.placa) {
        setErrorMessage("Se requiere DPI o placa del vehículo para identificar al visitante.");
        return false;
      }

      if (form.dpi) {
        const digitsOnly = form.dpi.replace(/\s/g, "");
        if (!/^\d{13}$/.test(digitsOnly)) {
          setErrorMessage("El DPI debe contener exactamente 13 dígitos numéricos.");
          return false;
        }
      }

      const plateError = getVehiclePlateError(form.placa);
      if (plateError) {
        setErrorMessage(plateError);
        return false;
      }
    }

    if (step === 2) {
      if (!form.fecha || !form.hora_inicio || !form.hora_fin) {
        setErrorMessage("Completa fecha y horario antes de continuar.");
        return false;
      }

      if (!validateVisitTimes(form.hora_inicio, form.hora_fin)) {
        return false;
      }

      if ((form.observaciones || "").length > 255) {
        setErrorMessage("Las observaciones no pueden superar 255 caracteres.");
        return false;
      }
    }

    setErrorMessage("");
    return true;
  }

  function handleNext() {
    if (!validateStep()) {
      return;
    }

    setStep((current) => Math.min(current + 1, steps.length));
  }

  function handlePrevious() {
    setErrorMessage("");
    setStep((current) => Math.max(current - 1, 1));
  }

  async function refreshFrequentVisitors() {
    try {
      const data = await getFrequentVisitorsRequest();
      setFrequentVisitors(data);
    } catch {
      // La visita ya fue creada; si esta recarga secundaria falla no bloqueamos el flujo.
    }
  }

  async function createVisit(payload: VisitPayload & { confirmar_actualizacion?: boolean }, message: string) {
    if (!validateVisitTimes(payload.hora_inicio, payload.hora_fin)) {
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage("");
      const createdVisit = await createVisitRequest({
        ...payload,
        foto: null,
      });
      setVisits((current) => [createdVisit, ...current]);
      setSuccessMessage(message);
      setConflictVisitor(null);
      setPendingPayload(null);
      setForm(createInitialForm());
      setPhotoPreview("");
      setStep(1);
      await refreshFrequentVisitors();
    } catch (error: unknown) {
      const apiError = error as { status?: number; code?: string; message?: string; existing?: { id_visitante: number; nombre: string; dpi: string; placa: string } };
      if (apiError?.code === "VISITOR_DATA_CONFLICT" && apiError?.existing) {
        setConflictVisitor(apiError.existing);
        setPendingPayload(payload);
        setErrorMessage("");
      } else if (apiError?.code === "DUPLICATE_VISIT") {
        setErrorMessage("Ya existe una visita autorizada para este visitante en la misma fecha y horario. Por favor elige un horario diferente.");
      } else {
        setErrorMessage(error instanceof Error ? error.message : "No fue posible autorizar la visita.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  function openEditVisitor(visitor: FrequentVisitor) {
    setEditingVisitor(visitor);
    setEditForm({ nombre: visitor.nombre, dpi: visitor.dpi || "", placa: visitor.placa || "" });
  }

  async function handleEditVisitorSubmit() {
    if (!editingVisitor) {
      return;
    }
    try {
      setIsEditSubmitting(true);
      const updated = await updateFrequentVisitorRequest(editingVisitor.id_visitante, editForm);
      setFrequentVisitors((current) =>
        current.map((v) =>
          v.id_visitante === updated.id_visitante
            ? { ...v, nombre: updated.nombre, dpi: updated.dpi || "", placa: updated.placa || "" }
            : v,
        ),
      );
      setEditingVisitor(null);
      void notifySuccess("Datos del visitante actualizados correctamente.");
    } catch (error) {
      void notifyError(error, "No fue posible actualizar los datos del visitante.");
    } finally {
      setIsEditSubmitting(false);
    }
  }

  async function handleConfirmConflict(confirm: boolean) {
    if (!pendingPayload) {
      return;
    }
    if (!confirm) {
      setConflictVisitor(null);
      setPendingPayload(null);
      return;
    }
    await createVisit({ ...pendingPayload, confirmar_actualizacion: true }, "Visita autorizada correctamente.");
  }

  async function handleSubmit() {
    if (step < steps.length) {
      handleNext();
      return;
    }

    if (!validateStep()) {
      return;
    }

    await createVisit(form, "Visita autorizada correctamente.");
  }

  const visitsDisabled = visitSchedule !== null && !visitSchedule.activo;

  async function handleQuickAuthorize(visitor: FrequentVisitor) {
    const now = new Date();
    const finish = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const fecha = getDateInTimezone(now);
    const horaInicio = getTimeInTimezone(now);
    const horaFin = getTimeInTimezone(finish);

    const confirmed = await confirmAction({
      title: "Confirmar acceso rápido",
      text: `${visitor.nombre} — ${fecha} de ${horaInicio} a ${horaFin}. ¿Autorizar ingreso inmediato?`,
      confirmText: "Autorizar",
      tone: "info",
    });

    if (!confirmed) {
      return;
    }

    setAuthorizingVisitorId(visitor.id_visitante);

    await createVisit(
      {
        nombre: visitor.nombre,
        dpi: visitor.dpi,
        placa: visitor.placa,
        foto: "",
        fecha,
        hora_inicio: horaInicio,
        hora_fin: horaFin,
        tipo_visita: "VISITA",
        observaciones: "",
      },
      `Visita rapida autorizada para ${visitor.nombre}.`,
    );
    setAuthorizingVisitorId(null);
  }

  async function handleDelete(visit: VisitRecord) {
    const confirmed = await confirmAction({
      title: "¿Eliminar la visita?",
      text: `Se eliminará la visita autorizada de ${visit.nombre}.`,
      confirmText: "Eliminar visita",
      tone: "danger",
    });

    if (!confirmed) {
      return;
    }

    try {
      await deleteVisitRequest(visit.id_acceso);
      setVisits((current) => current.filter((item) => item.id_acceso !== visit.id_acceso));
      void notifySuccess("Visita eliminada correctamente.");
    } catch (error) {
      void notifyError(error, "No fue posible eliminar la visita.");
    }
  }

  async function handleDeleteFrequentVisitor(visitor: FrequentVisitor) {
    const confirmed = await confirmAction({
      title: `¿Eliminar a ${visitor.nombre} de tus visitantes frecuentes?`,
      text: "También se eliminarán todas sus visitas asociadas.",
      confirmText: "Eliminar visitante",
      tone: "danger",
    });

    if (!confirmed) {
      return;
    }

    try {
      await deleteFrequentVisitorRequest(visitor.id_visitante);
      setFrequentVisitors((current) =>
        current.filter((item) => item.id_visitante !== visitor.id_visitante),
      );
      setVisits((current) =>
        current.filter((item) => item.id_visitante !== visitor.id_visitante),
      );
      void notifySuccess(`Visitante frecuente ${visitor.nombre} eliminado correctamente.`);
    } catch (error) {
      void notifyError(error, "No fue posible eliminar el visitante frecuente.");
    }
  }

  function handlePhotoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      setPhotoPreview("");
      updateForm("foto", "");
      return;
    }

    if (!file.type.startsWith("image/")) {
      setErrorMessage("Selecciona un archivo de imagen valido.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const preview = typeof reader.result === "string" ? reader.result : "";
      setPhotoPreview(preview);
      updateForm("foto", file.name);
      setErrorMessage("");
    };
    reader.readAsDataURL(file);
  }

  function handleRemovePhoto() {
    setPhotoPreview("");
    updateForm("foto", "");
  }

  return (
    <AppShell
      role="residente"
      title="Mis visitas"
      subtitle="Autorice visitas, consulte su estado y gestione sus visitantes frecuentes."
    >
      <div className="space-y-6">

        {errorMessage ? (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}

        {successMessage ? (
          <Alert className="border-emerald-200 bg-emerald-50 text-emerald-700">
            <AlertTitle>Operacion exitosa</AlertTitle>
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        ) : null}

        {visitSchedule && !visitSchedule.activo ? (
          <Alert variant="destructive">
            <AlertTitle>Autorizaciones pausadas</AlertTitle>
            <AlertDescription>
              Las autorizaciones de visita estan temporalmente deshabilitadas por el administrador.
            </AlertDescription>
          </Alert>
        ) : null}

        {conflictVisitor ? (
          <Alert className="border-amber-200 bg-amber-50 text-amber-800">
            <AlertTitle>Visitante existente detectado</AlertTitle>
            <AlertDescription>
              <p>
                Ya existe un visitante registrado con ese DPI o placa:{" "}
                <strong>{conflictVisitor.nombre}</strong>
                {conflictVisitor.dpi ? ` (DPI: ${conflictVisitor.dpi})` : ""}
                {conflictVisitor.placa ? ` — Placa: ${conflictVisitor.placa}` : ""}.
              </p>
              <p className="mt-1">¿Deseas actualizar sus datos al crear esta visita?</p>
              <div className="mt-3 flex gap-2">
                <Button
                  type="button"
                  onClick={() => handleConfirmConflict(true)}
                  disabled={isSubmitting}
                  className="rounded-xl bg-amber-600 px-4 text-sm text-white hover:bg-amber-700"
                >
                  Actualizar datos y autorizar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleConfirmConflict(false)}
                  className="rounded-xl border-amber-300 px-4 text-sm text-amber-800"
                >
                  Cancelar
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}

        {editingVisitor ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-xl font-semibold text-slate-900">Editar visitante frecuente</h3>
                <button
                  type="button"
                  onClick={() => setEditingVisitor(null)}
                  className="rounded-full p-2 text-slate-400 hover:bg-slate-100"
                  aria-label="Cerrar"
                >
                  <X className="size-5" />
                </button>
              </div>
              <div className="space-y-4">
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-slate-700">Nombre *</span>
                  <Input
                    value={editForm.nombre}
                    onChange={(e) => setEditForm((f) => ({ ...f, nombre: e.target.value }))}
                    className="h-12 rounded-xl border-slate-100 bg-slate-50"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-slate-700">DPI</span>
                  <Input
                    value={editForm.dpi}
                    onChange={(e) => setEditForm((f) => ({ ...f, dpi: e.target.value }))}
                    placeholder="1234567890123"
                    maxLength={13}
                    className="h-12 rounded-xl border-slate-100 bg-slate-50"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-slate-700">Placa</span>
                  <Input
                    value={editForm.placa}
                    onChange={(e) => setEditForm((f) => ({ ...f, placa: e.target.value.toUpperCase() }))}
                    placeholder="P-123ABC"
                    maxLength={14}
                    className="h-12 rounded-xl border-slate-100 bg-slate-50"
                  />
                </label>
              </div>
              <div className="mt-5 flex gap-3">
                <Button
                  type="button"
                  onClick={handleEditVisitorSubmit}
                  disabled={isEditSubmitting}
                  className="flex-1 rounded-xl bg-[linear-gradient(90deg,#a855f7_0%,#9333ea_100%)] text-white hover:opacity-95"
                >
                  {isEditSubmitting ? "Guardando..." : "Guardar cambios"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingVisitor(null)}
                  className="rounded-xl border-slate-200"
                >
                  Cancelar
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        <Card className="overflow-hidden border-0 shadow-[0_18px_40px_rgba(30,41,59,0.12)]">
          <div className="bg-[linear-gradient(90deg,#a855f7_0%,#9333ea_45%,#9d00ff_100%)] px-5 py-6 text-white">
            <div className="flex items-center gap-3">
              <Zap className="size-5" />
              <h3 className="text-2xl font-semibold">Acceso Rapido</h3>
              <span className="rounded-full bg-white/15 px-3 py-1 text-sm">¡1 click!</span>
            </div>
            <p className="mt-3 text-lg text-white/95">
              Autoriza visitantes frecuentes instantaneamente
            </p>
          </div>
          <CardContent className="space-y-4 bg-white px-5 py-5">
            {isLoading ? (
              <div className="rounded-3xl bg-slate-50 p-6 text-sm text-slate-500">
                Cargando visitantes frecuentes...
              </div>
            ) : frequentVisitors.length === 0 ? (
              <div className="rounded-3xl bg-slate-50 p-6 text-sm text-slate-500">
                Aun no tienes visitantes frecuentes registrados.
              </div>
            ) : (
              frequentVisitors.map((visitor) => (
                <div
                  key={visitor.id_visitante}
                  className="flex flex-col gap-4 rounded-3xl bg-slate-50 px-5 py-4 shadow-sm md:flex-row md:items-center md:justify-between"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex size-14 items-center justify-center rounded-full bg-[linear-gradient(180deg,#a855f7_0%,#9333ea_100%)] text-white">
                      <ShieldCheck className="size-7" />
                    </div>
                    <div>
                      <p className="text-2xl font-semibold text-slate-900">{visitor.nombre}</p>
                      <p className="text-sm text-slate-500">
                        {visitor.placa || "Sin placa"} {visitor.dpi ? `• DPI: ${visitor.dpi}` : ""}
                      </p>
                      <p className="text-xs text-slate-400">
                        {visitor.total_visitas} visita{visitor.total_visitas !== 1 ? "s" : ""}
                        {visitor.ultima_fecha ? ` • Ultima: ${formatDate(visitor.ultima_fecha)}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleQuickAuthorize(visitor)}
                      disabled={isSubmitting || visitsDisabled}
                      className="rounded-2xl bg-[linear-gradient(90deg,#a855f7_0%,#8b2cf5_100%)] px-6 text-base text-white hover:opacity-95"
                    >
                      {authorizingVisitorId === visitor.id_visitante ? (
                        <>
                          <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          Autorizando...
                        </>
                      ) : (
                        <>
                          <Zap className="size-4" />
                          Autorizar (1 click)
                        </>
                      )}
                    </Button>
                    <button
                      type="button"
                      onClick={() => openEditVisitor(visitor)}
                      className="rounded-2xl p-3 text-purple-500 transition hover:bg-purple-50"
                      aria-label={`Editar visitante frecuente ${visitor.nombre}`}
                    >
                      <Pencil className="size-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteFrequentVisitor(visitor)}
                      className="rounded-2xl p-3 text-rose-500 transition hover:bg-rose-50"
                      aria-label={`Eliminar visitante frecuente ${visitor.nombre}`}
                    >
                      <Trash2 className="size-5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2">
            {steps.map((item) => (
              <span
                key={item.id}
                className={`h-3 rounded-full transition-all ${
                  item.id === step ? "w-10 bg-blue-500" : "w-3 bg-slate-300"
                }`}
              />
            ))}
          </div>
          <p className="text-lg text-slate-700">Paso {step} de 3</p>
        </div>

        <Card className="border-white/70 bg-white shadow-[0_16px_40px_rgba(30,41,59,0.08)]">
          <CardHeader className="gap-2">
            <div className="flex items-start gap-3">
              <UserRoundPlus className="mt-1 size-6 text-blue-600" />
              <div>
                <CardTitle className="text-2xl font-semibold text-slate-900">
                  {steps[step - 1].label}
                </CardTitle>
                <p className="text-sm text-slate-600">{steps[step - 1].description}</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {step === 1 ? (
              <>
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-800">Nombre Completo *</span>
                  <Input
                    value={form.nombre}
                    onChange={(event) => updateForm("nombre", event.target.value)}
                    placeholder="Ej. Juan Perez Garcia"
                    className="h-14 rounded-2xl border-slate-100 bg-slate-50 px-4"
                  />
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-800">DPI / Documento de Identidad <span className="text-slate-400 text-xs">(requerido si no hay placa)</span></span>
                  <Input
                    value={form.dpi}
                    onChange={(event) => updateForm("dpi", event.target.value)}
                    placeholder="1234567890123"
                    maxLength={13}
                    className="h-14 rounded-2xl border-slate-100 bg-slate-50 px-4"
                  />
                  <span className="text-xs text-slate-500">13 dígitos numéricos</span>
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-800">Placa del Vehiculo (Opcional)</span>
                  <Input
                    value={form.placa}
                    onChange={(event) => updateForm("placa", event.target.value.toUpperCase())}
                    onBlur={() => updateForm("placa", normalizeVehiclePlate(form.placa))}
                    placeholder="P-123ABC"
                    maxLength={14}
                    aria-invalid={Boolean(getVehiclePlateError(form.placa))}
                    className="h-14 rounded-2xl border-slate-100 bg-slate-50 px-4"
                  />
                  {getVehiclePlateError(form.placa) ? (
                    <span className="text-xs text-rose-600">{getVehiclePlateError(form.placa)}</span>
                  ) : (
                    <span className="text-xs text-slate-500">Ejemplo: P-123ABC</span>
                  )}
                </label>

                <div className="space-y-2">
                  <span className="text-sm font-medium text-slate-800">
                    Foto del Visitante (Opcional)
                  </span>
                  {photoPreview ? (
                    <div className="relative min-h-44 rounded-[28px] border border-slate-200 bg-white p-4">
                      <button
                        type="button"
                        onClick={handleRemovePhoto}
                        className="absolute right-4 top-4 rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                        aria-label="Quitar foto"
                      >
                        <X className="size-5" />
                      </button>
                      <img
                        src={photoPreview}
                        alt="Vista previa del visitante"
                        className="h-40 w-40 rounded-2xl border border-slate-200 object-cover shadow-sm"
                      />
                    </div>
                  ) : (
                    <label className="flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-[28px] border border-dashed border-slate-300 bg-white text-slate-600 transition hover:border-blue-300 hover:text-blue-700">
                      <Camera className="size-11 text-slate-400" />
                      <span className="mt-4 text-2xl font-medium">Tomar o subir foto</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handlePhotoUpload}
                      />
                    </label>
                  )}
                </div>
              </>
            ) : null}

            {step === 2 ? (
              <>
                {visitSchedule ? (
                  <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                    Horario permitido:{" "}
                    <span className="font-medium">{formatVisitScheduleSummary(visitSchedule)}</span>
                  </div>
                ) : null}
                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  La fecha y hora se completaron automaticamente con la hora actual. Puedes modificarlos si lo necesitas.
                </div>
                <div className="grid gap-5 md:grid-cols-2">
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-slate-800">Fecha de visita *</span>
                    <Input
                      type="date"
                      value={form.fecha}
                      onChange={(event) => updateForm("fecha", event.target.value)}
                      className="h-14 rounded-2xl border-slate-100 bg-slate-50 px-4"
                    />
                  </label>

                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-slate-800">Tipo de visita *</span>
                    <select
                      value={form.tipo_visita}
                      onChange={(event) => updateForm("tipo_visita", event.target.value as VisitType)}
                      className="h-14 w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 text-sm outline-none focus:border-blue-300"
                    >
                      <option value="VISITA">Visita personal</option>
                      <option value="DELIVERY">Delivery</option>
                      <option value="PROVEEDOR">Proveedor</option>
                    </select>
                  </label>
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-slate-800">Hora de inicio *</span>
                    <Input
                      type="time"
                      value={form.hora_inicio}
                      min={visitSchedule?.hora_apertura}
                      max={visitSchedule?.hora_cierre}
                      onChange={(event) => updateForm("hora_inicio", event.target.value)}
                      className="h-14 rounded-2xl border-slate-100 bg-slate-50 px-4"
                    />
                  </label>

                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-slate-800">Hora de fin *</span>
                    <Input
                      type="time"
                      value={form.hora_fin}
                      min={visitSchedule?.hora_apertura}
                      max={visitSchedule?.hora_cierre}
                      onChange={(event) => updateForm("hora_fin", event.target.value)}
                      className="h-14 rounded-2xl border-slate-100 bg-slate-50 px-4"
                    />
                  </label>
                </div>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-800">
                    Observaciones adicionales (Opcional)
                  </span>
                  <textarea
                    value={form.observaciones || ""}
                    onChange={(event) => updateForm("observaciones", event.target.value)}
                    maxLength={255}
                    placeholder="Ej. trae equipo de trabajo, paquete pequeno, requiere autorizacion en recepcion"
                    className="min-h-28 w-full resize-none rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-blue-300"
                  />
                  <span className="block text-right text-xs text-slate-400">
                    {(form.observaciones || "").length}/255
                  </span>
                </label>
              </>
            ) : null}

            {step === 3 ? (
              <div className="grid gap-4 md:grid-cols-2">
                {[
                  { label: "Visitante", value: form.nombre || "No definido" },
                  { label: "DPI", value: form.dpi || "No definido" },
                  { label: "Placa", value: form.placa || "No definida" },
                  { label: "Fecha", value: form.fecha ? formatDate(form.fecha) : "No definida" },
                  { label: "Hora", value: `${form.hora_inicio || "--:--"} - ${form.hora_fin || "--:--"}` },
                  { label: "Tipo", value: visitTypeLabels[form.tipo_visita] },
                  { label: "Observaciones", value: form.observaciones || "Sin informacion adicional" },
                ].map((item) => (
                  <div key={item.label} className="rounded-3xl bg-slate-50 p-5">
                    <p className="text-sm text-slate-500">{item.label}</p>
                    <p className="mt-2 text-lg font-semibold text-slate-900">{item.value}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Button
            type="button"
            variant="outline"
            onClick={handlePrevious}
            disabled={step === 1 || isSubmitting}
            className="h-14 rounded-2xl border-slate-200 bg-slate-50 text-xl text-slate-600"
          >
            <ChevronLeft className="size-5" />
            Anterior
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || visitsDisabled}
            className="h-14 rounded-2xl bg-[linear-gradient(90deg,#3b82f6_0%,#1d4ed8_100%)] text-xl text-white hover:opacity-95"
          >
            {step === steps.length ? "Autorizar Visita" : "Siguiente"}
            <ChevronRight className="size-5" />
          </Button>
        </div>

        <div className="space-y-4">
          <div>
            <h3 className="text-3xl font-semibold text-slate-900">
              Historial de visitas ({visitHistory.length})
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              Visitas registradas por el residente, ordenadas de la mas reciente a la mas antigua.
            </p>
            <p className="mt-1 text-xs text-slate-400">Autorizadas hoy: {todayVisits}</p>
          </div>

          {isLoading ? (
            <Card>
              <CardContent className="p-6 text-sm text-slate-500">Cargando visitas autorizadas...</CardContent>
            </Card>
          ) : visitHistory.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-sm text-slate-500">
                No hay visitas registradas para esta residencia.
              </CardContent>
            </Card>
          ) : (
            visitHistory.map((visit) => (
              <Card
                key={visit.id_acceso}
                className="border-white/70 bg-white shadow-[0_12px_28px_rgba(30,41,59,0.08)]"
              >
                <CardContent className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_260px]">
                  <div className="flex gap-4">
                    <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(180deg,#60a5fa_0%,#2563eb_100%)] text-white">
                      <UserRoundPlus className="size-7" />
                    </div>
                    <div>
                      <div className="flex items-start justify-between gap-4">
                        <p className="text-2xl font-semibold text-slate-900">{visit.nombre}</p>
                        <button
                          type="button"
                          onClick={() => handleDelete(visit)}
                          className="rounded-full p-2 text-rose-500 transition hover:bg-rose-50"
                          aria-label={`Eliminar visita de ${visit.nombre}`}
                        >
                          <Trash2 className="size-5" />
                        </button>
                      </div>
                      <div className="mt-2 space-y-1 text-slate-600">
                        <p>DPI: {visit.dpi}</p>
                        <p>Placa: {visit.placa || "Sin placa"}</p>
                        <p className="flex items-center gap-2">
                          <CalendarDays className="size-4" />
                          Fecha: {formatDate(visit.fecha)}
                        </p>
                        <p className="flex items-center gap-2">
                          <Clock3 className="size-4" />
                          Hora: {visit.hora_inicio} - {visit.hora_fin}
                        </p>
                        <p>Tipo de acceso: {visitTypeLabels[visit.tipo_visita]}</p>
                        {visit.observaciones ? (
                          <p>Observaciones: {visit.observaciones}</p>
                        ) : null}
                      </div>
                      <span className="mt-4 inline-flex rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-700">
                        {visitTypeLabels[visit.tipo_visita]}
                      </span>
                      <p className="mt-3 text-xs text-slate-400">
                        Estado: {getVisitStatusLabel(visit)}
                      </p>
                    </div>
                  </div>
                  {visit.qr_value ? (
                    <QrCodeCard
                      value={visit.qr_value}
                      title={`QR ${visit.nombre}`}
                      description={`Casa ${visit.casa} • ${visit.fecha} • ${visit.hora_inicio}`}
                    />
                  ) : null}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}
