import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AdminPaymentsIntegrationView } from "@/views/AdminPaymentsIntegrationView";
import { getFiscalSettingsRequest, getIntegrationStatusRequest, updateFiscalSettingsRequest } from "@/services/paymentsIntegrationService";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, email: "admin@nexus.test", role: "admin" }, logout: vi.fn() }) }));
vi.mock("@/services/paymentsIntegrationService", () => ({ getIntegrationStatusRequest: vi.fn(), getFiscalSettingsRequest: vi.fn(), updateFiscalSettingsRequest: vi.fn() }));
vi.mock("@/utils/feedback", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

describe("AdminPaymentsIntegrationView", () => {
  it("muestra el estado del sandbox y guarda los datos fiscales en modo simulado", async () => {
    const status = { recurrente: { modo: "SANDBOX", configurado: true, llave: "sk_test_…abcd", sandbox_id: "sbx_1234…wxyz", webhook_configurado: false, url_webhook: "https://api.x.com/webhooks/recurrente", conexion: { ok: true, mensaje: "Conexión correcta con el ambiente de pruebas de Recurrente." } }, fel: { modo: "DESACTIVADO", datos_completos: false, certificador: null }, produccion: [{ paso: "RTU actualizado", responsable: "Cliente" }] };
    vi.mocked(getIntegrationStatusRequest).mockResolvedValue(status);
    vi.mocked(getFiscalSettingsRequest).mockResolvedValue({ modo: "DESACTIVADO", nit: "", nombre_emisor: "", nombre_comercial: "", direccion: "", regimen: "GENERAL", certificador: "" });
    vi.mocked(updateFiscalSettingsRequest).mockImplementation(async (body) => body);
    const user = userEvent.setup();
    render(<MemoryRouter><AdminPaymentsIntegrationView /></MemoryRouter>);
    expect(await screen.findByText(/Llave sk_test_…abcd/)).toBeInTheDocument();
    expect(screen.getByText(/webhooks\/recurrente/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("NIT del emisor"), "576442-4");
    await user.type(screen.getByLabelText("Razón social"), "Asociación Las Brisas");
    await user.type(screen.getByLabelText("Dirección fiscal"), "Zona 16");
    await user.click(screen.getByLabelText("Mostrar factura simulada en comprobantes"));
    await user.click(screen.getByRole("button", { name: "Guardar datos fiscales" }));
    await waitFor(() => expect(updateFiscalSettingsRequest).toHaveBeenCalledWith(expect.objectContaining({ modo: "SIMULADO", nit: "576442-4" })));
    expect(screen.getByText("RTU actualizado")).toBeInTheDocument();
  });
});
