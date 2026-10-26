// HU-C06: un proveedor siempre queda identificado.
// - Ingreso en vehiculo: la placa es obligatoria.
// - Ingreso a pie: el DPI (identificador alternativo acordado por el equipo) es obligatorio.
// Nunca se acepta un registro de proveedor sin un identificador valido.
const { ensureValidVehiclePlate } = require("./vehiclePlate");
const { ensureValidDpi } = require("./identityDocument");

const PROVIDER_ENTRY_MODES = Object.freeze({ VEHICULO: "VEHICULO", PEATONAL: "PEATONAL" });

function badRequest(message, code) {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  return error;
}

/**
 * Medio de ingreso del proveedor. Si no se envia se deduce de los datos: con placa es
 * VEHICULO y sin placa es PEATONAL (y entonces exige DPI).
 */
function resolveProviderEntryMode(value, plate) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!normalized) {
    return plate ? PROVIDER_ENTRY_MODES.VEHICULO : PROVIDER_ENTRY_MODES.PEATONAL;
  }
  if (!Object.values(PROVIDER_ENTRY_MODES).includes(normalized)) {
    throw badRequest("El medio de ingreso del proveedor debe ser VEHICULO o PEATONAL.", "INVALID_ENTRY_MODE");
  }
  return normalized;
}

function ensureProviderIdentifiers({ medio_ingreso: entryMode, placa, dpi } = {}) {
  const plate = ensureValidVehiclePlate(placa);
  const document = ensureValidDpi(dpi);
  const medioIngreso = resolveProviderEntryMode(entryMode, plate);

  if (medioIngreso === PROVIDER_ENTRY_MODES.VEHICULO && !plate) {
    throw badRequest(
      "La placa es obligatoria cuando el proveedor ingresa en vehículo.",
      "PROVIDER_PLATE_REQUIRED",
    );
  }

  if (medioIngreso === PROVIDER_ENTRY_MODES.PEATONAL && !document) {
    throw badRequest(
      "El DPI es obligatorio cuando el proveedor ingresa a pie.",
      "PROVIDER_DOCUMENT_REQUIRED",
    );
  }

  if (!plate && !document) {
    throw badRequest(
      "El proveedor necesita una placa o un DPI válido para registrarse.",
      "PROVIDER_IDENTIFIER_REQUIRED",
    );
  }

  return { medioIngreso, placa: plate, dpi: document };
}

/** Medio de ingreso mostrado en respuestas: se deduce de la placa guardada. */
function describeProviderEntryMode(plate) {
  return plate ? PROVIDER_ENTRY_MODES.VEHICULO : PROVIDER_ENTRY_MODES.PEATONAL;
}

module.exports = {
  PROVIDER_ENTRY_MODES,
  resolveProviderEntryMode,
  ensureProviderIdentifiers,
  describeProviderEntryMode,
};
