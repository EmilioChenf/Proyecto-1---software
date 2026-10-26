import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/services/api";
import { getVisitScheduleConfigRequest } from "@/services/configurationService";
import { cancelVisitRequest, deleteVisitRequest, getFrequentVisitorsRequest, getVisitsRequest } from "@/services/visitsService";
import { confirmAction, notifyError, notifySuccess } from "@/utils/feedback";
import { ResidenteVisitsView } from "@/views/ResidenteVisitsView";

vi.mock("@/components/layout/AppShell", () => ({ AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/visits/QrCodeCard", () => ({ QrCodeCard: () => <div>Codigo QR</div> }));
vi.mock("@/services/visitsService", () => ({
  cancelVisitRequest: vi.fn(), createVisitRequest: vi.fn(), deleteFrequentVisitorRequest: vi.fn(), deleteVisitRequest: vi.fn(),
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

  it("HU-C04 cancela una visita con movimientos sin quitarla del historial", async () => {
    const historical = {
      ...visit, estado_acceso: "SALIDA_REGISTRADA" as const, qr_status: "EXIT_REGISTERED" as const,
      tiene_historial: true, hora_ingreso: "10:05", hora_salida: "10:55",
      guardia_ingreso: "Guardia A", guardia_salida: "Guardia B", qr_value: "NEXUSVISIT:original",
    };
    vi.mocked(getVisitsRequest).mockResolvedValue([historical]);
    vi.mocked(confirmAction).mockResolvedValue(true);
    vi.mocked(cancelVisitRequest).mockResolvedValue({ ...historical, estado_acceso: "CANCELADA", qr_status: "CANCELLED" });
    render(<MemoryRouter><ResidenteVisitsView /></MemoryRouter>);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Cancelar visita de Pedro Ramirez" }));
    await screen.findByText("Estado: Cancelada");
    expect(cancelVisitRequest).toHaveBeenCalledWith(41);
    expect(screen.getByText("Ingreso: 10:05 por Guardia A")).toBeInTheDocument();
    expect(screen.getByText("Salida: 10:55 por Guardia B")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminar visita de Pedro Ramirez" })).not.toBeInTheDocument();
    expect(screen.queryByText("Codigo QR")).not.toBeInTheDocument();
    expect(notifySuccess).toHaveBeenCalledWith("Visita cancelada. El historial se conserva.");
  });

  it("HU-C04 muestra una vencida sin ofrecer su QR", async () => {
    vi.mocked(getVisitsRequest).mockResolvedValue([{ ...visit, qr_status: "EXPIRED", qr_value: "NEXUSVISIT:old" }]);
    render(<MemoryRouter><ResidenteVisitsView /></MemoryRouter>);
    await screen.findByText("Estado: Vencida");
    expect(screen.getByText("Pedro Ramirez")).toBeInTheDocument();
    expect(screen.queryByText("Codigo QR")).not.toBeInTheDocument();
  });

  it("HU-C04 no cancela cuando se cierra la confirmacion", async () => {
    vi.mocked(confirmAction).mockResolvedValue(false);
    render(<MemoryRouter><ResidenteVisitsView /></MemoryRouter>);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Cancelar visita de Pedro Ramirez" }));
    expect(cancelVisitRequest).not.toHaveBeenCalled();
    expect(screen.getByText("Estado: Autorizada")).toBeInTheDocument();
  });
});
