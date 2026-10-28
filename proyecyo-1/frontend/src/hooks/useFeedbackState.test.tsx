import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useFeedbackState } from "./useFeedbackState";
import { clearToasts, dismissToast, toastStore } from "@/utils/toastStore";

afterEach(clearToasts);
describe("Estado de mensajes compartido por todos los roles", () => {
  it("mantiene el mensaje inline, ignora limpiezas y vuelve a avisar al repetir una acción", () => {
    const { result } = renderHook(() => useFeedbackState("success", ""));
    act(() => result.current[1]("Reserva confirmada."));
    expect(result.current[0]).toBe("Reserva confirmada.");
    expect(toastStore.getSnapshot()).toHaveLength(1);
    act(() => dismissToast(toastStore.getSnapshot()[0].id));
    act(() => result.current[1]("Reserva confirmada."));
    expect(toastStore.getSnapshot()).toHaveLength(1);
    act(() => result.current[1](""));
    expect(toastStore.getSnapshot()).toHaveLength(1);
  });

  it("oculta detalles técnicos y conserva estable el setter para efectos de carga", () => {
    const { result } = renderHook(() => useFeedbackState("error", ""));
    const setter = result.current[1];
    act(() => setter("mysql secret password"));
    expect(toastStore.getSnapshot()[0].message).not.toContain("mysql");
    expect(result.current[1]).toBe(setter);
  });
});
