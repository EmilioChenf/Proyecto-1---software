import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AdminIndicatorsView } from "@/views/AdminIndicatorsView";
import { getIndicatorsRequest } from "@/services/indicatorsService";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, email: "admin@nexus.test", role: "admin" }, logout: vi.fn() }) }));
vi.mock("@/services/indicatorsService", () => ({ getIndicatorsRequest: vi.fn() }));

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

describe("AdminIndicatorsView", () => {
  it("muestra el resumen y la tabla de morosidad", async () => {
    vi.mocked(getIndicatorsRequest).mockResolvedValue({
      periodo: { meses: 6, dias: 30, desde: "2026-10-13", hasta: "2026-11-11" },
      resumen: { morosidad_actual: 12.5, morosidad_promedio: 10, ocupacion_amenidades: 34, visitas_promedio_dia: 8.2, dia_mas_concurrido: "Sábado", viviendas: 40, viviendas_ocupadas: 32 },
      morosidad: [{ mes: "2026-11", etiqueta: "Nov 26", cuotas: 8, emitido: 4000, pagado_a_tiempo: 3500, pendiente_hoy: 300, cuotas_tarde: 1, porcentaje: 12.5 }],
      ocupacion: [{ id_amenidad: 1, nombre: "Piscina", reservas: 20, horas_reservadas: 40, porcentaje: 34 }],
      visitas: [], fallas: [],
    });
    render(<MemoryRouter><AdminIndicatorsView /></MemoryRouter>);
    expect(await screen.findByText("12.5%")).toBeInTheDocument();
    expect(screen.getByText("Día más concurrido: Sábado")).toBeInTheDocument();
    expect(screen.getByText("32 de 40")).toBeInTheDocument();
    expect(screen.getByText("Piscina")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /Ver tabla/ }));
    expect(screen.getByText("Q4,000.00")).toBeInTheDocument();
  });
});
