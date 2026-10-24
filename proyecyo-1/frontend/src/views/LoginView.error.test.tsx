import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuth } from "@/hooks/useAuth";
import { LoginView } from "./LoginView";

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));

describe("LoginView error state", () => {
  beforeEach(() => vi.mocked(useAuth).mockReset());

  it("muestra el error, termina el loading y conserva los valores", async () => {
    const login = vi.fn().mockRejectedValue(new Error("Credenciales incorrectas."));
    vi.mocked(useAuth).mockReturnValue({ login } as ReturnType<typeof useAuth>);

    render(<MemoryRouter><LoginView /></MemoryRouter>);
    const email = screen.getByLabelText("Correo electrónico");
    const password = screen.getByLabelText("Contraseña");
    fireEvent.change(email, { target: { value: "usuario@nexus.test" } });
    fireEvent.change(password, { target: { value: "clave-segura" } });
    fireEvent.click(screen.getByRole("button", { name: "Ingresar como administrador" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Credenciales incorrectas.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Ingresar como administrador" })).toBeEnabled());
    expect(email).toHaveValue("usuario@nexus.test");
    expect(password).toHaveValue("clave-segura");
    expect(login).toHaveBeenCalledOnce();
  });

  it("marca y limpia los errores de validacion al corregir los campos", () => {
    vi.mocked(useAuth).mockReturnValue({ login: vi.fn() } as ReturnType<typeof useAuth>);
    render(<MemoryRouter><LoginView /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: "Ingresar como administrador" }));
    const email = screen.getByLabelText("Correo electrónico");
    expect(email).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(email, { target: { value: "usuario@nexus.test" } });
    expect(email).toHaveAttribute("aria-invalid", "false");
  });
});
