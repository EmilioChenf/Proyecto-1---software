import {
  BarChart3,
  BookOpen,
  BriefcaseBusiness,
  CalendarDays,
  KeyRound,
  LayoutDashboard,
  Megaphone,
  MonitorSmartphone,
  ReceiptText,
  UserRoundCheck,
  Wallet,
} from "lucide-react";

import {
  findActiveNavItem,
  type RoleNavItem,
  type RoleNavSection,
} from "@/components/layout/roleNavigation";

export type ResidentBadgeKey = "unreadNotifications" | "pendingProviders" | "pendingTenantRequests";

export type ResidentNavItem = RoleNavItem<ResidentBadgeKey>;
export type ResidentNavSection = RoleNavSection<ResidentBadgeKey>;

// Solo modulos con soporte real en el backend para el rol residente.
export const residentNavSections: ResidentNavSection[] = [
  {
    title: "General",
    items: [{ label: "Dashboard", icon: LayoutDashboard, to: "/residente", end: true }],
  },
  {
    title: "Mi unidad",
    items: [
      { label: "Mis visitas", icon: UserRoundCheck, to: "/residente/visitas" },
      { label: "Accesos y reservas", icon: KeyRound, to: "/residente/unificado", badge: "pendingTenantRequests" },
      { label: "Amenidades", icon: CalendarDays, to: "/residente/amenidades" },
      {
        label: "Proveedores",
        icon: BriefcaseBusiness,
        to: "/residente/proveedores",
        badge: "pendingProviders",
      },
      { label: "Resumen mensual", icon: BarChart3, to: "/residente/resumen-mensual" },
      { label: "Mi actividad", icon: CalendarDays, to: "/residente/actividad" },
    ],
  },
  {
    title: "Finanzas",
    items: [
      {
        label: "Mis pagos",
        icon: Wallet,
        to: "/residente/pagos",
        matches: ["/residente/estado-cuenta"],
      },
      { label: "Cargos y pagos", icon: ReceiptText, to: "/residente/detalle-financiero" },
    ],
  },
  {
    title: "Comunidad",
    items: [
      {
        label: "Comunicados y avisos",
        icon: Megaphone,
        to: "/residente/notificaciones",
        matches: ["/residente/comunicados"],
        badge: "unreadNotifications",
      },
      { label: "Reglamentos", icon: BookOpen, to: "/residente/reglamentos" },
    ],
  },
];

export const residentSessionsItem: ResidentNavItem = {
  label: "Sesiones activas",
  icon: MonitorSmartphone,
  to: "/residente/sesiones",
  matches: ["/cuenta/sesiones"],
};

export function findActiveResidentNavItem(pathname: string) {
  return findActiveNavItem(residentNavSections, [residentSessionsItem], pathname);
}
