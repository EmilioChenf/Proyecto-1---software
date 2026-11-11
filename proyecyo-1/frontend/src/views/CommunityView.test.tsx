import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { CommunityView } from "@/views/CommunityView";
import { listContactsRequest, listDocumentsRequest, listPollsRequest, votePollRequest } from "@/services/communityService";
import { confirmAction } from "@/utils/feedback";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 3, email: "res@nexus.test", role: "residente" }, logout: vi.fn() }) }));
vi.mock("@/services/communityService", () => ({ listPollsRequest: vi.fn(), listDocumentsRequest: vi.fn(), listContactsRequest: vi.fn(), votePollRequest: vi.fn(), downloadDocument: vi.fn() }));
vi.mock("@/utils/feedback", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn(), confirmAction: vi.fn() }));
vi.mock("@/services/notificationsService", () => ({ getUnreadNotificationsCountRequest: vi.fn().mockResolvedValue({ total: 0 }), getUnreadCountRequest: vi.fn().mockResolvedValue({ total: 0 }) }));

const poll = { id_votacion: 1, titulo: "¿Cámaras en la entrada?", descripcion: null, fecha_cierre: "2026-11-20 18:00", abierta: true, resultados_visibles: true, total_votos: 0, viviendas: 10, participacion: 0,
  opciones: [{ id_opcion: 5, texto: "Sí", votos: null }, { id_opcion: 6, texto: "No", votos: null }], mostrar_resultados: false, mi_voto: null, puede_votar: true, sin_vivienda: false };

describe("CommunityView", () => {
  it("el residente vota y luego ve los resultados; el directorio permite llamar", async () => {
    vi.mocked(listPollsRequest).mockResolvedValue([poll]);
    vi.mocked(listDocumentsRequest).mockResolvedValue([]);
    vi.mocked(listContactsRequest).mockResolvedValue([{ id_contacto: 1, nombre: "Policía Nacional Civil", categoria: "EMERGENCIA", telefono: "110", correo: null, nota: null, orden: 1 }]);
    vi.mocked(confirmAction).mockResolvedValue(true);
    vi.mocked(votePollRequest).mockResolvedValue({ ...poll, puede_votar: false, mi_voto: 5, mostrar_resultados: true, total_votos: 1, participacion: 10, opciones: [{ id_opcion: 5, texto: "Sí", votos: 1 }, { id_opcion: 6, texto: "No", votos: 0 }] });
    const user = userEvent.setup();
    render(<MemoryRouter><CommunityView /></MemoryRouter>);
    await user.click(await screen.findByRole("button", { name: "Sí" }));
    await waitFor(() => expect(votePollRequest).toHaveBeenCalledWith(1, 5));
    expect(await screen.findByText("100%")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Directorio/ }));
    expect(screen.getByRole("link", { name: "Llamar a Policía Nacional Civil" })).toHaveAttribute("href", "tel:110");
  });
});
