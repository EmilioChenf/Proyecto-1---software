import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UsersManagement } from "@/components/admin/UsersManagement";
import { ApiError } from "@/services/api";
import { createUserRequest, deleteUserRequest, getUsersRequest, getUserTypesRequest } from "@/services/usersService";
import { confirmAction, notifyError, notifySuccess } from "@/utils/feedback";

vi.mock("@/services/usersService", () => ({
  createUserRequest: vi.fn(),
  deleteUserRequest: vi.fn(),
  getUserTypesRequest: vi.fn(),
  getUsersRequest: vi.fn(),
  updateUserRequest: vi.fn(),
}));
vi.mock("@/utils/feedback", () => ({ confirmAction: vi.fn(), notifySuccess: vi.fn(), notifyError: vi.fn(), notifyWarning: vi.fn() }));

// HU-C02 (C02.3/C02.6/C02.7): acciones de usuarios con SweetAlert2 (confirmar, exito,
// error) sin duplicar el mismo mensaje en banners de la pagina.
const ana = { id_usuario: 7, nombre: "Ana Lopez", correo: "ana@ejemplo.com", telefono: null, id_tipo_usuario: 1, rol: "admin" as const, unidad: null, id_casa: null, numero_casa: null, torre: null };

describe("HU-C02 acciones de usuarios con SweetAlert2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getUsersRequest).mockResolvedValue([ana]);
    vi.mocked(getUserTypesRequest).mockResolvedValue([{ id: 1, nombre: "admin" }]);
  });

  it("eliminar pide confirmacion destructiva; si se cancela no elimina", async () => {
    const user = userEvent.setup();
    vi.mocked(confirmAction).mockResolvedValue(false);
    render(<UsersManagement />);
    await user.click(await screen.findByRole("button", { name: "Eliminar" }));

    expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ title: "¿Eliminar a Ana Lopez?", tone: "danger", confirmText: "Eliminar usuario" }));
    expect(deleteUserRequest).not.toHaveBeenCalled();
    expect(notifySuccess).not.toHaveBeenCalled();
  });

  it("al confirmar elimina y anuncia el exito una sola vez (sin banner duplicado)", async () => {
    const user = userEvent.setup();
    vi.mocked(confirmAction).mockResolvedValue(true);
    vi.mocked(deleteUserRequest).mockResolvedValue(undefined as never);
    render(<UsersManagement />);
    await user.click(await screen.findByRole("button", { name: "Eliminar" }));

    await waitFor(() => expect(deleteUserRequest).toHaveBeenCalledWith(7));
    await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith("Usuario eliminado correctamente."));
    expect(screen.queryByText("Usuario eliminado correctamente.")).not.toBeInTheDocument();
    expect(screen.queryByText("Operacion completada")).not.toBeInTheDocument();
  });

  it("si eliminar falla, el error del servidor se muestra con SweetAlert2 y no en la pagina", async () => {
    const user = userEvent.setup();
    const failure = new ApiError("No se puede eliminar un usuario con historial.", 409);
    vi.mocked(confirmAction).mockResolvedValue(true);
    vi.mocked(deleteUserRequest).mockRejectedValue(failure);
    render(<UsersManagement />);
    await user.click(await screen.findByRole("button", { name: "Eliminar" }));

    await waitFor(() => expect(notifyError).toHaveBeenCalledWith(failure, "No fue posible eliminar el usuario."));
    expect(screen.queryByText("No se puede eliminar un usuario con historial.")).not.toBeInTheDocument();
  });

  it("crear un usuario cierra el modal y anuncia el exito", async () => {
    const user = userEvent.setup();
    vi.mocked(createUserRequest).mockResolvedValue(ana as never);
    render(<UsersManagement />);
    await user.click(await screen.findByRole("button", { name: "Crear usuario" }));
    await user.type(screen.getByLabelText("Nombre"), "Luis");
    await user.type(screen.getByLabelText("Correo"), "luis@ejemplo.com");
    await user.type(screen.getByLabelText("Contrasena"), "clave123");
    await user.selectOptions(screen.getByLabelText("Tipo de usuario"), "1");
    await user.click(screen.getAllByRole("button", { name: "Crear usuario" }).at(-1)!);

    await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith("Usuario creado correctamente."));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("un error al guardar se queda dentro del modal y no abre SweetAlert2", async () => {
    const user = userEvent.setup();
    vi.mocked(createUserRequest).mockRejectedValue(new ApiError("Ya existe un usuario con ese correo.", 409, { message: "Ya existe un usuario con ese correo." }));
    render(<UsersManagement />);
    await user.click(await screen.findByRole("button", { name: "Crear usuario" }));
    await user.type(screen.getByLabelText("Nombre"), "Luis");
    await user.type(screen.getByLabelText("Correo"), "ana@ejemplo.com");
    await user.type(screen.getByLabelText("Contrasena"), "clave123");
    await user.selectOptions(screen.getByLabelText("Tipo de usuario"), "1");
    await user.click(screen.getAllByRole("button", { name: "Crear usuario" }).at(-1)!);

    await waitFor(() => expect(screen.getByLabelText("Correo")).toHaveAccessibleDescription("Ya existe un usuario con ese correo."));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(notifyError).not.toHaveBeenCalled();
    expect(notifySuccess).not.toHaveBeenCalled();
  });
});
