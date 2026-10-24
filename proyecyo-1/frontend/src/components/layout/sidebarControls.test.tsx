import type { ReactElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminLayout } from "@/components/admin/AdminLayout";
import { GuardLayout } from "@/components/guardia/GuardLayout";
import { TenantLayout } from "@/components/inquilino/TenantLayout";
import { ResidentLayout } from "@/components/residente/ResidentLayout";
import { useAuth } from "@/hooks/useAuth";

// HU-C02 (C02.1/C02.2): cada layout tiene UN control de menu movil y UN control de
// contraer en escritorio, con puntos de corte complementarios (el mismo prefijo lg).
// La visibilidad real (cascada CSS) se verifica en navegador con
// scripts/ui-responsive-check.mjs y la regla estructural en adminTheme.layers.test.ts.

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
// Sin contadores remotos: solo interesa la estructura de navegacion.
vi.mock("@/components/layout/sidebarCounters", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/layout/sidebarCounters")>()),
  useSidebarCounters: () => ({}),
  useSidebarDetail: () => null,
}));

const layouts: Array<[string, string, (children: ReactElement) => ReactElement]> = [
  ["admin", "admin", (children) => <AdminLayout title="Panel" subtitle="Admin">{children}</AdminLayout>],
  ["residente", "residente", (children) => <ResidentLayout title="Panel" subtitle="Residente">{children}</ResidentLayout>],
  ["inquilino", "inquilino", (children) => <TenantLayout title="Panel" subtitle="Inquilino">{children}</TenantLayout>],
  ["guardia", "guardia", (children) => <GuardLayout title="Panel" subtitle="Guardia">{children}</GuardLayout>],
];

const classesOf = (element: Element | null) => (element?.getAttribute("class") ?? "").split(/\s+/);

describe.each(layouts)("HU-C02 controles del sidebar: %s", (_name, role, renderLayout) => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({ user: { id: 1, email: `${role}@nexus.test`, role }, logout: vi.fn() } as unknown as ReturnType<typeof useAuth>);
    render(<MemoryRouter initialEntries={[`/${role}`]}>{renderLayout(<p>Contenido</p>)}</MemoryRouter>);
  });

  it("hay exactamente un control de menu movil y uno de contraer", () => {
    expect(screen.getAllByRole("button", { name: /^(Abrir|Cerrar) menú$/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^(Contraer|Expandir) menú lateral$/ })).toHaveLength(1);
  });

  it("los dos controles usan puntos de corte complementarios (nunca visibles a la vez)", () => {
    const menu = screen.getByRole("button", { name: "Abrir menú" });
    const collapse = screen.getByRole("button", { name: /menú lateral$/ });
    // El menu movil vive en la barra superior, oculta desde lg.
    const mobileBar = menu.closest("div.sticky");
    expect(classesOf(mobileBar)).toContain("lg:hidden");
    // El de contraer esta oculto por defecto y solo aparece desde lg.
    expect(classesOf(collapse)).toEqual(expect.arrayContaining(["nd-collapse", "hidden", "lg:flex"]));
  });

  it("cierra el menú al pulsar el enlace de la página actual", () => {
    const menu = screen.getByRole("button", { name: "Abrir menú" });
    fireEvent.click(menu);
    fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(menu).toHaveFocus();
  });

  it("restaura el desplazamiento y el acceso al contenido al cerrar con Escape", () => {
    const previousOverflow = document.body.style.overflow;
    const menu = screen.getByRole("button", { name: "Abrir menú" });
    fireEvent.click(menu);
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByRole("main", { hidden: true }).inert).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.body.style.overflow).toBe(previousOverflow);
    expect(screen.getByRole("main").inert).toBe(false);
    expect(menu).toHaveFocus();
  });

  it("abrir y cerrar el menu movil sigue funcionando con un solo boton", () => {
    const menu = screen.getByRole("button", { name: "Abrir menú" });
    fireEvent.click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("button", { name: /^(Abrir|Cerrar) menú$/ })).toHaveLength(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Abrir menú" })).toHaveAttribute("aria-expanded", "false");
  });
});
