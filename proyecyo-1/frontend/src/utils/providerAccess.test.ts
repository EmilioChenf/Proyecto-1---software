import { describe, expect, it } from "vitest";

import {
  getDpiError,
  getPastVisitWindowError,
  getPastVisitWindowErrors,
  getProviderIdentifierErrors,
  getVisitAccessRuleError,
} from "@/utils/providerAccess";

// 2026-10-26 16:40 en Guatemala (UTC-6).
const now = new Date("2026-10-26T22:40:00Z");

describe("HU-C06 identificador del proveedor", () => {
  it("exige placa cuando ingresa en vehiculo", () => {
    expect(getProviderIdentifierErrors({ medio_ingreso: "VEHICULO", placa: "", dpi: "1234567890123" }).placa).toBe(
      "La placa es obligatoria cuando el proveedor ingresa en vehículo.",
    );
  });

  it("exige DPI cuando ingresa a pie", () => {
    expect(getProviderIdentifierErrors({ medio_ingreso: "PEATONAL", placa: "P-123ABC", dpi: "" }).dpi).toBe(
      "El DPI es obligatorio cuando el proveedor ingresa a pie.",
    );
  });

  it("acepta placa en vehiculo y DPI a pie", () => {
    expect(getProviderIdentifierErrors({ medio_ingreso: "VEHICULO", placa: "p 123 abc", dpi: "" })).toEqual({});
    expect(getProviderIdentifierErrors({ medio_ingreso: "PEATONAL", placa: "", dpi: "1234 56789 0123" })).toEqual({});
  });

  it("rechaza identificadores con formato invalido", () => {
    expect(getDpiError("12345")).toMatch(/13 dígitos/);
    expect(getProviderIdentifierErrors({ medio_ingreso: "VEHICULO", placa: "P@1", dpi: "" }).placa).toMatch(/placa debe/);
  });
});

describe("HU-C06 fechas y horarios pasados", () => {
  it("bloquea fechas anteriores a hoy", () => {
    expect(getPastVisitWindowErrors("2026-10-25", "10:00", "11:00", { now }).fecha).toMatch(/ya pasó/);
  });

  it("bloquea un horario de hoy que ya termino (QR vencido)", () => {
    expect(getPastVisitWindowErrors("2026-10-26", "10:00", "16:40", { now }).hora_fin).toMatch(/QR vencido/);
  });

  it("bloquea una hora de inicio pasada fuera del margen de 10 minutos", () => {
    expect(getPastVisitWindowErrors("2026-10-26", "16:29", "18:00", { now }).hora_inicio).toMatch(/16:40/);
    expect(getPastVisitWindowError("2026-10-26", "16:30", "18:00", { now })).toBe("");
  });

  it("permite conservar el inicio de un acceso ya vigente al editar", () => {
    expect(getPastVisitWindowError("2026-10-26", "09:00", "18:00", { now, allowStartedWindow: true })).toBe("");
  });

  it("acepta fechas futuras", () => {
    expect(getPastVisitWindowError("2026-10-27", "06:00", "07:00", { now })).toBe("");
  });

  it("combina ambas reglas para los accesos de proveedor", () => {
    const base = { tipo_visita: "PROVEEDOR", placa: "", dpi: "", fecha: "2026-10-27", hora_inicio: "08:00", hora_fin: "09:00" };
    expect(getVisitAccessRuleError({ ...base, medio_ingreso: "VEHICULO" }, { now })).toMatch(/placa es obligatoria/);
    expect(getVisitAccessRuleError({ ...base }, { now })).toMatch(/DPI es obligatorio/);
    // HU-C03.1: la visita personal exige DPI; delivery conserva la regla anterior.
    expect(getVisitAccessRuleError({ ...base, tipo_visita: "VISITA" }, { now })).toMatch(/DPI\/documento del visitante es obligatorio/);
    expect(getVisitAccessRuleError({ ...base, tipo_visita: "VISITA", dpi: "1234567890123" }, { now })).toBe("");
    expect(getVisitAccessRuleError({ ...base, tipo_visita: "DELIVERY" }, { now })).toBe("");
  });
});
