import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "@/context/AuthContext";
import { useAuth } from "@/hooks/useAuth";
import { AdminRemindersView } from "./AdminRemindersView";
import { AdminSpecialAccessView } from "./AdminSpecialAccessView";

// Flujo completo vista -> servicio -> apiRequest -> AuthProvider con fetch simulado.
// Garantiza que un error funcional se muestra en pantalla y la sesión del administrador sigue viva.
// La acción pide confirmación con SweetAlert2; en estas pruebas el usuario confirma.
vi.mock("@/utils/feedback", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/feedback")>()),
  confirmAction: vi.fn(async () => true),
}));
vi.mock("@/components/admin/AdminLayout", () => ({
  AdminLayout: ({ children, actions }: { children: ReactNode; actions?: ReactNode }) => <main>{actions}{children}</main>,
}));

const SESSION = { id: 1, email: "admin@test.com", role: "admin", token: "token-admin" };
type Reply = { status: number; body: unknown };
let replies: Record<string, Reply>;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function SessionProbe() {
  const { isAuthenticated } = useAuth();
  return <p data-testid="sesion">{isAuthenticated ? "autenticado" : "sin sesion"}</p>;
}

function renderWithAuth(view: ReactNode) {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <SessionProbe />
        {view}
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function expectSessionAlive() {
  expect(screen.getByTestId("sesion")).toHaveTextContent("autenticado");
  expect(JSON.parse(window.localStorage.getItem("nexus.session") || "{}")).toMatchObject({ id: 1, token: "token-admin" });
}

beforeEach(() => {
  window.localStorage.setItem("nexus.session", JSON.stringify(SESSION));
  replies = {
    "GET /auth/session": { status: 200, body: { id: 1, email: "admin@test.com", role: "admin" } },
    "GET /admin/accesos-especiales/horario": { status: 200, body: { inicio: "06:00", fin: "22:00" } },
    "GET /admin/accesos-especiales/casas": { status: 200, body: [{ id_casa: 3, etiqueta: "A-101", propietario: "Ana" }] },
    "GET /admin/accesos-especiales/pendientes": { status: 200, body: [] },
    "GET /admin/accesos-especiales/historial": { status: 200, body: [] },
    "GET /admin/recordatorios/resumen": { status: 200, body: { total: 0, proximos: 0, vencidos: 0, enviados_hoy: 0 } },
    "GET /admin/recordatorios/configuracion": { status: 200, body: { activo: true, dias_antes: 3 } },
    "GET /admin/recordatorios": { status: 200, body: [] },
  };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const key = `${(init?.method || "GET").toUpperCase()} ${url.pathname}`;
    const reply = replies[key];
    return reply ? json(reply.status, reply.body) : json(404, { message: `Sin respuesta simulada para ${key}` });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

async function createSpecialAccess() {
  const user = userEvent.setup();
  await screen.findByText(/Horario permitido/);
  await user.type(screen.getByPlaceholderText("Nombre visitante"), "Visita Especial");
  await user.type(screen.getByPlaceholderText("DPI"), "1234567890101");
  await user.type(screen.getByPlaceholderText("P-123ABC"), "P-123ABC");
  await user.type(screen.getByPlaceholderText("Motivo de excepcion..."), "Entrega de mudanza");
  await user.click(screen.getByRole("button", { name: "Crear acceso especial" }));
}

describe("Acceso especial: crear", () => {
  it("crea el acceso, confirma en pantalla y el administrador sigue autenticado", async () => {
    replies["POST /admin/accesos-especiales"] = {
      status: 201,
      body: { id_acceso: 9, nombre: "Visita Especial", fecha: "2026-10-09", hora_inicio: "22:30", hora_fin: "23:30", requiere_aprobacion: true, estado: "PENDIENTE" },
    };
    renderWithAuth(<AdminSpecialAccessView />);

    await createSpecialAccess();

    expect(await screen.findByText(/Acceso especial registrado/)).toBeInTheDocument();
    await expectSessionAlive();
  }, 15000);

  it("un error de validación se muestra y NO cierra la sesión", async () => {
    replies["POST /admin/accesos-especiales"] = { status: 400, body: { message: "La hora de fin debe ser posterior a la hora de inicio." } };
    renderWithAuth(<AdminSpecialAccessView />);

    await createSpecialAccess();

    expect(await screen.findByText("La hora de fin debe ser posterior a la hora de inicio.")).toBeInTheDocument();
    await expectSessionAlive();
  }, 15000);

  it.each([
    [403, "Acceso restringido a administradores."],
    [409, "Ya existe un acceso especial en ese horario."],
  ])("un HTTP %i se muestra como error de la operación y NO cierra la sesión", async (status, message) => {
    replies["POST /admin/accesos-especiales"] = { status, body: { message } };
    renderWithAuth(<AdminSpecialAccessView />);

    await createSpecialAccess();

    expect(await screen.findByText(message)).toBeInTheDocument();
    await expectSessionAlive();
  }, 15000);

  it("un 401 real (sesión cerrada en el servidor) sí cierra la sesión", async () => {
    replies["POST /admin/accesos-especiales"] = { status: 401, body: { message: "La sesion fue cerrada o expiro." } };
    renderWithAuth(<AdminSpecialAccessView />);

    await createSpecialAccess();

    await waitFor(() => expect(screen.getByTestId("sesion")).toHaveTextContent("sin sesion"));
    expect(window.localStorage.getItem("nexus.session")).toBeNull();
  }, 15000);
});

describe("Recordatorios: enviar", () => {
  it("envía los recordatorios, confirma en pantalla y el administrador sigue autenticado", async () => {
    replies["POST /admin/recordatorios/generar"] = { status: 201, body: { enviados: 2, errores: 0, fecha_revision: "2026-10-08", activo: true } };
    const user = userEvent.setup();
    renderWithAuth(<AdminRemindersView />);

    await user.click(await screen.findByRole("button", { name: "Enviar recordatorios" }));

    expect(await screen.findByText("Se enviaron 2 recordatorios de pago.")).toBeInTheDocument();
    await expectSessionAlive();
  }, 15000);

  it.each([
    // El backend responde 500 con un mensaje genérico (nunca detalles internos).
    [500, { message: "Error interno del servidor" }, "Error interno del servidor"],
    // Un 500 sin cuerpo cae al mensaje genérico del cliente.
    [500, null, "Ocurrió un problema en el servidor. Intenta nuevamente."],
    [403, { message: "Acceso restringido a administradores." }, "Acceso restringido a administradores."],
  ])("un HTTP %i al enviar se muestra controlado y NO cierra la sesión", async (status, body, shown) => {
    replies["POST /admin/recordatorios/generar"] = { status, body };
    const user = userEvent.setup();
    renderWithAuth(<AdminRemindersView />);

    await user.click(await screen.findByRole("button", { name: "Enviar recordatorios" }));

    expect(await screen.findByText(shown)).toBeInTheDocument();
    await expectSessionAlive();
  }, 15000);
});
