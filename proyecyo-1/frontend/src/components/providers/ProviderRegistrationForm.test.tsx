import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderRegistrationForm } from "@/components/providers/ProviderRegistrationForm";
import { ApiError } from "@/services/api";
import { registerProviderRequest } from "@/services/providersService";
import { confirmAction } from "@/utils/feedback";

vi.mock("@/services/providersService", () => ({ registerProviderRequest: vi.fn() }));
vi.mock("@/utils/feedback", () => ({ confirmAction: vi.fn() }));

const registered = {
  proveedor: { id_servicio: 3, id_casa: 1, nombre: "Electricidad Lopez", estado: "VALIDADO" },
  acceso: { id_acceso: 9, tipo_visita: "PROVEEDOR", medio_ingreso: "VEHICULO" },
};

async function fillRequired(user: ReturnType<typeof userEvent.setup>, { plate = "P-123ABC" } = {}) {
  await user.type(screen.getByLabelText("Nombre del proveedor *"), "Electricidad Lopez");
  await user.type(screen.getByLabelText("Servicio que realizara *"), "Electricidad");
  if (plate) await user.type(screen.getByLabelText(/^Placa/), plate);
  await user.clear(screen.getByLabelText("Fecha *"));
  await user.type(screen.getByLabelText("Fecha *"), "2099-05-10");
  await user.clear(screen.getByLabelText("Hora de inicio *"));
  await user.type(screen.getByLabelText("Hora de inicio *"), "09:00");
  await user.clear(screen.getByLabelText("Hora de fin *"));
  await user.type(screen.getByLabelText("Hora de fin *"), "11:00");
}

describe("HU-C06 formulario de registro de proveedores", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("muestra junto al campo que la placa es obligatoria en vehiculo y no envia", async () => {
    const user = userEvent.setup();
    render(<ProviderRegistrationForm role="inquilino" />);
    await fillRequired(user, { plate: "" });
    await user.click(screen.getByRole("button", { name: /Registrar proveedor/ }));

    expect(screen.getByText("La placa es obligatoria cuando el proveedor ingresa en vehículo.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Placa/)).toHaveAttribute("aria-invalid", "true");
    expect(registerProviderRequest).not.toHaveBeenCalled();
  });

  it("a pie exige el DPI como identificador alternativo", async () => {
    const user = userEvent.setup();
    render(<ProviderRegistrationForm role="residente" />);
    await fillRequired(user, { plate: "" });
    await user.selectOptions(screen.getByLabelText("Medio de ingreso *"), "PEATONAL");
    await user.click(screen.getByRole("button", { name: /Registrar proveedor/ }));

    expect(screen.getByText("El DPI es obligatorio cuando el proveedor ingresa a pie.")).toBeInTheDocument();
    expect(registerProviderRequest).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/^DPI/), "1234567890123");
    vi.mocked(registerProviderRequest).mockResolvedValue(registered as never);
    await user.click(screen.getByRole("button", { name: /Registrar proveedor/ }));

    await waitFor(() =>
      expect(registerProviderRequest).toHaveBeenCalledWith(
        "residente",
        expect.objectContaining({ medio_ingreso: "PEATONAL", dpi: "1234567890123", placa: "" }),
      ),
    );
  });

  it("bloquea una fecha pasada con un mensaje visible", async () => {
    const user = userEvent.setup();
    render(<ProviderRegistrationForm role="inquilino" />);
    await fillRequired(user);
    await user.clear(screen.getByLabelText("Fecha *"));
    await user.type(screen.getByLabelText("Fecha *"), "2020-01-01");
    await user.click(screen.getByRole("button", { name: /Registrar proveedor/ }));

    expect(screen.getByText("La fecha seleccionada ya pasó. Elige hoy o una fecha futura.")).toBeInTheDocument();
    expect(registerProviderRequest).not.toHaveBeenCalled();
  });

  it("el administrador registra para la casa elegida y ve la confirmacion", async () => {
    const user = userEvent.setup();
    const onRegistered = vi.fn();
    vi.mocked(registerProviderRequest).mockResolvedValue(registered as never);
    render(
      <ProviderRegistrationForm
        role="admin"
        houses={[
          { id_casa: 1, etiqueta: "A-1" },
          { id_casa: 2, etiqueta: "B-2" },
        ]}
        onRegistered={onRegistered}
      />,
    );
    await fillRequired(user);
    await user.selectOptions(screen.getByLabelText("Casa / unidad *"), "2");
    await user.click(screen.getByRole("button", { name: /Registrar proveedor/ }));

    await waitFor(() => expect(onRegistered).toHaveBeenCalledWith(registered));
    expect(registerProviderRequest).toHaveBeenCalledWith(
      "admin",
      expect.objectContaining({ id_casa: 2, medio_ingreso: "VEHICULO", placa: "P-123ABC" }),
    );
    expect(screen.getByText(/Su QR ya esta disponible/)).toBeInTheDocument();
  });

  it("el inquilino nunca envia id_casa: el backend usa su unidad", async () => {
    const user = userEvent.setup();
    vi.mocked(registerProviderRequest).mockResolvedValue(registered as never);
    render(<ProviderRegistrationForm role="inquilino" fixedHouseLabel="A-12" />);
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /Registrar proveedor/ }));

    await waitFor(() => expect(registerProviderRequest).toHaveBeenCalled());
    expect(vi.mocked(registerProviderRequest).mock.calls[0][1].id_casa).toBeUndefined();
  });

  it("muestra el error del backend en el campo correspondiente", async () => {
    const user = userEvent.setup();
    vi.mocked(registerProviderRequest).mockRejectedValue(
      new ApiError("La hora de inicio ya pasó. Elige una hora a partir de las 10:00.", 400, {
        code: "VISIT_TIME_IN_PAST",
      }),
    );
    render(<ProviderRegistrationForm role="inquilino" />);
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /Registrar proveedor/ }));

    expect(await screen.findAllByText("La hora de inicio ya pasó. Elige una hora a partir de las 10:00.")).toHaveLength(2);
    expect(screen.getByLabelText("Hora de inicio *")).toHaveAttribute("aria-invalid", "true");
  });

  it("pide confirmacion antes de actualizar un visitante existente (HU-C03)", async () => {
    const user = userEvent.setup();
    vi.mocked(registerProviderRequest)
      .mockRejectedValueOnce(new ApiError("Ya existe un visitante registrado.", 409, { code: "VISITOR_DATA_CONFLICT" }))
      .mockResolvedValueOnce(registered as never);
    vi.mocked(confirmAction).mockResolvedValue(true);
    render(<ProviderRegistrationForm role="inquilino" />);
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: /Registrar proveedor/ }));

    await waitFor(() => expect(registerProviderRequest).toHaveBeenCalledTimes(2));
    expect(vi.mocked(registerProviderRequest).mock.calls[1][1]).toMatchObject({ confirmar_actualizacion: true });
  });
});
