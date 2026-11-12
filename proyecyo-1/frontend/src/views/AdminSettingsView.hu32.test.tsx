import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getRestoreHistoryRequest } from "@/services/restoresService";
import { AdminSettingsView } from "./AdminSettingsView";

vi.mock("@/components/admin/AdminLayout", () => ({ AdminLayout: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/admin/GeneralSettings", () => ({ GeneralSettings: () => null }));
vi.mock("@/components/admin/VisitScheduleSettings", () => ({ VisitScheduleSettings: () => null }));
vi.mock("@/components/admin/FinancialRulesSettings", () => ({ FinancialRulesSettings: () => <p>Reglas financieras</p> }));
vi.mock("@/components/admin/AutomaticBackupsSettings", () => ({ AutomaticBackupsSettings: () => null }));
vi.mock("@/services/restoresService", () => ({
  getRestoreHistoryRequest: vi.fn(), restoreBackupRequest: vi.fn(), validateBackupRequest: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

describe("HU32 Configuración", () => {
  it("un fallo del historial de restauraciones se muestra como error, no como historial vacío", async () => {
    vi.mocked(getRestoreHistoryRequest).mockRejectedValue(new Error("Historial no disponible"));
    render(<MemoryRouter><AdminSettingsView /></MemoryRouter>);
    expect(await screen.findByRole("alert")).toHaveTextContent("Historial no disponible");
    expect(screen.queryByText("Aún no hay restauraciones registradas.")).not.toBeInTheDocument();
  });

  it("con historial vacío muestra el estado vacío y la sección de recargos sigue disponible", async () => {
    vi.mocked(getRestoreHistoryRequest).mockResolvedValue([]);
    render(<MemoryRouter><AdminSettingsView /></MemoryRouter>);
    expect(await screen.findByText("Aún no hay restauraciones registradas.")).toBeInTheDocument();
    expect(screen.getByText("Reglas financieras")).toBeInTheDocument();
  });
});
