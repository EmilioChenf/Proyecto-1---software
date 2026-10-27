import { useEffect, useMemo, useState } from "react";
import { Bell, Check, CheckCheck, Clock3 } from "lucide-react";
import { Link } from "react-router-dom";
import { notificationAction } from "@/components/notifications/notificationActions";
import { subscribeToSidebarCounters } from "@/components/layout/sidebarCounters";

import { AppShell } from "@/components/layout/AppShell";
import { notifyResidentBadgesChanged } from "@/components/residente/residentBadges";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getNotificationsPageRequest,
  getUnreadNotificationsRequest,
  markAllNotificationsAsReadRequest,
  markNotificationAsReadRequest,
} from "@/services/notificationsService";
import type { NotificationPageFilter, NotificationRecord } from "@/types/notifications";
import { formatUtcTimestamp } from "@/utils/guatemalaTime";

export type NotificationFilter = NotificationPageFilter;

const filterOptions: { value: NotificationFilter; label: string }[] = [
  { value: "TODOS", label: "Todos" },
  { value: "SIN_LEER", label: "Sin leer" },
  { value: "COMUNICADOS", label: "Comunicados" },
  { value: "OTROS", label: "Otros avisos" },
];

const typeLabels: Record<string, string> = {
  COMUNICADO: "Comunicado",
  LLEGADA_VISITA: "Visita",
  ACCESO_CANCELADO: "Acceso",
  ACCESO_ESPECIAL: "Acceso especial",
  SOLICITUD_AUTORIZACION: "Autorización",
  RECORDATORIO_RESERVA: "Reserva",
  RESERVA_CANCELADA: "Reserva cancelada",
  RECORDATORIO_PAGO: "Cuota",
  CUOTA_PROXIMA: "Cuota próxima",
  CUOTA_HOY: "Vence hoy",
  CUOTA_VENCIDA: "Cuota vencida",
  PAGO_CONFIRMADO: "Pago confirmado",
  PAGO_NO_COMPLETADO: "Pago no completado",
  PAGO_CANCELADO: "Intento cancelado",
  REEMBOLSO_CONFIRMADO: "Reembolso",
};

// Orden del backend: creado_en DESC, id DESC.
function compareNotifications(a: NotificationRecord, b: NotificationRecord) {
  if (a.creado_en !== b.creado_en) return a.creado_en < b.creado_en ? 1 : -1;
  return b.id_notificacion - a.id_notificacion;
}

/** Incorpora la primera pagina fresca sin perder lo ya cargado con "Ver mas". */
function mergeFreshPage(current: NotificationRecord[], fresh: NotificationRecord[]) {
  const byId = new Map(current.map((item) => [item.id_notificacion, item]));
  for (const item of fresh) byId.set(item.id_notificacion, item);
  return [...byId.values()].sort(compareNotifications);
}

function matchesFilter(notification: NotificationRecord, filter: NotificationFilter) {
  if (filter === "SIN_LEER") return !notification.leido;
  if (filter === "COMUNICADOS") return notification.tipo === "COMUNICADO";
  if (filter === "OTROS") return notification.tipo !== "COMUNICADO";
  return true;
}

// creado_en de NOTIFICACION es un instante UTC (CURRENT_TIMESTAMP).
function formatDate(value: string) {
  return formatUtcTimestamp(value);
}

type NotificationsViewProps = {
  initialFilter?: NotificationFilter;
  /** Rol cuyo layout envuelve la vista; ambos consultan solo sus propias notificaciones. */
  role?: "residente" | "inquilino";
};

export function ResidentNotificationsView({ initialFilter = "TODOS", role = "residente" }: NotificationsViewProps) {
  const [filter, setFilter] = useState<NotificationFilter>(initialFilter);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [updatingId, setUpdatingId] = useState<number | "all" | null>(null);
  const [error, setError] = useState("");

  // Primera pagina del filtro activo (los filtros se aplican en el backend) y
  // total real de no leidas. Las recargas por evento/foco fusionan la pagina
  // fresca para no perder los avisos ya cargados con "Ver mas".
  useEffect(() => {
    let active = true;
    let generation = 0;
    let firstLoad = true;
    setLoading(true);
    setNotifications([]);
    setNextCursor(null);
    function load() {
      const request = ++generation;
      const isFirst = firstLoad;
      firstLoad = false;
      Promise.all([getNotificationsPageRequest({ filtro: filter }), getUnreadNotificationsRequest()])
      .then(([page, counter]) => {
        if (!active || request !== generation) return;
        if (isFirst) {
          setNotifications(page.items);
          setNextCursor(page.next_cursor);
        } else {
          setNotifications((current) => mergeFreshPage(current, page.items));
          setNextCursor((current) => current ?? page.next_cursor);
        }
        setUnread(counter.unread);
        setError("");
      })
      .catch((reason) => {
        if (active && request === generation) setError(reason instanceof Error ? reason.message : "No fue posible cargar las notificaciones.");
      })
      .finally(() => {
        if (active && request === generation) setLoading(false);
      });
    }
    load();
    const unsubscribe = subscribeToSidebarCounters(load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [filter]);

  async function loadMore() {
    if (!nextCursor) return;
    try {
      setLoadingMore(true);
      setError("");
      const page = await getNotificationsPageRequest({ filtro: filter, cursor: nextCursor });
      setNotifications((current) => mergeFreshPage(current, page.items));
      setNextCursor(page.next_cursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible cargar mas avisos.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function markAsRead(notification: NotificationRecord) {
    if (notification.leido) return;
    try {
      setUpdatingId(notification.id_notificacion);
      setError("");
      const updated = await markNotificationAsReadRequest(notification.id_notificacion);
      setNotifications((current) => current.map((item) => (
        item.id_notificacion === updated.id_notificacion ? updated : item
      )));
      notifyResidentBadgesChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible actualizar la notificacion.");
    } finally {
      setUpdatingId(null);
    }
  }

  async function markAllAsRead() {
    try {
      setUpdatingId("all");
      setError("");
      await markAllNotificationsAsReadRequest();
      setNotifications((current) => current.map((item) => ({ ...item, leido: true })));
      notifyResidentBadgesChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible actualizar las notificaciones.");
    } finally {
      setUpdatingId(null);
    }
  }

  useEffect(() => {
    setFilter(initialFilter);
  }, [initialFilter]);

  const visibleNotifications = useMemo(
    () => notifications.filter((notification) => matchesFilter(notification, filter)),
    [notifications, filter],
  );

  return (
    <AppShell
      role={role}
      title="Comunicados y avisos"
      subtitle="Comunicados de la administración y avisos de su unidad."
      actions={
        <Button type="button" variant="outline" disabled={unread === 0 || updatingId !== null} onClick={() => void markAllAsRead()}>
          <CheckCheck className="size-4" />
          Marcar todas como leidas
        </Button>
      }
    >

      <Card className="border-slate-200">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><Bell className="size-5 text-blue-700" /> Notificaciones</CardTitle>
            <CardDescription>Solo se muestran avisos asociados a su cuenta.</CardDescription>
          </div>
          {!loading ? (
            <span className="self-start rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700 sm:self-auto" aria-label={`${unread} pendientes`}>
              {unread} pendiente{unread === 1 ? "" : "s"}
            </span>
          ) : null}
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filtrar avisos">
            {filterOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={filter === option.value}
                onClick={() => setFilter(option.value)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  filter === option.value ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {error ? <Alert variant="destructive" className="mb-4"><AlertTitle>Error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
          {loading ? <p className="py-8 text-center text-sm text-slate-500">Cargando notificaciones...</p> : null}
          {!loading && !error && filter === "TODOS" && notifications.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 py-10 text-center">
              <Check className="mx-auto size-8 text-emerald-600" />
              <p className="mt-3 font-semibold text-slate-900">No tienes notificaciones</p>
              <p className="mt-1 text-sm text-slate-500">Los nuevos avisos apareceran en este espacio.</p>
            </div>
          ) : null}
          {!loading && !error && (filter !== "TODOS" || notifications.length > 0) && visibleNotifications.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500">
              No hay avisos para el filtro seleccionado.
            </p>
          ) : null}
          <div className="space-y-3">
            {visibleNotifications.map((notification) => (
              <article
                key={notification.id_notificacion}
                className={`rounded-2xl border p-4 ${notification.leido ? "border-slate-200 bg-white" : "border-blue-200 bg-blue-50/70"}`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      {!notification.leido ? <span className="size-2 rounded-full bg-blue-600" aria-label="Sin leer" /> : null}
                      <h2 className="font-semibold text-slate-950">{notification.titulo}</h2>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        {typeLabels[notification.tipo] ?? "Aviso"}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-700">{notification.mensaje}</p>
                    {notificationAction(notification, role) ? (
                      <Link className="mt-2 inline-block text-sm font-semibold text-blue-700 underline" to={notificationAction(notification, role)!.to}>
                        {notificationAction(notification, role)!.label}
                      </Link>
                    ) : null}
                    <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500"><Clock3 className="size-3.5" /> {formatDate(notification.creado_en)}</p>
                  </div>
                  {!notification.leido ? (
                    <Button type="button" variant="outline" disabled={updatingId !== null} onClick={() => void markAsRead(notification)}>
                      <Check className="size-4" />
                      {updatingId === notification.id_notificacion ? "Actualizando..." : "Marcar como leida"}
                    </Button>
                  ) : <span className="text-xs font-semibold text-emerald-700">Leida</span>}
                </div>
              </article>
            ))}
          </div>
          {!loading && nextCursor ? (
            <div className="mt-4 flex justify-center">
              <Button type="button" variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? "Cargando..." : "Ver más avisos"}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </AppShell>
  );
}
