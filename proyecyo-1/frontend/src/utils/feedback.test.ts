import Swal from "sweetalert2";
import { clearToasts, toastStore } from "./toastStore";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/services/api";
import { buildConfirmOptions, confirmAction, notifyError, notifySuccess, notifyWarning } from "./feedback";

// HU-C02: se prueba SweetAlert2 real (sin mocks) en jsdom.
const popup = () => document.querySelector(".swal2-popup") as HTMLElement | null;
const button = (selector: string) => document.querySelector(selector) as HTMLButtonElement;
const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeAll(() => {
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
    expect(buildConfirmOptions({ title: "x", tone: "danger" })).toMatchObject({ focusCancel: true, reverseButtons: true, icon: "warning", confirmButtonColor: "#DC2626" });
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

describe("Resultados flotantes globales", () => {
  it("publica éxito, advertencia y error sin abrir un diálogo", async () => {
    await notifySuccess("Usuario creado correctamente.");
    await notifyWarning("Revisa la fecha antes de continuar.");
    await notifyError(new ApiError("La visita ya ingresó.", 409));
    expect(toastStore.getSnapshot().map((item) => item.tone)).toEqual(["success", "warning", "error"]);
    expect(popup()).toBeNull();
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
    await notifyError("La visita ya no existe.");
    await notifyError("La visita ya no existe.");
    expect(toastStore.getSnapshot()).toHaveLength(1);
    expect(Swal.getTitle()?.textContent).toBe("¿Cancelar reserva?");
    button(".swal2-cancel").click();
    await expect(pending).resolves.toBe(false);
  });
});
