import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useMobileDrawer } from "./useMobileDrawer";

function Drawer() {
  const [open, setOpen] = useState(false);
  const { menuButtonRef, drawerRef, contentRef, closeDrawer } = useMobileDrawer(open, setOpen);
  return <>
    <button ref={menuButtonRef} aria-expanded={open} onClick={() => setOpen(!open)}>Menú</button>
    <aside ref={drawerRef}>
      <a href="#inicio" aria-current="page" onClick={closeDrawer}>Inicio</a>
      <button onClick={closeDrawer}>Salir</button>
    </aside>
    <main ref={contentRef}><button>Contenido</button></main>
  </>;
}

let resize: (event: { matches: boolean }) => void;
const removeListener = vi.fn();

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: (_type: string, listener: typeof resize) => { resize = listener; },
    removeEventListener: removeListener,
  })));
  // jsdom no calcula rectángulos; simula elementos visibles para probar el teclado.
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
});

afterEach(() => vi.unstubAllGlobals());

it("enfoca el enlace activo y mantiene Tab y Shift+Tab dentro del menú", () => {
  render(<Drawer />);
  const toggle = screen.getByRole("button", { name: "Menú" });
  fireEvent.click(toggle);
  expect(screen.getByRole("link", { name: "Inicio" })).toHaveFocus();
  const last = screen.getByRole("button", { name: "Salir" });
  last.focus();
  fireEvent.keyDown(window, { key: "Tab" });
  expect(toggle).toHaveFocus();
  fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
  expect(last).toHaveFocus();
});

it("al pasar a escritorio cierra el panel y restaura el desplazamiento", () => {
  render(<Drawer />);
  const toggle = screen.getByRole("button", { name: "Menú" });
  fireEvent.click(toggle);
  expect(document.body.style.overflow).toBe("hidden");
  act(() => resize({ matches: true }));
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(document.body.style.overflow).not.toBe("hidden");
});

it("restaura el estado de la página al desmontar el menú abierto", () => {
  document.body.style.overflow = "auto";
  const view = render(<Drawer />);
  fireEvent.click(screen.getByRole("button", { name: "Menú" }));
  const main = screen.getByRole("main", { hidden: true });
  expect(main.inert).toBe(true);
  view.unmount();
  expect(main.inert).toBe(false);
  expect(document.body.style.overflow).toBe("auto");
  expect(removeListener).toHaveBeenCalled();
  document.body.style.overflow = "";
});
