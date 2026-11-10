import type { ReactNode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getOwnerProvidersRequest, updateOwnerProviderValidationRequest } from "@/services/providersService";
import type { AdminProviderRecord } from "@/types/providers";
import { ResidenteProvidersView } from "./ResidenteProvidersView";

// La acción pide confirmación con SweetAlert2; en estas pruebas el usuario confirma.
vi.mock("@/utils/feedback", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/feedback")>()),
  confirmAction: vi.fn(async () => true),
}));
vi.mock("@/components/layout/AppShell", () => ({ AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/services/providersService", () => ({ getOwnerProvidersRequest: vi.fn(), updateOwnerProviderValidationRequest: vi.fn() }));

function provider(overrides: Partial<AdminProviderRecord>): AdminProviderRecord {
  return {
    id_servicio: 1, id_casa: 7, nombre: "Jardinería Verde", tipo_servicio: "Jardinería", descripcion: "Poda semanal",
    activo: true, estado: "PENDIENTE", casa_unidad: "A-12", fecha_registro: null, actualizado_en: null,
    registrado_por: "Inquilino Demo", propietario_nombre: "Residente", ultimo_cambio_por: "", ultimo_cambio_en: "", frecuencia_cambios: 0,
    ...overrides,
  };
}

const pending = provider({});
const approved = provider({ id_servicio: 2, nombre: "Plomería Rápida", estado: "VALIDADO" });

function item(name: string) {
  return screen.getByRole("heading", { name }).closest("li") as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOwnerProvidersRequest).mockResolvedValue([pending, approved]);
});

describe("ResidenteProvidersView", () => {
  it("solo ofrece Aprobar a proveedores pendientes", async () => {
    render(<MemoryRouter><ResidenteProvidersView /></MemoryRouter>);
    await screen.findByText("Jardinería Verde");
    expect(within(item("Jardinería Verde")).getByText("Pendiente")).toBeInTheDocument();
    expect(within(item("Jardinería Verde")).getByRole("button", { name: "Aprobar Jardinería Verde" })).toBeEnabled();
    expect(within(item("Plomería Rápida")).getByText("Aprobado")).toBeInTheDocument();
    expect(within(item("Plomería Rápida")).queryByRole("button")).not.toBeInTheDocument();
    expect(within(item("Jardinería Verde")).getByText(/Unidad A-12 · Registrado por Inquilino Demo/)).toBeInTheDocument();
  });

  it("aprueba un proveedor usando la API existente sin cambiar el contrato", async () => {
    const user = userEvent.setup();
    vi.mocked(updateOwnerProviderValidationRequest).mockResolvedValue({ ...pending, estado: "VALIDADO" });
    render(<MemoryRouter><ResidenteProvidersView /></MemoryRouter>);
    await user.click(await screen.findByRole("button", { name: "Aprobar Jardinería Verde" }));
    expect(updateOwnerProviderValidationRequest).toHaveBeenCalledWith({ id_servicio: 1, id_casa: 7, estado: "VALIDADO", activo: true });
    expect(await screen.findByText(/fue aprobado para la unidad A-12/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Aprobar/ })).not.toBeInTheDocument();
  });

  it("filtra por estado consultando al backend", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ResidenteProvidersView /></MemoryRouter>);
    await screen.findByText("Jardinería Verde");
    await user.click(screen.getByRole("button", { name: "Pendientes" }));
    await waitFor(() => expect(getOwnerProvidersRequest).toHaveBeenLastCalledWith({ search: "", status: "PENDIENTE" }));
    expect(screen.getByRole("button", { name: "Pendientes" })).toHaveAttribute("aria-pressed", "true");
  });

  it("muestra errores y estado vacío", async () => {
    vi.mocked(getOwnerProvidersRequest).mockRejectedValueOnce(new Error("Sin permisos"));
    render(<MemoryRouter><ResidenteProvidersView /></MemoryRouter>);
    expect(await screen.findByText("Sin permisos")).toBeInTheDocument();
    expect(screen.getByText("No hay proveedores asociados a su unidad.")).toBeInTheDocument();
  });
});
