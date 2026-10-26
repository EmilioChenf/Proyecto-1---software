// Documento de identidad de visitantes y proveedores (regla del equipo: DPI de 13 digitos).
const DPI_PATTERN = /^\d{13}$/;

function invalidDpi() {
  const error = new Error("El DPI debe contener exactamente 13 dígitos numéricos.");
  error.status = 400;
  error.code = "INVALID_DPI";
  return error;
}

/** Normaliza el DPI (sin espacios ni guiones). Vacio es valido: el DPI puede ser opcional. */
function ensureValidDpi(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }
  const digitsOnly = normalized.replace(/[\s-]/g, "");
  if (!DPI_PATTERN.test(digitsOnly)) {
    throw invalidDpi();
  }
  return digitsOnly;
}

module.exports = { ensureValidDpi };
