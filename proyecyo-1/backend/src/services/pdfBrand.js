// Marca del residencial para documentos PDF (comprobantes y reportes): nombre, color y logo.
// El logo es un enlace https configurado por el administrador; se descarga con límite de
// tiempo y tamaño, y si falla el documento se genera igual sin logo.
const DEFAULT = { nombre: "NexusResidencial", color: "#1E3A5F", logo: null, personalizada: false };
const CACHE_MS = 5 * 60 * 1000;
let cache = { at: 0, value: null };

async function fetchLogo(url) {
  if (!/^https:\/\//i.test(url || "") || typeof fetch !== "function") return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const type = String(response.headers.get("content-type") || "");
    if (!response.ok || !/image\/(png|jpe?g)/i.test(type)) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length <= 1024 * 1024 ? buffer : null;
  } catch {
    return null;
  }
}

async function loadPdfBrand() {
  if (cache.value && Date.now() - cache.at < CACHE_MS) return cache.value;
  try {
    const brand = await require("./configurationService").getPublicBrand();
    const value = {
      nombre: brand.nombre || DEFAULT.nombre,
      color: /^#[0-9A-F]{6}$/i.test(brand.color || "") ? brand.color : DEFAULT.color,
      logo: await fetchLogo(brand.logo_url),
      personalizada: Boolean(brand.nombre && brand.nombre !== DEFAULT.nombre),
    };
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return DEFAULT;
  }
}

function clearPdfBrandCache() {
  cache = { at: 0, value: null };
}

/** Dibuja el logo si existe; devuelve el ancho usado para desplazar el texto. */
function drawLogo(doc, brand, x, y, size) {
  if (!brand?.logo) return 0;
  try {
    doc.image(brand.logo, x, y, { fit: [size, size] });
    return size + 12;
  } catch {
    return 0;
  }
}

module.exports = { DEFAULT_PDF_BRAND: DEFAULT, loadPdfBrand, clearPdfBrandCache, drawLogo };
