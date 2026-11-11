import { useState } from "react";

import { useResidentialBrand } from "@/hooks/useResidentialBrand";

/** Logo del residencial si se configuró uno; si no, el ícono del producto. */
export function BrandIcon() {
  const brand = useResidentialBrand();
  const [failed, setFailed] = useState(false);
  if (brand.logo_url && !failed) {
    return (
      <span className="nd-brand-ico overflow-hidden bg-white p-0">
        <img src={brand.logo_url} alt={`Logo de ${brand.nombre}`} className="size-full object-contain" onError={() => setFailed(true)} />
      </span>
    );
  }
  return (
    <span className="nd-brand-ico">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 21V10l8-5 8 5v11" />
        <path d="M9 21v-6h6v6" />
        <circle cx="12" cy="11" r="1.4" fill="currentColor" />
      </svg>
    </span>
  );
}
