import { useEffect, useMemo, useState } from "react";
import { Bell, BriefcaseBusiness, CalendarDays, UserRoundCheck, Wallet } from "lucide-react";
import { Link } from "react-router-dom";

import {
  balanceHelper,
  formatCurrency,
  formatDay,
  isActiveVisit,
  KpiCard,
  KpiGrid,
  localDate,
  NotificationCenterPanel,
  Panel,
  PanelGrid,
  PanelLink,
  PanelState,
  QuotaStatusPanel,
  RecentVisitsPanel,
  useLoadable,
  useNotificationCenter,
} from "@/components/dashboard/dashboardWidgets";
import { AppShell } from "@/components/layout/AppShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuth } from "@/hooks/useAuth";
import { getResidentAccountStatementRequest } from "@/services/accountService";
import { getAmenitiesReservationsRequest } from "@/services/amenitiesService";
import { getOwnerProvidersRequest } from "@/services/providersService";
import { getVisitsRequest } from "@/services/visitsService";
import type { AmenityReservation } from "@/types/amenities";
import type { AdminProviderRecord } from "@/types/providers";

const ACTIVE_RESERVATION_STATES: AmenityReservation["estado_actual"][] = ["PENDIENTE", "CONFIRMADA", "EN_CURSO"];

const reservationStatusLabels: Record<AmenityReservation["estado_actual"], string> = {
  PENDIENTE: "Pendiente",
  CONFIRMADA: "Confirmada",
  EN_CURSO: "En curso",
  FINALIZADA: "Finalizada",
  CANCELADA: "Cancelada",
};

export function ResidenteView() {
  const { user } = useAuth();
  const [account] = useLoadable(
    () => getResidentAccountStatementRequest().then((response) => response.resumen),
    "No fue posible cargar el estado de cuenta.",
    [],
  );
  const [visits] = useLoadable(getVisitsRequest, "No fue posible cargar las visitas.", []);
  const [reservations] = useLoadable(
    () => getAmenitiesReservationsRequest({ from: localDate(), to: localDate(30), id_usuario: user?.id }),
    "No fue posible cargar las reservas.",
    [user?.id],
  );
  const notificationCenter = useNotificationCenter();
  const [providers, setProviders] = useState<AdminProviderRecord[]>([]);

  useEffect(() => {
    let active = true;
    getOwnerProvidersRequest({ status: "PENDIENTE" })
      .then((response) => {
        if (active) setProviders(response);
      })
      .catch(() => {
        // Fallback deliberado: el aviso de proveedores pendientes es secundario y el
        // badge del sidebar y la vista Proveedores muestran su propio estado/error.
        if (active) setProviders([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const today = localDate();
  const activeVisits = useMemo(
    () => (visits.status === "ready" ? visits.data.filter((visit) => isActiveVisit(visit, today)) : []),
    [visits, today],
  );
  const activeReservations = useMemo(
    () =>
      reservations.status === "ready"
        ? reservations.data
            .filter((reservation) => ACTIVE_RESERVATION_STATES.includes(reservation.estado_actual))
            .sort((a, b) => `${a.fecha} ${a.hora_inicio}`.localeCompare(`${b.fecha} ${b.hora_inicio}`))
        : [],
    [reservations],
  );
  const pendingProviders = providers.filter((provider) => provider.estado === "PENDIENTE");
  const summary = account.status === "ready" ? account.data : null;
  const { unreadTotal } = notificationCenter;
  const unreadCount = unreadTotal.status === "ready" ? unreadTotal.data : 0;

  return (
    <AppShell
      role="residente"
      title="Dashboard"
      subtitle="Resumen de su unidad: saldo, visitas, reservas y avisos."
      actions={
        // Neurolab (H2): la pre-autorización de visitas era difícil de encontrar; ahora es la acción principal del panel.
        <Link to="/residente/visitas" className="inline-flex h-11 items-center gap-2 rounded-xl bg-[var(--nd-accent)] px-4 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow">
          <UserRoundCheck className="size-4" aria-hidden="true" />Autorizar una visita
        </Link>
      }
    >
      {pendingProviders.length > 0 ? (
        <Alert className="border-amber-200 bg-amber-50 text-amber-900">
          <BriefcaseBusiness className="size-4" />
          <AlertTitle>
            {pendingProviders.length} proveedor{pendingProviders.length === 1 ? "" : "es"} pendiente
            {pendingProviders.length === 1 ? "" : "s"} de validación
          </AlertTitle>
          <AlertDescription className="text-amber-800">
            <p>Registrados por inquilinos de su unidad.</p>
            <Link to="/residente/proveedores" className="font-semibold underline underline-offset-2 hover:text-amber-950">
              Revisar proveedores
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <KpiGrid>
        <KpiCard
          label="Saldo pendiente"
          icon={Wallet}
          to="/residente/pagos"
          linkLabel="Ir a mis pagos"
          state={account}
          value={summary ? formatCurrency(summary.saldo_pendiente) : ""}
          helper={summary ? balanceHelper(summary) : ""}
          tone={summary && summary.cuotas_vencidas > 0 ? "amber" : "blue"}
        />
        <KpiCard
          label="Visitas activas"
          icon={UserRoundCheck}
          to="/residente/visitas"
          linkLabel="Ver mis visitas"
          state={visits}
          value={String(activeVisits.length)}
          helper={`${activeVisits.filter((visit) => visit.fecha === today).length} para hoy`}
          tone="emerald"
        />
        <KpiCard
          label="Reservas activas"
          icon={CalendarDays}
          to="/residente/amenidades"
          linkLabel="Ver amenidades"
          state={reservations}
          value={String(activeReservations.length)}
          helper="Próximos 30 días"
          tone="violet"
        />
        <KpiCard
          label="Avisos no leídos"
          icon={Bell}
          to="/residente/notificaciones"
          linkLabel="Ver avisos"
          state={unreadTotal}
          value={String(unreadCount)}
          helper={unreadCount === 0 ? "Todo al día" : "Pendientes de lectura"}
        />
      </KpiGrid>

      <PanelGrid>
        <QuotaStatusPanel state={account} to="/residente/pagos" linkLabel="Mis pagos" />

        <Panel title="Próximas reservas" icon={CalendarDays} action={<PanelLink to="/residente/amenidades">Reservar</PanelLink>}>
          {activeReservations.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {activeReservations.slice(0, 4).map((reservation) => (
                <li key={reservation.reservation_key} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{reservation.amenidad_nombre}</p>
                    <p className="text-xs text-slate-500">
                      {formatDay(reservation.fecha)} · {reservation.hora_inicio} – {reservation.hora_fin}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700">
                    {reservationStatusLabels[reservation.estado_actual]}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <PanelState state={reservations} empty="No tiene reservas activas en los próximos 30 días." />
          )}
        </Panel>
      </PanelGrid>

      <PanelGrid>
        <RecentVisitsPanel visits={visits} to="/residente/visitas" empty="Aún no ha autorizado visitas." />
        <NotificationCenterPanel center={notificationCenter} to="/residente/notificaciones" />
      </PanelGrid>
    </AppShell>
  );
}
