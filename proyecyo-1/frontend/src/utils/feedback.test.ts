import Swal from "sweetalert2";
import { clearToasts, setAlertPresenter, sweetAlertPresenter, toastStore } from "./toastStore";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/services/api";
import { buildConfirmOptions, confirmAction, notifyError, notifySuccess, notifyWarning } from "./feedback";

// HU-C02: se prueba SweetAlert2 real (sin mocks) en jsdom.
const popup = () => document.querySelector(".swal2-popup") as HTMLElement | null;
const button = (selector: string) => document.querySelector(selector) as HTMLButtonElement;
const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeAll(() => {
  // Aqui se prueban las ventanas reales de SweetAlert2 (las pruebas de vistas solo las registran).
  setAlertPresenter(sweetAlertPresenter);
  // SweetAlert restores scroll position when a real browser closes a dialog.
  window.scrollTo = vi.fn();
  // jsdom no implementa innerText: SweetAlert2 lo usa para titleText (texto plano).
  // En un navegador, asignar innerText equivale a asignar textContent (no interpreta HTML).
  if (!Object.getOwnPropertyDescriptor(HTMLElement.prototype, "innerText")) {
    Object.defineProperty(HTMLElement.prototype, "innerText", {
      configurable: true,
      get(this: HTMLElement) { return this.textContent; },
      set(this: HTMLElement, value: string) { this.textContent = value; },
    });
  }
  // jsdom no implementa matchMedia (SweetAlert2 lo consulta); un navegador real si.
  if (!window.matchMedia) {
    window.matchMedia = (query: string) => ({
      matches: false, media: query, onchange: null,
      addListener: () => undefined, removeListener: () => undefined,
      addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
    });
  }
});

afterAll(() => setAlertPresenter(() => new Promise((resolve) => setTimeout(resolve, 0))));

afterEach(async () => {
  Swal.close();
  clearToasts();
  await new Promise((resolve) => setTimeout(resolve, 20));
});

describe("HU-C02 confirmaciones", () => {
  it("devuelve true solo al confirmar y muestra titulo, texto y botones en espanol", async () => {
    const pending = confirmAction({ title: "¿Eliminar a Ana?", text: "Esta acción no se puede deshacer.", confirmText: "Eliminar usuario", tone: "danger" });
    await nextTick();
    expect(popup()).not.toBeNull();
    expect(Swal.getTitle()?.textContent).toBe("¿Eliminar a Ana?");
    expect(Swal.getHtmlContainer()?.textContent).toBe("Esta acción no se puede deshacer.");
    expect(button(".swal2-confirm").textContent).toBe("Eliminar usuario");
    expect(button(".swal2-cancel").textContent).toBe("Cancelar");
    button(".swal2-confirm").click();
    await expect(pending).resolves.toBe(true);
  });

  it("cancelar devuelve false", async () => {
    const pending = confirmAction({ title: "¿Restaurar?", tone: "danger" });
    await nextTick();
    button(".swal2-cancel").click();
    await expect(pending).resolves.toBe(false);
  });

  // jsdom no calcula visibilidad y SweetAlert2 solo enfoca botones visibles: el foco se
  // verifica a traves de las opciones que recibe la libreria.
  it("en acciones destructivas el foco inicial va a Cancelar y Cancelar queda a la izquierda", () => {
    // Estilo unico del sistema: confirmar en verde y cancelar en rojo.
    expect(buildConfirmOptions({ title: "x", tone: "danger" })).toMatchObject({ focusCancel: true, reverseButtons: true, icon: "warning", confirmButtonColor: "#16A34A", cancelButtonColor: "#DC2626" });
    expect(buildConfirmOptions({ title: "x" })).toMatchObject({ focusCancel: false, icon: "question" });
  });

  it("el texto se inserta como texto, nunca como HTML", async () => {
    const pending = confirmAction({ title: "<img src=x onerror=alert(1)>", text: "<b>no html</b>" });
    await nextTick();
    expect(popup()?.querySelector("img[src=\"x\"], b")).toBeNull();
    expect(Swal.getTitle()?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(Swal.getHtmlContainer()?.textContent).toBe("<b>no html</b>");
    button(".swal2-cancel").click();
    await pending;
  });
});

describe("Resultado de cada acción como ventana de SweetAlert2", () => {
  it("el éxito abre una ventana con icono, título, texto y botón OK", async () => {
    void notifySuccess("La visita se creó correctamente.");
    await nextTick();
    expect(popup()).not.toBeNull();
    expect(popup()?.classList.contains("swal2-toast")).toBe(false);
    expect(document.querySelector(".swal2-icon.swal2-success")).not.toBeNull();
    expect(Swal.getTitle()?.textContent).toBe("¡Listo!");
    expect(Swal.getHtmlContainer()?.textContent).toBe("La visita se creó correctamente.");
    expect(button(".swal2-confirm").textContent).toBe("OK");
    button(".swal2-confirm").click();
    await nextTick();
    expect(toastStore.getSnapshot()).toHaveLength(0);
  });

  it("advertencia y error usan su icono y se muestran uno después del otro", async () => {
    void notifyWarning("Revisa la fecha antes de continuar.");
    void notifyError(new ApiError("La visita ya ingresó.", 409));
    await nextTick();
    expect(document.querySelector(".swal2-icon.swal2-warning")).not.toBeNull();
    expect(Swal.getTitle()?.textContent).toBe("Atención");
    button(".swal2-confirm").click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.querySelector(".swal2-icon.swal2-error")).not.toBeNull();
    expect(Swal.getHtmlContainer()?.textContent).toBe("La visita ya ingresó.");
  });

  it("los datos del usuario se muestran como texto, nunca como HTML", async () => {
    void notifySuccess("<img src=x onerror=alert(1)> creado.");
    await nextTick();
    expect(popup()?.querySelector("img[src=\"x\"]")).toBeNull();
    expect(Swal.getHtmlContainer()?.textContent).toBe("<img src=x onerror=alert(1)> creado.");
  });

  it("sanea detalles técnicos del servidor", async () => {
    await notifyError(new Error("ER_DUP_ENTRY: insert into USUARIO ... at query.js:12"), "No fue posible guardar el usuario.");
    expect(toastStore.getSnapshot()[0].message).toBe("No fue posible guardar el usuario.");
  });

  it("un 401 deja que la app cierre la sesión", async () => {
    await notifyError(new ApiError("Tu sesión ha expirado.", 401));
    expect(toastStore.getSnapshot()).toHaveLength(0);
  });

  it("deduplica resultados y no cierra una confirmación pendiente", async () => {
    const pending = confirmAction({ title: "¿Cancelar reserva?" });
    await nextTick();
    await notifyError("La visita ya no existe.");
    await notifyError("La visita ya no existe.");
    expect(toastStore.getSnapshot()).toHaveLength(1);
    expect(Swal.getTitle()?.textContent).toBe("¿Cancelar reserva?");
    button(".swal2-cancel").click();
    await expect(pending).resolves.toBe(false);
  });
});
