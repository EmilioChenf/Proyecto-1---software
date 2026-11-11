import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AdminSetupView } from "@/views/AdminSetupView";
import { getSetupStatusRequest } from "@/services/setupService";
import { saveGlobalMaintenanceRequest } from "@/services/propertyContractsService";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, email: "admin@nexus.test", role: "admin" }, logout: vi.fn() }) }));
vi.mock("@/services/setupService", () => ({ getSetupStatusRequest: vi.fn(), hideSetupRequest: vi.fn(), markSetupStepRequest: vi.fn() }));
vi.mock("@/services/configurationService", () => ({
  getGeneralConfigurationRequest: vi.fn().mockResolvedValue({ nombre: "Las Brisas", direccion: "", correo_contacto: "", telefono_contacto: "", zona_horaria: "America/Guatemala", moneda: "GTQ" }),
  getAdminVisitScheduleConfigRequest: vi.fn().mockResolvedValue({ hora_apertura: "06:00", hora_cierre: "22:00", duracion_maxima_horas: 4, activo: true, dias_habilitados: [1, 2, 3, 4, 5] }),
  updateGeneralConfigurationRequest: vi.fn(), updateBrandRequest: vi.fn(), updateVisitScheduleConfigRequest: vi.fn(),
}));
vi.mock("@/services/propertyContractsService", () => ({ getGlobalMaintenanceRequest: vi.fn().mockResolvedValue({ vigente: null, historial: [] }), saveGlobalMaintenanceRequest: vi.fn().mockResolvedValue({}) }));
vi.mock("@/services/amenitiesService", () => ({ getAmenitiesRequest: vi.fn().mockResolvedValue([]) }));
vi.mock("@/utils/feedback", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn(), confirmAction: vi.fn() }));

const pasos = (done: string[]) => ["marca", "mantenimiento", "visitas", "amenidades", "viviendas", "guardias"].map((id) => ({ id, label: id, done: done.includes(id) }));

describe("AdminSetupView", () => {
  it("abre en el primer paso pendiente y guarda la cuota de mantenimiento", async () => {
    vi.mocked(getSetupStatusRequest)
      .mockResolvedValueOnce({ pasos: pasos(["marca"]), completados: 1, total: 6, oculto: false, conteos: { viviendas: 0, personas: 0, amenidades: 0, guardias: 0 } })
      .mockResolvedValue({ pasos: pasos(["marca", "mantenimiento"]), completados: 2, total: 6, oculto: false, conteos: { viviendas: 0, personas: 0, amenidades: 0, guardias: 0 } });
    const user = userEvent.setup();
    render(<MemoryRouter><AdminSetupView /></MemoryRouter>);
    await user.type(await screen.findByLabelText("Cuota de mantenimiento"), "450");
    await user.click(screen.getByRole("button", { name: /Guardar y continuar/ }));
    await waitFor(() => expect(saveGlobalMaintenanceRequest).toHaveBeenCalledWith(expect.objectContaining({ monto: "450.00", vigente_desde: expect.stringMatching(/-01$/) })));
    expect(await screen.findByText("¿En qué horario se reciben visitas?")).toBeInTheDocument();
  });
});
