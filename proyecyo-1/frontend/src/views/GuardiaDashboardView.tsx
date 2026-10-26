import { useMemo } from "react";
import { BellRing, Clock3, DoorOpen, History, LogIn, ScanLine, UserRoundCheck } from "lucide-react";
import { Link } from "react-router-dom";

import {
  KpiCard,
  KpiGrid,
  Panel,
  PanelGrid,
  PanelLink,
  PanelState,
  useLoadable,
} from "@/components/dashboard/dashboardWidgets";
import { AppShell } from "@/components/layout/AppShell";
import { getGuardNotificationsRequest } from "@/services/notificationsService";
import { getGuardAccessHistoryRequest } from "@/services/sprintStoriesService";
import type { GuardAccessHistoryRecord } from "@/types/sprintStories";
import { formatUtcTimestamp, guatemalaToday } from "@/utils/guatemalaTime";

const movementLabels: Record<GuardAccessHistoryRecord["estado"], { label: string; className: string }> = {
  PENDIENTE: { label: "Pendiente", className: "bg-amber-50 text-amber-700" },
  INGRESO: { label: "Ingresó", className: "bg-emerald-50 text-emerald-700" },
  SALIDA: { label: "Salida", className: "bg-blue-50 text-blue-700" },
  VENCIDA: { label: "Vencida", className: "bg-slate-100 text-slate-600" },
  CANCELADA: { label: "Cancelada", className: "bg-rose-50 text-rose-700" },
  RECHAZADA: { label: "Rechazada", className: "bg-rose-50 text-rose-700" },
  PENDIENTE_APROBACION: { label: "Por aprobar", className: "bg-violet-50 text-violet-700" },
};

// Solo cuentan los accesos autorizados (pendientes, dentro o con salida);
// cancelados, rechazados y por aprobar no forman parte de la operacion del dia.
const AUTHORIZED_FLOW: GuardAccessHistoryRecord["estado"][] = ["PENDIENTE", "INGRESO", "SALIDA"];

// El backend devuelve hora_ingreso/hora_salida ya convertidas a hora de Guatemala ("HH:mm").
function lastMovement(record: GuardAccessHistoryRecord) {
  return record.hora_salida ?? record.hora_ingreso ?? "";
}

/** Dashboard operativo de garita: indicadores del dia a partir del historial real. */
export function GuardiaDashboardView() {
  const today = guatemalaToday();
  const [history] = useLoadable(
    () => getGuardAccessHistoryRequest({ date: today }),
    "No fue posible cargar los accesos del día.",
    [today],
  );
  const [alerts] = useLoadable(getGuardNotificationsRequest, "No fue posible cargar las alertas.", []);

  const records = history.status === "ready" ? history.data : [];
  const scheduled = records.filter((record) => AUTHORIZED_FLOW.includes(record.estado));
  const pending = useMemo(
    () =>
      records
        .filter((record) => record.estado === "PENDIENTE")
        .sort((a, b) => a.hora_programada.localeCompare(b.hora_programada)),
    [records],
  );
  const inside = records.filter((record) => Boolean(record.hora_ingreso) && !record.hora_salida);
  const exits = records.filter((record) => Boolean(record.hora_salida));
  const movements = useMemo(
    () =>
      records
        .filter((record) => Boolean(record.hora_ingreso || record.hora_salida))
        .sort((a, b) => lastMovement(b).localeCompare(lastMovement(a)))
        .slice(0, 5),
    [records],
  );
  const unreadAlerts = alerts.status === "ready" ? alerts.data.filter((alert) => !alert.leido) : [];

  return (
    <AppShell
      role="guardia"
      title="Dashboard"
      subtitle="Operación de garita del día: accesos programados, ingresos, salidas y alertas."
      actions={
        <Link
          to="/guardia/control"
          className="inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-medium text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        >
          <ScanLine className="size-4" aria-hidden="true" />
          Escanear QR
        </Link>
      }
    >
      <KpiGrid>
        <KpiCard
          label="Accesos de hoy"
          icon={UserRoundCheck}
          to="/guardia/historial"
          linkLabel="Ver historial"
          state={history}
          value={String(scheduled.length)}
          helper="Programados para hoy"
        />
        <KpiCard
          label="Pendientes de ingreso"
          icon={Clock3}
          to="/guardia/visitas"
          linkLabel="Ver visitas recientes"
          state={history}
          value={String(pending.length)}
          helper={pending.length === 0 ? "Sin ingresos pendientes" : "Por llegar a garita"}
          tone="amber"
        />
        <KpiCard
          label="Dentro ahora"
          icon={DoorOpen}
          to="/guardia/visitas"
          linkLabel="Registrar salidas"
          state={history}
          value={String(inside.length)}
          helper={`${exits.length} salida${exits.length === 1 ? "" : "s"} registrada${exits.length === 1 ? "" : "s"}`}
          tone="emerald"
        />
        <KpiCard
          label="Alertas sin leer"
          icon={BellRing}
          to="/guardia/alertas"
          linkLabel="Ver alertas"
          state={alerts}
          value={String(unreadAlerts.length)}
          helper={unreadAlerts.length === 0 ? "Todo al día" : "Revisar cancelaciones"}
          tone="rose"
        />
      </KpiGrid>

      <PanelGrid>
        <Panel title="Próximos ingresos" icon={LogIn} action={<PanelLink to="/guardia/control">Control de acceso</PanelLink>}>
          {pending.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {pending.slice(0, 5).map((record) => (
                <li key={record.id_acceso} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{record.visitante}</p>
                    <p className="text-xs text-slate-500">
                      Unidad {record.casa} · {record.hora_programada}
                      {record.placa ? ` · Placa ${record.placa}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{record.tipo_visita}</span>
                </li>
              ))}
            </ul>
          ) : (
            <PanelState state={history} empty="No hay ingresos pendientes para hoy." />
          )}
        </Panel>

        <Panel title="Movimientos recientes" icon={History} action={<PanelLink to="/guardia/historial">Ver historial</PanelLink>}>
          {movements.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {movements.map((record) => {
                const status = movementLabels[record.estado];
                return (
                  <li key={record.id_acceso} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{record.visitante}</p>
                      <p className="text-xs text-slate-500">
                        Unidad {record.casa} · {lastMovement(record)}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${status.className}`}>{status.label}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <PanelState state={history} empty="Aún no hay ingresos ni salidas registrados hoy." />
          )}
        </Panel>
      </PanelGrid>

      <Panel title="Alertas recientes" icon={BellRing} action={<PanelLink to="/guardia/alertas">Ver alertas</PanelLink>}>
        {unreadAlerts.length > 0 ? (
          <ul className="space-y-2">
            {unreadAlerts.slice(0, 3).map((alert) => (
              <li key={alert.id_notificacion} className="rounded-xl border border-rose-100 bg-rose-50/60 px-3.5 py-3">
                <p className="text-sm font-semibold text-slate-900">{alert.titulo}</p>
                <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">{alert.mensaje}</p>
                <p className="mt-1.5 text-xs text-slate-400">{formatUtcTimestamp(alert.creado_en)}</p>
              </li>
            ))}
          </ul>
        ) : (
          <PanelState state={alerts} empty="No hay alertas sin leer." />
        )}
      </Panel>
    </AppShell>
  );
}
