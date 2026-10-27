import type { ReactNode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  adminCancelAmenitiesReservationRequest,
  createAdminAmenitiesReservationRequest,
  getAdminAmenitiesRequest,
  getAdminAmenitiesReservationsRequest,
  getAdminAmenitiesUsersRequest,
  getAdminAmenityAvailabilityRequest,
  validateAdminAmenityConflictRequest,
} from "@/services/amenitiesService";
import type { AmenityReservation } from "@/types/amenities";
import { confirmAction, notifyError, notifySuccess, promptText } from "@/utils/feedback";
import { AdminAmenitiesReservationsView } from "@/views/AdminAmenitiesReservationsView";

vi.mock("@/components/admin/AdminLayout", () => ({ AdminLayout: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/services/amenitiesService", () => ({
  adminCancelAmenitiesReservationRequest: vi.fn(),
  createAdminAmenitiesReservationRequest: vi.fn(),
  getAdminAmenitiesRequest: vi.fn(),
  getAdminAmenitiesReservationsRequest: vi.fn(),
  getAdminAmenitiesUsersRequest: vi.fn(),
  getAdminAmenityAvailabilityRequest: vi.fn(),
  updateAmenityScheduleRequest: vi.fn(),
  validateAdminAmenityConflictRequest: vi.fn(),
}));
vi.mock("@/utils/feedback", () => ({
  confirmAction: vi.fn(),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
  promptText: vi.fn(),
}));

function localDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

const today = localDate();
const amenity = { id_amenidad: 1, nombre: "Piscina", descripcion: "", hora_apertura: "08:00", hora_cierre: "20:00", intervalo_minutos: 60, activo: true };
const user = { id_usuario: 7, nombre: "Ana Lopez", rol: "residente" as const, unidad: "A-1" };

function reservation(overrides: Partial<AmenityReservation> = {}): AmenityReservation {
  return {
    reservation_key: `7-1-${today}-21:00`,
    id_usuario: 7,
    id_amenidad: 1,
    amenidad_nombre: "Piscina",
    fecha: today,
    hora_inicio: "21:00",
    hora_fin: "22:00",
    estado: "CONFIRMADA",
    estado_actual: "CONFIRMADA",
    usuario_nombre: "Ana Lopez",
    usuario_rol: "residente",
    unidad: "A-1",
    ...overrides,
  };
}

// Manana: siempre figura en "Proximas reservas", sin depender de la hora de la prueba.
const upcoming = reservation({ reservation_key: `7-1-${localDate(1)}-10:00`, fecha: localDate(1), hora_inicio: "10:00", hora_fin: "11:00" });
const active = reservation();
const cancelled = reservation({
  reservation_key: `9-1-${today}-22:00`,
  id_usuario: 9,
  hora_inicio: "22:00",
  hora_fin: "23:00",
  estado: "CANCELADA",
  estado_actual: "CANCELADA",
  usuario_nombre: "Luis Perez",
  cancelada_por_nombre: "Admin Uno",
  cancelada_en: `${today} 15:00:00`,
  motivo_cancelacion: "Mantenimiento",
});

describe("HU-C05 administracion de reservas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdminAmenitiesRequest).mockResolvedValue([amenity]);
    vi.mocked(getAdminAmenitiesUsersRequest).mockResolvedValue([user]);
    vi.mocked(getAdminAmenitiesReservationsRequest).mockResolvedValue([active, cancelled, upcoming]);
    vi.mocked(getAdminAmenityAvailabilityRequest).mockResolvedValue({
      amenidad: amenity,
      fecha: localDate(2),
      slots: [{ hora_inicio: "10:00", hora_fin: "11:00", disponible: true, reserva: null }],
      reservas: [],
    });
  });

  it("HU-C05.7: el calendario no cuenta la reserva cancelada como ocupacion activa", async () => {
    render(<AdminAmenitiesReservationsView />);
    const dayNumber = String(Number(today.slice(8, 10)));
    const cells = await screen.findAllByRole("button", { name: new RegExp(`^${dayNumber}`) });
    const todayCell = cells.find((cell) => within(cell).queryByText("1 reserva"));
    expect(todayCell).toBeDefined();
    expect(within(todayCell as HTMLElement).getByText("1 cancelada")).toBeInTheDocument();
    expect(screen.queryByText("2 reservas")).not.toBeInTheDocument();
  });

  it("HU-C05.5: muestra quien cancelo, cuando y el motivo", async () => {
    render(<AdminAmenitiesReservationsView />);
    expect(await screen.findByText("Cancelaciones recientes")).toBeInTheDocument();
    expect(screen.getByText(/Cancelada por Admin Uno/)).toHaveTextContent("Motivo: Mantenimiento");
  });

  it("HU-C05.4: el administrador cancela con motivo y el panel se actualiza", async () => {
    vi.mocked(promptText).mockResolvedValue("Fuga de agua");
    vi.mocked(adminCancelAmenitiesReservationRequest).mockResolvedValue({ ...upcoming, estado: "CANCELADA", estado_actual: "CANCELADA" });
    render(<AdminAmenitiesReservationsView />);
    await userEvent.click(await screen.findByRole("button", { name: "Cancelar reserva de Ana Lopez en Piscina" }));
    await waitFor(() => expect(adminCancelAmenitiesReservationRequest).toHaveBeenCalledWith(upcoming.reservation_key, "Fuga de agua"));
    expect(promptText).toHaveBeenCalledWith(expect.objectContaining({ tone: "danger", label: "Motivo de la cancelación (opcional)" }));
    await waitFor(() => expect(notifySuccess).toHaveBeenCalled());
    expect(getAdminAmenitiesReservationsRequest).toHaveBeenCalledTimes(2);
  });

  it("HU-C05.4: si el administrador vuelve atras no se cancela nada; un error se informa", async () => {
    vi.mocked(promptText).mockResolvedValueOnce(null);
    render(<AdminAmenitiesReservationsView />);
    const button = await screen.findByRole("button", { name: "Cancelar reserva de Ana Lopez en Piscina" });
    await userEvent.click(button);
    expect(adminCancelAmenitiesReservationRequest).not.toHaveBeenCalled();

    const failure = new Error("La reserva ya fue cancelada.");
    vi.mocked(promptText).mockResolvedValueOnce("");
    vi.mocked(adminCancelAmenitiesReservationRequest).mockRejectedValueOnce(failure);
    await userEvent.click(button);
    await waitFor(() => expect(notifyError).toHaveBeenCalledWith(failure, "No fue posible cancelar la reserva."));
    expect(adminCancelAmenitiesReservationRequest).toHaveBeenCalledWith(upcoming.reservation_key, undefined);
  });

  it("HU-C05.10: reservar en nombre de otra persona exige confirmacion explicita", async () => {
    vi.mocked(validateAdminAmenityConflictRequest).mockResolvedValue({
      conflicto: false, reserva: null, limite_alcanzado: false, limite_reservas: 3, reservas_activas_usuario: 0, mensaje_limite: null,
    });
    vi.mocked(confirmAction).mockResolvedValueOnce(false);
    render(<AdminAmenitiesReservationsView />);
    await userEvent.click(await screen.findByRole("button", { name: /Nueva Reserva/ }));
    await userEvent.click(await screen.findByRole("button", { name: /10:00 - 11:00/ }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar reserva" }));

    await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
    const options = vi.mocked(confirmAction).mock.calls[0][0];
    expect(options.title).toBe("¿Reservar en nombre de otra persona?");
    expect(options.text).toContain("Ana Lopez (A-1)");
    expect(options.text).toContain("Piscina");
    expect(createAdminAmenitiesReservationRequest).not.toHaveBeenCalled();

    vi.mocked(confirmAction).mockResolvedValueOnce(true);
    vi.mocked(createAdminAmenitiesReservationRequest).mockResolvedValue(reservation({ hora_inicio: "10:00", hora_fin: "11:00" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar reserva" }));
    await waitFor(() =>
      expect(createAdminAmenitiesReservationRequest).toHaveBeenCalledWith(
        expect.objectContaining({ id_usuario: 7, id_amenidad: 1, hora_inicio: "10:00", hora_fin: "11:00" }),
      ),
    );
  });
});
