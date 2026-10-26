import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getVisitScheduleConfigRequest } from "@/services/configurationService";
import {
  createVisitRequest,
  deleteFrequentVisitorRequest,
  getFrequentVisitorsRequest,
  getVisitsRequest,
  updateFrequentVisitorRequest,
} from "@/services/visitsService";
import { confirmAction, notifyError, notifySuccess } from "@/utils/feedback";
import { ResidenteVisitsView } from "@/views/ResidenteVisitsView";

vi.mock("@/components/layout/AppShell", () => ({ AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/visits/QrCodeCard", () => ({ QrCodeCard: () => <div>Codigo QR</div> }));
vi.mock("@/services/visitsService", () => ({
  createVisitRequest: vi.fn(),
  deleteFrequentVisitorRequest: vi.fn(),
  deleteVisitRequest: vi.fn(),
  getFrequentVisitorsRequest: vi.fn(),
  getVisitsRequest: vi.fn(),
  updateFrequentVisitorRequest: vi.fn(),
}));
vi.mock("@/services/configurationService", () => ({ getVisitScheduleConfigRequest: vi.fn() }));
vi.mock("@/utils/feedback", () => ({ confirmAction: vi.fn(), notifySuccess: vi.fn(), notifyError: vi.fn(), notifyWarning: vi.fn() }));

const scheduleConfig = {
  dias_habilitados: [0, 1, 2, 3, 4, 5, 6],
  hora_apertura: "00:00",
  hora_cierre: "23:59",
  duracion_maxima_horas: 24,
  activo: true,
};

const frequentVisitor = {
  id_visitante: 5,
  nombre: "Ana Lopez",
  dpi: "1234567890123",
  placa: null,
  total_visitas: 3,
};

describe("HU-C03 visitantes frecuentes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getVisitsRequest).mockResolvedValue([]);
    vi.mocked(getFrequentVisitorsRequest).mockResolvedValue([frequentVisitor]);
    vi.mocked(getVisitScheduleConfigRequest).mockResolvedValue(scheduleConfig);
  });

  it("HU-C03.4: muestra el boton de editar por cada visitante frecuente", async () => {
    render(<MemoryRouter><ResidenteVisitsView /></MemoryRouter>);
    const editBtn = await screen.findByRole("button", { name: /editar visitante frecuente ana lopez/i });
    expect(editBtn).toBeInTheDocument();
  });

  it("HU-C03.5: abrir el modal de edicion muestra los datos actuales del visitante", async () => {
    render(<MemoryRouter><ResidenteVisitsView /></MemoryRouter>);
    const editBtn = await screen.findByRole("button", { name: /editar visitante frecuente ana lopez/i });
    await userEvent.click(editBtn);
    expect(await screen.findByDisplayValue("Ana Lopez")).toBeInTheDocument();
  });

  it("HU-C03.6: soft delete muestra mensaje de exito al eliminar visitante con historial", async () => {
    vi.mocked(confirmAction).mockResolvedValue(true);
    vi.mocked(deleteFrequentVisitorRequest).mockResolvedValue({ id_visitante: 5, nombre: "Ana Lopez", desactivado: true });
    render(<MemoryRouter><ResidenteVisitsView /></MemoryRouter>);
    const deleteBtn = await screen.findByRole("button", { name: /eliminar visitante frecuente ana lopez/i });
    await userEvent.click(deleteBtn);
    await waitFor(() => expect(notifySuccess).toHaveBeenCalled());
  });

  it("HU-C03.8: error DUPLICATE_VISIT muestra mensaje claro al usuario", async () => {
    vi.mocked(getFrequentVisitorsRequest).mockResolvedValue([]);
    const dupError = Object.assign(new Error("Duplicado"), { status: 409, code: "DUPLICATE_VISIT" });
    vi.mocked(createVisitRequest).mockRejectedValue(dupError);
    render(<MemoryRouter><ResidenteVisitsView /></MemoryRouter>);
    await screen.findByText("No hay visitas registradas para esta residencia.");
    await userEvent.type(screen.getByLabelText("Nombre Completo *"), "Juan Perez");
    await userEvent.type(screen.getByLabelText(/DPI \/ Documento/), "1234567890123");
    await userEvent.click(screen.getByRole("button", { name: /siguiente/i }));
    const dateInput = screen.getByLabelText("Fecha de visita *");
    await userEvent.clear(dateInput);
    await userEvent.type(dateInput, "2099-12-31");
    await userEvent.click(screen.getByRole("button", { name: /siguiente/i }));
    await userEvent.click(screen.getByRole("button", { name: "Autorizar Visita" }));
    await waitFor(() =>
      expect(screen.getByText(/ya existe una visita autorizada/i)).toBeInTheDocument(),
    );
  });
});
