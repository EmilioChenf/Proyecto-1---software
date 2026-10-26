import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import jsQR from "jsqr";
import {
  BellRing,
  Camera,
  CheckCheck,
  CircleAlert,
  LogIn,
  LogOut,
  QrCode,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  XCircle,
} from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { notifySidebarCountersChanged } from "@/components/layout/sidebarCounters";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getGuardVisitsRequest,
  registerQrEntryRequest,
  registerQrExitRequest,
  validateQrRequest,
} from "@/services/visitsService";
import {
  getGuardNotificationsRequest,
  getNotificationsRequest,
  markAllGuardNotificationsAsReadRequest,
  markGuardNotificationAsReadRequest,
} from "@/services/notificationsService";
import { getGuardAccessHistoryRequest } from "@/services/sprintStoriesService";
import type { NotificationRecord } from "@/types/notifications";
import type { GuardAccessHistoryRecord } from "@/types/sprintStories";
import type { VisitRecord } from "@/types/visits";
import { formatUtcTimestamp, guatemalaToday } from "@/utils/guatemalaTime";

// Etiquetas de los estados reales que devuelve /guardia/historial-accesos.
const historyStatusLabels: Record<GuardAccessHistoryRecord["estado"], { label: string; className: string }> = {
  PENDIENTE: { label: "Pendiente", className: "bg-amber-50 text-amber-700" },
  INGRESO: { label: "Ingresó", className: "bg-emerald-50 text-emerald-700" },
  SALIDA: { label: "Salida", className: "bg-blue-50 text-blue-700" },
  VENCIDA: { label: "Vencida", className: "bg-slate-100 text-slate-600" },
  CANCELADA: { label: "Cancelada", className: "bg-rose-50 text-rose-700" },
  RECHAZADA: { label: "Rechazada", className: "bg-rose-50 text-rose-700" },
  PENDIENTE_APROBACION: { label: "Por aprobar", className: "bg-violet-50 text-violet-700" },
};

type GuardScanAction = "INGRESO" | "SALIDA";
const REFRESH_INTERVAL_MS = 10000;

function formatDate(date: string) {
  return new Intl.DateTimeFormat("es-GT", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

function extractQrToken(rawValue: string) {
  return rawValue.startsWith("NEXUSVISIT:") ? rawValue.slice("NEXUSVISIT:".length) : rawValue;
}

function canUseCamera() {
  const isLocalhost =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

  return Boolean(navigator.mediaDevices?.getUserMedia) && (window.isSecureContext || isLocalhost);
}

function getVisitBadge(visit: VisitRecord): { label: string; className: string } {
  if (visit.estado_acceso === "CANCELADA" || visit.qr_status === "CANCELLED") {
    return {
      label: "Cancelado",
      className: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200",
    };
  }

  if (visit.qr_status === "EXIT_REGISTERED" || visit.estado_acceso === "SALIDA_REGISTRADA") {
    return {
      label: "Salida registrada",
      className: "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200",
    };
  }
  if (visit.qr_status === "NOT_YET_VALID") {
    return {
      label: "QR aun no vigente",
      className: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
    };
  }

  if (visit.qr_status === "EXPIRED") {
    return {
      label: "QR expirado",
      className: "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200",
    };
  }

  if (visit.es_acceso_especial) {
    if (visit.qr_status === "PENDING_APPROVAL" || visit.estado_acceso === "PENDIENTE_APROBACION") {
      return {
        label: "Acceso especial pendiente",
        className: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
      };
    }
    return {
      label: "Acceso especial",
      className: "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200",
    };
  }

  if (visit.qr_status === "USED" || visit.estado_acceso === "INGRESO_REGISTRADO") {
    return {
      label: "Ingreso registrado",
      className: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
    };
  }

  return {
    label: "Autorizada",
    className: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200",
  };
}
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

function canRegisterExit(visit: VisitRecord) {
  return (
    visit.estado_acceso === "INGRESO_REGISTRADO" &&
    visit.qr_status === "USED" &&
    !visit.hora_salida &&
    Boolean(visit.token_qr)
  );
}

export type GuardiaSection = "control" | "visitas" | "historial" | "alertas";

const sectionHeadings: Record<GuardiaSection, { title: string; subtitle: string }> = {
  control: {
    title: "Control de acceso",
    subtitle: "Escanee o ingrese el código QR del visitante para registrar su ingreso o salida.",
  },
  visitas: {
    title: "Visitas recientes",
    subtitle: "Visitas de hoy y de días anteriores: revise su estado y registre salidas desde garita.",
  },
  historial: {
    title: "Historial de accesos",
    subtitle: "Ingresos y salidas registrados, con filtros por fecha, estado y búsqueda.",
  },
  alertas: {
    title: "Alertas",
    subtitle: "Accesos cancelados por residentes o inquilinos y accesos especiales aprobados.",
  },
};

export function GuardiaView({ section }: { section: GuardiaSection }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [specialNotifications, setSpecialNotifications] = useState<NotificationRecord[]>([]);
  const [accessHistory, setAccessHistory] = useState<GuardAccessHistoryRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [alertsError, setAlertsError] = useState("");
  const [historyDate, setHistoryDate] = useState(() => guatemalaToday());
  const [historyStatus, setHistoryStatus] = useState("TODOS");
  const [historySearch, setHistorySearch] = useState("");
  const [validatedVisit, setValidatedVisit] = useState<VisitRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [scanAction, setScanAction] = useState<GuardScanAction>("INGRESO");
  const [exitingAccessId, setExitingAccessId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [validationResult, setValidationResult] = useState<{
    status: "approved" | "rejected";
    title: string;
    message: string;
  } | null>(null);

  const loadGuardVisits = useCallback(async (options: { silent?: boolean } = {}) => {
    const { silent = false } = options;

    try {
      if (silent) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      const response = await getGuardVisitsRequest();
      setVisits(response);
      setLastUpdatedAt(new Date());
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No fue posible cargar las visitas.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function loadNotifications() {
      try {
        const [guardData, allData] = await Promise.all([
          getGuardNotificationsRequest(),
          getNotificationsRequest(),
        ]);
        if (active) {
          setAlertsError("");
          setNotifications(guardData);
          setSpecialNotifications(allData.filter((item) => item.tipo === "ACCESO_ESPECIAL"));
        }
      } catch (error) {
        // Se conservan las ultimas alertas conocidas y se informa el fallo (error != vacio).
        if (active) {
          setAlertsError(error instanceof Error && error.message ? error.message : "No fue posible cargar las alertas.");
        }
      }
    }

    void loadGuardVisits();
    void loadNotifications();

    const intervalId = window.setInterval(() => {
      void loadGuardVisits({ silent: true });
      void loadNotifications();
    }, REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [loadGuardVisits]);

  useEffect(() => {
    let active = true;

    async function loadHistory() {
      try {
        const response = await getGuardAccessHistoryRequest({
          date: historyDate,
          status: historyStatus,
          search: historySearch,
        });
        if (active) {
          setHistoryError("");
          setAccessHistory(response);
        }
      } catch (error) {
        if (active) {
          setHistoryError(error instanceof Error && error.message ? error.message : "No fue posible cargar el historial.");
        }
      } finally {
        if (active) setHistoryLoading(false);
      }
    }

    void loadHistory();
    const timer = window.setInterval(() => {
      void loadHistory();
    }, 15000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [historyDate, historySearch, historyStatus]);

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, []);

  const cancellationAlerts = useMemo(
    () => notifications.filter((notification) => notification.tipo === "ACCESO_CANCELADO" && !notification.leido),
    [notifications],
  );
  function updateVisitCollection(visit: VisitRecord) {
    setVisits((current) => {
      const found = current.some((item) => item.id_acceso === visit.id_acceso);
      return found
        ? current.map((item) => (item.id_acceso === visit.id_acceso ? visit : item))
        : [visit, ...current];
    });
  }

  function stopScanner() {
    if (frameRef.current) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsScanning(false);
  }

  async function handleMarkAlertRead(notificationId: number) {
    try {
      await markGuardNotificationAsReadRequest(notificationId);
      setNotifications((current) =>
        current.map((notification) =>
          notification.id_notificacion === notificationId ? { ...notification, leido: true } : notification,
        ),
      );
      notifySidebarCountersChanged();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No fue posible marcar la alerta como leida.");
    }
  }

  async function handleMarkAllAlertsRead() {
    try {
      await markAllGuardNotificationsAsReadRequest();
      setNotifications((current) => current.map((notification) => ({ ...notification, leido: true })));
      notifySidebarCountersChanged();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No fue posible marcar las alertas como leidas.");
    }
  }

  async function handleValidateToken(qrToken: string) {
    try {
      setErrorMessage("");
      setSuccessMessage("");
      const isExitAction = scanAction === "SALIDA";
      const visit = isExitAction
        ? await registerQrExitRequest({ qrToken })
        : await validateQrRequest({ qrToken });

      setValidatedVisit(visit);
      setValidationResult({
        status: "approved",
        title: isExitAction ? "Salida registrada" : "Visita autorizada",
        message: isExitAction
          ? "La salida fue registrada con la hora actual."
          : "QR valido. El ingreso fue registrado y este QR ya no funcionara una segunda vez.",
      });
      updateVisitCollection(visit);
      void loadGuardVisits({ silent: true });
      setSuccessMessage(isExitAction ? "Salida registrada correctamente." : "Visita autorizada e ingreso registrado.");
    } catch (error) {
      setValidatedVisit(null);
      const message =
        error instanceof Error
          ? error.message
          : scanAction === "SALIDA"
            ? "No fue posible registrar la salida."
            : "No fue posible validar el QR.";
      const apiError = error as { status?: number; message?: string; payload?: { code?: string } };
      const isCancelled =
        apiError?.status === 410 &&
        (message.toLowerCase().includes("cancelado") || apiError?.payload?.code === "ACCESS_CANCELLED");

      setValidationResult({
        status: "rejected",
        title: isCancelled ? "ACCESO CANCELADO - NO AUTORIZAR" : "Acceso rechazado",
        message,
      });
      setErrorMessage(message);

      if (isCancelled) {
        try {
          setNotifications(await getGuardNotificationsRequest());
        } catch {
          // Mantiene el resultado de validacion aunque falle el refresco de alertas.
        }
      }
    }
  }

  async function scanFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas || video.readyState < 2) {
      frameRef.current = window.requestAnimationFrame(() => {
        void scanFrame();
      });
      return;
    }

    const context = canvas.getContext("2d", { willReadFrequently: true });

    if (!context) {
      setErrorMessage("No fue posible inicializar el lector QR.");
      stopScanner();
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(imageData.data, imageData.width, imageData.height);

    if (result?.data) {
      stopScanner();
      await handleValidateToken(extractQrToken(result.data));
      return;
    }

    frameRef.current = window.requestAnimationFrame(() => {
      void scanFrame();
    });
  }

  async function handleStartScanner() {
    if (!canUseCamera()) {
      setErrorMessage(
        "La camara necesita HTTPS o localhost y permisos del navegador. En telefono y compu funciona, pero fuera de localhost debe abrirse en HTTPS.",
      );
      return;
    }

    try {
      setErrorMessage("");
      setSuccessMessage("");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setIsScanning(true);
      frameRef.current = window.requestAnimationFrame(() => {
        void scanFrame();
      });
    } catch (error) {
      stopScanner();
      setErrorMessage(error instanceof Error ? error.message : "No fue posible iniciar la camara.");
    }
  }

  async function decodeQrFromImageBitmap(bitmap: ImageBitmap) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    if (!context) {
      throw new Error("No fue posible procesar la imagen del QR.");
    }

    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    context.drawImage(bitmap, 0, 0);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(imageData.data, imageData.width, imageData.height);

    if (!result?.data) {
      throw new Error("No se detecto ningun QR en la imagen.");
    }

    return result.data;
  }

  async function handleImageScan(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      setErrorMessage("");
      setSuccessMessage("");
      const bitmap = await createImageBitmap(file);
      const qrValue = await decodeQrFromImageBitmap(bitmap);
      await handleValidateToken(extractQrToken(qrValue));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No fue posible leer la imagen.");
    } finally {
      event.target.value = "";
    }
  }

  async function handleManualValidation() {
    if (!manualCode.trim()) {
      setErrorMessage("Ingresa un codigo QR valido.");
      return;
    }

    await handleValidateToken(manualCode);
  }

  async function handleRegisterEntry() {
    if (!validatedVisit?.token_qr) {
      return;
    }

    try {
      setErrorMessage("");
      setSuccessMessage("");
      const visit = await registerQrEntryRequest({ qrToken: validatedVisit.token_qr });
      setValidatedVisit(visit);
      setValidationResult({
        status: "approved",
        title: "Ingreso autorizado",
        message: "El QR fue usado correctamente y ya no funcionara una segunda vez.",
      });
      updateVisitCollection(visit);
      void loadGuardVisits({ silent: true });
      setSuccessMessage("Ingreso registrado correctamente.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No fue posible registrar el ingreso.";
      setValidationResult({
        status: "rejected",
        title: "Acceso rechazado",
        message,
      });
      setErrorMessage(message);
    }
  }

  async function handleRegisterExit(visit: VisitRecord) {
    if (!visit.token_qr) {
      setErrorMessage("Este acceso no tiene codigo QR para registrar salida.");
      return;
    }

    try {
      setExitingAccessId(visit.id_acceso);
      setErrorMessage("");
      setSuccessMessage("");
      const updatedVisit = await registerQrExitRequest({ qrToken: visit.token_qr });
      setValidatedVisit(updatedVisit);
      setValidationResult({
        status: "approved",
        title: "Salida registrada",
        message: "La salida fue registrada con la hora actual.",
      });
      updateVisitCollection(updatedVisit);
      void loadGuardVisits({ silent: true });
      setSuccessMessage(`Salida registrada para ${updatedVisit.nombre}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No fue posible registrar la salida.";
      setValidationResult({
        status: "rejected",
        title: "Acceso rechazado",
        message,
      });
      setErrorMessage(message);
    } finally {
      setExitingAccessId(null);
    }
  }

  return (
    <AppShell
      role="guardia"
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

      {section === "alertas" ? <>
      {cancellationAlerts.length > 0 ? (
        <Card className="border-rose-200 bg-rose-50/60 shadow-[0_10px_30px_rgba(244,63,94,0.08)]">
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700">
                  <BellRing className="size-5 animate-pulse" />
                </div>
                <div>
                  <CardTitle className="text-rose-900">
                    {cancellationAlerts.length} alerta{cancellationAlerts.length !== 1 ? "s" : ""} de cancelacion
                  </CardTitle>
                  <CardDescription className="text-rose-700">
                    Accesos cancelados por residentes/inquilinos. Verifica que el QR ya no sea valido.
                  </CardDescription>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleMarkAllAlertsRead}
                className="border-rose-200 bg-white text-rose-700 hover:bg-rose-100"
              >
                <CheckCheck className="size-4" />
                Marcar todas
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {cancellationAlerts.slice(0, 5).map((alert) => (
              <div
                key={alert.id_notificacion}
                className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-white px-4 py-3"
              >
                <div className="flex items-start gap-3">
                  <XCircle className="mt-0.5 size-4 shrink-0 text-rose-600" />
                  <div className="text-sm">
                    <p className="font-medium text-slate-900">{alert.titulo}</p>
                    <p className="text-slate-600">{alert.mensaje}</p>
                    <p className="mt-1 text-xs text-slate-400">{formatUtcTimestamp(alert.creado_en)}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleMarkAlertRead(alert.id_notificacion)}
                  className="text-xs font-medium text-rose-600 hover:underline"
                  aria-label="Marcar como leida"
                >
                  Leida
                </button>
              </div>
            ))}
            {cancellationAlerts.length > 5 ? (
              <p className="px-1 text-xs text-rose-700">+{cancellationAlerts.length - 5} alertas mas pendientes.</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {specialNotifications.length > 0 ? (
        <Card className="border-violet-200 bg-violet-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-violet-900">
              <ShieldAlert className="size-5" />
              Accesos especiales
            </CardTitle>
            <CardDescription className="text-violet-700">
              Avisos de accesos especiales gestionados por administración.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {specialNotifications.slice(0, 5).map((notification) => (
              <div
                key={notification.id_notificacion}
                className="rounded-xl border border-violet-200 bg-white px-4 py-3 text-sm text-violet-900"
              >
                <p className="font-medium">{notification.titulo}</p>
                <p className="mt-1 text-violet-700">{notification.mensaje}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
      {alertsError ? (
        <Alert variant="destructive">
          <AlertTitle>No fue posible actualizar las alertas</AlertTitle>
          <AlertDescription>{alertsError}</AlertDescription>
        </Alert>
      ) : null}
      {!alertsError && cancellationAlerts.length === 0 && specialNotifications.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-white py-10 text-center text-sm text-slate-500">
          No hay alertas pendientes. Las cancelaciones de acceso y los accesos especiales aprobados aparecerán aquí.
        </p>
      ) : null}
      </> : null}

      {section === "control" ? <>
      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle>Escanear QR</CardTitle>
            <CardDescription>Lee el QR del visitante para registrar ingreso o salida.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-4">
              <div className="mb-4 grid gap-2 sm:grid-cols-2">
                <Button
                  type="button"
                  variant={scanAction === "INGRESO" ? "default" : "outline"}
                  onClick={() => setScanAction("INGRESO")}
                  className="rounded-2xl"
                >
                  <LogIn className="size-4" />
                  Registrar ingreso
                </Button>
                <Button
                  type="button"
                  variant={scanAction === "SALIDA" ? "default" : "outline"}
                  onClick={() => setScanAction("SALIDA")}
                  className="rounded-2xl"
                >
                  <LogOut className="size-4" />
                  Registrar salida
                </Button>
              </div>
              <video ref={videoRef} className="h-72 w-full rounded-2xl bg-slate-900 object-cover" muted playsInline />
              <canvas ref={canvasRef} className="hidden" />
              <div className="mt-4 flex flex-wrap gap-3">
                <Button type="button" onClick={() => void handleStartScanner()} className="rounded-2xl">
                  <Camera className="size-4" />
                  Iniciar camara
                </Button>
                <Button type="button" variant="outline" onClick={stopScanner} className="rounded-2xl">
                  <ScanLine className="size-4" />
                  Detener
                </Button>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700">
                  <QrCode className="size-4" />
                  Leer desde imagen
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageScan} />
                </label>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                {isScanning
                  ? "Escaneando QR en tiempo real..."
                  : "Funciona en compu y telefono. Para usar camara fuera de localhost, la web debe abrirse con HTTPS."}
              </p>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-medium text-slate-900">Codigo manual</p>
              <div className="mt-3 flex flex-col gap-3 md:flex-row">
                <input
                  aria-label="Código QR manual"
                  value={manualCode}
                  onChange={(event) => setManualCode(event.target.value)}
                  placeholder="NEXUSVISIT:token o token"
                  className="h-11 flex-1 rounded-2xl border border-slate-200 px-4 outline-none focus:border-blue-300"
                />
                <Button type="button" onClick={() => void handleManualValidation()} className="rounded-2xl">
                  {scanAction === "SALIDA" ? "Registrar salida" : "Validar QR"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle>Resultado de validacion</CardTitle>
            <CardDescription>Si el QR es valido, aqui aparece la visita autorizada.</CardDescription>
          </CardHeader>
          <CardContent>
            {validatedVisit ? (
              <div className="space-y-4 rounded-3xl bg-emerald-50 p-5">
                <div>
                  <p className="text-sm font-medium uppercase tracking-[0.18em] text-emerald-600">
                    Visita autorizada
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">{validatedVisit.nombre}</p>
                </div>
                <div className="space-y-2 text-slate-700">
                  <p>DPI: {validatedVisit.dpi}</p>
                  <p>Placa: {validatedVisit.placa}</p>
                  <p>Casa: {validatedVisit.casa}</p>
                  <p>Fecha: {formatDate(validatedVisit.fecha)}</p>
                  <p>Hora: {validatedVisit.hora_inicio} - {validatedVisit.hora_fin}</p>
                  <p>Salida: {validatedVisit.hora_salida || "Sin registro"}</p>
                  <p>Tipo: {validatedVisit.tipo_visita}</p>
                  <p>Estado: {validatedVisit.estado_acceso}</p>
                  {validatedVisit.observaciones ? (
                    <p>Observaciones: {validatedVisit.observaciones}</p>
                  ) : null}
                  {validatedVisit.es_acceso_especial ? (
                    <p className="font-medium text-violet-700">Mostrar estado especial: autorizado</p>
                  ) : null}
                </div>
                {canRegisterExit(validatedVisit) ? (
                  <Button
                    type="button"
                    onClick={() => void handleRegisterExit(validatedVisit)}
                    disabled={exitingAccessId === validatedVisit.id_acceso}
                    className="rounded-2xl"
                  >
                    <LogOut className="size-4" />
                    {exitingAccessId === validatedVisit.id_acceso ? "Registrando..." : "Registrar salida"}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={() => void handleRegisterEntry()}
                    disabled
                    className="rounded-2xl"
                  >
                    {validatedVisit.hora_salida ? "Salida ya registrada" : "Ingreso ya registrado"}
                  </Button>
                )}
              </div>
            ) : validationResult?.status === "rejected" ? (
              <div className="space-y-3 rounded-3xl bg-rose-50 p-5 text-rose-700">
                <div className="flex items-center gap-2">
                  <CircleAlert className="size-5" />
                  <p className="font-semibold">{validationResult.title}</p>
                </div>
                <p>{validationResult.message}</p>
              </div>
            ) : (
              <div className="rounded-3xl bg-slate-50 p-5 text-sm text-slate-500">
                Aun no se ha validado un QR.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      </> : null}

      {section === "visitas" ? <>
      <Card>
        <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Control de ingresos</CardTitle>
            <CardDescription>Listado operativo para revision rapida desde garita.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-slate-500">
              Actualizado: {formatRefreshTime(lastUpdatedAt)}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadGuardVisits({ silent: true })}
              disabled={isRefreshing || isLoading}
              className="rounded-xl"
            >
              <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
              {isRefreshing ? "Actualizando..." : "Actualizar"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="rounded-xl border border-slate-200 p-4 text-sm text-slate-500">
              Cargando visitas del turno...
            </div>
          ) : visits.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500">
              No hay visitas registradas para el turno.
            </p>
          ) : (
            visits.map((visitor) => (
              <div
                key={visitor.id_acceso}
                className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <p className="text-slate-900">{visitor.nombre}</p>
                  <p className="text-sm text-slate-500">
                    {visitor.casa} • {formatDate(visitor.fecha)} • {visitor.hora_inicio} - {visitor.hora_fin}
                  </p>
                  {visitor.hora_salida ? (
                    <p className="text-sm font-medium text-emerald-700">Salida: {visitor.hora_salida}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canRegisterExit(visitor) ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleRegisterExit(visitor)}
                      disabled={exitingAccessId === visitor.id_acceso}
                      className="rounded-xl"
                    >
                      <LogOut className="size-3.5" />
                      {exitingAccessId === visitor.id_acceso ? "Registrando..." : "Registrar salida"}
                    </Button>
                  ) : null}
                  {(() => {
                    const badge = getVisitBadge(visitor);
                    return (
                      <span className={`rounded-full px-3 py-1 text-sm ${badge.className}`}>
                        {badge.label}
                      </span>
                    );
                  })()}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
      </> : null}

      {section === "historial" ? <>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>Historial diario de ingresos y salidas</CardTitle>
              <CardDescription>Tabla sincronizada con garita y actualizacion cada 15 segundos.</CardDescription>
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              <input
                aria-label="Fecha del historial"
                type="date"
                value={historyDate}
                onChange={(event) => setHistoryDate(event.target.value)}
                className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
              />
              <select
                aria-label="Filtrar por estado"
                value={historyStatus}
                onChange={(event) => setHistoryStatus(event.target.value)}
                className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
              >
                <option value="TODOS">Todos</option>
                <option value="PENDIENTE">Pendientes</option>
                <option value="INGRESO">Ingresos</option>
                <option value="SALIDA">Salidas</option>
                <option value="CANCELADA">Canceladas</option>
                <option value="VENCIDA">Vencidas</option>
                <option value="RECHAZADA">Rechazadas</option>
                <option value="PENDIENTE_APROBACION">Por aprobar</option>
              </select>
              <input
                aria-label="Buscar visitante o casa"
                value={historySearch}
                onChange={(event) => setHistorySearch(event.target.value)}
                placeholder="Visitante o casa"
                className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full text-left">
              <thead className="bg-slate-50 text-xs uppercase tracking-[0.1em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">Visitante</th>
                  <th className="px-4 py-3">Casa</th>
                  <th className="px-4 py-3">Ingreso</th>
                  <th className="px-4 py-3">Salida</th>
                  <th className="px-4 py-3">Estado</th>
                </tr>
              </thead>
              <tbody>
                {historyError ? (
                  <tr>
                    <td colSpan={5} role="alert" className="bg-rose-50 px-4 py-6 text-sm text-rose-700">
                      {historyError}
                    </td>
                  </tr>
                ) : historyLoading && accessHistory.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-sm text-slate-500">Cargando historial...</td>
                  </tr>
                ) : accessHistory.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-sm text-slate-500">
                      Sin registros para los filtros actuales.
                    </td>
                  </tr>
                ) : (
                  accessHistory.map((record) => (
                    <tr key={record.id_acceso} className="border-t border-slate-100">
                      <td className="px-4 py-3 text-sm text-slate-900">
                        <p className="font-medium">{record.visitante}</p>
                        <p className="text-xs text-slate-500">{record.placa}</p>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-500">{record.casa}</td>
                      <td className="px-4 py-3 text-sm text-slate-500">
                        {record.hora_ingreso || record.hora_programada}
                        {record.guardia_ingreso ? <p className="text-xs text-slate-400">por {record.guardia_ingreso}</p> : null}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-500">
                        {record.hora_salida || "--:--"}
                        {record.guardia_salida ? <p className="text-xs text-slate-400">por {record.guardia_salida}</p> : null}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-medium ${
                            (historyStatusLabels[record.estado] ?? historyStatusLabels.PENDIENTE).className
                          }`}
                        >
                          {(historyStatusLabels[record.estado] ?? { label: record.estado }).label}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      </> : null}
    </AppShell>
  );
}
