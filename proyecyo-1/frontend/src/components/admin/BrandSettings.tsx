import { useEffect, useState, type FormEvent } from "react";
import { Image as ImageIcon, Palette } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFeedbackState } from "@/hooks/useFeedbackState";
import { hasCustomName, setResidentialBrand, useResidentialBrand } from "@/hooks/useResidentialBrand";
import { updateBrandRequest } from "@/services/configurationService";

/** Logo y color del residencial: aparecen en el menú, el inicio de sesión y los correos. */
export function BrandSettings() {
  const brand = useResidentialBrand();
  const [logo, setLogo] = useState(brand.logo_url);
  const [color, setColor] = useState(brand.color);
  const [saving, setSaving] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [, setError] = useFeedbackState("error", "");
  const [, setSuccess] = useFeedbackState("success", "");

  useEffect(() => { setLogo(brand.logo_url); setColor(brand.color); }, [brand.logo_url, brand.color]);
  useEffect(() => { setPreviewFailed(false); }, [logo]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (logo && !/^https:\/\/\S+$/i.test(logo.trim())) {
      setError("El logo debe ser una dirección que empiece con https://");
      return;
    }
    try {
      setSaving(true);
      setResidentialBrand(await updateBrandRequest({ logo_url: logo.trim(), color }));
      setSuccess("La marca del residencial fue guardada.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible guardar la marca.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mb-5 rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-violet-50 p-2.5 text-violet-700"><Palette className="size-5" /></div>
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Marca del residencial</h2>
          <p className="text-sm text-slate-500">El nombre se edita arriba; aquí el logo y el color. Se muestran en el menú, el inicio de sesión y los correos.</p>
        </div>
      </div>
      <form className="mt-5 grid gap-5 md:grid-cols-[1fr_auto]" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
          <label className="text-sm font-medium text-slate-700">Logo (dirección https://)
            <Input aria-label="Logo del residencial" className="mt-1.5" placeholder="https://ejemplo.com/logo.png" value={logo} onChange={(e) => setLogo(e.target.value)} />
            <span className="mt-1 block text-xs font-normal text-slate-500">Imagen cuadrada (PNG o SVG). Puedes subirla a tu sitio web o a un servicio de imágenes y pegar aquí el enlace.</span>
          </label>
          <label className="text-sm font-medium text-slate-700">Color principal
            <span className="mt-1.5 flex items-center gap-2">
              <input type="color" aria-label="Color principal" value={color} onChange={(e) => setColor(e.target.value.toUpperCase())} className="h-10 w-12 cursor-pointer rounded-lg border border-slate-200 bg-white p-1" />
              <Input aria-label="Color en hexadecimal" value={color} maxLength={7} onChange={(e) => setColor(e.target.value.toUpperCase())} className="font-mono" />
            </span>
          </label>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 md:w-72">
          <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl text-white" style={{ background: logo && !previewFailed ? "#FFFFFF" : color }}>
            {logo && !previewFailed ? <img src={logo} alt="Vista previa del logo" className="size-full object-contain" onError={() => setPreviewFailed(true)} /> : <ImageIcon className="size-5" />}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-bold" style={{ color }}>{hasCustomName(brand) ? brand.nombre : "NexusResidencial"}</span>
            <span className="block text-xs text-slate-500">Vista previa</span>
          </span>
        </div>
        <div className="md:col-span-2"><Button type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar marca"}</Button></div>
      </form>
    </section>
  );
}
