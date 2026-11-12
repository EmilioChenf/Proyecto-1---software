import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { getGeneralConfigurationRequest, updateGeneralConfigurationRequest } from "@/services/configurationService";
import { GeneralSettings } from "./GeneralSettings";

vi.mock("@/services/configurationService", () => ({
  getGeneralConfigurationRequest: vi.fn(),
  updateGeneralConfigurationRequest: vi.fn(),
}));

const configuration = {
  nombre: "NexusResidencial",
  direccion: "Zona 10",
  correo_contacto: "admin@nexus.test",
  telefono_contacto: "+502 5555-5555",
  zona_horaria: "America/Guatemala",
  moneda: "GTQ" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getGeneralConfigurationRequest).mockResolvedValue(configuration);
});

it("carga, modifica y confirma la configuracion persistida", async () => {
  vi.mocked(updateGeneralConfigurationRequest).mockResolvedValue({ ...configuration, nombre: "Residencial Central" });
  render(<GeneralSettings />);
  const name = await screen.findByLabelText("Nombre del residencial");
  fireEvent.change(name, { target: { value: "Residencial Central" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar configuración" }));
  expect(await screen.findByText("La configuracion general fue guardada correctamente.")).toBeInTheDocument();
  expect(updateGeneralConfigurationRequest).toHaveBeenCalledWith(expect.objectContaining({ nombre: "Residencial Central" }));
});
