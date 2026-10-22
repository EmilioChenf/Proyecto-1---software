import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  AlertTriangle,
  BriefcaseBusiness,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  KeyRound,
  Pencil,
  Power,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserRoundPlus,
  X,
  XCircle,
  Zap,
} from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { QrCodeCard } from "@/components/visits/QrCodeCard";
import {
  cancelVisitRequest,
  createVisitRequest,
  deleteVisitRequest,
  getFrequentVisitorsRequest,
  getVisitsRequest,
  updateVisitRequest,
} from "@/services/visitsService";
import {
  createTenantProviderRequest,
  getTenantProviderHistoryRequest,
  getTenantProvidersRequest,
  updateTenantProviderRequest,
} from "@/services/providersService";
import {
  createTenantAuthorizationRequest,
  getTenantAuthorizationRequestsRequest,
  getTenantPermissionsRequest,
} from "@/services/sprintStoriesService";
import type {
  TenantProvider,
  TenantProviderHistoryRecord,
  TenantProviderStatus,
} from "@/types/providers";
import type { AuthorizationRequest, TenantPermission } from "@/types/sprintStories";
import type { FrequentVisitor, VisitPayload, VisitRecord, VisitType } from "@/types/visits";
import { getVehiclePlateError, normalizeVehiclePlate } from "@/utils/vehiclePlate";
import { formatUtcTimestamp } from "@/utils/guatemalaTime";
import { confirmAction, notifyError, notifySuccess } from "@/utils/feedback";

type VisitFormState = VisitPayload;
type AccessFilter = "TODOS" | "APROBADO" | "UTILIZADO" | "RECHAZADO" | "PENDIENTE";
type ProviderFilterStatus = TenantProviderStatus | "TODOS";

const RESIDENTIAL_TIMEZONE = "America/Guatemala";
const PROVIDER_FORM_STORAGE_KEY = "nexus.tenant-provider-draft";

const steps = [
  { id: 1, label: "Datos del Visitante", description: "Informacion basica de identificacion" },
  { id: 2, label: "Horario y Acceso", description: "Define fecha, horario y tipo de visita" },
  { id: 3, label: "Confirmacion", description: "Revisa la informacion antes de autorizar" },
];

const visitTypeLabels: Record<VisitType, string> = {
  VISITA: "Visita personal",
  DELIVERY: "Delivery",
  PROVEEDOR: "Proveedor",
};

const statusLabels: Record<AccessFilter, string> = {
  TODOS: "Todos",
  APROBADO: "Aprobado",
  PENDIENTE: "Pendiente",
  RECHAZADO: "Rechazado",
  UTILIZADO: "Utilizado",
};

const statusStyles: Record<Exclude<AccessFilter, "TODOS">, string> = {
  APROBADO: "bg-emerald-50 text-emerald-700",
  PENDIENTE: "bg-amber-50 text-amber-700",
  RECHAZADO: "bg-rose-50 text-rose-700",
  UTILIZADO: "bg-blue-50 text-blue-700",
};

const providerStatusStyles: Record<TenantProviderStatus, string> = {
  VALIDADO: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  PENDIENTE: "bg-amber-50 text-amber-700 ring-amber-200",
};

const providerStatusLabels: Record<TenantProviderStatus, string> = {
  VALIDADO: "Validado",
  PENDIENTE: "Pendiente",
};

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

function createInitialForm(): VisitFormState {
  const now = new Date();
  const finish = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  return {
    nombre: "",
    dpi: "",
    placa: "",
    foto: "",
    fecha: getDateInTimezone(now),
    hora_inicio: getTimeInTimezone(now),
    hora_fin: getTimeInTimezone(finish),
    tipo_visita: "VISITA",
    motivo_servicio: "",
    observaciones: "",
  };
}

function createInitialProviderForm(): VisitFormState {
  return {
    ...createInitialForm(),
    tipo_visita: "PROVEEDOR",
  };
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("es-GT", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

function formatDateTime(dateTime: string | null) {
  if (!dateTime) {
    return "Sin registro";
  }

  // Registro/cambios de proveedores son instantes UTC (CURRENT_TIMESTAMP).
  return formatUtcTimestamp(dateTime, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function getAccessStatus(visit: VisitRecord): Exclude<AccessFilter, "TODOS"> {
  if (
    visit.estado_acceso === "INGRESO_REGISTRADO" ||
    visit.estado_acceso === "SALIDA_REGISTRADA" ||
    visit.qr_status === "USED" ||
    visit.qr_status === "EXIT_REGISTERED"
  ) {
    return "UTILIZADO";
  }

  if (visit.estado_acceso === "CANCELADA" || visit.qr_status === "CANCELLED") {
    return "RECHAZADO";
  }

  return "APROBADO";
}

function countActiveProviders(providers: TenantProvider[]) {
  return providers.filter((provider) => provider.activo).length;
}

function isAccessEditable(visit: VisitRecord) {
  return visit.estado_acceso === "AUTORIZADA" && visit.qr_status === "VALID";
}

// Estados reales de SOLICITUD_AUTORIZACION_DIGITAL; el propietario los resuelve (HU32).
const requestStatusStyles: Record<string, { label: string; className: string }> = {
  PENDIENTE: { label: "Pendiente", className: "bg-amber-50 text-amber-700" },
  APROBADO: { label: "Aprobada", className: "bg-emerald-50 text-emerald-700" },
  RECHAZADO: { label: "Rechazada", className: "bg-rose-50 text-rose-700" },
};

export type InquilinoSection = "visitas" | "proveedores" | "permisos";

const sectionHeadings: Record<InquilinoSection, { title: string; subtitle: string }> = {
  visitas: {
    title: "Mis visitas",
    subtitle: "Autorice visitas y dé seguimiento a los accesos asociados a su unidad.",
  },
  proveedores: {
    title: "Proveedores",
    subtitle: "Registre proveedores de servicio y consulte su estado de validación e historial.",
  },
  permisos: {
    title: "Permisos y solicitudes",
    subtitle: "Permisos asignados por el propietario y solicitudes de autorización enviadas.",
  },
};

export function InquilinoView({ section }: { section: InquilinoSection }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<VisitFormState>(createInitialForm);
  const [providerForm, setProviderForm] = useState<VisitFormState>(createInitialProviderForm);
  const [editingVisit, setEditingVisit] = useState<VisitRecord | null>(null);
  const [editForm, setEditForm] = useState<VisitFormState>(createInitialForm);
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [frequentVisitors, setFrequentVisitors] = useState<FrequentVisitor[]>([]);
  const [providers, setProviders] = useState<TenantProvider[]>([]);
  const [providerHistory, setProviderHistory] = useState<TenantProviderHistoryRecord[]>([]);
  const [providerSearch, setProviderSearch] = useState("");
  const [providerDateFilter, setProviderDateFilter] = useState("");
  const [providerStatusFilter, setProviderStatusFilter] = useState<ProviderFilterStatus>("TODOS");
  const [providerHistoryUserFilter, setProviderHistoryUserFilter] = useState("");
  const [providerHistoryDateFilter, setProviderHistoryDateFilter] = useState("");
  const [permissions, setPermissions] = useState<TenantPermission[]>([]);
  const [authorizationRequests, setAuthorizationRequests] = useState<AuthorizationRequest[]>([]);
  const [authorizationModalOpen, setAuthorizationModalOpen] = useState(false);
  // Sin valor sugerido: el inquilino no puede reservar amenidades (HU32, coherencia de permisos).
  const [authorizationAction, setAuthorizationAction] = useState("");
  const [authorizationReason, setAuthorizationReason] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<AccessFilter>("TODOS");
  const [isLoading, setIsLoading] = useState(true);
  // Errores de cargas secundarias: se muestran en su seccion en lugar de un falso estado vacio.
  const [loadErrors, setLoadErrors] = useState<Partial<Record<"frequent" | "providers" | "providerHistory" | "permissions" | "authorizations", string>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRegisteringProvider, setIsRegisteringProvider] = useState(false);
  const [isUpdatingAccess, setIsUpdatingAccess] = useState(false);
  const [isLoadingProviderHistory, setIsLoadingProviderHistory] = useState(false);
  const [updatingProviderId, setUpdatingProviderId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [authorizingVisitorId, setAuthorizingVisitorId] = useState<number | null>(null);
  const [visitToCancel, setVisitToCancel] = useState<VisitRecord | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadData() {
      try {
        setIsLoading(true);
        setErrorMessage("");
        const [
          visitsResult,
          frequentResult,
          providersResult,
          providerHistoryResult,
          permissionsResult,
          authorizationsResult,
        ] = await Promise.allSettled([
          getVisitsRequest(),
          getFrequentVisitorsRequest(),
          getTenantProvidersRequest(),
          getTenantProviderHistoryRequest(),
          getTenantPermissionsRequest(),
          getTenantAuthorizationRequestsRequest(),
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
              : "No fue posible cargar los accesos.",
          );
        }

        const failure = (result: PromiseSettledResult<unknown>, fallback: string) =>
          result.status === "rejected"
            ? result.reason instanceof Error && result.reason.message
              ? result.reason.message
              : fallback
            : undefined;
        setLoadErrors({
          frequent: failure(frequentResult, "No fue posible cargar los visitantes frecuentes."),
          providers: failure(providersResult, "No fue posible cargar los proveedores."),
          providerHistory: failure(providerHistoryResult, "No fue posible cargar el historial de proveedores."),
          permissions: failure(permissionsResult, "No fue posible cargar los permisos."),
          authorizations: failure(authorizationsResult, "No fue posible cargar las solicitudes."),
        });
        setFrequentVisitors(frequentResult.status === "fulfilled" ? frequentResult.value : []);
        setProviders(providersResult.status === "fulfilled" ? providersResult.value : []);
        setProviderHistory(providerHistoryResult.status === "fulfilled" ? providerHistoryResult.value : []);
        setPermissions(permissionsResult.status === "fulfilled" ? permissionsResult.value : []);
        setAuthorizationRequests(
          authorizationsResult.status === "fulfilled" ? authorizationsResult.value : [],
        );
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadData();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const savedDraft = window.localStorage.getItem(PROVIDER_FORM_STORAGE_KEY);

    if (!savedDraft) {
      return;
    }

    try {
      const parsedDraft = JSON.parse(savedDraft) as Partial<VisitFormState>;
      setProviderForm((current) => ({
        ...current,
        ...parsedDraft,
        tipo_visita: "PROVEEDOR",
      }));
    } catch {
      window.localStorage.removeItem(PROVIDER_FORM_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(PROVIDER_FORM_STORAGE_KEY, JSON.stringify(providerForm));
  }, [providerForm]);

  const activeProvidersCount = useMemo(() => countActiveProviders(providers), [providers]);
  const filteredVisits = useMemo(
    () =>
      selectedStatus === "TODOS"
        ? visits
        : visits.filter((visit) => getAccessStatus(visit) === selectedStatus),
    [selectedStatus, visits],
  );
  const filteredProviders = useMemo(
    () =>
      providers.filter((provider) => {
        const matchesSearch =
          !providerSearch.trim() ||
          [provider.nombre, provider.tipo_servicio, provider.descripcion]
            .join(" ")
            .toLowerCase()
            .includes(providerSearch.trim().toLowerCase());
        const matchesStatus =
          providerStatusFilter === "TODOS" || provider.estado === providerStatusFilter;
        const matchesDate =
          !providerDateFilter ||
          (provider.fecha_registro ? provider.fecha_registro.slice(0, 10) === providerDateFilter : false);

        return matchesSearch && matchesStatus && matchesDate;
      }),
    [providerDateFilter, providerSearch, providerStatusFilter, providers],
  );
  const filteredProviderHistory = useMemo(
    () =>
      providerHistory.filter((entry) => {
        const matchesUser =
          !providerHistoryUserFilter.trim() ||
          entry.realizado_por_nombre
            .toLowerCase()
            .includes(providerHistoryUserFilter.trim().toLowerCase());
        const matchesDate =
          !providerHistoryDateFilter || entry.creado_en.slice(0, 10) === providerHistoryDateFilter;

        return matchesUser && matchesDate;
      }),
    [providerHistory, providerHistoryDateFilter, providerHistoryUserFilter],
  );
  const tenantHouseLabel = providers[0]?.casa_unidad || visits[0]?.casa || "Asignada a tu usuario";

  function updateForm<K extends keyof VisitFormState>(field: K, value: VisitFormState[K]) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function validateStep() {
    if (step === 1) {
      if (!form.nombre.trim()) {
        setErrorMessage("El nombre del visitante es obligatorio.");
        return false;
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

      if (form.hora_inicio >= form.hora_fin) {
        setErrorMessage("La hora de fin debe ser mayor a la hora de inicio.");
        return false;
      }
    }

    setErrorMessage("");
    return true;
  }

  function validateVisitPayload(payload: VisitFormState, nameMessage: string) {
    if (!payload.nombre.trim()) {
      setErrorMessage(nameMessage);
      return false;
    }

    const plateError = getVehiclePlateError(payload.placa);
    if (plateError) {
      setErrorMessage(plateError);
      return false;
    }

    if (!payload.fecha || !payload.hora_inicio || !payload.hora_fin) {
      setErrorMessage("Completa fecha y horario antes de guardar.");
      return false;
    }

    if (payload.hora_inicio >= payload.hora_fin) {
      setErrorMessage("La hora de fin debe ser mayor a la hora de inicio.");
      return false;
    }

    if (payload.tipo_visita === "PROVEEDOR" && !payload.motivo_servicio?.trim()) {
      setErrorMessage("Indica el servicio que realizara el proveedor.");
      return false;
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

  // Si la recarga falla se conserva la ultima lista conocida y se informa el error (error != vacio).
  async function refreshFrequentVisitors() {
    try {
      setFrequentVisitors(await getFrequentVisitorsRequest());
      setLoadErrors((current) => ({ ...current, frequent: undefined }));
    } catch (error) {
      setLoadErrors((current) => ({
        ...current,
        frequent: error instanceof Error && error.message ? error.message : "No fue posible actualizar los visitantes frecuentes.",
      }));
    }
  }

  async function refreshProviderHistory() {
    try {
      setIsLoadingProviderHistory(true);
      setProviderHistory(await getTenantProviderHistoryRequest());
      setLoadErrors((current) => ({ ...current, providerHistory: undefined }));
    } catch (error) {
      setLoadErrors((current) => ({
        ...current,
        providerHistory: error instanceof Error && error.message ? error.message : "No fue posible actualizar el historial de proveedores.",
      }));
    } finally {
      setIsLoadingProviderHistory(false);
    }
  }

  async function createVisit(payload: VisitPayload, message: string) {
    try {
      setIsSubmitting(true);
      setErrorMessage("");
      const createdVisit = await createVisitRequest({
        ...payload,
        foto: null,
      });
      setVisits((current) => [createdVisit, ...current]);
      setSuccessMessage(message);
      setSelectedStatus("TODOS");
      setForm(createInitialForm());
      setStep(1);
      await refreshFrequentVisitors();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No fue posible autorizar la visita.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleProviderSubmit() {
    if (!validateVisitPayload(providerForm, "El nombre del proveedor es obligatorio.")) {
      return;
    }

    try {
      setIsRegisteringProvider(true);
      setErrorMessage("");
      const [registeredProvider, createdProviderAccess] = await Promise.all([
        createTenantProviderRequest({
          nombre: providerForm.nombre,
          tipo_servicio: providerForm.motivo_servicio || "General",
          descripcion: providerForm.observaciones,
        }),
        createVisitRequest({
          ...providerForm,
          tipo_visita: "PROVEEDOR",
          foto: null,
        }),
      ]);
      setVisits((current) => [createdProviderAccess, ...current]);
      setProviders((current) => {
        const exists = current.some((provider) => provider.id_servicio === registeredProvider.id_servicio);
        return exists
          ? current.map((provider) =>
              provider.id_servicio === registeredProvider.id_servicio ? registeredProvider : provider,
            )
          : [...current, registeredProvider].sort((first, second) =>
              first.nombre.localeCompare(second.nombre),
            );
      });
      setProviderForm(createInitialProviderForm());
      window.localStorage.removeItem(PROVIDER_FORM_STORAGE_KEY);
      await refreshProviderHistory();
      setSelectedStatus("TODOS");
      setSuccessMessage("Proveedor registrado correctamente. Ya aparece en gestion y en tus accesos.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No fue posible registrar el proveedor.");
    } finally {
      setIsRegisteringProvider(false);
    }
  }

  async function handleAuthorizationSubmit() {
    if (!authorizationAction.trim() || !authorizationReason.trim()) {
      setErrorMessage("Completa la accion restringida y el motivo de autorizacion.");
      return;
    }

    try {
      setErrorMessage("");
      const created = await createTenantAuthorizationRequest({
        accion: authorizationAction,
        motivo: authorizationReason,
      });
      setAuthorizationRequests((current) => [created, ...current]);
      setAuthorizationReason("");
      setAuthorizationModalOpen(false);
      setSuccessMessage("Solicitud digital enviada al propietario.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No fue posible enviar la solicitud.");
    }
  }

  function startEditingVisit(visit: VisitRecord) {
    if (!isAccessEditable(visit)) {
      setErrorMessage("Este acceso ya no puede modificarse por su estado actual.");
      return;
    }

    setEditingVisit(visit);
    setEditForm({
      nombre: visit.nombre,
      dpi: visit.dpi || "",
      placa: visit.placa || "",
      foto: "",
      fecha: visit.fecha,
      hora_inicio: visit.hora_inicio,
      hora_fin: visit.hora_fin,
      tipo_visita: visit.tipo_visita,
      motivo_servicio: visit.motivo_servicio || "",
      observaciones: visit.observaciones || "",
    });
    setErrorMessage("");
  }

  async function handleUpdateAccess() {
    if (!editingVisit) {
      return;
    }

    if (!validateVisitPayload(editForm, "El nombre del acceso es obligatorio.")) {
      return;
    }

    try {
      setIsUpdatingAccess(true);
      setErrorMessage("");
      const updatedVisit = await updateVisitRequest(editingVisit.id_acceso, {
        ...editForm,
        foto: null,
      });
      setVisits((current) =>
        current.map((item) => (item.id_acceso === updatedVisit.id_acceso ? updatedVisit : item)),
      );
      setEditingVisit(null);
      setSuccessMessage(`Acceso de ${updatedVisit.nombre} actualizado correctamente.`);
    } catch (error) {
      const apiError = error as { status?: number; message?: string } | undefined;
      setErrorMessage(
        apiError?.message || "No fue posible actualizar el acceso. Revisa los datos e intenta de nuevo.",
      );
    } finally {
      setIsUpdatingAccess(false);
    }
  }

  async function handleSubmit() {
    if (step < steps.length) {
      handleNext();
      return;
    }

    await createVisit(form, "Visita autorizada correctamente. El QR ya esta disponible.");
  }

  async function handleQuickAuthorize(visitor: FrequentVisitor) {
    setAuthorizingVisitorId(visitor.id_visitante);
    const now = new Date();
    const finish = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    await createVisit(
      {
        nombre: visitor.nombre,
        dpi: visitor.dpi,
        placa: visitor.placa,
        foto: "",
        fecha: getDateInTimezone(now),
        hora_inicio: getTimeInTimezone(now),
        hora_fin: getTimeInTimezone(finish),
        tipo_visita: "VISITA",
      },
      `Visita rapida autorizada para ${visitor.nombre}.`,
    );
    setAuthorizingVisitorId(null);
  }

  async function handleProviderToggle(provider: TenantProvider) {
    const nextActive = !provider.activo;

    try {
      setUpdatingProviderId(provider.id_servicio);
      setErrorMessage("");

      const updatedProvider = await updateTenantProviderRequest(provider.id_servicio, nextActive);

      setProviders((current) =>
        current.map((item) =>
          item.id_servicio === updatedProvider.id_servicio ? updatedProvider : item,
        ),
      );
      await refreshProviderHistory();
      setSuccessMessage(
        nextActive
          ? `${provider.nombre} fue activado y quedo pendiente de validacion.`
          : `${provider.nombre} fue desactivado correctamente.`,
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "No fue posible guardar el cambio del proveedor.",
      );
    } finally {
      setUpdatingProviderId(null);
    }
  }

  function updateProviderForm<K extends keyof VisitFormState>(field: K, value: VisitFormState[K]) {
    setProviderForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updateEditForm<K extends keyof VisitFormState>(field: K, value: VisitFormState[K]) {
    setEditForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleConfirmCancel() {
    if (!visitToCancel) {
      return;
    }

    try {
      setIsCancelling(true);
      setErrorMessage("");
      setSuccessMessage("");
      const updated = await cancelVisitRequest(visitToCancel.id_acceso);

      // Actualiza la lista en su sitio (estado cambia a CANCELADA, no se elimina)
      setVisits((current) =>
        current.map((item) =>
          item.id_acceso === updated.id_acceso
            ? { ...item, ...updated, estado_acceso: "CANCELADA", qr_status: "CANCELLED" }
            : item,
        ),
      );

      // Si el filtro actual es APROBADO, cambia a TODOS para que el usuario vea
      // que el cambio se aplico.
      if (selectedStatus === "APROBADO") {
        setSelectedStatus("TODOS");
      }

      setSuccessMessage(`Acceso de ${visitToCancel.nombre} cancelado correctamente.`);
      setVisitToCancel(null);
    } catch (error) {
      const apiError = error as { status?: number; message?: string } | undefined;
      let friendlyMessage = "No fue posible cancelar el acceso. Intenta de nuevo.";

      if (apiError?.status === 404) {
        friendlyMessage = "Esta visita ya no existe. La lista se actualizara automaticamente.";
        // Sincroniza la lista quitando la visita huerfana
        setVisits((current) => current.filter((item) => item.id_acceso !== visitToCancel.id_acceso));
        setVisitToCancel(null);
      } else if (apiError?.status === 409) {
        friendlyMessage =
          apiError.message ||
          "No se puede cancelar este acceso porque ya tiene un ingreso registrado.";
      } else if (apiError?.status === 401 || apiError?.status === 403) {
        friendlyMessage = "Tu sesion expiro o no tienes permiso para cancelar este acceso.";
      } else if (apiError?.message) {
        friendlyMessage = apiError.message;
      }

      setErrorMessage(friendlyMessage);
    } finally {
      setIsCancelling(false);
    }
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

  return (
    <AppShell
      role="inquilino"
      title={sectionHeadings[section].title}
      subtitle={sectionHeadings[section].subtitle}
    >
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

      {section === "permisos" ? <>
      <Card className="border-0 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-2xl text-slate-900">
                <ShieldCheck className="size-6 text-blue-600" />
                Permisos asignados
              </CardTitle>
              <CardDescription className="mt-2">
                Permisos activos, restricciones y vigencias asignadas a su cuenta.
              </CardDescription>
            </div>
            <Button
              type="button"
              onClick={() => setAuthorizationModalOpen(true)}
              className="rounded-2xl bg-blue-600 text-white hover:bg-blue-700"
            >
              <ShieldAlert className="size-4" />
              Solicitar autorizacion
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
          <div className="grid gap-3 md:grid-cols-2">
            {isLoading ? (
              <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">Cargando permisos...</div>
            ) : loadErrors.permissions ? (
              <p role="alert" className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-700">{loadErrors.permissions}</p>
            ) : permissions.length === 0 ? (
              <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
                No hay permisos asignados.
              </div>
            ) : (
              permissions.map((permission) => (
                <article key={permission.id_permiso} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-slate-900">{permission.nombre}</h3>
                      <p className="mt-1 text-sm text-slate-500">{permission.descripcion}</p>
                    </div>
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                      {permission.estado}
                    </span>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">Restriccion: {permission.restriccion}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Vigencia: {permission.fecha_inicio} - {permission.fecha_fin || "Indefinida"}
                  </p>
                </article>
              ))
            )}
          </div>

          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="font-semibold text-slate-900">Solicitudes digitales</p>
            <div className="mt-3 space-y-2">
              {isLoading ? (
                <p className="text-sm text-slate-500">Cargando solicitudes...</p>
              ) : loadErrors.authorizations ? (
                <p role="alert" className="text-sm text-rose-700">{loadErrors.authorizations}</p>
              ) : authorizationRequests.length === 0 ? (
                <p className="text-sm text-slate-500">Sin solicitudes registradas.</p>
              ) : (
                authorizationRequests.slice(0, 5).map((request) => (
                  <div key={request.id_solicitud} className="rounded-xl bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-800">{request.accion}</p>
                      <span className={`rounded-full px-2 py-1 text-xs ${requestStatusStyles[request.estado]?.className ?? "bg-slate-100 text-slate-600"}`}>
                        {requestStatusStyles[request.estado]?.label ?? request.estado}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{request.motivo}</p>
                    {request.respuesta ? (
                      <p className="mt-1 text-xs text-slate-600">Respuesta del propietario: {request.respuesta}</p>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      </> : null}

      {section === "proveedores" ? <>
      <Card className="border-0 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-2xl text-slate-900">
                <BriefcaseBusiness className="size-6 text-blue-600" />
                Gestion de proveedores
              </CardTitle>
              <CardDescription className="mt-2">
                Administra los servicios asociados a tu unidad y revisa su estado de validacion.
              </CardDescription>
            </div>

            <div className="rounded-2xl bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700">
              {activeProvidersCount} de {providers.length} activos
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Input
              value={providerSearch}
              onChange={(event) => setProviderSearch(event.target.value)}
              placeholder="Buscar por proveedor o tipo..."
              className="h-12 rounded-2xl border-slate-100 bg-slate-50 px-4"
            />
            <Input
              type="date"
              value={providerDateFilter}
              onChange={(event) => setProviderDateFilter(event.target.value)}
              className="h-12 rounded-2xl border-slate-100 bg-slate-50 px-4"
            />
            <select
              value={providerStatusFilter}
              onChange={(event) => setProviderStatusFilter(event.target.value as ProviderFilterStatus)}
              className="h-12 w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 text-sm outline-none focus:border-blue-300"
            >
              <option value="TODOS">Todos los estados</option>
              <option value="VALIDADO">Solo validados</option>
              <option value="PENDIENTE">Solo pendientes</option>
            </select>
          </div>

          {isLoading ? (
            <div className="rounded-3xl bg-slate-50 p-6 text-sm text-slate-500">
              Cargando proveedores de tu unidad...
            </div>
          ) : loadErrors.providers ? (
            <p role="alert" className="rounded-3xl bg-rose-50 p-6 text-sm text-rose-700">{loadErrors.providers}</p>
          ) : filteredProviders.length === 0 ? (
            <div className="rounded-3xl bg-slate-50 p-6 text-sm text-slate-500">
              No hay proveedores que coincidan con los filtros seleccionados.
            </div>
          ) : (
            filteredProviders.map((provider) => {
              const isUpdating = updatingProviderId === provider.id_servicio;

              return (
                <article
                  key={provider.id_servicio}
                  className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm lg:grid-cols-[minmax(0,1fr)_180px]"
                >
                  <div className="flex gap-4">
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-slate-50 text-blue-600">
                      <BriefcaseBusiness className="size-5" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold text-slate-900">{provider.nombre}</h3>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ring-1 ${providerStatusStyles[provider.estado]}`}
                        >
                          <BadgeCheck className="size-3.5" />
                          {providerStatusLabels[provider.estado]}
                        </span>
                      </div>

                      <p className="mt-1 text-sm leading-6 text-slate-500">{provider.descripcion}</p>

                      <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
                          Tipo: {provider.tipo_servicio}
                        </span>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
                          Unidad: {provider.casa_unidad}
                        </span>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
                          Registro: {formatDateTime(provider.fecha_registro)}
                        </span>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
                          Cambios: {formatDateTime(provider.actualizado_en)}
                        </span>
                      </div>

                      <p className="mt-3 text-xs text-slate-500">
                        Registrado por: {provider.registrado_por || "Sin registro"}.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3 lg:flex-col lg:items-stretch lg:justify-center">
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Estado</p>
                      <p className={`mt-1 text-sm font-semibold ${provider.activo ? "text-emerald-700" : "text-slate-500"}`}>
                        {provider.activo ? "ON" : "OFF"}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleProviderToggle(provider)}
                      disabled={isUpdating}
                      aria-pressed={provider.activo}
                      className={`inline-flex h-11 min-w-[98px] items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold text-white transition ${
                        provider.activo
                          ? "bg-emerald-600 hover:bg-emerald-700"
                          : "bg-slate-400 hover:bg-slate-500"
                      } disabled:cursor-not-allowed disabled:opacity-70`}
                    >
                      {isUpdating ? (
                        <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      ) : (
                        <Power className="size-4" />
                      )}
                      {provider.activo ? "ON" : "OFF"}
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl text-slate-900">
            <BriefcaseBusiness className="size-6 text-blue-600" />
            Registrar proveedor
          </CardTitle>
          <CardDescription className="mt-2">
            Autoriza un proveedor para ingresar a tu unidad con fecha y horario definidos.
            El formulario guarda cambios automaticamente mientras avanzas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-5 md:grid-cols-2">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-800">Nombre del proveedor *</span>
              <Input
                value={providerForm.nombre}
                onChange={(event) => updateProviderForm("nombre", event.target.value)}
                placeholder="Ej. Mantenimiento Lopez"
                className="h-14 rounded-2xl border-slate-100 bg-slate-50 px-4"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-800">Servicio que realizara *</span>
              <Input
                value={providerForm.motivo_servicio || ""}
                onChange={(event) => updateProviderForm("motivo_servicio", event.target.value)}
                placeholder="Ej. Reparacion electrica"
                className="h-14 rounded-2xl border-slate-100 bg-slate-50 px-4"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-800">Fecha *</span>
              <Input
                type="date"
                value={providerForm.fecha}
                onChange={(event) => updateProviderForm("fecha", event.target.value)}
                className="h-14 rounded-2xl border-slate-100 bg-slate-50 px-4"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-800">Casa / unidad</span>
              <Input
                value={tenantHouseLabel}
                readOnly
                className="h-14 rounded-2xl border-slate-100 bg-slate-100 px-4 text-slate-500"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-800">Hora de inicio *</span>
              <Input
                type="time"
                value={providerForm.hora_inicio}
                onChange={(event) => updateProviderForm("hora_inicio", event.target.value)}
                className="h-14 rounded-2xl border-slate-100 bg-slate-50 px-4"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-800">Hora de fin *</span>
              <Input
                type="time"
                value={providerForm.hora_fin}
                onChange={(event) => updateProviderForm("hora_fin", event.target.value)}
                className="h-14 rounded-2xl border-slate-100 bg-slate-50 px-4"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-800">Placa si aplica</span>
              <Input
                value={providerForm.placa}
                onChange={(event) => updateProviderForm("placa", event.target.value.toUpperCase())}
                onBlur={() => updateProviderForm("placa", normalizeVehiclePlate(providerForm.placa))}
                placeholder="P-123ABC"
                maxLength={14}
                aria-invalid={Boolean(getVehiclePlateError(providerForm.placa))}
                className="h-14 rounded-2xl border-slate-100 bg-slate-50 px-4"
              />
              {getVehiclePlateError(providerForm.placa) ? (
                <span className="text-xs text-rose-600">{getVehiclePlateError(providerForm.placa)}</span>
              ) : null}
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-800">Observaciones</span>
              <Input
                value={providerForm.observaciones || ""}
                onChange={(event) => updateProviderForm("observaciones", event.target.value)}
                placeholder="Ej. Trae herramientas grandes"
                className="h-14 rounded-2xl border-slate-100 bg-slate-50 px-4"
              />
            </label>
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              onClick={handleProviderSubmit}
              disabled={isRegisteringProvider}
              className="h-12 rounded-2xl bg-blue-600 px-6 text-white hover:bg-blue-700"
            >
              {isRegisteringProvider ? (
                <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <BriefcaseBusiness className="size-4" />
              )}
              Registrar proveedor
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-2xl text-slate-900">
                <Clock3 className="size-6 text-blue-600" />
                Cambios realizados
              </CardTitle>
              <CardDescription className="mt-2">
                Historial de activaciones, desactivaciones y registros hechos sobre tus proveedores.
              </CardDescription>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
              {providerHistory.length} movimientos registrados
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Input
              value={providerHistoryUserFilter}
              onChange={(event) => setProviderHistoryUserFilter(event.target.value)}
              placeholder="Filtrar por usuario..."
              className="h-12 rounded-2xl border-slate-100 bg-slate-50 px-4"
            />
            <Input
              type="date"
              value={providerHistoryDateFilter}
              onChange={(event) => setProviderHistoryDateFilter(event.target.value)}
              className="h-12 rounded-2xl border-slate-100 bg-slate-50 px-4"
            />
          </div>

          {isLoadingProviderHistory ? (
            <div className="rounded-3xl bg-slate-50 p-6 text-sm text-slate-500">
              Cargando historial de proveedores...
            </div>
          ) : loadErrors.providerHistory ? (
            <p role="alert" className="rounded-3xl bg-rose-50 p-6 text-sm text-rose-700">{loadErrors.providerHistory}</p>
          ) : filteredProviderHistory.length === 0 ? (
            <div className="rounded-3xl bg-slate-50 p-6 text-sm text-slate-500">
              No hay cambios que coincidan con los filtros actuales.
            </div>
          ) : (
            filteredProviderHistory.slice(0, 8).map((entry) => (
              <article
                key={entry.id_historial}
                className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-slate-900">{entry.proveedor_nombre}</h3>
                      <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                        {entry.accion}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">{entry.detalle}</p>
                    <p className="mt-2 text-xs text-slate-500">
                      Usuario: {entry.realizado_por_nombre} ({entry.realizado_por_rol}) | Fecha:{" "}
                      {formatDateTime(entry.creado_en)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-600">
                    <p>Estado: {entry.estado_nuevo || entry.estado_anterior || "Sin cambio"}</p>
                    <p className="mt-1">
                      Activo:{" "}
                      {entry.activo_nuevo === null ? "Sin cambio" : entry.activo_nuevo ? "ON" : "OFF"}
                    </p>
                  </div>
                </div>
              </article>
            ))
          )}
        </CardContent>
      </Card>
      </> : null}

      {section === "visitas" ? <>
      <Card className="overflow-hidden border-0 shadow-[0_18px_40px_rgba(30,41,59,0.12)]">
        <div className="bg-[linear-gradient(90deg,#a855f7_0%,#9333ea_45%,#9d00ff_100%)] px-5 py-6 text-white">
          <div className="flex items-center gap-3">
            <Zap className="size-5" />
            <h3 className="text-2xl font-semibold">Acceso Rapido</h3>
            <span className="rounded-full bg-white/15 px-3 py-1 text-sm">1 click</span>
          </div>
          <p className="mt-3 text-lg text-white/95">
            Autorice a sus visitantes frecuentes con un solo clic.
          </p>
        </div>
        <CardContent className="space-y-4 bg-white px-5 py-5">
          {isLoading ? (
            <div className="rounded-3xl bg-slate-50 p-6 text-sm text-slate-500">
              Cargando visitantes frecuentes...
            </div>
          ) : loadErrors.frequent ? (
            <p role="alert" className="rounded-3xl bg-rose-50 p-6 text-sm text-rose-700">{loadErrors.frequent}</p>
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
                <div>
                  <p className="text-xl font-semibold text-slate-900">{visitor.nombre}</p>
                  <p className="text-sm text-slate-500">
                    {visitor.placa || "Sin placa"} {visitor.dpi ? `DPI: ${visitor.dpi}` : ""}
                  </p>
                  <p className="text-xs text-slate-400">
                    {visitor.total_visitas} visita{visitor.total_visitas !== 1 ? "s" : ""}
                    {visitor.ultima_fecha ? ` | Ultima: ${formatDate(visitor.ultima_fecha)}` : ""}
                  </p>
                </div>
                <Button
                  onClick={() => handleQuickAuthorize(visitor)}
                  disabled={isSubmitting}
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
                      Autorizar
                    </>
                  )}
                </Button>
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
                <span className="text-sm font-medium text-slate-800">DPI / Documento (Opcional)</span>
                <Input
                  value={form.dpi}
                  onChange={(event) => updateForm("dpi", event.target.value)}
                  placeholder="1234567890123"
                  className="h-14 rounded-2xl border-slate-100 bg-slate-50 px-4"
                />
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
            </>
          ) : null}

          {step === 2 ? (
            <>
              <div className="rounded-2xl bg-blue-50 px-4 py-3 text-sm text-blue-700">
                La fecha y hora se completaron automaticamente con la hora actual.
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
                    onChange={(event) => updateForm("hora_inicio", event.target.value)}
                    className="h-14 rounded-2xl border-slate-100 bg-slate-50 px-4"
                  />
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-slate-800">Hora de fin *</span>
                  <Input
                    type="time"
                    value={form.hora_fin}
                    onChange={(event) => updateForm("hora_fin", event.target.value)}
                    className="h-14 rounded-2xl border-slate-100 bg-slate-50 px-4"
                  />
                </label>
              </div>
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
          disabled={isSubmitting}
          className="h-14 rounded-2xl bg-[linear-gradient(90deg,#3b82f6_0%,#1d4ed8_100%)] text-xl text-white hover:opacity-95"
        >
          {step === steps.length ? "Autorizar Visita" : "Siguiente"}
          <ChevronRight className="size-5" />
        </Button>
      </div>

      <Card className="overflow-hidden border-0 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-2xl text-slate-900">Gestion de accesos</CardTitle>
              <CardDescription className="mt-2 text-sm text-slate-600">
                Accesos autorizados por el inquilino autenticado y compatibles con garita.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(statusLabels) as AccessFilter[]).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setSelectedStatus(status)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    selectedStatus === status
                      ? "bg-blue-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {statusLabels[status]}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="rounded-3xl bg-slate-50 p-6 text-sm text-slate-500">
              Cargando accesos del inquilino...
            </div>
          ) : filteredVisits.length === 0 ? (
            <div className="rounded-3xl bg-slate-50 p-6 text-sm text-slate-500">
              No hay accesos para el filtro seleccionado.
            </div>
          ) : (
            filteredVisits.map((visit) => {
              const accessStatus = getAccessStatus(visit);

              return (
                <article
                  key={visit.id_acceso}
                  className="rounded-3xl border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-5 shadow-sm"
                >
                  <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_260px]">
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex size-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
                          <KeyRound className="size-5" />
                        </div>
                        <div>
                          <h3 className="text-xl font-semibold text-slate-900">{visit.nombre}</h3>
                          <p className="text-sm text-slate-500">{visitTypeLabels[visit.tipo_visita]}</p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-medium ${statusStyles[accessStatus]}`}>
                          {statusLabels[accessStatus]}
                        </span>
                        <div className="ml-auto flex items-center gap-1">
                          {isAccessEditable(visit) ? (
                            <button
                              type="button"
                              onClick={() => startEditingVisit(visit)}
                              className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-200 transition hover:bg-blue-100"
                              aria-label={`Editar acceso de ${visit.nombre}`}
                            >
                              <Pencil className="size-3.5" />
                              Editar
                            </button>
                          ) : null}
                          {accessStatus === "APROBADO" ? (
                            <button
                              type="button"
                              onClick={() => setVisitToCancel(visit)}
                              className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200 transition hover:bg-amber-100"
                              aria-label={`Cancelar acceso de ${visit.nombre}`}
                            >
                              <XCircle className="size-3.5" />
                              Cancelar
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => handleDelete(visit)}
                            className="rounded-full p-2 text-rose-500 transition hover:bg-rose-50"
                            aria-label={`Eliminar visita de ${visit.nombre}`}
                          >
                            <Trash2 className="size-5" />
                          </button>
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-2xl bg-slate-50 p-4">
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Tipo</p>
                          <p className="mt-2 text-sm font-medium text-slate-800">{visitTypeLabels[visit.tipo_visita]}</p>
                        </div>
                        <div className="rounded-2xl bg-slate-50 p-4">
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Fecha</p>
                          <p className="mt-2 text-sm font-medium text-slate-800">{formatDate(visit.fecha)}</p>
                        </div>
                        <div className="rounded-2xl bg-slate-50 p-4">
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Hora</p>
                          <p className="mt-2 text-sm font-medium text-slate-800">
                            {visit.hora_inicio} - {visit.hora_fin}
                          </p>
                        </div>
                        <div className="rounded-2xl bg-slate-50 p-4">
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Placa</p>
                          <p className="mt-2 text-sm font-medium text-slate-800">{visit.placa || "Sin placa"}</p>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-3">
                        <p className="flex items-center gap-2 text-sm font-medium text-slate-700">
                          <CalendarDays className="size-4" />
                          Casa/unidad: {visit.casa || "Asignada al inquilino"}
                        </p>
                        {visit.motivo_servicio ? (
                          <p className="mt-1 text-sm text-slate-500">
                            Servicio/motivo: {visit.motivo_servicio}
                          </p>
                        ) : null}
                        {visit.observaciones ? (
                          <p className="mt-1 text-sm text-slate-500">
                            Observaciones: {visit.observaciones}
                          </p>
                        ) : null}
                        <p className="mt-1 text-sm text-slate-500">
                          Referencia QR: {visit.token_qr || "Sin token disponible"}
                        </p>
                      </div>
                    </div>

                    {visit.qr_value ? (
                      <QrCodeCard
                        value={visit.qr_value}
                        title={`QR ${visit.nombre}`}
                        description={`Casa ${visit.casa} | ${visit.fecha} | ${visit.hora_inicio}`}
                      />
                    ) : null}
                  </div>
                </article>
              );
            })
          )}
        </CardContent>
      </Card>
      </> : null}

      {editingVisit ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/50 px-4 py-8"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-access-title"
        >
          <div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.25)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="edit-access-title" className="text-xl font-semibold text-slate-900">
                  Editar acceso
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Solo se pueden modificar accesos autorizados y vigentes.
                </p>
              </div>
              <button
                type="button"
                onClick={() => (isUpdatingAccess ? null : setEditingVisit(null))}
                className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="Cerrar"
                disabled={isUpdatingAccess}
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-800">Nombre *</span>
                <Input
                  value={editForm.nombre}
                  onChange={(event) => updateEditForm("nombre", event.target.value)}
                  className="h-12 rounded-2xl border-slate-100 bg-slate-50 px-4"
                />
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-800">Tipo *</span>
                <select
                  value={editForm.tipo_visita}
                  onChange={(event) => updateEditForm("tipo_visita", event.target.value as VisitType)}
                  className="h-12 w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 text-sm outline-none focus:border-blue-300"
                >
                  <option value="VISITA">Visita personal</option>
                  <option value="DELIVERY">Delivery</option>
                  <option value="PROVEEDOR">Proveedor</option>
                </select>
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-800">Fecha *</span>
                <Input
                  type="date"
                  value={editForm.fecha}
                  onChange={(event) => updateEditForm("fecha", event.target.value)}
                  className="h-12 rounded-2xl border-slate-100 bg-slate-50 px-4"
                />
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-800">Placa</span>
                <Input
                  value={editForm.placa}
                  onChange={(event) => updateEditForm("placa", event.target.value.toUpperCase())}
                  onBlur={() => updateEditForm("placa", normalizeVehiclePlate(editForm.placa))}
                  maxLength={14}
                  aria-invalid={Boolean(getVehiclePlateError(editForm.placa))}
                  className="h-12 rounded-2xl border-slate-100 bg-slate-50 px-4"
                />
                {getVehiclePlateError(editForm.placa) ? (
                  <span className="text-xs text-rose-600">{getVehiclePlateError(editForm.placa)}</span>
                ) : null}
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-800">Hora de inicio *</span>
                <Input
                  type="time"
                  value={editForm.hora_inicio}
                  onChange={(event) => updateEditForm("hora_inicio", event.target.value)}
                  className="h-12 rounded-2xl border-slate-100 bg-slate-50 px-4"
                />
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-800">Hora de fin *</span>
                <Input
                  type="time"
                  value={editForm.hora_fin}
                  onChange={(event) => updateEditForm("hora_fin", event.target.value)}
                  className="h-12 rounded-2xl border-slate-100 bg-slate-50 px-4"
                />
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-800">Servicio / motivo</span>
                <Input
                  value={editForm.motivo_servicio || ""}
                  onChange={(event) => updateEditForm("motivo_servicio", event.target.value)}
                  className="h-12 rounded-2xl border-slate-100 bg-slate-50 px-4"
                />
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-800">Observaciones</span>
                <Input
                  value={editForm.observaciones || ""}
                  onChange={(event) => updateEditForm("observaciones", event.target.value)}
                  className="h-12 rounded-2xl border-slate-100 bg-slate-50 px-4"
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingVisit(null)}
                disabled={isUpdatingAccess}
                className="rounded-xl"
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={handleUpdateAccess}
                disabled={isUpdatingAccess}
                className="rounded-xl bg-blue-600 text-white hover:bg-blue-700"
              >
                {isUpdatingAccess ? (
                  <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <Pencil className="size-4" />
                )}
                Guardar cambios
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {visitToCancel ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-visit-title"
        >
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.25)]">
            <div className="flex items-start gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                <AlertTriangle className="size-6" />
              </div>
              <div className="flex-1">
                <h3 id="cancel-visit-title" className="text-lg font-semibold text-slate-900">
                  Confirmar cancelacion
                </h3>
                <p className="mt-2 text-sm text-slate-600">
                  Estas a punto de cancelar el acceso de{" "}
                  <span className="font-semibold text-slate-900">{visitToCancel.nombre}</span>{" "}
                  programado para el {formatDate(visitToCancel.fecha)} a las{" "}
                  {visitToCancel.hora_inicio}. El QR dejara de ser valido.
                </p>
              </div>
              <button
                type="button"
                onClick={() => (isCancelling ? null : setVisitToCancel(null))}
                className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="Cerrar"
                disabled={isCancelling}
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setVisitToCancel(null)}
                disabled={isCancelling}
                className="rounded-xl"
              >
                Volver
              </Button>
              <Button
                type="button"
                onClick={handleConfirmCancel}
                disabled={isCancelling}
                className="rounded-xl bg-amber-600 text-white hover:bg-amber-700"
              >
                {isCancelling ? (
                  <>
                    <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Cancelando...
                  </>
                ) : (
                  <>
                    <XCircle className="size-4" />
                    Si, cancelar
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {authorizationModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="authorization-request-title"
        >
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.25)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="authorization-request-title" className="text-xl font-semibold text-slate-900">
                  Solicitud digital de autorizacion
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Se notificara al propietario y quedara registrada en historial.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAuthorizationModalOpen(false)}
                className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="Cerrar"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-800">Accion restringida</span>
                <Input
                  value={authorizationAction}
                  placeholder="Ej. Mudanza fuera de horario"
                  onChange={(event) => setAuthorizationAction(event.target.value)}
                  className="h-12 rounded-2xl border-slate-100 bg-slate-50 px-4"
                />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-800">Motivo</span>
                <Input
                  value={authorizationReason}
                  onChange={(event) => setAuthorizationReason(event.target.value)}
                  placeholder="Describe por que necesitas esta autorizacion"
                  className="h-12 rounded-2xl border-slate-100 bg-slate-50 px-4"
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setAuthorizationModalOpen(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={() => void handleAuthorizationSubmit()}
                className="bg-blue-600 text-white hover:bg-blue-700"
              >
                Enviar solicitud
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
