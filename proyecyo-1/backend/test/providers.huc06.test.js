// HU-C06.9: reglas puras de proveedores (identificador por medio de ingreso) y de
// vigencia (fechas/horarios pasados) con un reloj fijo.
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ensureProviderIdentifiers,
  resolveProviderEntryMode,
} = require("../src/utils/providerAccessValidation");
const { ensureVisitWindowNotPast, isVisitWindowExpired } = require("../src/utils/visitWindow");
const { __private__ } = require("../src/services/visitsService");

// 2026-10-26 16:40 en Guatemala (UTC-6).
const now = new Date("2026-10-26T22:40:00Z");

function rejectsWith(fn, code) {
  assert.throws(fn, (error) => error.status === 400 && error.code === code);
}

test("proveedor en vehiculo exige placa", () => {
  rejectsWith(() => ensureProviderIdentifiers({ medio_ingreso: "VEHICULO", placa: "", dpi: "1234567890123" }), "PROVIDER_PLATE_REQUIRED");
  assert.deepEqual(ensureProviderIdentifiers({ medio_ingreso: "vehiculo", placa: "p 123 abc" }), {
    medioIngreso: "VEHICULO",
    placa: "P-123ABC",
    dpi: "",
  });
});

test("proveedor a pie exige DPI como identificador alternativo", () => {
  rejectsWith(() => ensureProviderIdentifiers({ medio_ingreso: "PEATONAL", placa: "P-123ABC", dpi: "" }), "PROVIDER_DOCUMENT_REQUIRED");
  assert.equal(ensureProviderIdentifiers({ medio_ingreso: "PEATONAL", dpi: "1234-56789-0123" }).dpi, "1234567890123");
});

test("sin medio de ingreso se deduce de la placa y nunca queda sin identificador", () => {
  assert.equal(resolveProviderEntryMode("", "P-123ABC"), "VEHICULO");
  assert.equal(resolveProviderEntryMode(undefined, ""), "PEATONAL");
  rejectsWith(() => ensureProviderIdentifiers({}), "PROVIDER_DOCUMENT_REQUIRED");
  rejectsWith(() => ensureProviderIdentifiers({ medio_ingreso: "BICICLETA", placa: "P-123ABC" }), "INVALID_ENTRY_MODE");
  rejectsWith(() => ensureProviderIdentifiers({ medio_ingreso: "PEATONAL", dpi: "12AB" }), "INVALID_DPI");
});

test("visitas de proveedor usan la regla del proveedor; las demas conservan HU-C03", () => {
  rejectsWith(() => __private__.ensureVisitIdentifiers({ placa: "" , dpi: "", medio_ingreso: "VEHICULO" }, "PROVEEDOR"), "PROVIDER_PLATE_REQUIRED");
  assert.deepEqual(__private__.ensureVisitIdentifiers({ placa: "", dpi: "" }, "VISITA"), { dpi: "", placa: "" });
});

test("bloquea fechas pasadas", () => {
  rejectsWith(() => ensureVisitWindowNotPast("2026-10-25", "10:00:00", "11:00:00", { now }), "VISIT_DATE_IN_PAST");
});

test("bloquea un horario de hoy que ya termino", () => {
  rejectsWith(() => ensureVisitWindowNotPast("2026-10-26", "10:00:00", "16:40:00", { now }), "VISIT_WINDOW_EXPIRED");
  assert.equal(isVisitWindowExpired("2026-10-26", "16:40:00", now), true);
  assert.equal(isVisitWindowExpired("2026-10-26", "16:41", now), false);
});

test("bloquea un inicio pasado fuera del margen de 10 minutos", () => {
  rejectsWith(() => ensureVisitWindowNotPast("2026-10-26", "16:29:00", "18:00:00", { now }), "VISIT_TIME_IN_PAST");
  assert.doesNotThrow(() => ensureVisitWindowNotPast("2026-10-26", "16:30:00", "18:00:00", { now }));
});

test("una edicion que conserva el inicio de un acceso vigente sigue permitida", () => {
  assert.doesNotThrow(() =>
    ensureVisitWindowNotPast("2026-10-26", "09:00:00", "18:00:00", { now, allowStartedWindow: true }),
  );
  rejectsWith(
    () => ensureVisitWindowNotPast("2026-10-26", "09:00:00", "16:00:00", { now, allowStartedWindow: true }),
    "VISIT_WINDOW_EXPIRED",
  );
});

test("acepta fechas futuras", () => {
  assert.doesNotThrow(() => ensureVisitWindowNotPast("2026-10-27", "06:00:00", "07:00:00", { now }));
});
