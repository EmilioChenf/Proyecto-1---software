import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publishReservationChange, useReservationUpdates } from "./useReservationUpdates";

afterEach(() => vi.useRealTimers());
describe("Actualización de calendarios abiertos", () => {
  it("recibe cambios locales, otras pestañas y el regreso al programa", () => {
    const { result, unmount } = renderHook(() => useReservationUpdates());
    act(publishReservationChange);
    expect(result.current).toBe(1);
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "nexus.reservations.changed" })));
    expect(result.current).toBe(2);
    act(() => window.dispatchEvent(new Event("focus")));
    expect(result.current).toBe(3);
    unmount();
    act(publishReservationChange);
    expect(result.current).toBe(3);
  });
  it("actualiza cada veinte segundos sin intervención del usuario", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useReservationUpdates());
    act(() => vi.advanceTimersByTime(20_000));
    expect(result.current).toBe(1);
  });
});
