import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { ResidentePaymentReturnView } from "./ResidentePaymentReturnView";
import { getResidentCheckoutStatusRequest, retryResidentCheckoutRequest, getTenantCheckoutStatusRequest, retryTenantCheckoutRequest, redirectToRecurrente } from "@/services/recurrenteCheckoutService";
import type { RecurrenteCheckoutStatus } from "@/types/recurrenteCheckout";
vi.mock("@/components/layout/AppShell", () => ({ AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/services/recurrenteCheckoutService", () => ({ getResidentCheckoutStatusRequest: vi.fn(), retryResidentCheckoutRequest: vi.fn(), getTenantCheckoutStatusRequest:vi.fn(),retryTenantCheckoutRequest:vi.fn(),redirectToRecurrente: vi.fn() }));
const reference = "00000000-0000-4000-8000-000000000015";
const status = (estado: RecurrenteCheckoutStatus["estado"] = "RECHAZADO", accion: RecurrenteCheckoutStatus["accion"] = "CONTINUAR"): RecurrenteCheckoutStatus => ({ referencia_local: reference, estado, accion, mensaje: "Estado consultado en backend." });
const mount = (query = "") => render(<MemoryRouter initialEntries={[`/residente/pagos/retorno?referencia=${reference}${query}`]}><ResidentePaymentReturnView /></MemoryRouter>);
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getResidentCheckoutStatusRequest).mockResolvedValue(status()); });
it("renta directa consulta su canal y no confirma por parámetros de retorno",async()=>{
  vi.mocked(getTenantCheckoutStatusRequest).mockResolvedValue(status('PENDIENTE','NINGUNA'));
  render(<MemoryRouter initialEntries={[`/inquilino/pagos/retorno?referencia=${reference}&status=paid`]}><ResidentePaymentReturnView tenant /></MemoryRouter>);
  expect(await screen.findByText("Tu pago está pendiente de verificación")).toBeInTheDocument();
  expect(getTenantCheckoutStatusRequest).toHaveBeenCalledWith(reference);
  expect(getResidentCheckoutStatusRequest).not.toHaveBeenCalled();
  expect(retryTenantCheckoutRequest).not.toHaveBeenCalled();
});
it("muestra carga y no permite retry mientras consulta estado", async () => {
  let resolve!: (s: RecurrenteCheckoutStatus) => void;
  vi.mocked(getResidentCheckoutStatusRequest).mockReturnValue(new Promise((r) => { resolve = r; }));
  mount(); expect(screen.getByRole("status")).toHaveTextContent("Consultando"); expect(screen.getByRole("button", { name: "Actualizar estado" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Verificar y continuar pago" })).not.toBeInTheDocument();
  await act(async () => resolve(status())); expect(await screen.findByText("Pago rechazado")).toBeInTheDocument();
});
it.each([
  ["RECHAZADO", "Pago rechazado"], ["FALLIDO", "Pago no completado"], ["CANCELADO", "Intento de pago cancelado"],
])("muestra resultado %s decidido en backend sin afirmar pago realizado", async (estado, title) => {
  vi.mocked(getResidentCheckoutStatusRequest).mockResolvedValue(status(estado as RecurrenteCheckoutStatus["estado"]));
  mount(); await screen.findByText(title); expect(screen.queryByText("Pago realizado")).not.toBeInTheDocument();
  expect(getResidentCheckoutStatusRequest).toHaveBeenCalledWith(reference);
});
it("cancel_url y status=paid no confirman ni cancelan financieramente", async () => {
  vi.mocked(getResidentCheckoutStatusRequest).mockResolvedValue(status("PENDIENTE", "NINGUNA"));
  mount("&status=paid&canceled=true&amount=0"); await waitFor(() => expect(getResidentCheckoutStatusRequest).toHaveBeenCalledTimes(1));
  expect(screen.getByText("Tu pago está pendiente de verificación")).toBeInTheDocument(); expect(screen.queryByText("Intento de pago cancelado")).not.toBeInTheDocument();
  expect(retryResidentCheckoutRequest).not.toHaveBeenCalled();
});
it.each(["INCIERTO", "CONFIRMADO", "CUOTA_PAGADA"] as const)("backend %s bloquea botón de retry", async (estado) => {
  vi.mocked(getResidentCheckoutStatusRequest).mockResolvedValue(status(estado, "NINGUNA")); mount();
  await screen.findByText("Estado consultado en backend."); expect(screen.queryByRole("button", { name: /Reintentar|continuar/ })).not.toBeInTheDocument();
  expect(retryResidentCheckoutRequest).not.toHaveBeenCalled();
});
it("continuación tiene loading, evita doble click y redirige solo con URL del backend", async () => {
  let resolve!: (s: { referencia_local: string; checkout_url: string }) => void;
  vi.mocked(retryResidentCheckoutRequest).mockReturnValue(new Promise((r) => { resolve = r; })); mount();
  const button = await screen.findByRole("button", { name: "Verificar y continuar pago" }); fireEvent.click(button); fireEvent.click(button);
  expect(retryResidentCheckoutRequest).toHaveBeenCalledTimes(1); expect(retryResidentCheckoutRequest).toHaveBeenCalledWith(reference);
  expect(screen.getByRole("button", { name: "Verificando checkout…" })).toBeDisabled();
  const url = "https://app.recurrente.com/checkout-session/ch_TEST"; await act(async () => resolve({ referencia_local: reference, checkout_url: url }));
  expect(redirectToRecurrente).toHaveBeenCalledWith(url); expect(screen.queryByText("Pago realizado")).not.toBeInTheDocument();
});
it("solo ofrece nuevo intento cuando backend lo permite", async () => {
  vi.mocked(getResidentCheckoutStatusRequest).mockResolvedValue(status("NO_COMPLETADO", "REINTENTAR"));
  vi.mocked(retryResidentCheckoutRequest).mockResolvedValue({ referencia_local: reference, checkout_url: "https://app.recurrente.com/checkout-session/ch_TEST" });
  mount(); fireEvent.click(await screen.findByRole("button", { name: "Reintentar pago" }));
  await waitFor(() => expect(retryResidentCheckoutRequest).toHaveBeenCalledTimes(1));
});
it("error de consulta no expone detalles y bloquea cobro", async () => {
  vi.mocked(getResidentCheckoutStatusRequest).mockRejectedValue(new Error("TEST_PRIVATE_DO_NOT_EXPOSE")); mount();
  await screen.findByText(/No se pudo consultar el estado/); expect(screen.queryByText("TEST_PRIVATE_DO_NOT_EXPOSE")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Reintentar|continuar/ })).not.toBeInTheDocument();
});
it("error/timeout de retry solicita verificar, no reintenta automáticamente", async () => {
  vi.mocked(retryResidentCheckoutRequest).mockRejectedValue(new Error("TEST_PROVIDER_RAW_ERROR")); mount();
  fireEvent.click(await screen.findByRole("button", { name: "Verificar y continuar pago" }));
  await screen.findByText(/No se pudo continuar el pago/); expect(screen.queryByText("TEST_PROVIDER_RAW_ERROR")).not.toBeInTheDocument();
  expect(retryResidentCheckoutRequest).toHaveBeenCalledTimes(1); expect(redirectToRecurrente).not.toHaveBeenCalled();
});
it("Actualizar estado consulta solamente el backend y actualiza su decisión", async () => {
  mount(); await screen.findByText("Pago rechazado"); vi.mocked(getResidentCheckoutStatusRequest).mockResolvedValue(status("CONFIRMADO", "NINGUNA"));
  fireEvent.click(screen.getByRole("button", { name: "Actualizar estado" })); await screen.findByText("Pago confirmado por el servidor");
  expect(retryResidentCheckoutRequest).not.toHaveBeenCalled(); expect(redirectToRecurrente).not.toHaveBeenCalled();
});
it('evidencia posterior en revisión muestra verificación, sin afirmar fallo ni ofrecer cobro',async()=>{
  vi.mocked(getResidentCheckoutStatusRequest).mockResolvedValue({...status('INCIERTO','NINGUNA'),
    mensaje:'Recibimos información adicional del proveedor y estamos verificando el resultado. No intentes pagar nuevamente.'});
  mount();await screen.findByText('Pago en verificación');
  expect(screen.getByText(/No intentes pagar nuevamente/)).toBeInTheDocument();
  expect(screen.queryByText('Pago no completado')).not.toBeInTheDocument();
  expect(screen.queryByText('Pago confirmado por el servidor')).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/Reintentar|continuar/})).not.toBeInTheDocument();
  expect(retryResidentCheckoutRequest).not.toHaveBeenCalled();expect(redirectToRecurrente).not.toHaveBeenCalled();
});
