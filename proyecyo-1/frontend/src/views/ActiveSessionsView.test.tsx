import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";

import { closeActiveSessionRequest, getActiveSessionsRequest } from "@/services/sessionsService";
import { confirmAction } from "@/utils/feedback";
import { ActiveSessionsView } from "./ActiveSessionsView";

const logout = vi.fn();
// La acción pide confirmación con SweetAlert2; en estas pruebas el usuario confirma.
vi.mock("@/utils/feedback", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/feedback")>()),
  confirmAction: vi.fn(async () => true),
}));
vi.mock("@/components/layout/AppShell", () => ({ AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 2, email: "user@test.com", role: "residente" }, logout }) }));
vi.mock("@/services/sessionsService", () => ({ getActiveSessionsRequest: vi.fn(), closeActiveSessionRequest: vi.fn() }));

const sessions = [
  { id_sesion: "current", dispositivo: "Chrome en Windows", direccion_ip: "127.0.0.1", creada_en: "2026-09-29 08:00:00", ultima_actividad_en: "2026-09-29 09:00:00", expira_en: "2026-09-29 17:00:00", actual: true },
  { id_sesion: "phone", dispositivo: "Safari en iOS", direccion_ip: "10.0.0.2", creada_en: "2026-09-28 08:00:00", ultima_actividad_en: "2026-09-29 08:30:00", expira_en: "2026-09-29 16:30:00", actual: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveSessionsRequest).mockResolvedValue(sessions);
});

it("cierra un dispositivo ajeno a la sesion actual y lo elimina de la lista", async () => {
  vi.mocked(closeActiveSessionRequest).mockResolvedValue({ id_sesion: "phone", cerrada: true, actual: false });
  render(<MemoryRouter><ActiveSessionsView /></MemoryRouter>);
  expect(await screen.findByText("Safari en iOS")).toBeInTheDocument();
  const buttons = screen.getAllByRole("button", { name: "Cerrar sesión" });
  fireEvent.click(buttons[1]);
  expect(await screen.findByText("Chrome en Windows")).toBeInTheDocument();
  expect(screen.queryByText("Safari en iOS")).not.toBeInTheDocument();
  expect(closeActiveSessionRequest).toHaveBeenCalledWith("phone");
  expect(logout).not.toHaveBeenCalled();
});

it("no duplica la navegacion del sidebar para el residente", async () => {
  render(<MemoryRouter><ActiveSessionsView /></MemoryRouter>);
  expect(await screen.findByText("Safari en iOS")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Volver al panel" })).not.toBeInTheDocument();
});

it("si el usuario responde \"No, cancelar\" en la confirmación, la sesión no se cierra", async () => {
  vi.mocked(confirmAction).mockResolvedValueOnce(false);
  render(<MemoryRouter><ActiveSessionsView /></MemoryRouter>);
  expect(await screen.findByText("Safari en iOS")).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: "Cerrar sesión" })[1]);
  await waitFor(() => expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ title: "¿Cerrar esta sesión?", tone: "danger" })));
  expect(closeActiveSessionRequest).not.toHaveBeenCalled();
  expect(screen.getByText("Safari en iOS")).toBeInTheDocument();
});
