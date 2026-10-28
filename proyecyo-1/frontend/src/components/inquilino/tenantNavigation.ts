import {
  BriefcaseBusiness,
  CalendarDays,
  LayoutDashboard,
  Megaphone,
  MonitorSmartphone,
  ShieldCheck,
  UserRoundCheck,
  Wallet,
} from "lucide-react";

import {
  findActiveNavItem,
  type RoleNavItem,
  type RoleNavSection,
} from "@/components/layout/roleNavigation";

export type TenantBadgeKey = "unreadNotifications";

// Solo modulos que el backend autoriza al rol inquilino (requireTenant /
// requireResidentOrTenant / requireNotificationUser). El historial de reservas es
// de consulta propia; crear/modificar reservas sigue reservado al residente/admin.
export const tenantNavSections: RoleNavSection<TenantBadgeKey>[] = [
  {
    title: "General",
    items: [{ label: "Dashboard", icon: LayoutDashboard, to: "/inquilino", end: true }],
  },
  {
    title: "Mi unidad",
    items: [
      { label: "Mis visitas", icon: UserRoundCheck, to: "/inquilino/visitas" },
      { label: "Mis reservas", icon: CalendarDays, to: "/inquilino/reservas" },
      { label: "Proveedores", icon: BriefcaseBusiness, to: "/inquilino/proveedores" },
      { label: "Permisos y solicitudes", icon: ShieldCheck, to: "/inquilino/permisos" },
    ],
  },
  {
    title: "Finanzas",
    items: [
      {
        label: "Estado de cuenta",
        icon: Wallet,
        to: "/inquilino/estado-cuenta",
        matches: ["/inquilino/historial-financiero"],
      },
    ],
  },
  {
    title: "Comunidad",
    items: [
      {
        label: "Comunicados y avisos",
        icon: Megaphone,
        to: "/inquilino/notificaciones",
        matches: ["/inquilino/comunicados"],
        badge: "unreadNotifications",
      },
    ],
  },
];

export const tenantSessionsItem: RoleNavItem<TenantBadgeKey> = {
  label: "Sesiones activas",
  icon: MonitorSmartphone,
  to: "/inquilino/sesiones",
  matches: ["/cuenta/sesiones"],
};

export function findActiveTenantNavItem(pathname: string) {
  return findActiveNavItem(tenantNavSections, [tenantSessionsItem], pathname);
}
