import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTenantAmenitiesHistoryRequest, getTenantAmenitiesReservationsRequest } from "@/services/amenitiesService";
import { TenantAmenitiesHistoryView } from "./TenantAmenitiesHistoryView";

vi.mock("@/components/layout/AppShell", () => ({ AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/services/amenitiesService", () => ({ getTenantAmenitiesHistoryRequest: vi.fn(), getTenantAmenitiesReservationsRequest: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getTenantAmenitiesReservationsRequest).mockResolvedValue([]);
  vi.mocked(getTenantAmenitiesHistoryRequest).mockResolvedValue([]);
});

describe("HU-C05.6 cuenta del inquilino", () => {
  it("muestra cancelación, responsable, fecha y motivo sin controles administrativos", async () => {
    vi.mocked(getTenantAmenitiesReservationsRequest).mockResolvedValue([{
      reservation_key: "7-2-2099-01-10-10:00", id_usuario: 7, id_amenidad: 2,
      amenidad_nombre: "Piscina", fecha: "2099-01-10", hora_inicio: "10:00", hora_fin: "11:00",
      estado: "CANCELADA", estado_actual: "CANCELADA", creada_por_admin: true, creada_por_nombre: "Admin A",
      cancelada_por_nombre: "Admin B", cancelada_en: "2026-10-27 18:00:00", motivo_cancelacion: "Mantenimiento",
    }]);
    render(<TenantAmenitiesHistoryView />);
    expect(await screen.findByText(/Cancelada por Admin B/)).toHaveTextContent("Mantenimiento");
    expect(screen.getByText(/Creada por administración: Admin A/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cancelar reserva|Guardar reserva/ })).not.toBeInTheDocument();
  });

  it("recarga el estado al regresar a la cuenta y permite reintentar un error", async () => {
    vi.mocked(getTenantAmenitiesReservationsRequest).mockRejectedValueOnce(new Error("No fue posible consultar tus reservas."));
    render(<TenantAmenitiesHistoryView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No fue posible consultar");
    fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));
    expect(await screen.findByText("No hay reservas en este período.")).toBeInTheDocument();
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(getTenantAmenitiesReservationsRequest).toHaveBeenCalledTimes(3);
    // No caller-supplied user id is ever sent.
    expect(getTenantAmenitiesReservationsRequest).toHaveBeenLastCalledWith({ from: expect.any(String), to: expect.any(String) });
  });
});
