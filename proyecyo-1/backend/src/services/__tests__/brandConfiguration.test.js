jest.mock("../../database/mysql", () => ({ query: jest.fn(), pool: {} }));
const { query } = require("../../database/mysql");
const { validateBrand, getPublicBrand } = require("../configurationService");

describe("marca del residencial", () => {
  afterEach(() => { delete process.env.PUBLIC_LANDING; query.mockReset(); });
  test("acepta logo https y color #RRGGBB", () => {
    expect(validateBrand({ logo_url: "https://cdn.test/logo.png", color: "#0ea5e9" })).toEqual({ logo_url: "https://cdn.test/logo.png", color: "#0EA5E9" });
    expect(validateBrand({})).toEqual({ logo_url: "", color: "#2563EB" });
  });
  test("rechaza logos que no son https o con caracteres peligrosos", () => {
    expect(() => validateBrand({ logo_url: "http://x.test/l.png" })).toThrow(/https/);
    expect(() => validateBrand({ logo_url: "https://x.test/\"onerror=" })).toThrow(/https/);
    expect(() => validateBrand({ color: "rojo" })).toThrow(/#RRGGBB/);
  });
  test("datos públicos: nombre, logo, color y si se muestra la página comercial", async () => {
    query.mockResolvedValue([{ clave: "residencial_nombre", valor: "Las Brisas" }, { clave: "residencial_logo_url", valor: "https://cdn.test/l.png" }]);
    process.env.PUBLIC_LANDING = "false";
    await expect(getPublicBrand()).resolves.toEqual({ nombre: "Las Brisas", logo_url: "https://cdn.test/l.png", color: "#2563EB", mostrar_landing: false });
  });
});
