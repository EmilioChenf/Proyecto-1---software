import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { UserFormModal } from "@/components/admin/UserFormModal";
import { ApiError } from "@/services/api";

vi.mock("@/services/housesService", () => ({ getHousesRequest: vi.fn().mockResolvedValue([]) }));

// HU-C02 (C02.4/C02.5): los errores del modal de usuarios quedan junto a su campo,
// el campo se marca como invalido (no solo con color) y el foco va al primer error.
const userTypes = [{ id: 1, nombre: "admin" }];

function renderModal(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  render(<UserFormModal isOpen isSubmitting={false} userTypes={userTypes} editingUser={null} onClose={vi.fn()} onSubmit={onSubmit} />);
  return onSubmit;
}

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Nombre"), "Ana Lopez");
  await user.type(screen.getByLabelText("Correo"), "ana@ejemplo.com");
  await user.type(screen.getByLabelText("Contrasena"), "clave123");
  await user.selectOptions(screen.getByLabelText("Tipo de usuario"), "1");
}

describe("HU-C02 validaciones dentro del modal de usuarios", () => {
  it("marca cada campo invalido, enlaza su mensaje y enfoca el primero", async () => {
    const user = userEvent.setup();
    const onSubmit = renderModal();
    await user.click(screen.getByRole("button", { name: "Crear usuario" }));

    for (const [label, message] of [["Nombre", "El nombre es obligatorio."], ["Correo", "El correo es obligatorio."],
      ["Contrasena", "La contrasena es obligatoria."], ["Tipo de usuario", "Seleccione un rol."]] as const) {
      const field = screen.getByLabelText(label);
      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(field).toHaveAccessibleDescription(message);
      // Icono + texto: el error no depende solo del color.
      const error = document.getElementById(field.getAttribute("aria-describedby") ?? "");
      expect(error?.querySelector("svg")).not.toBeNull();
    }
    expect(screen.getByLabelText("Tipo de usuario").className).toContain("aria-invalid:border-red-500");
    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveFocus());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("al corregir un campo y reenviar, deja de marcarse como invalido", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("button", { name: "Crear usuario" }));
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Crear usuario" }));
    expect(screen.getByLabelText("Nombre")).toHaveAttribute("aria-invalid", "false");
    expect(screen.getByLabelText("Correo")).not.toHaveAccessibleDescription();
  });

  it("correo ya registrado (409 del servidor): el error aparece en el campo Correo, no como aviso general", async () => {
    const user = userEvent.setup();
    renderModal(vi.fn().mockRejectedValue(new ApiError("Ya existe un usuario con ese correo.", 409, { message: "Ya existe un usuario con ese correo." })));
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Crear usuario" }));

    const email = screen.getByLabelText("Correo");
    await waitFor(() => expect(email).toHaveAttribute("aria-invalid", "true"));
    expect(email).toHaveAccessibleDescription("Ya existe un usuario con ese correo.");
    await waitFor(() => expect(email).toHaveFocus());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getAllByText("Ya existe un usuario con ese correo.")).toHaveLength(1);
  });

  it("errores por campo del servidor (errores[]) se ubican en sus campos", async () => {
    const user = userEvent.setup();
    const payload = { message: "Revisa los datos.", errores: [{ field: "nombre", message: "El nombre es demasiado largo." }] };
    renderModal(vi.fn().mockRejectedValue(new ApiError("Revisa los datos.", 400, payload, payload.errores)));
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Crear usuario" }));
    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveAccessibleDescription("El nombre es demasiado largo."));
  });

  it("un error del servidor sin campo se muestra una sola vez dentro del modal", async () => {
    const user = userEvent.setup();
    renderModal(vi.fn().mockRejectedValue(new ApiError("Ocurrió un problema en el servidor. Intenta nuevamente.", 500)));
    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "Crear usuario" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No se pudo guardar el usuario");
    expect(alert).toHaveTextContent("Ocurrió un problema en el servidor. Intenta nuevamente.");
    expect(screen.getByRole("dialog")).toContainElement(alert);
    expect(screen.getAllByText("Ocurrió un problema en el servidor. Intenta nuevamente.")).toHaveLength(1);
  });
});
