import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { getResidentAccountStatementRequest, payResidentObligationRequest } from "@/services/accountService";
import { createResidentCheckoutRequest, redirectToRecurrente } from "@/services/recurrenteCheckoutService";
import { ResidenteAccountView } from "./ResidenteAccountView";
vi.mock("@/components/layout/AppShell", () => ({ AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/services/accountService", () => ({ getResidentAccountStatementRequest: vi.fn(), payResidentObligationRequest: vi.fn() }));
vi.mock("@/services/recurrenteCheckoutService", () => ({ createResidentCheckoutRequest: vi.fn(), redirectToRecurrente: vi.fn() }));
const pending = { resumen: { total_cuotas: 1, cuotas_pagadas: 0, cuotas_pendientes: 1, cuotas_vencidas: 0, saldo_pendiente: 115, total_pagado: 0, proximo_vencimiento: "2026-08-31", actualizado_en: "2026-08-20T12:00:00Z" }, cuotas: [{ id_cuota: 3, id_casa: 8, casa_unidad: "A-1", servicio: "Mantenimiento", tipo_servicio: "General", monto: 115, monto_base: 100, recargo: 15, monto_pagado: 0, saldo_pendiente: 115, fecha_limite: "2026-08-31", ultimo_pago: null, estado: "PENDIENTE" as const }] };
const checkout = { referencia_local: "local-test", checkout_url: "https://app.recurrente.com/checkout-session/ch_test" };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getResidentAccountStatementRequest).mockResolvedValue(pending); vi.mocked(createResidentCheckoutRequest).mockResolvedValue(checkout); });
const mount = () => render(<MemoryRouter><ResidenteAccountView /></MemoryRouter>);
it("abre checkout sin simulacion, confirmacion, comprobante ni refresco de pago", async () => {
  mount(); fireEvent.click(await screen.findByRole("button", { name: "Pagar" }));
  await waitFor(() => expect(redirectToRecurrente).toHaveBeenCalledWith(checkout.checkout_url));
  expect(createResidentCheckoutRequest).toHaveBeenCalledWith(3);
  expect(payResidentObligationRequest).not.toHaveBeenCalled();
  expect(screen.queryByText("Pago realizado")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Descargar comprobante" })).not.toBeInTheDocument();
  expect(getResidentAccountStatementRequest).toHaveBeenCalledTimes(1);
});
it("loading y doble clic generan solo una solicitud", async () => {
  let resolve!: (value: typeof checkout) => void;
  vi.mocked(createResidentCheckoutRequest).mockImplementation(() => new Promise((done) => { resolve = done; }));
  mount(); const button = await screen.findByRole("button", { name: "Pagar" });
  fireEvent.click(button); fireEvent.click(button);
  expect(screen.getByRole("button", { name: "Abriendo checkout..." })).toBeDisabled();
  expect(createResidentCheckoutRequest).toHaveBeenCalledTimes(1);
  resolve(checkout); await waitFor(() => expect(redirectToRecurrente).toHaveBeenCalledTimes(1));
});
it("error de negocio permite reintentar la solicitud y no cambia saldo", async () => {
  vi.mocked(createResidentCheckoutRequest).mockRejectedValue(new Error("Existe una operación pendiente de revisión."));
  mount(); fireEvent.click(await screen.findByRole("button", { name: "Pagar" }));
  expect(await screen.findByText("Existe una operación pendiente de revisión.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Pagar" })).toBeEnabled();
  expect(redirectToRecurrente).not.toHaveBeenCalled(); expect(payResidentObligationRequest).not.toHaveBeenCalled();
});
it("fallo de validacion de URL se muestra sin confirmar pago", async () => {
  vi.mocked(redirectToRecurrente).mockImplementation(() => { throw new Error("Dirección de checkout inválida."); });
  mount(); fireEvent.click(await screen.findByRole("button", { name: "Pagar" }));
  expect(await screen.findByText("Dirección de checkout inválida.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Pagar" })).toBeEnabled();
});
it("cuota pagada no permite abrir checkout", async () => {
  vi.mocked(getResidentAccountStatementRequest).mockResolvedValue({ ...pending, cuotas: [{ ...pending.cuotas[0], estado: "PAGADA", saldo_pendiente: 0, monto_pagado: 115 }] });
  mount(); await screen.findByText("Mantenimiento"); expect(screen.queryByRole("button", { name: "Pagar" })).not.toBeInTheDocument();
});
it("sobrepago historico deshabilita cobro", async () => {
  vi.mocked(getResidentAccountStatementRequest).mockResolvedValue({ ...pending, cuotas: [{ ...pending.cuotas[0], requiere_revision: true }] });
  mount(); expect(await screen.findByRole("button", { name: "Pagar" })).toBeDisabled();
});
it("no duplica la navegacion del sidebar y conserva Actualizar", async () => {
  mount(); await screen.findByText("Mantenimiento");
  expect(screen.queryByRole("button", { name: "Volver" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Actualizar" })).toBeEnabled();
});

it("propietario ve concepto, período y número de cuota", async () => {
  vi.mocked(getResidentAccountStatementRequest).mockResolvedValue({...pending,cuotas:[{...pending.cuotas[0],servicio:"Cuota de vivienda",periodo:"2026-08-01",numero_cuota:12},{...pending.cuotas[0],id_cuota:4,periodo:"2026-08-01"}]});
  mount();
  expect(await screen.findByText("Cuota de vivienda")).toBeInTheDocument();
  expect(screen.getByText("Mantenimiento")).toBeInTheDocument();
  expect(screen.getByText("Período 2026-08 · Cuota #12")).toBeInTheDocument();
});
