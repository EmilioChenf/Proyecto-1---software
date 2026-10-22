import Swal from "sweetalert2";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { ApiError } from "@/services/api";
import { buildConfirmOptions, confirmAction, notifyError, notifySuccess, notifyWarning } from "./feedback";

// HU-C02: se prueba SweetAlert2 real (sin mocks) en jsdom.
const popup = () => document.querySelector(".swal2-popup") as HTMLElement | null;
const button = (selector: string) => document.querySelector(selector) as HTMLButtonElement;
const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeAll(() => {
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

describe("HU-C02 exito, advertencia y error", () => {
  it("el exito es un aviso breve (toast) que no bloquea la pantalla", async () => {
    void notifySuccess("Usuario creado correctamente.");
    await nextTick();
    expect(popup()?.classList.contains("swal2-toast")).toBe(true);
    expect(Swal.getTitle()?.textContent).toBe("Usuario creado correctamente.");
    expect(document.querySelector(".swal2-icon.swal2-success")).not.toBeNull();
  });

  it("la advertencia usa su icono y un boton para continuar", async () => {
    void notifyWarning("Revisa la fecha antes de continuar.");
    await nextTick();
    expect(document.querySelector(".swal2-icon.swal2-warning")).not.toBeNull();
    expect(button(".swal2-confirm").textContent).toBe("Entendido");
  });

  it("el error muestra el mensaje del servidor si es claro", async () => {
    void notifyError(new ApiError("No fue posible eliminar la visita porque ya ingreso.", 409));
    await nextTick();
    expect(document.querySelector(".swal2-icon.swal2-error")).not.toBeNull();
    expect(Swal.getHtmlContainer()?.textContent).toBe("No fue posible eliminar la visita porque ya ingreso.");
  });

  it("nunca muestra detalles tecnicos: usa el mensaje de respaldo", async () => {
    void notifyError(new Error("ER_DUP_ENTRY: insert into USUARIO ... at query.js:12"), "No fue posible guardar el usuario.");
    await nextTick();
    expect(Swal.getHtmlContainer()?.textContent).toBe("No fue posible guardar el usuario.");
  });

  it("un 401 no abre ninguna alerta (la app ya cierra la sesion)", async () => {
    await notifyError(new ApiError("Tu sesion ha expirado.", 401));
    expect(popup()).toBeNull();
  });

  it("no apila el mismo error dos veces", async () => {
    void notifyError("La visita ya no existe.");
    await nextTick();
    const second = await notifyError("La visita ya no existe.");
    expect(second).toBeNull();
    expect(document.querySelectorAll(".swal2-popup")).toHaveLength(1);
  });
});
