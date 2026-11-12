import { beforeEach, describe, expect, it } from "vitest";

import { SESSION_KEY, clearSession, readSession, writeSession } from "@/services/sessionStore";

const admin = JSON.stringify({ id: 1, role: "admin", token: "t-admin" });
const guard = JSON.stringify({ id: 2, role: "guardia", token: "t-guard" });

describe("sesión por pestaña", () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  it("una pestaña nueva entra con la última sesión y luego queda independiente", () => {
    writeSession(admin);
    sessionStorage.clear(); // simula abrir otra pestaña
    expect(readSession()).toBe(admin);
    expect(sessionStorage.getItem(SESSION_KEY)).toBe(admin);
  });

  it("iniciar sesión como guardia en otra pestaña no cambia la del administrador", () => {
    writeSession(admin); // pestaña A
    const tabA = sessionStorage.getItem(SESSION_KEY);
    sessionStorage.clear(); writeSession(guard); // pestaña B
    sessionStorage.setItem(SESSION_KEY, tabA as string); // volvemos a la pestaña A
    expect(readSession()).toBe(admin);
  });

  it("cerrar sesión en una pestaña no borra la sesión compartida de otro usuario", () => {
    writeSession(guard); // última sesión compartida: guardia
    sessionStorage.setItem(SESSION_KEY, admin); // esta pestaña es del administrador
    clearSession();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect(localStorage.getItem(SESSION_KEY)).toBe(guard);
  });
});
