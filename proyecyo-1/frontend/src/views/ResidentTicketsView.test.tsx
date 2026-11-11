import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { createTicketRequest, listMyTicketsRequest } from "@/services/ticketsService";
import { ResidentTicketsView } from "./ResidentTicketsView";

vi.mock("@/components/residente/ResidentLayout", () => ({ ResidentLayout: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/inquilino/TenantLayout", () => ({ TenantLayout: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/services/ticketsService", () => ({ listMyTicketsRequest: vi.fn(), createTicketRequest: vi.fn(), getMyTicketRequest: vi.fn(), commentMyTicketRequest: vi.fn() }));

const detail = { id_ticket: 7, titulo: "Lámpara del parqueo", descripcion: "", categoria: "ELECTRICIDAD", prioridad: "MEDIA", estado: "ABIERTO", ubicacion: "Parqueo", reportado_por: "Residente", casa: "B-302", creado_en: "2026-11-11 10:00", actualizado_en: null, resuelto_en: null, tiene_foto: false, comentarios: 0, foto: null, historial: [] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listMyTicketsRequest).mockResolvedValue([]);
  vi.mocked(createTicketRequest).mockResolvedValue(detail as never);
});

it("el residente reporta una falla eligiendo categoría y lugar", async () => {
  render(<ResidentTicketsView />);
  expect(await screen.findByText("Aún no has reportado fallas.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Reportar una falla/ }));
  fireEvent.click(screen.getByRole("button", { name: /Agua y plomería/ }));
  fireEvent.change(screen.getByLabelText("Título del reporte"), { target: { value: "Fuga en el jardín" } });
  fireEvent.change(screen.getByLabelText("Ubicación"), { target: { value: "Área verde" } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar reporte" }));
  await waitFor(() => expect(createTicketRequest).toHaveBeenCalledWith({ titulo: "Fuga en el jardín", descripcion: "", categoria: "AGUA_PLOMERIA", ubicacion: "Área verde", foto: null }));
  expect(await screen.findByText("Reporte #7 · 💡 Electricidad · Casa B-302")).toBeInTheDocument();
});

it("no envía un reporte sin título", async () => {
  render(<ResidentTicketsView role="inquilino" />);
  await screen.findByText("Aún no has reportado fallas.");
  fireEvent.click(screen.getByRole("button", { name: /Reportar una falla/ }));
  fireEvent.click(screen.getByRole("button", { name: "Enviar reporte" }));
  expect(screen.getByRole("alert")).toHaveTextContent("mínimo 4 letras");
  expect(createTicketRequest).not.toHaveBeenCalled();
});
