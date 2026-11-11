import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AdminRolesView } from "@/views/AdminRolesView";
import { createRoleRequest, listRolesRequest } from "@/services/rolesService";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, email: "admin@nexus.test", role: "admin" }, logout: vi.fn() }) }));
vi.mock("@/services/rolesService", () => ({ listRolesRequest: vi.fn(), createRoleRequest: vi.fn(), updateRoleRequest: vi.fn(), deleteRoleRequest: vi.fn() }));
vi.mock("@/utils/feedback", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn(), confirmAction: vi.fn() }));

const modulos = [{ id: "pagos", label: "Pagos y cobros", solo_lectura: false }, { id: "finanzas", label: "Finanzas y reporte financiero", solo_lectura: false }];

describe("AdminRolesView", () => {
  it("crea un rol tocando las tarjetas de módulos y muestra la vista previa del menú", async () => {
    vi.mocked(listRolesRequest).mockResolvedValue({ roles: [], modulos, colores: ["#2563EB", "#059669"] });
    vi.mocked(createRoleRequest).mockResolvedValue({ id: 3, nombre: "Contador", descripcion: null, color: "#2563EB", usuarios: 0, permisos: { pagos: "EDITAR" } });
    const user = userEvent.setup();
    render(<MemoryRouter><AdminRolesView /></MemoryRouter>);
    await user.click(await screen.findByRole("button", { name: /Crear el primer rol/ }));
    await user.type(screen.getByLabelText("Nombre del rol"), "Contador");
    const card = screen.getByRole("button", { name: /Pagos y cobros: sin acceso/ });
    await user.click(card);
    await user.click(screen.getByRole("button", { name: /Pagos y cobros: solo ver/ }));
    expect(screen.getByRole("button", { name: /Pagos y cobros: ver y editar/ })).toBeInTheDocument();
    expect(screen.getByText("Así verá su menú")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Crear rol" }));
    await waitFor(() => expect(createRoleRequest).toHaveBeenCalledWith(expect.objectContaining({ nombre: "Contador", permisos: { pagos: "EDITAR" } })));
  });
});
