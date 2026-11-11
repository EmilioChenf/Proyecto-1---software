import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AdminImportView } from "@/views/AdminImportView";
import { applyImportRequest, previewImportRequest } from "@/services/importService";
import { confirmAction } from "@/utils/feedback";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, email: "admin@nexus.test", role: "admin" }, logout: vi.fn() }) }));
vi.mock("@/services/importService", () => ({ downloadImportTemplate: vi.fn(), previewImportRequest: vi.fn(), applyImportRequest: vi.fn() }));
vi.mock("@/utils/feedback", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn(), confirmAction: vi.fn() }));

describe("AdminImportView", () => {
  it("revisa el archivo, muestra errores por fila e importa", async () => {
    vi.mocked(previewImportRequest).mockResolvedValue({
      viviendas: [{ fila: 2, estado: "NUEVA", errores: [], vivienda: "A-1" }],
      residentes: [{ fila: 2, estado: "ERROR", errores: ["El correo no es válido."], nombre: "Ana", correo: "ana@", vivienda: "A-1" }],
      inquilinos: [], saldos: [], resumen: { listas: 1, existentes: 0, errores: 1, ejemplos_ignorados: 0 },
    });
    vi.mocked(confirmAction).mockResolvedValue(true);
    vi.mocked(applyImportRequest).mockResolvedValue({ viviendas: 1, residentes: 0, inquilinos: 0, saldos: 0, omitidas: 1, invitaciones: 0, fallidas: [] });
    const user = userEvent.setup();
    render(<MemoryRouter><AdminImportView /></MemoryRouter>);
    await user.upload(screen.getByLabelText("Archivo de Excel"), new File(["x"], "datos.xlsx"));
    expect(await screen.findByText("Vivienda A-1")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Residentes/ }));
    expect(screen.getByText("El correo no es válido.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Importar 1 registros/ }));
    await waitFor(() => expect(applyImportRequest).toHaveBeenCalledWith(expect.stringContaining("base64"), true));
    expect(await screen.findByText("Importación terminada")).toBeInTheDocument();
  });
});
