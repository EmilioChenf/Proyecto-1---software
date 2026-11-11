import { describe, expect, it } from "vitest";

import { getVisitScheduleNotice, suggestVisitWindow, validateVisitTimesAgainstSchedule } from "./visitSchedule";

const schedule = { hora_apertura: "06:00", hora_cierre: "22:00", duracion_maxima_horas: 4, activo: true, dias_habilitados: [0, 1, 2, 3, 4, 5, 6] };
// 2026-11-10 23:49 en Guatemala (UTC-6).
const lateNight = new Date("2026-11-11T05:49:00Z");
const afternoon = new Date("2026-11-10T20:00:00Z"); // 14:00 en Guatemala

describe("reglas de horario de visitas", () => {
  it("explica que una visita no puede pasar de la medianoche (23:49 a 03:49)", () => {
    expect(validateVisitTimesAgainstSchedule("23:49", "03:49", schedule)).toMatch(/medianoche/);
  });
  it("explica el horario permitido y ofrece la emergencia", () => {
    expect(validateVisitTimesAgainstSchedule("21:00", "23:00", schedule)).toMatch(/06:00 a 22:00.*emergencia/);
  });
  it("limita la duración máxima", () => {
    expect(validateVisitTimesAgainstSchedule("08:00", "13:00", schedule)).toMatch(/más de 4 hora/);
  });
  it("acepta un horario válido", () => {
    expect(validateVisitTimesAgainstSchedule("08:00", "10:00", schedule)).toBeNull();
  });
  it("avisa antes de elegir que hoy ya terminó el horario", () => {
    expect(getVisitScheduleNotice("2026-11-10", schedule, lateNight)).toMatch(/ya terminó/);
    expect(getVisitScheduleNotice("2026-11-11", schedule, lateNight)).toBeNull();
  });
  it("de noche sugiere mañana a la hora de apertura", () => {
    expect(suggestVisitWindow(schedule, lateNight)).toEqual({ fecha: "2026-11-11", hora_inicio: "06:00", hora_fin: "08:00" });
  });
  it("de día sugiere desde ahora sin pasar del cierre", () => {
    expect(suggestVisitWindow(schedule, afternoon)).toEqual({ fecha: "2026-11-10", hora_inicio: "14:00", hora_fin: "16:00" });
  });
  it("salta los días deshabilitados", () => {
    const weekdays = { ...schedule, dias_habilitados: [1, 2, 3, 4, 5] };
    // Viernes 2026-11-13 23:00 -> lunes 2026-11-16
    expect(suggestVisitWindow(weekdays, new Date("2026-11-14T05:00:00Z")).fecha).toBe("2026-11-16");
  });
});
