import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import Swal from "sweetalert2";
import { afterEach, vi } from "vitest";

import { clearToasts, setAlertPresenter } from "@/utils/toastStore";

// Las vistas siguen llamando a los avisos reales; aqui solo se registran (sin ventana
// modal que oculte la pagina a las consultas por rol). Las pruebas de feedback y
// toastStore vuelven a usar SweetAlert2 real con sweetAlertPresenter.
setAlertPresenter(() => new Promise((resolve) => setTimeout(resolve, 0)));

// SweetAlert2 usa APIs del navegador que jsdom no implementa. En un navegador real,
// innerText equivale a textContent al asignarlo (no interpreta HTML).
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
if (!Object.getOwnPropertyDescriptor(HTMLElement.prototype, "innerText")) {
  Object.defineProperty(HTMLElement.prototype, "innerText", {
    configurable: true,
    get(this: HTMLElement) { return this.textContent; },
    set(this: HTMLElement, value: string) { this.textContent = value; },
  });
}

afterEach(() => {
  // La sesión de cada pestaña (sessionStorage) no debe pasar de una prueba a otra.
  try { window.sessionStorage.clear(); } catch { /* jsdom sin almacenamiento */ }
  // Ninguna ventana de SweetAlert2 abierta o en cola pasa a la siguiente prueba.
  clearToasts();
  Swal.close();
  cleanup();
  vi.restoreAllMocks();
});
