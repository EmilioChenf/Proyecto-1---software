import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";

import { requestPasswordReset, resetPasswordRequest } from "@/services/passwordResetService";
import { ForgotPasswordView } from "./ForgotPasswordView";
import { ResetPasswordView } from "./ResetPasswordView";

vi.mock("@/services/passwordResetService", () => ({ requestPasswordReset: vi.fn(), resetPasswordRequest: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

it("muestra la respuesta generica al solicitar recuperacion", async () => {
  vi.mocked(requestPasswordReset).mockResolvedValue({ message: "Si el correo pertenece a una cuenta activa, enviaremos instrucciones." });
  render(<MemoryRouter><ForgotPasswordView /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText("Correo electronico"), { target: { value: "persona@test.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar instrucciones" }));
  expect(await screen.findByText(/Si el correo pertenece/)).toBeInTheDocument();
  expect(requestPasswordReset).toHaveBeenCalledWith("persona@test.com");
});

it("restablece la contrasena usando el token del enlace", async () => {
  vi.mocked(resetPasswordRequest).mockResolvedValue({ message: "Contrasena actualizada. Ya puedes iniciar sesion." });
  render(<MemoryRouter initialEntries={[`/restablecer-contrasena?token=${"a".repeat(64)}`]}><ResetPasswordView /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText("Nueva contrasena"), { target: { value: "Nexus2026" } });
  fireEvent.change(screen.getByLabelText("Confirmar contrasena"), { target: { value: "Nexus2026" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar nueva contrasena" }));
  expect(await screen.findByText(/Ya puedes iniciar sesion/)).toBeInTheDocument();
  expect(resetPasswordRequest).toHaveBeenCalledWith("a".repeat(64), "Nexus2026");
});
