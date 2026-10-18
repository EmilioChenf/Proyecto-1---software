import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getGuardNotificationsRequest,
  getNotificationsRequest,
  markAllGuardNotificationsAsReadRequest,
} from "@/services/notificationsService";
import { getGuardAccessHistoryRequest } from "@/services/sprintStoriesService";
import {
  getGuardVisitsRequest,
  registerQrExitRequest,
  validateQrRequest,
} from "@/services/visitsService";
import type { VisitRecord } from "@/types/visits";
import { GuardiaView, type GuardiaSection } from "./GuardiaView";

vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ title, children }: { title: string; children: ReactNode }) => <main><h1>{title}</h1>{children}</main>,
}));
vi.mock("@/services/visitsService", () => ({
  getGuardVisitsRequest: vi.fn(), registerQrEntryRequest: vi.fn(), registerQrExitRequest: vi.fn(), validateQrRequest: vi.fn(),
}));
vi.mock("@/services/notificationsService", () => ({
  getGuardNotificationsRequest: vi.fn(), getNotificationsRequest: vi.fn(),
  markAllGuardNotificationsAsReadRequest: vi.fn(), markGuardNotificationAsReadRequest: vi.fn(),
}));
vi.mock("@/services/sprintStoriesService", () => ({ getGuardAccessHistoryRequest: vi.fn() }));

const insideVisit: VisitRecord = {
  id_acceso: 11, id_visitante: 1, nombre: "Ana Dentro", dpi: "", placa: "P1", fecha: "2026-10-04", hora_inicio: "09:00",
  hora_fin: "11:00", tipo_visita: "VISITA", estado_acceso: "INGRESO_REGISTRADO", qr_status: "USED", token_qr: "tok-11", casa: "A-1",
};

const renderSection = (section: GuardiaSection) => render(<MemoryRouter><GuardiaView section={section} /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getGuardVisitsRequest).mockResolvedValue([insideVisit]);
  vi.mocked(getGuardNotificationsRequest).mockResolvedValue([]);
  vi.mocked(getNotificationsRequest).mockResolvedValue([]);
  vi.mocked(getGuardAccessHistoryRequest).mockResolvedValue([]);
});

describe("GuardiaView por secciones", () => {
  it("Control de acceso valida un QR manual con la API existente", async () => {
    vi.mocked(validateQrRequest).mockResolvedValue({ ...insideVisit, nombre: "Beto Valido" });
    renderSection("control");
    expect(screen.getByRole("heading", { level: 1, name: "Control de acceso" })).toBeInTheDocument();
    expect(screen.queryByText("Control de ingresos")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Código QR manual"), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Validar QR" }));
    await waitFor(() => expect(validateQrRequest).toHaveBeenCalledWith({ qrToken: "abc" }));
    expect(await screen.findByText("Visita autorizada e ingreso registrado.")).toBeInTheDocument();
  });

  it("Visitas recientes lista visitas y registra salidas", async () => {
    vi.mocked(registerQrExitRequest).mockResolvedValue({ ...insideVisit, estado_acceso: "SALIDA_REGISTRADA", qr_status: "EXIT_REGISTERED", hora_salida: "10:30" });
    renderSection("visitas");
    expect(await screen.findByText("Ana Dentro")).toBeInTheDocument();
    expect(screen.queryByLabelText("Código QR manual")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Registrar salida" }));
    await waitFor(() => expect(registerQrExitRequest).toHaveBeenCalledWith({ qrToken: "tok-11" }));
  });

  it("Visitas recientes muestra estado vacío", async () => {
    vi.mocked(getGuardVisitsRequest).mockResolvedValue([]);
    renderSection("visitas");
    expect(await screen.findByText("No hay visitas registradas para el turno.")).toBeInTheDocument();
  });

  it("Historial consulta con filtros etiquetados", async () => {
    renderSection("historial");
    await waitFor(() => expect(getGuardAccessHistoryRequest).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Filtrar por estado"), { target: { value: "SALIDA" } });
    await waitFor(() => expect(getGuardAccessHistoryRequest).toHaveBeenLastCalledWith(expect.objectContaining({ status: "SALIDA" })));
    expect(screen.getByLabelText("Fecha del historial")).toBeInTheDocument();
    expect(screen.getByLabelText("Buscar visitante o casa")).toBeInTheDocument();
  });

  it("Alertas muestra cancelaciones, permite marcarlas y tiene estado vacío", async () => {
    vi.mocked(getGuardNotificationsRequest).mockResolvedValue([
      { id_notificacion: 3, id_usuario: 4, id_acceso: 11, tipo: "ACCESO_CANCELADO", titulo: "Acceso cancelado", mensaje: "No autorizar.", leido: false, creado_en: "2026-10-04 08:00:00", leido_en: null },
    ]);
    vi.mocked(markAllGuardNotificationsAsReadRequest).mockResolvedValue({ unread: 0 });
    renderSection("alertas");
    expect(await screen.findByText("Acceso cancelado")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Marcar todas/ }));
    expect(await screen.findByText(/No hay alertas pendientes/)).toBeInTheDocument();
    expect(markAllGuardNotificationsAsReadRequest).toHaveBeenCalledTimes(1);
  });
});

describe("HU32 Guardia: estados y errores", () => {
  it("un fallo del historial se muestra como error, no como 'Sin registros'", async () => {
    vi.mocked(getGuardAccessHistoryRequest).mockRejectedValue(new Error("Garita sin conexión"));
    renderSection("historial");
    expect(await screen.findByRole("alert")).toHaveTextContent("Garita sin conexión");
    expect(screen.queryByText("Sin registros para los filtros actuales.")).not.toBeInTheDocument();
  });

  it("el filtro Canceladas y los estados reales se envían al backend con etiquetas legibles", async () => {
    vi.mocked(getGuardAccessHistoryRequest).mockResolvedValue([
      { id_acceso: 9, visitante: "Rita Rechazo", placa: "Sin placa", casa: "A-1", tipo_visita: "VISITA", estado: "RECHAZADA", hora_programada: "10:00", hora_ingreso: null, hora_salida: null },
    ]);
    renderSection("historial");
    expect(await screen.findByText("Rechazada")).toBeInTheDocument();
    for (const option of ["Canceladas", "Rechazadas", "Por aprobar"]) expect(screen.getByRole("option", { name: option })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filtrar por estado"), { target: { value: "CANCELADA" } });
    await waitFor(() => expect(getGuardAccessHistoryRequest).toHaveBeenLastCalledWith(expect.objectContaining({ status: "CANCELADA" })));
  });

  it("HU-C08: el historial muestra qué guardia registró cada entrada y salida", async () => {
    vi.mocked(getGuardAccessHistoryRequest).mockResolvedValue([
      { id_acceso: 11, visitante: "Sara Salida", placa: "Sin placa", casa: "B-302", tipo_visita: "VISITA", estado: "SALIDA", hora_programada: "09:00", hora_ingreso: "09:05", hora_salida: "10:40", guardia_ingreso: "Guardia Norte", guardia_salida: "Guardia Sur" },
      { id_acceso: 12, visitante: "Hugo Historico", placa: "Sin placa", casa: "B-302", tipo_visita: "VISITA", estado: "INGRESO", hora_programada: "08:00", hora_ingreso: "08:02", hora_salida: null, guardia_ingreso: null, guardia_salida: null },
    ]);
    renderSection("historial");
    expect(await screen.findByText("por Guardia Norte")).toBeInTheDocument();
    expect(screen.getByText("por Guardia Sur")).toBeInTheDocument();
    // Registros historicos sin ejecutor no inventan autor.
    expect(screen.getAllByText(/^por /)).toHaveLength(2);
  });

  it("la fecha por defecto del historial es el día de Guatemala", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T05:30:00Z")); // 23:30 del 4 en Guatemala
    try {
      renderSection("historial");
      await waitFor(() => expect(getGuardAccessHistoryRequest).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-10-04" })));
      expect(screen.getByLabelText("Fecha del historial")).toHaveValue("2026-10-04");
    } finally {
      vi.useRealTimers();
    }
  });

  it("si las alertas fallan se informa el error en lugar de 'No hay alertas'", async () => {
    vi.mocked(getGuardNotificationsRequest).mockRejectedValue(new Error("Servicio de alertas caído"));
    renderSection("alertas");
    expect(await screen.findByText("Servicio de alertas caído")).toBeInTheDocument();
    expect(screen.queryByText(/No hay alertas pendientes/)).not.toBeInTheDocument();
  });
});
