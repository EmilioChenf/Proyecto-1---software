import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TenantRequestsPanel } from "@/components/residente/TenantRequestsPanel";
import {
  getOwnerAuthorizationRequestsRequest,
  resolveOwnerAuthorizationRequest,
} from "@/services/sprintStoriesService";
import type { OwnerAuthorizationRequest } from "@/types/sprintStories";

// La acción pide confirmación con SweetAlert2; en estas pruebas el usuario confirma.
vi.mock("@/utils/feedback", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/feedback")>()),
  confirmAction: vi.fn(async () => true),
}));
vi.mock("@/services/sprintStoriesService", () => ({
  getOwnerAuthorizationRequestsRequest: vi.fn(),
  resolveOwnerAuthorizationRequest: vi.fn(),
}));

const pending: OwnerAuthorizationRequest = {
  id_solicitud: 4, accion: "Mudanza fuera de horario", motivo: "Traslado de muebles", estado: "PENDIENTE",
  respuesta: null, creado_en: "2026-10-05 06:00:00", actualizado_en: "2026-10-05 06:00:00", inquilino: "Ina Quilino", unidad: "B-302",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOwnerAuthorizationRequestsRequest).mockResolvedValue([pending]);
});

describe("HU32 solicitudes de inquilinos (residente)", () => {
  it("lista pendientes con inquilino y unidad, y las aprueba", async () => {
    vi.mocked(resolveOwnerAuthorizationRequest).mockResolvedValue({ ...pending, estado: "APROBADO" });
    render(<TenantRequestsPanel />);
    expect(await screen.findByText("Mudanza fuera de horario")).toBeInTheDocument();
    expect(screen.getByText(/Ina Quilino · Unidad B-302/)).toBeInTheDocument();
    expect(screen.getByLabelText("1 solicitudes pendientes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Aprobar Mudanza fuera de horario" }));
    await waitFor(() => expect(resolveOwnerAuthorizationRequest).toHaveBeenCalledWith(4, "APROBADO", ""));
    expect(await screen.findByRole("status")).toHaveTextContent("aprobada");
    expect(screen.getByText("No hay solicitudes pendientes de sus inquilinos.")).toBeInTheDocument();
    expect(within(screen.getByText("Resueltas recientemente").parentElement!).getByText("Aprobada")).toBeInTheDocument();
  });

  it("rechazar exige motivo y lo envía al backend", async () => {
    vi.mocked(resolveOwnerAuthorizationRequest).mockResolvedValue({ ...pending, estado: "RECHAZADO", respuesta: "No permitido" });
    render(<TenantRequestsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Rechazar Mudanza fuera de horario" }));
    const confirm = screen.getByRole("button", { name: "Confirmar rechazo" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Motivo del rechazo"), { target: { value: "No permitido" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(resolveOwnerAuthorizationRequest).toHaveBeenCalledWith(4, "RECHAZADO", "No permitido"));
  });

  it("un fallo al cargar se muestra como error, no como 'sin solicitudes'", async () => {
    vi.mocked(getOwnerAuthorizationRequestsRequest).mockRejectedValue(new Error("Servicio no disponible"));
    render(<TenantRequestsPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Servicio no disponible");
    expect(screen.queryByText("No hay solicitudes pendientes de sus inquilinos.")).not.toBeInTheDocument();
  });

  it("si ya fue resuelta en otro dispositivo, informa y refresca el estado real", async () => {
    vi.mocked(resolveOwnerAuthorizationRequest).mockRejectedValue(new Error("La solicitud ya fue resuelta."));
    render(<TenantRequestsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Aprobar Mudanza fuera de horario" }));
    expect(await screen.findByText("La solicitud ya fue resuelta.")).toBeInTheDocument();
    await waitFor(() => expect(getOwnerAuthorizationRequestsRequest).toHaveBeenCalledTimes(2));
  });
});
