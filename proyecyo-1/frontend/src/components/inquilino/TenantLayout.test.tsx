import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TenantLayout } from "@/components/inquilino/TenantLayout";
import { findActiveTenantNavItem } from "@/components/inquilino/tenantNavigation";
import { notifySidebarCountersChanged } from "@/components/layout/sidebarCounters";
import { useAuth } from "@/hooks/useAuth";
import { getUnreadNotificationsRequest } from "@/services/notificationsService";
import { getTenantAccountStatementRequest } from "@/services/tenantAccountService";

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/services/notificationsService", () => ({ getUnreadNotificationsRequest: vi.fn() }));
vi.mock("@/services/tenantAccountService", () => ({ getTenantAccountStatementRequest: vi.fn() }));

const logout = vi.fn();

function LocationProbe() {
  return <p data-testid="location">{useLocation().pathname}</p>;
}

function renderLayout(path = "/inquilino") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<TenantLayout title="Vista" subtitle="Sub"><LocationProbe /></TenantLayout>} />
      </Routes>
    </MemoryRouter>,
  );
}

const sidebar = () => screen.getByRole("navigation", { name: "Módulos del inquilino" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({ user: { id: 9, email: "inquilino@test.com", role: "inquilino" }, logout } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(getUnreadNotificationsRequest).mockResolvedValue({ unread: 3 });
  vi.mocked(getTenantAccountStatementRequest).mockResolvedValue({ casa: { id_casa: 2, unidad: "B-302", propietario: "Prop" } } as never);
});

describe("TenantLayout", () => {
  it("muestra solo los módulos autorizados al inquilino", () => {
    renderLayout();
    expect(screen.getByText("Panel de Inquilino")).toBeInTheDocument();
    const nav = within(sidebar());
    const expected: Array<[RegExp, string]> = [
      [/^Dashboard$/, "/inquilino"],
      [/^Mis visitas$/, "/inquilino/visitas"],
      [/^Mis reservas$/, "/inquilino/reservas"],
      [/^Proveedores$/, "/inquilino/proveedores"],
      [/^Permisos y solicitudes$/, "/inquilino/permisos"],
      [/^Estado de cuenta$/, "/inquilino/estado-cuenta"],
      [/^Comunicados y avisos/, "/inquilino/notificaciones"],
    ];
    expect(nav.getAllByRole("link")).toHaveLength(expected.length);
    for (const [name, href] of expected) {
      expect(nav.getByRole("link", { name })).toHaveAttribute("href", href);
    }
    expect(screen.getByRole("link", { name: "Sesiones activas" })).toHaveAttribute("href", "/inquilino/sesiones");
  });

  it("no expone módulos exclusivos de residente, guardia ni admin", () => {
    renderLayout();
    for (const label of [/Amenidades/, /Reglamentos/, /Resumen mensual/, /Mis pagos/, /Cargos y pagos/, /Accesos y reservas/]) {
      expect(screen.queryByRole("link", { name: label })).not.toBeInTheDocument();
    }
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href")).toMatch(/^\/inquilino/);
    }
  });

  it.each([
    ["/inquilino", "Dashboard"],
    ["/inquilino/visitas", "Mis visitas"],
    ["/inquilino/historial-financiero", "Estado de cuenta"],
    ["/inquilino/comunicados", "Comunicados y avisos"],
  ])("marca como activa la opción correcta en %s", (path, label) => {
    renderLayout(path);
    const current = within(sidebar()).getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent(label);
  });

  it("marca sesiones activas en su ruta y en la compartida", () => {
    expect(findActiveTenantNavItem("/cuenta/sesiones")?.label).toBe("Sesiones activas");
    renderLayout("/inquilino/sesiones");
    expect(screen.getByRole("link", { name: "Sesiones activas" })).toHaveAttribute("aria-current", "page");
  });

  it("muestra badge real de avisos, unidad del inquilino y lo recalcula al cambiar", async () => {
    renderLayout();
    expect(await screen.findByLabelText("3 sin leer")).toBeInTheDocument();
    expect(await screen.findByText("Unidad B-302")).toBeInTheDocument();
    vi.mocked(getUnreadNotificationsRequest).mockResolvedValue({ unread: 0 });
    act(() => notifySidebarCountersChanged());
    await waitFor(() => expect(screen.queryByLabelText(/sin leer$/)).not.toBeInTheDocument());
  });

  it("no inventa badge ni unidad si las APIs fallan", async () => {
    vi.mocked(getUnreadNotificationsRequest).mockRejectedValue(new Error("fallo"));
    vi.mocked(getTenantAccountStatementRequest).mockRejectedValue(new Error("fallo"));
    renderLayout();
    await waitFor(() => expect(getUnreadNotificationsRequest).toHaveBeenCalled());
    expect(screen.queryByLabelText(/sin leer$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Unidad /)).not.toBeInTheDocument();
  });

  it("navega, abre el menú móvil y cierra sesión", async () => {
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getByRole("button", { name: "Abrir menú" }));
    expect(screen.getByRole("button", { name: "Cerrar menú" })).toHaveAttribute("aria-expanded", "true");
    await user.click(within(sidebar()).getByRole("link", { name: "Proveedores" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/inquilino/proveedores");
    expect(screen.getByRole("button", { name: "Abrir menú" })).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
