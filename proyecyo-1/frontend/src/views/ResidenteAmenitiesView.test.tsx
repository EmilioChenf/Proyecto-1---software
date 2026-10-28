import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { ResidenteAmenitiesView } from "@/views/ResidenteAmenitiesView";
import { confirmAction } from "@/utils/feedback";
vi.mock("@/utils/feedback", () => ({ confirmAction: vi.fn(), notifyError: vi.fn() }));
import {
  cancelAmenitiesReservationRequest,
  getAmenityAvailabilityRequest,
  getAmenitiesRequest,
  getAmenitiesReservationHistoryRequest,
  getAmenitiesReservationsRequest,
} from "@/services/amenitiesService";

vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 9, email: "residente@nexus.test", role: "residente" } }),
}));

vi.mock("@/services/amenitiesService", () => ({
  cancelAmenitiesReservationRequest: vi.fn(),
  createAmenitiesReservationRequest: vi.fn(),
  getAmenityAvailabilityRequest: vi.fn(),
  getAmenitiesRequest: vi.fn(),
  getAmenitiesReservationHistoryRequest: vi.fn(),
  getAmenitiesReservationsRequest: vi.fn(),
  updateAmenitiesReservationRequest: vi.fn(),
}));

const amenity = {
  id_amenidad: 2,
  nombre: "Salon social",
  descripcion: "Eventos",
  hora_apertura: "08:00",
  hora_cierre: "20:00",
  intervalo_minutos: 60,
  activo: true,
};

describe("Reservas de amenidades del residente", () => {
  beforeEach(() => {
    vi.mocked(confirmAction).mockResolvedValue(true);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-07-13T06:00:00Z"));
    vi.mocked(getAmenitiesRequest).mockResolvedValue([amenity]);
    vi.mocked(getAmenitiesReservationHistoryRequest).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancela una reserva propia y actualiza la lista", async () => {
    const reservation = {
      reservation_key: "9-2-2026-07-13-10:00:00",
      id_usuario: 9,
      id_amenidad: 2,
      amenidad_nombre: "Salon social",
      fecha: "2026-07-13",
      hora_inicio: "10:00",
      hora_fin: "11:00",
      estado: "CONFIRMADA" as const,
      estado_actual: "CONFIRMADA" as const,
    };
    let reservations = [reservation];
    vi.mocked(getAmenitiesReservationsRequest).mockImplementation(async () => reservations);
    vi.mocked(getAmenityAvailabilityRequest).mockImplementation(async (_id, fecha) => ({
      amenidad: amenity,
      fecha,
      slots: [],
      reservas: reservations,
    }));
    vi.mocked(cancelAmenitiesReservationRequest).mockImplementation(async () => {
      reservations = [];
      return { ...reservation, estado: "CANCELADA", estado_actual: "CANCELADA" };
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ResidenteAmenitiesView />, { wrapper: MemoryRouter });

    await user.click(await screen.findByRole("button", { name: "Cancelar reserva" }));

    await waitFor(() => {
      expect(cancelAmenitiesReservationRequest).toHaveBeenCalledWith(reservation.reservation_key);
    });
    expect(await screen.findByText("Reserva de Salon social cancelada correctamente.")).toBeInTheDocument();
  });
});
