import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  BellRing,
  FileText,
  Home,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  Settings,
  ShieldAlert,
  UserCheck,
  Wallet,
  BriefcaseBusiness,
  MessageSquareText,
  MonitorSmartphone,
  Building2,
  Users,
  X,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";

import { BrandIcon } from "@/components/layout/BrandIcon";
import { cn } from "@/components/ui/utils";
import { useAuth } from "@/hooks/useAuth";

import "./adminTheme.css";

type AdminLayoutProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  actions?: ReactNode;
};

type AdminMenuItem = {
  label: string;
  icon: typeof LayoutDashboard;
  to: string;
  end?: boolean;
};

const adminMenuItems: AdminMenuItem[] = [
  { label: "Finanzas", icon: Wallet, to: "/admin/finanzas" },
  {
    label: "Dashboard",
    icon: LayoutDashboard,
    to: "/admin",
    end: true,
  },
  {
    label: "Usuarios",
    icon: Users,
    to: "/admin/usuarios",
  },
  {
    label: "Viviendas",
    icon: Building2,
    to: "/admin/viviendas",
  },
  {
    label: "Accesos",
    icon: KeyRound,
    to: "/admin/accesos",
  },
  {
    label: "Usuarios autorizados",
    icon: UserCheck,
    to: "/admin/usuarios-autorizados",
  },
  {
    label: "Proveedores",
    icon: BriefcaseBusiness,
    to: "/admin/proveedores",
  },
  {
    label: "Accesos especiales",
    icon: ShieldAlert,
    to: "/admin/accesos-especiales",
  },
  {
    label: "Comunicados",
    icon: Megaphone,
    to: "/admin/comunicados",
  },
  {
    label: "Pagos",
    icon: Wallet,
    to: "/admin/pagos",
    end: true,
  },
  { label: "Reembolsos de pagos", icon: Wallet, to: "/admin/pagos/reembolsos" },
  { label: "Conciliación de pagos", icon: Wallet, to: "/admin/pagos/conciliacion" },
  {
    label: "Recordatorios",
    icon: BellRing,
    to: "/admin/recordatorios",
  },
  {
    label: "Sanciones",
    icon: ShieldAlert,
    to: "/admin/sanciones",
  },
  {
    label: "Historial sanciones",
    icon: FileText,
    to: "/admin/sanciones/historial-completo",
  },
  {
    label: "Amenidades",
    icon: Home,
    to: "/admin/amenidades",
  },
  {
    label: "Reportes",
    icon: FileText,
    to: "/admin/reportes",
  },
  {
    label: "Reporte financiero",
    icon: Wallet,
    to: "/admin/reportes-financieros",
  },
  {
    label: "Configuraci\u00f3n",
    icon: Settings,
    to: "/admin/configuracion",
  },
  {
    label: "Auditor\u00eda",
    icon: ShieldAlert,
    to: "/admin/auditoria",
  },
  {
    label: "Solicitudes demo",
    icon: MessageSquareText,
    to: "/admin/solicitudes-demo",
  },
];


// Diseño "Dashboard · Administrador": la navegación se agrupa por área. Los grupos se
// derivan de las rutas para no duplicar la lista de módulos de arriba.
const menuGroupByPath: Record<string, string> = {
  "/admin": "General",
  "/admin/reportes": "General",
  "/admin/reportes-financieros": "General",
  "/admin/usuarios": "Comunidad",
  "/admin/viviendas": "Comunidad",
  "/admin/usuarios-autorizados": "Comunidad",
  "/admin/proveedores": "Comunidad",
  "/admin/amenidades": "Comunidad",
  "/admin/accesos": "Seguridad",
  "/admin/accesos-especiales": "Seguridad",
  "/admin/auditoria": "Seguridad",
  "/admin/pagos": "Finanzas",
  "/admin/pagos/reembolsos": "Finanzas",
  "/admin/pagos/conciliacion": "Finanzas",
  "/admin/comunicados": "Convivencia",
  "/admin/recordatorios": "Convivencia",
  "/admin/sanciones": "Convivencia",
  "/admin/sanciones/historial-completo": "Convivencia",
  "/admin/configuracion": "Sistema",
  "/admin/solicitudes-demo": "Sistema",
};

const menuGroupOrder = ["General", "Comunidad", "Seguridad", "Finanzas", "Convivencia", "Sistema", "Otros"];

// Trazos de los iconos del diseño (viewBox 24x24, stroke).
const menuIconByPath: Record<string, string> = {
  "/admin": "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  "/admin/reportes": "M4 20V11M10 20V5M16 20v-8M21 20H3",
  "/admin/reportes-financieros": "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .9-3 2s1.3 1.6 3 2 3 .9 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6.5v11",
  "/admin/usuarios": "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6",
  "/admin/viviendas": "M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6",
  "/admin/usuarios-autorizados": "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 9-5.2M15 18l2 2 4-4",
  "/admin/proveedores": "M2 7h11v9H2zM13 10h4l4 4v2h-8zM6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  "/admin/amenidades": "M12 3l4 7h-3l4 6H7l4-6H8zM12 16v5",
  "/admin/accesos": "M8 21a5 5 0 1 1 4.6-7L21 5.6M17 9.5l2.5 2.5M14.5 12l2 2",
  "/admin/accesos-especiales": "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4",
  "/admin/auditoria": "M9 3h6l1 2h3v16H5V5h3zM9 3v3h6V3M9 12h6M9 16h4",
  "/admin/pagos": "M3 6h18v12H3zM3 10h18M7 15h4",
  "/admin/pagos/reembolsos": "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5",
  "/admin/pagos/conciliacion": "M5 5h14v16H5zM8 3v4M16 3v4M5 10h14M9 15l2 2 4-4",
  "/admin/comunicados": "M3 11l15-6v14L3 13zM7 12.5V17a2 2 0 0 0 4 0v-2.8",
  "/admin/recordatorios": "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0",
  "/admin/sanciones": "M12 3l10 18H2zM12 10v4M12 17v.01",
  "/admin/sanciones/historial-completo": "M12 7v5l3 3M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5",
  "/admin/configuracion": "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4",
  "/admin/solicitudes-demo": "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM8 9h8M8 13h5",
};

const menuGroups = menuGroupOrder
  .map((group) => ({
    group,
    items: adminMenuItems.filter((item) => (menuGroupByPath[item.to] ?? "Otros") === group),
  }))
  .filter(({ items }) => items.length > 0);

const SIDEBAR_STORAGE_KEY = "nr-admin-sidebar-collapsed";

function readCollapsed() {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function getInitials(email: string | undefined) {
  if (!email) {
    return "AD";
  }

  const [namePart] = email.split("@");
  return (namePart.slice(0, 2) || "ad").toUpperCase();
}

function findActiveItem(pathname: string) {
  return adminMenuItems
    .filter(({ to, end }) => pathname === to || (!end && pathname.startsWith(`${to}/`)))
    .sort((a, b) => b.to.length - a.to.length)[0];
}

function MenuIcon({ item }: { item: AdminMenuItem }) {
  const d = menuIconByPath[item.to];
  if (!d) {
    const Icon = item.icon;
    return <Icon className="size-[17px]" aria-hidden="true" />;
  }
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function AdminLayout({ title, subtitle, children, actions }: AdminLayoutProps) {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  // HU32: en movil/tablet el menu es un panel desplegable; antes empujaba todo el
  // contenido debajo de ~19 enlaces. En escritorio (lg) el sidebar sigue fijo.
  const [menuOpen, setMenuOpen] = useState(false);
  // En escritorio el sidebar se puede contraer a solo iconos (preferencia local).
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const menuId = useId();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const activeItem = findActiveItem(pathname);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [menuOpen]);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Sin almacenamiento disponible: la preferencia solo dura la sesion.
      }
      return next;
    });
  };

  // Al contraer solo se ocultan los textos en escritorio; el panel movil siempre es completo.
  const whenExpanded = collapsed ? "lg:hidden" : "";

  return (
    <div className="nd min-h-screen">
      <div className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-[#E6EBF3] bg-white px-4 py-3 lg:hidden">
        <div className="flex min-w-0 items-center gap-3">
          <BrandIcon />
          <div className="min-w-0">
            <p className="text-[17px] font-extrabold leading-tight tracking-[-0.02em] text-[color-mix(in_srgb,var(--nd-accent)_85%,#000)]">NexusResidencial</p>
            <p className="truncate text-xs text-slate-500">{"Panel de Administración"}</p>
          </div>
        </div>
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-controls={menuId}
          aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
          className="nd-icon-btn"
        >
          {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {menuOpen ? (
        <div
          className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden"
          aria-hidden="true"
          onClick={() => setMenuOpen(false)}
          data-testid="admin-drawer-backdrop"
        />
      ) : null}

      <aside
        id={menuId}
        aria-label={"Navegación del administrador"}
        className={cn(
          "nd-side fixed inset-y-0 left-0 z-40 flex w-[272px] max-w-[85vw] flex-col overflow-hidden border-r border-[#E6EBF3] bg-white lg:translate-x-0",
          collapsed ? "lg:w-[84px]" : "lg:w-[272px]",
          menuOpen ? "visible translate-x-0 shadow-xl" : "invisible -translate-x-full lg:visible",
        )}
      >
        <div
          className={cn(
            "flex shrink-0 items-center justify-between gap-2 px-[18px] pb-[14px] pt-5",
            collapsed && "lg:flex-col lg:px-[22px]",
          )}
        >
          <div className="flex min-w-0 items-center gap-3">
            <BrandIcon />
            <div className={cn("min-w-0", whenExpanded)}>
              <p className="text-[17px] font-extrabold leading-tight tracking-[-0.02em] text-[color-mix(in_srgb,var(--nd-accent)_85%,#000)]">
                NexusResidencial
              </p>
              <p className="whitespace-nowrap text-xs text-slate-500">{"Panel de Administración"}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expandir menú lateral" : "Contraer menú lateral"}
            aria-pressed={collapsed}
            className={cn("nd-collapse hidden !w-9 lg:flex", collapsed && "is-col")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
        </div>

        <nav aria-label={"Módulos del administrador"} className="min-h-0 flex-1 overflow-y-auto px-[14px] pb-3">
          {menuGroups.map(({ group, items }, groupIndex) => (
            <div key={group} className="flex flex-col gap-0.5">
              <p className={cn("nd-sec", whenExpanded)}>{group}</p>
              {collapsed && groupIndex > 0 ? <div className="mx-2 my-2.5 hidden h-px bg-[#EEF2F7] lg:block" /> : null}
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  title={item.label}
                  className={({ isActive }) => cn("nd-nav", isActive && "is-on", collapsed && "lg:justify-center")}
                >
                  <span className="nd-ico">
                    <MenuIcon item={item} />
                  </span>
                  <span className={cn("truncate", whenExpanded)}>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="flex shrink-0 flex-col gap-2.5 px-[14px] pb-5 pt-3">
          <div className={cn("flex items-center gap-3 rounded-[14px] bg-[#F6F8FC] p-3", collapsed && "lg:justify-center lg:p-2")}>
            <span className="relative flex size-10 flex-none items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--nd-accent)_14%,#FFFFFF)] text-sm font-extrabold text-[color-mix(in_srgb,var(--nd-accent)_80%,#000)]">
              {getInitials(user?.email)}
              <span className="absolute bottom-0 right-0 size-[11px] rounded-full border-2 border-[#F6F8FC] bg-emerald-500" aria-hidden="true" />
            </span>
            <div className={cn("min-w-0", whenExpanded)}>
              <p className="truncate text-sm font-bold">Administrador</p>
              <p className="truncate text-xs text-slate-500">{user?.email || "admin@residencial.com"}</p>
            </div>
          </div>
          <div className={cn("grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-2", collapsed && "lg:grid-cols-1")}>
            <NavLink to="/cuenta/sesiones" className="nd-ghost" title="Sesiones activas" aria-label="Sesiones activas">
              <MonitorSmartphone className="size-4" aria-hidden="true" />
              <span className={whenExpanded}>Sesiones</span>
            </NavLink>
            <button type="button" onClick={logout} className="nd-ghost danger" title={"Cerrar sesión"}>
              <LogOut className="size-4" aria-hidden="true" />
              <span className={whenExpanded}>{"Cerrar sesión"}</span>
            </button>
          </div>
        </div>
      </aside>

      <main className={cn("transition-[padding] duration-300", collapsed ? "lg:pl-[84px]" : "lg:pl-[272px]")}>
        <div className="flex flex-col gap-[22px] px-4 pb-10 pt-5 sm:px-6 lg:px-9 lg:pb-12 lg:pt-7">
          <header className="nd-rise flex flex-wrap items-end justify-between gap-[18px]">
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="nd-mono flex items-center gap-2 text-xs text-slate-500">
                <span>Panel</span>
                <span className="text-slate-300">/</span>
                <span className="font-semibold text-slate-900">{activeItem?.label ?? title}</span>
              </div>
              <h1 className="m-0 text-[clamp(26px,3vw,34px)] font-extrabold leading-[1.1] tracking-[-0.035em] text-slate-900">
                {title}
              </h1>
              <p className="m-0 text-[14.5px] text-slate-500">{subtitle}</p>
            </div>
            {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
          </header>

          <div className="nd-content">{children}</div>
        </div>
      </main>
    </div>
  );
}
