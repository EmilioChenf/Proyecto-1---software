import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "@/context/AuthContext";
import { useAuth } from "@/hooks/useAuth";
import { ChangePasswordCard } from "./ChangePasswordCard";

// HU-C01: formulario -> authService -> apiRequest -> AuthProvider con fetch simulado.
const SESSION = { id: 7, email: "residente@test.com", role: "residente", token: "token-anterior" };
type Reply = { status: number; body: unknown };
let changeReply: Reply;
let fetchMock: ReturnType<typeof vi.fn>;

function SessionProbe() {
  const { isAuthenticated } = useAuth();
  return <p data-testid="sesion">{isAuthenticated ? "autenticado" : "sin sesion"}</p>;
}

function renderCard(onChanged = vi.fn()) {
  render(<MemoryRouter><AuthProvider><SessionProbe /><ChangePasswordCard onChanged={onChanged} /></AuthProvider></MemoryRouter>);
  return onChanged;
}

async function fill(current: string, next: string, confirmation: string) {
  const user = userEvent.setup();
  if (current) await user.type(screen.getByLabelText("Contrasena actual"), current);
  if (next) await user.type(screen.getByLabelText("Nueva contrasena"), next);
  if (confirmation) await user.type(screen.getByLabelText("Confirmar nueva contrasena"), confirmation);
  await user.click(screen.getByRole("button", { name: "Cambiar contrasena" }));
}

const changeCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/auth/password/change"));
const storedSession = () => JSON.parse(window.localStorage.getItem("nexus.session") || "{}");

beforeEach(() => {
  window.localStorage.setItem("nexus.session", JSON.stringify(SESSION));
  changeReply = { status: 200, body: { message: "Contrasena actualizada. Se cerraron tus demas sesiones.", id: 7, email: "residente@test.com", role: "residente", token: "token-nuevo" } };
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const reply = url.endsWith("/auth/password/change") ? changeReply : { status: 200, body: { id: 7, email: "residente@test.com", role: "residente" } };
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("HU-C01 cambio de contrasena propia", () => {
  it("envia actual, nueva y confirmacion con la sesion vigente y guarda el token nuevo", async () => {
    const onChanged = renderCard();
    await fill("Inicial123", "Renovada456", "Renovada456");

    expect(await screen.findByText("Contrasena actualizada. Se cerraron tus demas sesiones.")).toBeInTheDocument();
    const [, init] = changeCalls()[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ currentPassword: "Inicial123", newPassword: "Renovada456", confirmPassword: "Renovada456" });
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer token-anterior");
    expect(storedSession()).toEqual({ id: 7, email: "residente@test.com", role: "residente", token: "token-nuevo" });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Contrasena actual")).toHaveValue("");
  });

  it("no llama al servidor si falta un campo, la confirmacion difiere o la contrasena es debil", async () => {
    renderCard();
    await fill("", "Renovada456", "Distinta456");
    expect(screen.getByText("Ingresa tu contrasena actual.")).toBeInTheDocument();
    expect(screen.getByText("La confirmacion no coincide con la nueva contrasena.")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirmar nueva contrasena")).toHaveAttribute("aria-invalid", "true");

    await userEvent.setup().clear(screen.getByLabelText("Nueva contrasena"));
    await fill("Inicial123", "corta", "");
    expect(screen.getByText("La contrasena debe tener entre 8 y 128 caracteres e incluir letras y numeros.")).toBeInTheDocument();
    expect(changeCalls()).toHaveLength(0);
  });

  it("contrasena actual incorrecta: muestra el error en el campo y NO cierra la sesion", async () => {
    changeReply = { status: 400, body: { message: "La contrasena actual es incorrecta.", code: "CURRENT_PASSWORD_INVALID", errores: [{ field: "currentPassword", message: "La contrasena actual es incorrecta." }] } };
    renderCard();
    await fill("Equivocada1", "Renovada456", "Renovada456");

    expect(await screen.findAllByText("La contrasena actual es incorrecta.")).toHaveLength(2);
    expect(screen.getByLabelText("Contrasena actual")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByTestId("sesion")).toHaveTextContent("autenticado");
    expect(storedSession().token).toBe("token-anterior");
  });

  it("limite excedido: informa el 429 del servidor sin cerrar la sesion", async () => {
    changeReply = { status: 429, body: { message: "Demasiados intentos de cambio de contrasena. Intenta de nuevo mas tarde.", code: "RATE_LIMITED" } };
    renderCard();
    await fill("Inicial123", "Renovada456", "Renovada456");

    expect(await screen.findByText("Demasiados intentos de cambio de contrasena. Intenta de nuevo mas tarde.")).toBeInTheDocument();
    expect(screen.getByTestId("sesion")).toHaveTextContent("autenticado");
  });

  it("si la sesion ya fue revocada (401) se cierra la sesion local", async () => {
    changeReply = { status: 401, body: { message: "La sesion fue cerrada o expiro.", code: "SESSION_REVOKED" } };
    renderCard();
    await fill("Inicial123", "Renovada456", "Renovada456");

    await waitFor(() => expect(screen.getByTestId("sesion")).toHaveTextContent("sin sesion"));
    expect(window.localStorage.getItem("nexus.session")).toBeNull();
  });
});
