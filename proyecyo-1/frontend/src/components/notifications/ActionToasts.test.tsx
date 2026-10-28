import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionToasts } from "./ActionToasts";
import { clearToasts, pushToast } from "@/utils/toastStore";

afterEach(() => { clearToasts(); vi.useRealTimers(); });

describe("Notificaciones de acciones", () => {
  it("muestra texto plano, deduplica y permite cerrar con teclado", () => {
    render(<ActionToasts />);
    act(() => { pushToast("error", "<b>Error al guardar</b>"); pushToast("error", "<b>Error al guardar</b>"); });
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByText("<b>Error al guardar</b>").querySelector("b")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar notificación" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("expira automáticamente y pausa mientras se lee o enfoca", () => {
    vi.useFakeTimers();
    render(<ActionToasts />);
    act(() => { pushToast("success", "Reserva confirmada."); });
    fireEvent.mouseEnter(screen.getByRole("status"));
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByText("Reserva confirmada.")).toBeInTheDocument();
    fireEvent.mouseLeave(screen.getByRole("status"));
    fireEvent.focus(screen.getByRole("button"));
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByRole("status")).toBeInTheDocument();
    fireEvent.blur(screen.getByRole("button"));
    act(() => { vi.advanceTimersByTime(4500); });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("limita los avisos visibles y conserva el resultado al cambiar de vista", () => {
    const { unmount } = render(<ActionToasts />);
    act(() => { for (let n = 0; n < 6; n++) pushToast("info", `Acción ${n}`); });
    expect(screen.getAllByRole("status")).toHaveLength(4);
    unmount();
    render(<ActionToasts />);
    expect(screen.getByText("Acción 5")).toBeInTheDocument();
    expect(screen.queryByText("Acción 0")).not.toBeInTheDocument();
  });
});
