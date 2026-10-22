import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/services/api";
import { getVisitScheduleConfigRequest } from "@/services/configurationService";
import { deleteVisitRequest, getFrequentVisitorsRequest, getVisitsRequest } from "@/services/visitsService";
import { confirmAction, notifyError, notifySuccess } from "@/utils/feedback";
import { ResidenteVisitsView } from "@/views/ResidenteVisitsView";

vi.mock("@/components/layout/AppShell", () => ({ AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/visits/QrCodeCard", () => ({ QrCodeCard: () => <div>Codigo QR</div> }));
vi.mock("@/services/visitsService", () => ({
  createVisitRequest: vi.fn(), deleteFrequentVisitorRequest: vi.fn(), deleteVisitRequest: vi.fn(),
  getFrequentVisitorsRequest: vi.fn(), getVisitsRequest: vi.fn(),
}));
vi.mock("@/services/configurationService", () => ({ getVisitScheduleConfigRequest: vi.fn() }));
vi.mock("@/utils/feedback", () => ({ confirmAction: vi.fn(), notifySuccess: vi.fn(), notifyError: vi.fn(), notifyWarning: vi.fn() }));

// HU-C02 (C02.3/C02.7): eliminar una visita del residente usa la confirmacion de
// SweetAlert2 (antes window.confirm) y anuncia exito/error sin duplicarlo en la pagina.
const visit = {
  id_acceso: 41, id_visitante: 9, nombre: "Pedro Ramirez", dpi: "1234567890101", placa: "", fecha: "2099-01-01",
  hora_inicio: "10:00", hora_fin: "11:00", tipo_visita: "VISITA" as const, estado_acceso: "AUTORIZADA" as const, qr_status: "VALID" as const,
};

describe("HU-C02 eliminar visita del residente", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getVisitsRequest).mockResolvedValue([visit]);
    vi.mocked(getFrequentVisitorsRequest).mockResolvedValue([]);
    vi.mocked(getVisitScheduleConfigRequest).mockResolvedValue({ dias_habilitados: [0, 1, 2, 3, 4, 5, 6], hora_apertura: "00:00", hora_cierre: "23:59", duracion_maxima_horas: 24, activo: true });
  });

  const openAndDelete = async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ResidenteVisitsView /></MemoryRouter>);
    await user.click(await screen.findByRole("button", { name: "Eliminar visita de Pedro Ramirez" }));
  };

  it("cancelar la confirmacion no elimina la visita", async () => {
    vi.mocked(confirmAction).mockResolvedValue(false);
    await openAndDelete();
    expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ title: "¿Eliminar la visita?", tone: "danger" }));
    expect(deleteVisitRequest).not.toHaveBeenCalled();
  });

  it("confirmar elimina, quita la tarjeta y anuncia el exito con SweetAlert2", async () => {
    vi.mocked(confirmAction).mockResolvedValue(true);
    vi.mocked(deleteVisitRequest).mockResolvedValue(undefined as never);
    await openAndDelete();
    await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith("Visita eliminada correctamente."));
    expect(deleteVisitRequest).toHaveBeenCalledWith(41);
    expect(screen.queryByRole("button", { name: "Eliminar visita de Pedro Ramirez" })).not.toBeInTheDocument();
    expect(screen.queryByText("Visita eliminada correctamente.")).not.toBeInTheDocument();
  });

  it("si el servidor rechaza la eliminacion se informa con SweetAlert2 y la visita se conserva", async () => {
    const failure = new ApiError("La visita ya registro su ingreso.", 409);
    vi.mocked(confirmAction).mockResolvedValue(true);
    vi.mocked(deleteVisitRequest).mockRejectedValue(failure);
    await openAndDelete();
    await waitFor(() => expect(notifyError).toHaveBeenCalledWith(failure, "No fue posible eliminar la visita."));
    expect(screen.getByRole("button", { name: "Eliminar visita de Pedro Ramirez" })).toBeInTheDocument();
  });
});
