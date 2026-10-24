import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { LogOut, Menu, X } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

import { BrandIcon } from "@/components/layout/BrandIcon";
import {
  findActiveNavItem,
  isNavItemActive,
  type RoleNavItem,
  type RoleNavSection,
} from "@/components/layout/roleNavigation";
import { cn } from "@/components/ui/utils";
import { useAuth } from "@/hooks/useAuth";

// Mismo lenguaje visual que el panel de administración (diseño "Dashboard · Administrador").
import "@/components/admin/adminTheme.css";

export type RoleSidebarConfig<Badge extends string = string> = {
  /** Texto bajo la marca, p. ej. "Panel de Residente". */
  panelLabel: string;
  /** Nombre del rol en el pie del sidebar. */
  roleLabel: string;
  homePath: string;
  /** Sustantivo del rol para etiquetas accesibles, p. ej. "residente". */
  roleNoun: string;
  sections: RoleNavSection<Badge>[];
  sessionsItem: RoleNavItem<Badge>;
  counterLabels?: Partial<Record<Badge, string>>;
  /** Color de acento del rol (botones, item activo, iconos). */
  accent?: string;
};

type RoleSidebarLayoutProps<Badge extends string> = {
  config: RoleSidebarConfig<Badge>;
  counters?: Partial<Record<Badge, number>>;
  /** Dato secundario del usuario (p. ej. "Unidad B-302"); se omite si no existe. */
  userDetail?: string | null;
  title: string;
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
};

function getInitials(email: string | undefined, fallback: string) {
  if (!email) return fallback;
  const [namePart] = email.split("@");
  return (namePart.slice(0, 2) || fallback).toUpperCase();
}

function readCollapsed(key: string) {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function NavBadge({ value, label, compact }: { value: number; label: string; compact: boolean }) {
  return (
    <span className={cn("nd-badge", compact && "lg:hidden")} aria-label={`${value} ${label}`}>
      {value > 99 ? "99+" : value}
    </span>
  );
}

/**
 * Layout con sidebar compartido por los paneles de rol (mismo lenguaje visual
 * que AdminLayout). Cada rol aporta su propia configuracion de navegacion:
 * este componente no decide permisos; la autorizacion real sigue en
 * ProtectedRoute y en el backend.
 */
export function RoleSidebarLayout<Badge extends string>({
  config,
  counters = {},
  userDetail,
  title,
  subtitle,
  actions,
  children,
}: RoleSidebarLayoutProps<Badge>) {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const storageKey = `nr-${config.roleNoun}-sidebar-collapsed`;
  const [collapsed, setCollapsed] = useState(() => readCollapsed(storageKey));
  const drawerId = useId();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const activeItem = findActiveNavItem(config.sections, [config.sessionsItem], pathname);
  const sessionsActive = isNavItemActive(config.sessionsItem, pathname);
  const SessionsIcon = config.sessionsItem.icon;

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [drawerOpen]);

  const closeDrawer = () => setDrawerOpen(false);
  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        // Sin almacenamiento disponible: la preferencia solo dura la sesion.
      }
      return next;
    });
  };

  // Al contraer solo se ocultan los textos en escritorio; el panel movil siempre es completo.
  const whenExpanded = collapsed ? "lg:hidden" : "";
  const accentStyle = (config.accent ? { "--nd-accent": config.accent } : undefined) as CSSProperties | undefined;

  return (
    <div className={cn("nd min-h-screen", config.accent && "nd-tint")} style={accentStyle}>
      <div className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-[#E6EBF3] bg-white px-4 py-3 lg:hidden">
        <div className="flex min-w-0 items-center gap-3">
          <BrandIcon />
          <div className="min-w-0">
            <p className="text-[17px] font-extrabold leading-tight tracking-[-0.02em] text-[color-mix(in_srgb,var(--nd-accent)_85%,#000)]">NexusResidencial</p>
            <p className="truncate text-xs text-slate-500">{activeItem?.label ?? config.panelLabel}</p>
          </div>
        </div>
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setDrawerOpen((open) => !open)}
          aria-expanded={drawerOpen}
          aria-controls={drawerId}
          aria-label={drawerOpen ? "Cerrar menú" : "Abrir menú"}
          className="nd-icon-btn"
        >
          {drawerOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {drawerOpen ? (
        <div
          className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden"
          aria-hidden="true"
          onClick={closeDrawer}
          data-testid="sidebar-drawer-backdrop"
        />
      ) : null}

      <aside
        id={drawerId}
        aria-label={`Navegación del ${config.roleNoun}`}
        className={cn(
          "nd-side fixed inset-y-0 left-0 z-40 flex w-[272px] max-w-[85vw] flex-col overflow-hidden border-r border-[#E6EBF3] bg-white lg:translate-x-0",
          collapsed ? "lg:w-[84px]" : "lg:w-[272px]",
          drawerOpen ? "visible translate-x-0 shadow-xl" : "invisible -translate-x-full lg:visible",
        )}
      >
        <div
          className={cn(
            "flex shrink-0 items-center justify-between gap-2 px-[18px] pb-[14px] pt-5",
            collapsed && "lg:flex-col lg:px-[22px]",
          )}
        >
          <Link to={config.homePath} onClick={closeDrawer} className="flex min-w-0 items-center gap-3 rounded-xl no-underline">
            <BrandIcon />
            <span className={cn("min-w-0", whenExpanded)}>
              <span className="block text-[17px] font-extrabold leading-tight tracking-[-0.02em] text-[color-mix(in_srgb,var(--nd-accent)_85%,#000)]">
                NexusResidencial
              </span>
              <span className="block whitespace-nowrap text-xs text-slate-500" aria-hidden="true">{config.panelLabel}</span>
            </span>
          </Link>
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

        <nav aria-label={`Módulos del ${config.roleNoun}`} className="min-h-0 flex-1 overflow-y-auto px-[14px] pb-3">
          {config.sections.map((section, sectionIndex) => (
            <div key={section.title} className="flex flex-col gap-0.5">
              <p className={cn("nd-sec", whenExpanded)}>{section.title}</p>
              {collapsed && sectionIndex > 0 ? <div className="mx-2 my-2.5 hidden h-px bg-[#EEF2F7] lg:block" /> : null}
              {section.items.map((item) => {
                const active = isNavItemActive(item, pathname);
                const Icon = item.icon;
                const badgeValue = item.badge ? counters[item.badge] : undefined;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={closeDrawer}
                    title={item.label}
                    aria-current={active ? "page" : undefined}
                    className={cn("nd-nav", active && "is-on", collapsed && "lg:justify-center")}
                  >
                    <span className="nd-ico">
                      <Icon className="size-[17px]" aria-hidden="true" />
                      {badgeValue && collapsed ? <span className="nd-dot hidden lg:block" aria-hidden="true" /> : null}
                    </span>
                    <span className={cn("truncate", whenExpanded)}>{item.label}</span>
                    {badgeValue ? (
                      <NavBadge
                        value={badgeValue}
                        label={(item.badge && config.counterLabels?.[item.badge]) ?? ""}
                        compact={collapsed}
                      />
                    ) : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="flex shrink-0 flex-col gap-2.5 px-[14px] pb-5 pt-3">
          <div className={cn("flex items-center gap-3 rounded-[14px] bg-[#F6F8FC] p-3", collapsed && "lg:justify-center lg:p-2")}>
            <span
              className="relative flex size-10 flex-none items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--nd-accent)_14%,#FFFFFF)] text-sm font-extrabold text-[color-mix(in_srgb,var(--nd-accent)_80%,#000)]"
              aria-hidden="true"
            >
              {getInitials(user?.email, config.roleLabel.slice(0, 2).toUpperCase())}
              <span className="absolute bottom-0 right-0 size-[11px] rounded-full border-2 border-[#F6F8FC] bg-emerald-500" />
            </span>
            <div className={cn("min-w-0", whenExpanded)}>
              <p className="truncate text-sm font-bold">{config.roleLabel}</p>
              <p className="truncate text-xs text-slate-500">{user?.email}</p>
              {userDetail ? <p className="truncate text-xs text-slate-500">{userDetail}</p> : null}
            </div>
          </div>
          <div className={cn("grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-2", collapsed && "lg:grid-cols-1")}>
            <Link
              to={config.sessionsItem.to}
              onClick={closeDrawer}
              aria-current={sessionsActive ? "page" : undefined}
              aria-label={config.sessionsItem.label}
              title={config.sessionsItem.label}
              className={cn(
                "nd-ghost",
                sessionsActive && "!border-[color-mix(in_srgb,var(--nd-accent)_35%,#FFFFFF)] !bg-[color-mix(in_srgb,var(--nd-accent)_8%,#FFFFFF)] !text-[color-mix(in_srgb,var(--nd-accent)_80%,#000)]",
              )}
            >
              <SessionsIcon className="size-4" aria-hidden="true" />
              <span className={whenExpanded}>Sesiones</span>
            </Link>
            <button type="button" onClick={logout} className="nd-ghost danger" title="Cerrar sesión">
              <LogOut className="size-4" aria-hidden="true" />
              <span className={whenExpanded}>Cerrar sesión</span>
            </button>
          </div>
        </div>
      </aside>

      <main className={cn("transition-[padding] duration-300", collapsed ? "lg:pl-[84px]" : "lg:pl-[272px]")}>
        <div className="flex flex-col gap-[22px] px-4 pb-10 pt-5 sm:px-6 lg:px-9 lg:pb-12 lg:pt-7">
          <header className="nd-rise flex flex-wrap items-end justify-between gap-[18px]">
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="nd-mono flex items-center gap-2 text-xs text-slate-500">
                <span>{config.panelLabel.replace(/^Panel de /, "")}</span>
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
