import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserFormModal } from "@/components/admin/UserFormModal";
import { ApiError } from "@/services/api";
import { getHousesRequest } from "@/services/housesService";
import type { HouseRecord } from "@/types/houses";

vi.mock("@/services/housesService", () => ({ getHousesRequest: vi.fn() }));

const house = (id: number, extra: Partial<HouseRecord> = {}): HouseRecord => ({
  id_casa: id, numero: String(300 + id), torre: "A", codigo: `A-${300 + id}`, estado: "DISPONIBLE", activo: true, precio: 96000,
  area_terreno: null, area_construccion: null, habitaciones: null, banos: null, niveles: null, modelo: null,
  mapa_fila: null, mapa_columna: null, creado_en: null, residente: null, cantidad_inquilinos: 0, ...extra,
});
const userTypes = [{ id: 3, nombre: "residente" }, { id: 4, nombre: "inquilino" }];

// Respuesta del backend con elegibilidad ya calculada para cada rol.
function serve(role: "residente" | "inquilino") {
  const free = house(1), taken = house(2, { estado: "OCUPADA", residente: { id_usuario: 7, nombre: "Ana Pérez" }, cantidad_inquilinos: 2 });
  const elegible = role === "residente"
    ? [{ ...free, elegible: true, motivo: null }, { ...taken, elegible: false, motivo: "Ocupada por otro residente." }]
    : [{ ...free, elegible: false, motivo: "Sin residente: un inquilino solo puede vincularse a una vivienda ocupada." }, { ...taken, elegible: true, motivo: null }];
  return { resumen: { total: 2, disponibles: 1, ocupadas: 1, inactivas: 0 }, viviendas: elegible };
}

async function fillUser(roleId: string) {
  await userEvent.type(screen.getByLabelText("Nombre"), "Nuevo");
  await userEvent.type(screen.getByLabelText("Correo"), "nuevo@test.com");
  await userEvent.type(screen.getByLabelText("Contraseña"), "clave123");
  await userEvent.selectOptions(screen.getByLabelText("Tipo de usuario"), roleId);
}
const renderModal = (onSubmit = vi.fn().mockResolvedValue(undefined)) => {
  render(<UserFormModal isOpen isSubmitting={false} userTypes={userTypes} editingUser={null} onClose={vi.fn()} onSubmit={onSubmit} />);
  return onSubmit;
};
// El residente ve primero solo disponibles; para elegir entre todas se muestran las ocupadas.
const showAll = async () => { const btn = screen.getByRole("button", { name: /^Ocupada\s*\d+$/ }); if (btn.getAttribute("aria-pressed") === "false") await userEvent.click(btn); };

beforeEach(() => vi.mocked(getHousesRequest).mockReset());

describe("Crear residente con selector de vivienda", () => {
  it("solo permite viviendas disponibles, exige confirmar y envía id_casa", async () => {
    vi.mocked(getHousesRequest).mockResolvedValue(serve("residente"));
    const onSubmit = renderModal();
    await fillUser("3");
    expect(getHousesRequest).toHaveBeenCalledWith({ seleccion: "residente", id_usuario: null });
    await screen.findByRole("button", { name: /A-301/ });

    await userEvent.click(screen.getByRole("button", { name: "Crear usuario" }));
    expect(screen.getByText("Selecciona y confirma una vivienda en el mapa.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    await showAll();
    await userEvent.click(screen.getByRole("button", { name: /A-302/ }));
    expect(screen.getByText(/A-302 no se puede seleccionar: Ocupada por otro residente/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /A-301/ }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmar vivienda A-301" }));
    const chosen = screen.getByText("Vivienda seleccionada").closest("div") as HTMLElement;
    expect(within(chosen).getByText("A-301")).toBeInTheDocument();
    expect(within(chosen).getByText(/Q\s?96,000\.00/)).toBeInTheDocument();
    expect(within(chosen).getByText("Disponible")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Crear usuario" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ id_tipo_usuario: "3", id_casa: 1 })));
  }, 15000); // flujo largo (4 campos + 10 interacciones): margen bajo carga de la suite completa

  it("si otro admin ocupó la vivienda, muestra el conflicto, limpia la selección y recarga el mapa", async () => {
    vi.mocked(getHousesRequest).mockResolvedValue(serve("residente"));
    const onSubmit = renderModal(vi.fn().mockRejectedValue(
      new ApiError("Esta vivienda acaba de ser asignada a otro residente. Selecciona otra.", 409, { code: "VIVIENDA_OCUPADA" }),
    ));
    await fillUser("3");
    await userEvent.click(await screen.findByRole("button", { name: /A-301/ }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmar vivienda A-301" }));
    await userEvent.click(screen.getByRole("button", { name: "Crear usuario" }));
    expect(await screen.findByText("Esta vivienda acaba de ser asignada a otro residente. Selecciona otra.")).toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Vivienda seleccionada")).not.toBeInTheDocument();
    await waitFor(() => expect(getHousesRequest).toHaveBeenCalledTimes(2));
  });
});

describe("Crear inquilino con selector de vivienda", () => {
  it("solo permite viviendas ocupadas y muestra residente e inquilinos actuales", async () => {
    vi.mocked(getHousesRequest).mockResolvedValue(serve("inquilino"));
    const onSubmit = renderModal();
    await fillUser("4");
    expect(getHousesRequest).toHaveBeenCalledWith({ seleccion: "inquilino", id_usuario: null });
    await userEvent.click(screen.getByRole("button", { name: /^Disponible\s*\d+$/ }));
    await userEvent.click(await screen.findByRole("button", { name: /A-301/ }));
    expect(screen.getByText(/A-301 no se puede seleccionar: Sin residente/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /A-302/ }));
    expect(screen.getByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Confirmar vivienda A-302" }));
    await userEvent.click(screen.getByRole("button", { name: "Crear usuario" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ id_tipo_usuario: "4", id_casa: 2 })));
  });

  it("error al cargar viviendas: mensaje visible y reintento", async () => {
    vi.mocked(getHousesRequest).mockRejectedValueOnce(new Error("Sin conexión")).mockResolvedValue(serve("inquilino"));
    renderModal();
    await fillUser("4");
    expect(await screen.findByText("Sin conexión")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("button", { name: /A-302/ })).toBeInTheDocument();
  });
});
