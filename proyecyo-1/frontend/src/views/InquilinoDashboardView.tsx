import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Bell, BriefcaseBusiness, ShieldCheck, UserRoundCheck, Wallet } from "lucide-react";

import {
  balanceHelper,
  formatCurrency,
  formatDateTime,
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
import { getTenantProvidersRequest } from "@/services/providersService";
import { getTenantAuthorizationRequestsRequest } from "@/services/sprintStoriesService";
import { getTenantAccountStatementRequest } from "@/services/tenantAccountService";
import { getVisitsRequest } from "@/services/visitsService";
import type { AuthorizationRequest } from "@/types/sprintStories";

const requestStatusStyles: Record<AuthorizationRequest["estado"], { label: string; className: string }> = {
  PENDIENTE: { label: "Pendiente", className: "bg-amber-50 text-amber-700" },
  APROBADO: { label: "Aprobado", className: "bg-emerald-50 text-emerald-700" },
  RECHAZADO: { label: "Rechazado", className: "bg-rose-50 text-rose-700" },
};

/** Resumen del inquilino: solo datos de APIs autorizadas a su rol. */
export function InquilinoDashboardView() {
  const [account] = useLoadable(
    () => getTenantAccountStatementRequest().then((response) => response.resumen),
    "No fue posible cargar el estado de cuenta.",
    [],
  );
  const [visits] = useLoadable(getVisitsRequest, "No fue posible cargar las visitas.", []);
  const [providers] = useLoadable(() => getTenantProvidersRequest(), "No fue posible cargar los proveedores.", []);
  const [requests] = useLoadable(getTenantAuthorizationRequestsRequest, "No fue posible cargar las solicitudes.", []);
  const notificationCenter = useNotificationCenter();

  const today = localDate();
  const activeVisits = useMemo(
    () => (visits.status === "ready" ? visits.data.filter((visit) => isActiveVisit(visit, today)) : []),
    [visits, today],
  );
  const activeProviders = providers.status === "ready" ? providers.data.filter((provider) => provider.activo) : [];
  const pendingValidation = providers.status === "ready"
    ? providers.data.filter((provider) => provider.estado === "PENDIENTE").length
    : 0;
  const summary = account.status === "ready" ? account.data : null;
  const { unreadTotal } = notificationCenter;
  const unreadCount = unreadTotal.status === "ready" ? unreadTotal.data : 0;
  const recentRequests = requests.status === "ready"
    ? [...requests.data].sort((a, b) => b.creado_en.localeCompare(a.creado_en)).slice(0, 4)
    : [];

  return (
    <AppShell role="inquilino" title="Dashboard" subtitle="Resumen de su unidad: saldo, visitas, proveedores y avisos."
      actions={
        // Neurolab (H2): la pre-autorización de visitas era difícil de encontrar; ahora es la acción principal del panel.
        <Link to="/inquilino/visitas" className="inline-flex h-11 items-center gap-2 rounded-xl bg-[var(--nd-accent)] px-4 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow">
          <UserRoundCheck className="size-4" aria-hidden="true" />Autorizar una visita
        </Link>
      }>
      <KpiGrid>
        <KpiCard
          label="Saldo pendiente"
          icon={Wallet}
          to="/inquilino/estado-cuenta"
          linkLabel="Ver estado de cuenta"
          state={account}
          value={summary ? formatCurrency(summary.saldo_pendiente) : ""}
          helper={summary ? balanceHelper(summary) : ""}
          tone={summary && summary.cuotas_vencidas > 0 ? "amber" : "blue"}
        />
        <KpiCard
          label="Visitas activas"
          icon={UserRoundCheck}
          to="/inquilino/visitas"
          linkLabel="Ver mis visitas"
          state={visits}
          value={String(activeVisits.length)}
          helper={`${activeVisits.filter((visit) => visit.fecha === today).length} para hoy`}
          tone="emerald"
        />
        <KpiCard
          label="Proveedores activos"
          icon={BriefcaseBusiness}
          to="/inquilino/proveedores"
          linkLabel="Ver proveedores"
          state={providers}
          value={String(activeProviders.length)}
          helper={pendingValidation > 0 ? `${pendingValidation} pendiente${pendingValidation === 1 ? "" : "s"} de validación` : "Sin validaciones pendientes"}
          tone="violet"
        />
        <KpiCard
          label="Avisos no leídos"
          icon={Bell}
          to="/inquilino/notificaciones"
          linkLabel="Ver avisos"
          state={unreadTotal}
          value={String(unreadCount)}
          helper={unreadCount === 0 ? "Todo al día" : "Pendientes de lectura"}
        />
      </KpiGrid>

      <PanelGrid>
        <QuotaStatusPanel state={account} to="/inquilino/estado-cuenta" linkLabel="Estado de cuenta" />

        <Panel title="Solicitudes de autorización" icon={ShieldCheck} action={<PanelLink to="/inquilino/permisos">Ver permisos</PanelLink>}>
          {recentRequests.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {recentRequests.map((request) => {
                const status = requestStatusStyles[request.estado] ?? { label: request.estado, className: "bg-slate-100 text-slate-600" };
                return (
                  <li key={request.id_solicitud} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{request.accion}</p>
                      <p className="text-xs text-slate-500">{formatDateTime(request.creado_en)}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${status.className}`}>{status.label}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <PanelState state={requests} empty="No ha enviado solicitudes de autorización." />
          )}
        </Panel>
      </PanelGrid>

      <PanelGrid>
        <RecentVisitsPanel visits={visits} to="/inquilino/visitas" empty="Aún no ha autorizado visitas." />
        <NotificationCenterPanel center={notificationCenter} to="/inquilino/notificaciones" />
      </PanelGrid>
    </AppShell>
  );
}
