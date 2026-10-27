import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { ApiError } from "@/services/api";
import {
  createAmenitiesReservationRequest,
  getAmenityAvailabilityRequest,
  getAmenitiesRequest,
  getAmenitiesReservationHistoryRequest,
  getAmenitiesReservationsRequest,
  validateAmenityConflictRequest,
} from "@/services/amenitiesService";
import { notifyError } from "@/utils/feedback";
import { ResidenteAmenitiesView } from "@/views/ResidenteAmenitiesView";

vi.mock("@/components/layout/AppShell", () => ({ AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 9, email: "residente@nexus.test", role: "residente" } }) }));
vi.mock("@/utils/feedback", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn(), confirmAction: vi.fn() }));
vi.mock("@/services/amenitiesService", () => ({
  cancelAmenitiesReservationRequest: vi.fn(),
  createAmenitiesReservationRequest: vi.fn(),
  getAmenityAvailabilityRequest: vi.fn(),
  getAmenitiesRequest: vi.fn(),
  getAmenitiesReservationHistoryRequest: vi.fn(),
  getAmenitiesReservationsRequest: vi.fn(),
  updateAmenitiesReservationRequest: vi.fn(),
  validateAmenityConflictRequest: vi.fn(),
}));

const amenity = { id_amenidad: 2, nombre: "Salon social", descripcion: "", hora_apertura: "08:00", hora_cierre: "20:00", intervalo_minutos: 60, activo: true };
// 2026-07-13 10:30 en Guatemala (UTC-6): lunes.
const NOW = new Date("2026-07-13T16:30:00Z");

function availability(fecha: string) {
  return {
    amenidad: amenity,
    fecha,
    slots: [
      { hora_inicio: "09:00", hora_fin: "10:00", disponible: true, reserva: null },
      { hora_inicio: "11:00", hora_fin: "12:00", disponible: true, reserva: null },
    ],
    reservas: [],
  };
}

describe("HU-C05 reservas del residente: fechas pasadas y cancelaciones visibles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    vi.mocked(getAmenitiesRequest).mockResolvedValue([amenity]);
    vi.mocked(getAmenitiesReservationsRequest).mockResolvedValue([]);
    vi.mocked(getAmenitiesReservationHistoryRequest).mockResolvedValue([]);
    vi.mocked(getAmenityAvailabilityRequest).mockImplementation(async (_id: number, fecha: string) => availability(fecha));
  });
  afterEach(() => vi.useRealTimers());

  it("HU-C05.1/C05.2: un bloque que ya empezo hoy se muestra como pasado y no se puede elegir", async () => {
    render(<MemoryRouter initialEntries={["/residente/amenidades"]}><ResidenteAmenitiesView /></MemoryRouter>);
    const past = await screen.findByRole("button", { name: /09:00 - 10:00/ });
    expect(past).toBeDisabled();
    expect(past).toHaveTextContent("Horario pasado");
    expect(screen.getByRole("button", { name: /11:00 - 12:00/ })).toBeEnabled();
  });

  it("HU-C05.1: el error del servidor por fecha pasada se muestra como notificacion flotante", async () => {
    vi.mocked(validateAmenityConflictRequest).mockResolvedValue({
      conflicto: false, reserva: null, limite_alcanzado: false, limite_reservas: 3, reservas_activas_usuario: 0, mensaje_limite: null,
    });
    const failure = new ApiError("No se pueden registrar reservas en horarios pasados. Elige una fecha y hora futuras.", 400, {
      message: "No se pueden registrar reservas en horarios pasados. Elige una fecha y hora futuras.",
      code: "RESERVATION_IN_PAST",
    });
    vi.mocked(createAmenitiesReservationRequest).mockRejectedValue(failure);
    render(<MemoryRouter initialEntries={["/residente/amenidades"]}><ResidenteAmenitiesView /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: /11:00 - 12:00/ }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmar reserva" }));
    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith(failure, "No fue posible confirmar la reserva.", "No se puede reservar en el pasado"),
    );
  });

  it("HU-C05.1: elegir una fecha pasada muestra un aviso visible", async () => {
    // La vista toma la fecha inicial de la URL real (window.location).
    window.history.pushState({}, "", "/residente/amenidades?fecha=2026-07-10");
    try {
      render(<MemoryRouter initialEntries={["/residente/amenidades?fecha=2026-07-10"]}><ResidenteAmenitiesView /></MemoryRouter>);
      expect(await screen.findByText("Fecha pasada")).toBeInTheDocument();
      for (const slot of [/09:00 - 10:00/, /11:00 - 12:00/]) {
        expect(await screen.findByRole("button", { name: slot })).toBeDisabled();
      }
    } finally {
      window.history.pushState({}, "", "/");
    }
  });

  it("HU-C05.6: la cancelacion hecha por administracion aparece en el historial con su motivo", async () => {
    vi.mocked(getAmenitiesReservationHistoryRequest).mockResolvedValue([
      {
        id_historial: 4,
        accion: "CANCELACION_ADMIN",
        detalle: "Administración (Admin Uno) canceló la reserva de Salon social del 2026-07-15 10:00-11:00. Motivo: Mantenimiento",
        amenidad_nombre: "Salon social",
        fecha_anterior: "2026-07-15",
        hora_inicio_anterior: "10:00",
        hora_fin_anterior: "11:00",
        fecha_nueva: "2026-07-15",
        hora_inicio_nueva: "10:00",
        hora_fin_nueva: "11:00",
        estado_anterior: "CONFIRMADA",
        estado_nuevo: "CANCELADA",
        realizado_por_nombre: "Admin Uno",
        realizado_por_rol: "admin",
        motivo: "Mantenimiento",
        creado_en: "2026-07-13 16:00:00",
      },
    ]);
    render(<MemoryRouter initialEntries={["/residente/amenidades"]}><ResidenteAmenitiesView /></MemoryRouter>);
    expect(await screen.findByText("Cancelada por administración")).toBeInTheDocument();
    expect(screen.getByText(/Motivo: Mantenimiento/)).toBeInTheDocument();
  });
});
