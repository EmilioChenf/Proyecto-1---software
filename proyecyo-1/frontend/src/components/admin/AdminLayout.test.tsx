import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminLayout } from "@/components/admin/AdminLayout";
import { useAuth } from "@/hooks/useAuth";

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));

describe("AdminLayout", () => {
  const logout = vi.fn();

  beforeEach(() => {
    logout.mockReset();
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 1, email: "admin@nexus.test", role: "admin" },
      logout,
    } as ReturnType<typeof useAuth>);
  });

  it("mantiene disponible el cierre de sesión y ejecuta logout", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AdminLayout title="Panel" subtitle="Administración">
          <p>Contenido</p>
        </AdminLayout>
      </MemoryRouter>,
    );

    const button = screen.getByRole("button", { name: /Cerrar sesi/ });
    expect(button).toBeVisible();
    await user.click(button);
    expect(logout).toHaveBeenCalledTimes(1);
  });
});

describe("HU32 AdminLayout responsive", () => {
  const logout = vi.fn();
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({ user: { id: 1, email: "admin@nexus.test", role: "admin" }, logout } as unknown as ReturnType<typeof useAuth>);
  });
  const renderLayout = () => render(
    <MemoryRouter initialEntries={["/admin"]}>
      <AdminLayout title="Panel" subtitle="Administración"><p>Contenido</p></AdminLayout>
    </MemoryRouter>,
  );

  it("el botón de cierre de sesión muestra el acento correctamente (sin secuencia de escape literal)", () => {
    renderLayout();
    const button = screen.getByRole("button", { name: "Cerrar sesión" });
    // Antes el texto JSX mostraba la secuencia de escape literal (barra invertida + "u00f3").
    expect(button.textContent).not.toContain(String.fromCharCode(92) + "u00f3");
    expect(button.textContent).toBe("Cerrar sesión");
  });

  it("en móvil el menú es un panel que se abre, se cierra con Escape y al navegar", async () => {
    const user = userEvent.setup();
    renderLayout();
    const toggle = screen.getByRole("button", { name: "Abrir menú" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Cerrar menú" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("admin-drawer-backdrop")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Abrir menú" })).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("button", { name: "Abrir menú" }));
    const nav = screen.getByRole("navigation", { name: "Módulos del administrador" });
    await user.click(within(nav).getByRole("link", { name: "Pagos" }));
    expect(screen.getByRole("button", { name: "Abrir menú" })).toHaveAttribute("aria-expanded", "false");
  });

  it("el contenido no queda debajo del menú: la navegación es un panel aparte", () => {
    renderLayout();
    const aside = screen.getByRole("complementary", { name: "Navegación del administrador" });
    expect(aside.className).toContain("fixed");
    expect(aside.className).toContain("lg:translate-x-0");
    expect(screen.getByText("Contenido")).toBeInTheDocument();
  });
});
