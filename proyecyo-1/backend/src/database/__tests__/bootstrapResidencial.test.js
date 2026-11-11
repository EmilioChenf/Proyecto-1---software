const { readBootstrapConfig } = require("../bootstrapResidencial");

describe("configuración de arranque de un residencial nuevo", () => {
  const base = { BOOTSTRAP_RESIDENCIAL_NOMBRE: "Residencial Las Brisas", BOOTSTRAP_ADMIN_CORREO: "Admin@LasBrisas.gt", BOOTSTRAP_ADMIN_PASSWORD: "Brisas-2026!" };

  test("sin BOOTSTRAP_ADMIN_CORREO no hace nada", () => {
    expect(readBootstrapConfig({})).toBeNull();
  });
  test("normaliza el correo y no limpia datos de ejemplo por defecto", () => {
    expect(readBootstrapConfig(base)).toEqual(expect.objectContaining({ adminCorreo: "admin@lasbrisas.gt", residencial: "Residencial Las Brisas", limpiarDemo: false, contactoCorreo: "admin@lasbrisas.gt" }));
    expect(readBootstrapConfig({ ...base, BOOTSTRAP_LIMPIAR_DEMO: "SI" }).limpiarDemo).toBe(true);
  });
  test("exige contraseña larga, correo real y nombre del residencial", () => {
    expect(() => readBootstrapConfig({ ...base, BOOTSTRAP_ADMIN_PASSWORD: "1234" })).toThrow(/al menos 10/);
    expect(() => readBootstrapConfig({ ...base, BOOTSTRAP_ADMIN_CORREO: "admin@test.com" })).toThrow(/correo real/);
    expect(() => readBootstrapConfig({ ...base, BOOTSTRAP_RESIDENCIAL_NOMBRE: "" })).toThrow(/RESIDENCIAL_NOMBRE/);
  });
});
