import { useFeedbackState } from "@/hooks/useFeedbackState";
import { useEffect, useMemo, useState, type DependencyList, type ReactNode } from "react";
import { ArrowRight, Bell, CheckCheck, Clock3, UserRoundCheck, Wallet, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { notifySidebarCountersChanged, subscribeToSidebarCounters } from "@/components/layout/sidebarCounters";
import { useUnreadNotificationsCount } from "@/components/notifications/unreadNotifications";
import { Button } from "@/components/ui/button";
import {
  getNotificationsRequest,
  markAllNotificationsAsReadRequest,
  markNotificationAsReadRequest,
} from "@/services/notificationsService";
import type { NotificationRecord } from "@/types/notifications";
import type { VisitRecord } from "@/types/visits";
import { formatUtcTimestamp, guatemalaToday } from "@/utils/guatemalaTime";

// Piezas visuales compartidas por los dashboards de rol (residente, inquilino, guardia).

export type Loadable<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

/** Fecha calendario en America/Guatemala, independiente de la zona del navegador. */
export function localDate(offsetDays = 0) {
  return guatemalaToday(offsetDays);
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-GT", { style: "currency", currency: "GTQ" }).format(value);
}

export function formatDay(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-GT", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

/** Instantes del backend (creado_en de avisos y solicitudes) guardados en UTC, mostrados en Guatemala. */
export function formatDateTime(value: string) {
  return formatUtcTimestamp(value);
}

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export const visitStatusLabels: Record<NonNullable<VisitRecord["estado_acceso"]>, { label: string; className: string }> = {
  AUTORIZADA: { label: "Autorizada", className: "bg-blue-50 text-blue-700" },
  INGRESO_REGISTRADO: { label: "Ingresó", className: "bg-emerald-50 text-emerald-700" },
  SALIDA_REGISTRADA: { label: "Salida registrada", className: "bg-slate-100 text-slate-600" },
  CANCELADA: { label: "Cancelada", className: "bg-rose-50 text-rose-700" },
  PENDIENTE_APROBACION: { label: "Pendiente de aprobación", className: "bg-amber-50 text-amber-700" },
  RECHAZADA: { label: "Rechazada", className: "bg-rose-50 text-rose-700" },
};

export function isActiveVisit(visit: VisitRecord, today: string) {
  if (visit.estado_acceso === "AUTORIZADA") return visit.fecha >= today;
  if (visit.estado_acceso === "INGRESO_REGISTRADO") return visit.fecha === today;
  return false;
}

/** Carga un recurso y expone su estado loading/error/ready. */
export function useLoadable<T>(loader: () => Promise<T>, fallbackError: string, deps: DependencyList) {
  const [state, setState] = useState<Loadable<T>>({ status: "loading" });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    loader()
      .then((data) => {
        if (active) setState({ status: "ready", data });
      })
      .catch((error) => {
        if (active) setState({ status: "error", message: errorMessage(error, fallbackError) });
      });
    return () => {
      active = false;
    };
  }, deps);

  return [state, setState] as const;
}

type KpiTone = "blue" | "amber" | "emerald" | "violet" | "rose";

const toneClasses: Record<KpiTone, string> = {
  blue: "bg-blue-50 text-blue-600",
  amber: "bg-amber-50 text-amber-600",
  emerald: "bg-emerald-50 text-emerald-600",
  violet: "bg-violet-50 text-violet-600",
  rose: "bg-rose-50 text-rose-600",
};

type KpiCardProps = {
  label: string;
  icon: LucideIcon;
  to: string;
  linkLabel: string;
  state: Loadable<unknown>;
  value: string;
  helper: string;
  tone?: KpiTone;
};

export function KpiCard({ label, icon: Icon, to, linkLabel, state, value, helper, tone = "blue" }: KpiCardProps) {
  return (
    <Link
      to={to}
      aria-label={`${label}: ${linkLabel}`}
      className="group flex min-w-0 flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 transition hover:border-blue-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-slate-500 sm:text-sm">{label}</p>
        <span className={`shrink-0 rounded-xl p-2 ${toneClasses[tone]}`} aria-hidden="true">
          <Icon className="size-4 sm:size-5" />
        </span>
      </div>
      <div>
        {state.status === "loading" ? (
          <p className="h-8 w-24 animate-pulse rounded-md bg-slate-100" aria-label="Cargando" />
        ) : state.status === "error" ? (
          <>
            <p className="text-2xl font-semibold text-slate-400">—</p>
            <p className="mt-1 text-xs text-rose-600">No disponible</p>
          </>
        ) : (
          <>
            <p className="break-words text-xl font-semibold leading-tight tracking-tight text-slate-950 sm:text-[1.75rem]">{value}</p>
            <p className="mt-1 text-xs text-slate-500">{helper}</p>
          </>
        )}
      </div>
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 group-hover:text-blue-800">
        {linkLabel}
        <ArrowRight className="size-3.5" aria-hidden="true" />
      </span>
    </Link>
  );
}

export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">{children}</div>;
}

export function PanelGrid({ children }: { children: ReactNode }) {
  return <div className="grid items-start gap-6 lg:grid-cols-2">{children}</div>;
}

export function Panel({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  icon: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    // min-w-0: en grillas de una columna, textos con truncate no deben ensanchar el panel (overflow movil).
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-950">
          <Icon className="size-4 text-blue-600" aria-hidden="true" />
          {title}
        </h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function PanelLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:text-blue-800">
      {children}
      <ArrowRight className="size-3.5" aria-hidden="true" />
    </Link>
  );
}

export function PanelState({ state, empty }: { state: Loadable<unknown>; empty: string }) {
  if (state.status === "loading") return <p className="py-6 text-center text-sm text-slate-500">Cargando...</p>;
  if (state.status === "error") {
    return (
      <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
        {state.message}
      </p>
    );
  }
  return <p className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-sm text-slate-500">{empty}</p>;
}

/** Lista compacta de las visitas mas recientes del usuario. */
export function RecentVisitsPanel({ visits, to, empty }: { visits: Loadable<VisitRecord[]>; to: string; empty: string }) {
  const recentVisits = useMemo(
    () =>
      visits.status === "ready"
        ? [...visits.data]
            .sort((a, b) => `${b.fecha} ${b.hora_inicio}`.localeCompare(`${a.fecha} ${a.hora_inicio}`))
            .slice(0, 5)
        : [],
    [visits],
  );

  return (
    <Panel title="Visitas recientes" icon={UserRoundCheck} action={<PanelLink to={to}>Ver todas</PanelLink>}>
      {recentVisits.length > 0 ? (
        <ul className="divide-y divide-slate-100">
          {recentVisits.map((visit) => {
            const status = visit.estado_acceso ? visitStatusLabels[visit.estado_acceso] : null;
            return (
              <li key={visit.id_acceso} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{visit.nombre}</p>
                  <p className="text-xs text-slate-500">
                    {formatDay(visit.fecha)} · {visit.hora_inicio} – {visit.hora_fin}
                    {visit.placa ? ` · Placa ${visit.placa}` : ""}
                  </p>
                </div>
                {status ? (
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${status.className}`}>{status.label}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <PanelState state={visits} empty={empty} />
      )}
    </Panel>
  );
}

/** Estado y acciones del centro de avisos (notificaciones propias del usuario). */
export function useNotificationCenter() {
  const [notifications, setNotifications] = useState<Loadable<NotificationRecord[]>>({ status: "loading" });
  // Total real de no leidas (misma fuente que el badge del sidebar). El listado
  // solo trae las 20 notificaciones mas recientes y sirve como vista previa.
  const unreadTotal = useUnreadNotificationsCount();
  const [actionError, setActionError] = useFeedbackState("error", "");
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    let active = true;
    let generation = 0;
    const reload = () => {
      const request = ++generation;
      getNotificationsRequest()
        .then(data => { if (active && request === generation) setNotifications({ status: "ready", data }); })
        .catch(error => {
          if (active && request === generation) setNotifications(current => current.status === "ready" ? current
            : { status: "error", message: errorMessage(error, "No fue posible cargar las notificaciones.") });
        });
    };
    reload();
    const unsubscribe = subscribeToSidebarCounters(reload);
    return () => { active = false; unsubscribe(); };
  }, [setNotifications]);

  const unread = useMemo(
    () => (notifications.status === "ready" ? notifications.data.filter((item) => !item.leido) : []),
    [notifications],
  );

  function update(updater: (current: NotificationRecord[]) => NotificationRecord[]) {
    setNotifications((current) => (current.status === "ready" ? { status: "ready", data: updater(current.data) } : current));
  }

  async function markAsRead(notificationId: number) {
    try {
      setUpdating(true);
      setActionError("");
      const updated = await markNotificationAsReadRequest(notificationId);
      update((current) => current.map((item) => (item.id_notificacion === updated.id_notificacion ? updated : item)));
      notifySidebarCountersChanged();
    } catch (error) {
      setActionError(errorMessage(error, "No fue posible marcar la notificacion como leida."));
    } finally {
      setUpdating(false);
    }
  }

  async function markAllAsRead() {
    try {
      setUpdating(true);
      setActionError("");
      await markAllNotificationsAsReadRequest();
      update((current) => current.map((item) => ({ ...item, leido: true })));
      notifySidebarCountersChanged();
    } catch (error) {
      setActionError(errorMessage(error, "No fue posible marcar las notificaciones como leidas."));
    } finally {
      setUpdating(false);
    }
  }

  return { notifications, unread, unreadTotal, actionError, updating, markAsRead, markAllAsRead };
}

export function NotificationCenterPanel({
  center,
  to,
}: {
  center: ReturnType<typeof useNotificationCenter>;
  to: string;
}) {
  const { notifications, unread, unreadTotal, actionError, updating, markAsRead, markAllAsRead } = center;
  // El total solo proviene de GET /notificaciones/no-leidas; el listado (20 recientes)
  // nunca se usa como total. Sin conteo disponible no se muestra ninguna cifra.
  const pendingCount = unreadTotal.status === "ready" ? unreadTotal.data : null;
  const hasPending = pendingCount !== null ? pendingCount > 0 : unread.length > 0;

  return (
    <Panel
      title="Centro de avisos"
      icon={Bell}
      action={
        hasPending ? (
          <Button type="button" variant="outline" size="sm" disabled={updating} onClick={() => void markAllAsRead()}>
            <CheckCheck className="size-4" aria-hidden="true" />
            Marcar todas
          </Button>
        ) : (
          <PanelLink to={to}>Ver todos</PanelLink>
        )
      }
    >
      {actionError ? (
        <p role="alert" className="mb-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {actionError}
        </p>
      ) : null}
      {notifications.status === "ready" && notifications.data.length > 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            {pendingCount === null
              ? "Avisos más recientes."
              : pendingCount === 0
                ? "No tiene notificaciones pendientes."
                : `Tiene ${pendingCount} notificacion${pendingCount === 1 ? "" : "es"} pendiente${pendingCount === 1 ? "" : "s"}.`}
          </p>
          <ul className="space-y-2">
            {(unread.length > 0 ? unread : notifications.data).slice(0, 3).map((notification) => (
              <li
                key={notification.id_notificacion}
                className={`rounded-xl border px-3.5 py-3 ${notification.leido ? "border-slate-200" : "border-blue-100 bg-blue-50/60"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      {!notification.leido ? <span className="sr-only">Sin leer: </span> : null}
                      {notification.titulo}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">{notification.mensaje}</p>
                    <p className="mt-1.5 flex items-center gap-1 text-xs text-slate-400">
                      <Clock3 className="size-3" aria-hidden="true" />
                      {formatDateTime(notification.creado_en)}
                    </p>
                  </div>
                  {!notification.leido ? (
                    <button
                      type="button"
                      disabled={updating}
                      onClick={() => void markAsRead(notification.id_notificacion)}
                      className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                    >
                      Marcar como leida
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {hasPending ? <PanelLink to={to}>Ver todos los avisos</PanelLink> : null}
        </div>
      ) : (
        <PanelState state={notifications} empty="No tiene notificaciones." />
      )}
    </Panel>
  );
}

type QuotaSummary = {
  total_cuotas: number;
  cuotas_pagadas: number;
  cuotas_pendientes: number;
  cuotas_vencidas: number;
  total_pagado: number;
  proximo_vencimiento: string | null;
};

/** Distribucion de cuotas pagadas/pendientes/vencidas segun el resumen financiero real. */
export function QuotaStatusPanel({
  state,
  to,
  linkLabel,
}: {
  state: Loadable<QuotaSummary>;
  to: string;
  linkLabel: string;
}) {
  const summary = state.status === "ready" ? state.data : null;
  const quotaTotal = summary ? Math.max(summary.total_cuotas, 0) : 0;
  const quotaSegments = summary
    ? [
        { label: "Pagadas", value: summary.cuotas_pagadas, className: "bg-emerald-500" },
        { label: "Pendientes", value: summary.cuotas_pendientes, className: "bg-amber-400" },
        { label: "Vencidas", value: summary.cuotas_vencidas, className: "bg-rose-500" },
      ]
    : [];

  return (
    <Panel title="Estado de cuotas" icon={Wallet} action={<PanelLink to={to}>{linkLabel}</PanelLink>}>
      {summary ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm text-slate-500">
              {summary.cuotas_pagadas} de {quotaTotal} cuota{quotaTotal === 1 ? "" : "s"} pagada{quotaTotal === 1 ? "" : "s"}
            </p>
            <p className="text-sm text-slate-500">
              Total pagado: <span className="font-semibold text-slate-900">{formatCurrency(summary.total_pagado)}</span>
            </p>
          </div>
          {quotaTotal > 0 ? (
            <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={quotaSegments.map((s) => `${s.label}: ${s.value}`).join(", ")}>
              {quotaSegments.map((segment) =>
                segment.value > 0 ? (
                  <span key={segment.label} className={segment.className} style={{ width: `${(segment.value / quotaTotal) * 100}%` }} />
                ) : null,
              )}
            </div>
          ) : null}
          <dl className="grid grid-cols-3 gap-3">
            {quotaSegments.map((segment) => (
              <div key={segment.label} className="rounded-xl bg-slate-50 px-3 py-2.5">
                <dt className="flex items-center gap-1.5 text-xs text-slate-500">
                  <span className={`size-2 rounded-full ${segment.className}`} aria-hidden="true" />
                  {segment.label}
                </dt>
                <dd className="mt-1 text-lg font-semibold text-slate-950">{segment.value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-slate-500">
            {summary.proximo_vencimiento
              ? `Próximo vencimiento: ${formatDay(summary.proximo_vencimiento)}`
              : "No hay vencimientos próximos."}
          </p>
        </div>
      ) : (
        <PanelState state={state} empty="Sin información financiera." />
      )}
    </Panel>
  );
}

/** Texto auxiliar del KPI de saldo: cuotas vencidas o proximo vencimiento. */
export function balanceHelper(summary: { cuotas_vencidas: number; proximo_vencimiento: string | null }) {
  if (summary.cuotas_vencidas > 0) {
    return `${summary.cuotas_vencidas} cuota${summary.cuotas_vencidas === 1 ? "" : "s"} vencida${summary.cuotas_vencidas === 1 ? "" : "s"}`;
  }
  return summary.proximo_vencimiento ? `Próximo vencimiento: ${formatDay(summary.proximo_vencimiento)}` : "Sin mora activa";
}
