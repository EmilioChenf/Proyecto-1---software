import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requestPasswordReset, resetPasswordRequest } from "@/services/passwordResetService";
import { ForgotPasswordView } from "./ForgotPasswordView";
import { ResetPasswordView } from "./ResetPasswordView";

vi.mock("@/services/passwordResetService", () => ({
  requestPasswordReset: vi.fn(),
  resetPasswordRequest: vi.fn(),
}));

beforeEach(() => vi.resetAllMocks());

describe("Recuperación: mensajes junto a los campos", () => {
  const renderRecovery = () => render(<MemoryRouter><ForgotPasswordView /></MemoryRouter>);

  it.each(["", "correo-invalido", "uno@@dominio.com"])("rechaza el correo %j, enfoca el campo y no envía la solicitud", (email) => {
    renderRecovery();
    const input = screen.getByLabelText("Correo electrónico");
    fireEvent.change(input, { target: { value: email } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar instrucciones" }));
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/Ingresa/);
    expect(requestPasswordReset).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "persona@dominio.com" } });
    expect(input).toHaveAttribute("aria-invalid", "false");
  });

  it("normaliza el correo, bloquea envíos repetidos y anuncia el éxito", async () => {
    let finish!: (value: { message: string }) => void;
    vi.mocked(requestPasswordReset).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    renderRecovery();
    const input = screen.getByLabelText("Correo electrónico");
    fireEvent.change(input, { target: { value: "Persona@Dominio.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar instrucciones" }));
    expect(input).toBeDisabled();
    expect(screen.getByRole("button", { name: "Enviando..." })).toBeDisabled();
    fireEvent.submit(input.closest("form")!);
    expect(requestPasswordReset).toHaveBeenCalledExactlyOnceWith("persona@dominio.com");
    finish({ message: "Si la cuenta existe, recibirás instrucciones." });
    expect(await screen.findByRole("status")).toHaveTextContent("Solicitud recibida");
    expect(input).toBeEnabled();
  });

  it("muestra un error seguro y permite reintentar conservando el correo", async () => {
    vi.mocked(requestPasswordReset).mockRejectedValue(new Error("SQLSTATE conexión mysql"));
    renderRecovery();
    const input = screen.getByLabelText("Correo electrónico");
    fireEvent.change(input, { target: { value: "persona@dominio.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar instrucciones" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Intenta nuevamente");
    expect(screen.getByRole("alert")).not.toHaveTextContent("SQLSTATE");
    expect(input).toHaveValue("persona@dominio.com");
    expect(screen.getByRole("button", { name: "Enviar instrucciones" })).toBeEnabled();
  });
});

describe("Restablecimiento: validación y navegación", () => {
  const renderReset = (url = "/restablecer-contrasena?token=ejemplo") => render(
    <MemoryRouter initialEntries={[url]}><ResetPasswordView /></MemoryRouter>,
  );

  it("un enlace incompleto permite solicitar otro e impide enviar el formulario", () => {
    renderReset("/restablecer-contrasena");
    expect(screen.getByRole("alert")).toHaveTextContent("Enlace de recuperación inválido");
    expect(screen.getByRole("link", { name: "Solicita un nuevo enlace" })).toHaveAttribute("href", "/olvide-contrasena");
    const input = screen.getByLabelText("Nueva contraseña");
    expect(input).toBeDisabled();
    fireEvent.submit(input.closest("form")!);
    expect(resetPasswordRequest).not.toHaveBeenCalled();
  });

  it("marca los campos vacíos y enfoca el primero", () => {
    renderReset();
    fireEvent.click(screen.getByRole("button", { name: "Guardar nueva contraseña" }));
    const password = screen.getByLabelText("Nueva contraseña");
    expect(password).toHaveFocus();
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveAccessibleDescription(/al menos 8 caracteres/);
    expect(screen.getByLabelText("Confirmar contraseña")).toHaveAccessibleDescription("Confirma tu nueva contraseña.");
    expect(resetPasswordRequest).not.toHaveBeenCalled();
  });

  it("enfoca la confirmación si no coincide, guarda al corregir y evita reutilizar el enlace", async () => {
    vi.mocked(resetPasswordRequest).mockResolvedValue({ message: "Tu contraseña se actualizó." });
    renderReset();
    const password = screen.getByLabelText("Nueva contraseña");
    const confirmation = screen.getByLabelText("Confirmar contraseña");
    fireEvent.change(password, { target: { value: "Segura123" } });
    fireEvent.change(confirmation, { target: { value: "Otra1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar nueva contraseña" }));
    expect(confirmation).toHaveFocus();
    expect(confirmation).toHaveAccessibleDescription("Las contraseñas no coinciden.");
    expect(resetPasswordRequest).not.toHaveBeenCalled();
    fireEvent.change(confirmation, { target: { value: "Segura123" } });
    expect(confirmation).toHaveAttribute("aria-invalid", "false");
    fireEvent.click(screen.getByRole("button", { name: "Guardar nueva contraseña" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Contraseña actualizada");
    expect(resetPasswordRequest).toHaveBeenCalledExactlyOnceWith("ejemplo", "Segura123");
    expect(password).toHaveValue("");
    expect(confirmation).toHaveValue("");
    expect(screen.getByRole("button", { name: "Guardar nueva contraseña" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Ir al inicio de sesión" })).toHaveAttribute("href", "/login");
  });

  it("conserva los campos y permite reintentar cuando falla el servidor", async () => {
    vi.mocked(resetPasswordRequest).mockRejectedValue(new Error("El enlace ha expirado. Solicita uno nuevo."));
    renderReset();
    fireEvent.change(screen.getByLabelText("Nueva contraseña"), { target: { value: "Segura123" } });
    fireEvent.change(screen.getByLabelText("Confirmar contraseña"), { target: { value: "Segura123" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar nueva contraseña" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("El enlace ha expirado");
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar nueva contraseña" })).toBeEnabled());
    expect(screen.getByLabelText("Nueva contraseña")).toHaveValue("Segura123");
  });
});
