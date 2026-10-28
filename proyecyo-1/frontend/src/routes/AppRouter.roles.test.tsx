import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuth } from "@/hooks/useAuth";
import { AppRouter } from "@/routes/AppRouter";
import type { UserRole } from "@/types/auth";

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));

const { stub } = vi.hoisted(() => ({
  stub: (name: string) => () => ({ [name]: () => <p>vista:{name}</p> }),
}));
vi.mock("@/views/AdminView", stub("AdminView"));
vi.mock("@/views/AdminPaymentsView", stub("AdminPaymentsView"));
vi.mock("@/views/ResidenteView", stub("ResidenteView"));
vi.mock("@/views/ResidenteAccountView", stub("ResidenteAccountView"));
vi.mock("@/views/ResidenteAmenitiesView", stub("ResidenteAmenitiesView"));
vi.mock("@/views/ResidenteRegulationsView", stub("ResidenteRegulationsView"));
vi.mock("@/views/InquilinoDashboardView", stub("InquilinoDashboardView"));
vi.mock("@/views/InquilinoAccountView", stub("InquilinoAccountView"));
vi.mock("@/views/GuardiaDashboardView", stub("GuardiaDashboardView"));
vi.mock("@/views/ActiveSessionsView", stub("ActiveSessionsView"));
vi.mock("@/views/TenantAmenitiesHistoryView", stub("TenantAmenitiesHistoryView"));
vi.mock("@/views/InquilinoView", () => ({
  InquilinoView: ({ section }: { section: string }) => <p>vista:InquilinoView:{section}</p>,
}));
vi.mock("@/views/GuardiaView", () => ({
  GuardiaView: ({ section }: { section: string }) => <p>vista:GuardiaView:{section}</p>,
}));
vi.mock("@/views/ResidentNotificationsView", () => ({
  ResidentNotificationsView: ({ role = "residente", initialFilter = "TODOS" }: { role?: string; initialFilter?: string }) => (
    <p>vista:Notificaciones:{role}:{initialFilter}</p>
  ),
}));

function renderAt(path: string, role: UserRole) {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 3, email: `${role}@nexus.test`, role },
    isLoading: false,
  } as unknown as ReturnType<typeof useAuth>);
  window.history.pushState({}, "", path);
  render(<AppRouter />);
}

beforeEach(() => vi.clearAllMocks());

describe("Rutas del inquilino", () => {
  it.each([
    ["/inquilino", "InquilinoDashboardView"],
    ["/inquilino/visitas", "InquilinoView:visitas"],
    ["/inquilino/proveedores", "InquilinoView:proveedores"],
    ["/inquilino/permisos", "InquilinoView:permisos"],
    ["/inquilino/reservas", "TenantAmenitiesHistoryView"],
    ["/inquilino/estado-cuenta", "InquilinoAccountView"],
    ["/inquilino/historial-financiero", "InquilinoAccountView"],
    ["/inquilino/notificaciones", "Notificaciones:inquilino:TODOS"],
    ["/inquilino/comunicados", "Notificaciones:inquilino:COMUNICADOS"],
    ["/inquilino/sesiones", "ActiveSessionsView"],
    ["/cuenta/sesiones", "ActiveSessionsView"],
  ])("%s renderiza %s", (path, view) => {
    renderAt(path, "inquilino");
    expect(screen.getByText(`vista:${view}`)).toBeInTheDocument();
  });

  it.each(["/admin", "/admin/pagos", "/guardia", "/guardia/control", "/residente/amenidades", "/residente/reglamentos", "/residente/pagos"])(
    "un inquilino que abre %s regresa a su dashboard",
    (path) => {
      renderAt(path, "inquilino");
      expect(screen.getByText("vista:InquilinoDashboardView")).toBeInTheDocument();
    },
  );
});

describe("Rutas del guardia", () => {
  it.each([
    ["/guardia", "GuardiaDashboardView"],
    ["/guardia/control", "GuardiaView:control"],
    ["/guardia/visitas", "GuardiaView:visitas"],
    ["/guardia/historial", "GuardiaView:historial"],
    ["/guardia/alertas", "GuardiaView:alertas"],
    ["/guardia/sesiones", "ActiveSessionsView"],
  ])("%s renderiza %s", (path, view) => {
    renderAt(path, "guardia");
    expect(screen.getByText(`vista:${view}`)).toBeInTheDocument();
  });

  it.each(["/admin", "/admin/pagos", "/residente/pagos", "/residente/estado-cuenta", "/inquilino/estado-cuenta", "/inquilino", "/residente"])(
    "un guardia que abre %s regresa a su dashboard",
    (path) => {
      renderAt(path, "guardia");
      expect(screen.getByText("vista:GuardiaDashboardView")).toBeInTheDocument();
    },
  );
});

describe("Otros roles no acceden a las rutas nuevas", () => {
  it.each([
    ["/inquilino/permisos", "residente", "ResidenteView"],
    ["/guardia/control", "residente", "ResidenteView"],
    ["/guardia/alertas", "admin", "AdminView"],
    ["/inquilino/visitas", "admin", "AdminView"],
  ] as const)("%s con rol %s redirige a su panel", (path, role, view) => {
    renderAt(path, role);
    expect(screen.getByText(`vista:${view}`)).toBeInTheDocument();
  });
});
