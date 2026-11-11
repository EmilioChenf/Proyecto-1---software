import { useEffect, useState } from "react";

import { apiRequest } from "@/services/api";

/** Marca del residencial de esta copia del sistema (nombre, logo, color). */
export type ResidentialBrand = { nombre: string; logo_url: string; color: string; mostrar_landing: boolean };

export const PRODUCT_NAME = "NexusResidencial";
const DEFAULT_BRAND: ResidentialBrand = { nombre: PRODUCT_NAME, logo_url: "", color: "#2563EB", mostrar_landing: true };

let cached: ResidentialBrand | null = null;
let pending: Promise<ResidentialBrand> | null = null;
const listeners = new Set<(brand: ResidentialBrand) => void>();

export function loadResidentialBrand() {
  if (cached) return Promise.resolve(cached);
  pending ??= apiRequest<ResidentialBrand>("/configuracion/marca")
    .then((brand) => ({ ...DEFAULT_BRAND, ...brand }))
    .catch(() => DEFAULT_BRAND)
    .then((brand) => {
      cached = brand;
      listeners.forEach((listener) => listener(brand));
      return brand;
    });
  return pending;
}

/** Tras guardar la marca en Configuración, todas las pantallas se actualizan. */
export function setResidentialBrand(brand: ResidentialBrand) {
  cached = { ...DEFAULT_BRAND, ...brand };
  pending = Promise.resolve(cached);
  listeners.forEach((listener) => listener(cached as ResidentialBrand));
}

/** Actualiza solo algunos campos (p. ej. el nombre guardado en Configuración general). */
export function patchResidentialBrand(partial: Partial<ResidentialBrand>) {
  setResidentialBrand({ ...(cached ?? DEFAULT_BRAND), ...partial });
}

/** true cuando el residencial tiene un nombre propio (no el nombre del producto). */
export const hasCustomName = (brand: ResidentialBrand) => Boolean(brand.nombre) && brand.nombre !== PRODUCT_NAME;

export function useResidentialBrand() {
  const [brand, setBrand] = useState<ResidentialBrand>(cached ?? DEFAULT_BRAND);
  useEffect(() => {
    listeners.add(setBrand);
    void loadResidentialBrand().then(setBrand);
    return () => { listeners.delete(setBrand); };
  }, []);
  useEffect(() => {
    if (typeof document !== "undefined") document.title = hasCustomName(brand) ? `${brand.nombre} · ${PRODUCT_NAME}` : PRODUCT_NAME;
  }, [brand]);
  return brand;
}

/** Subtítulo bajo la marca: el nombre del residencial o, sin nombre propio, el panel. */
export function brandSubtitle(brand: ResidentialBrand, panelLabel: string) {
  return hasCustomName(brand) ? brand.nombre : panelLabel;
}
