import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FinancialRulesSettings } from "@/components/admin/FinancialRulesSettings";
import { apiRequest } from "@/services/api";

vi.mock("@/services/api", () => ({ apiRequest: vi.fn() }));
vi.mock('@/components/admin/GlobalMaintenanceSettings',()=>({GlobalMaintenanceSettings:()=>null}));

const rule = { dia_limite: 10, tipo: "PORCENTAJE", porcentaje: 5, monto_fijo: 0, dias_gracia: 3, activo: true, vigente_desde: "2026-01-01" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiRequest).mockImplementation(async (path: string) => {
    if (path === "/admin/configuracion-financiera") return rule;
    throw new Error(`no esperado ${path}`);
  });
});

const applyCalls = () => vi.mocked(apiRequest).mock.calls.filter(([path]) => path === "/admin/recargos/aplicar");

describe("HU32 aplicar recargos (Admin)", () => {
  it("explica la acción y no aplica nada sin confirmación explícita", async () => {
    render(<FinancialRulesSettings />);
    expect(await screen.findByText(/5% del capital pendiente/)).toBeInTheDocument();
    expect(screen.getByText(/no se aplican automáticamente/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Aplicar recargos" }));
    expect(screen.getByText("¿Confirma que desea aplicar los recargos ahora?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(applyCalls()).toHaveLength(0);
  });

  it("al confirmar llama al endpoint existente y muestra el resultado", async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) =>
      path === "/admin/recargos/aplicar" ? { aplicados: 3, activo: true, fecha_revision: "2026-10-04" } : rule);
    render(<FinancialRulesSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Aplicar recargos" }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, aplicar recargos" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Recargos aplicados: 3. Fecha de revisión: 2026-10-04.");
    expect(applyCalls()).toEqual([["/admin/recargos/aplicar", { method: "POST" }]]);
  });

  it("informa cuando la regla está desactivada", async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) =>
      path === "/admin/recargos/aplicar" ? { aplicados: 0, activo: false, fecha_revision: "2026-10-04" } : rule);
    render(<FinancialRulesSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Aplicar recargos" }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, aplicar recargos" }));
    expect(await screen.findByRole("status")).toHaveTextContent("La regla de recargos está desactivada");
  });

  it("muestra el error del backend sin presentarlo como éxito", async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === "/admin/recargos/aplicar") throw new Error("Acceso restringido");
      return rule;
    });
    render(<FinancialRulesSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Aplicar recargos" }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, aplicar recargos" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Acceso restringido");
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });
});
