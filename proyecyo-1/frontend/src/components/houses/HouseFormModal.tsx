import { useFeedbackState } from "@/hooks/useFeedbackState";
import { useEffect, useId, useState, type FormEvent } from "react";
import { X } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { HouseDetail, HouseFormValues } from "@/types/houses";

const empty: HouseFormValues = {
  numero: "", torre: "", precio: "", area_terreno: "", area_construccion: "", habitaciones: "",
  banos: "", niveles: "", modelo: "", mapa_fila: "", mapa_columna: "",
};

const fromDetail = (d: HouseDetail): HouseFormValues => ({
  numero: d.numero, torre: d.torre ?? "", modelo: d.modelo ?? "",
  precio: d.precio == null ? "" : d.precio.toFixed(2),
  area_terreno: d.area_terreno?.toString() ?? "", area_construccion: d.area_construccion?.toString() ?? "",
  habitaciones: d.habitaciones?.toString() ?? "", banos: d.banos?.toString() ?? "", niveles: d.niveles?.toString() ?? "",
  mapa_fila: d.mapa_fila?.toString() ?? "", mapa_columna: d.mapa_columna?.toString() ?? "",
});

type Errors = Partial<Record<keyof HouseFormValues, string>>;
const DECIMAL = /^\d+(\.\d{1,2})?$/;

// Validacion inmediata en el cliente; la autoridad final es el backend (housesService).
export function validateHouseForm(v: HouseFormValues): Errors {
  const e: Errors = {};
  if (!v.numero.trim()) e.numero = "El número es obligatorio.";
  for (const key of ["precio", "area_terreno", "area_construccion"] as const) {
    if (v[key].trim() && !DECIMAL.test(v[key].trim())) e[key] = "Debe ser mayor o igual a 0, con hasta 2 decimales.";
  }
  if (v.habitaciones.trim() && !/^\d+$/.test(v.habitaciones.trim())) e.habitaciones = "Debe ser un entero mayor o igual a 0.";
  if (v.banos.trim() && !/^\d+(\.5|\.0)?$/.test(v.banos.trim())) e.banos = "Usa enteros o medios (ej. 2.5).";
  if (v.niveles.trim() && !/^[1-5]$/.test(v.niveles.trim())) e.niveles = "Entre 1 y 5.";
  const fila = v.mapa_fila.trim(), columna = v.mapa_columna.trim();
  if (Boolean(fila) !== Boolean(columna)) e.mapa_columna = "Indica fila y columna, o deja ambas vacías.";
  if (fila && !/^([1-9]|[12]\d|30)$/.test(fila)) e.mapa_fila = "Entre 1 y 30.";
  if (columna && !/^([1-9]|[12]\d|30)$/.test(columna)) e.mapa_columna = "Entre 1 y 30.";
  return e;
}

interface HouseFormModalProps {
  open: boolean;
  editing: HouseDetail | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (values: HouseFormValues) => Promise<void>;
}

const FIELDS: Array<{ key: keyof HouseFormValues; label: string; placeholder?: string; inputMode?: "decimal" | "numeric" }> = [
  { key: "numero", label: "Número / código *", placeholder: "Ej. 302" },
  { key: "torre", label: "Torre o manzana", placeholder: "Ej. B" },
  { key: "modelo", label: "Modelo / tipo", placeholder: "Ej. Jacaranda" },
  { key: "precio", label: "Precio (Q)", placeholder: "Ej. 96000.00", inputMode: "decimal" },
  { key: "area_terreno", label: "Área de terreno (m²)", inputMode: "decimal" },
  { key: "area_construccion", label: "Área de construcción (m²)", inputMode: "decimal" },
  { key: "habitaciones", label: "Habitaciones", inputMode: "numeric" },
  { key: "banos", label: "Baños", placeholder: "Ej. 2.5", inputMode: "decimal" },
  { key: "niveles", label: "Niveles (1-5)", inputMode: "numeric" },
  { key: "mapa_fila", label: "Fila en el mapa", placeholder: "Automática", inputMode: "numeric" },
  { key: "mapa_columna", label: "Columna en el mapa", placeholder: "Automática", inputMode: "numeric" },
];

export function HouseFormModal({ open, editing, submitting, onClose, onSubmit }: HouseFormModalProps) {
  const [values, setValues] = useState<HouseFormValues>(empty);
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useFeedbackState("error", "");
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    setValues(editing ? fromDetail(editing) : empty);
    setErrors({});
    setServerError("");
    window.setTimeout(() => document.getElementById("house-numero")?.focus(), 0);
  }, [open, editing]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !submitting) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, submitting, onClose]);

  if (!open) return null;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setServerError("");
    const nextErrors = validateHouseForm(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    try {
      await onSubmit(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()])) as unknown as HouseFormValues);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "No fue posible guardar la vivienda.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-semibold text-slate-950">{editing ? `Editar vivienda ${editing.codigo}` : "Agregar vivienda"}</h2>
          <button type="button" aria-label="Cerrar" onClick={onClose} disabled={submitting} className="rounded-md p-1 text-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            <X className="size-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {serverError ? (
            <Alert variant="destructive"><AlertTitle>No se guardó</AlertTitle><AlertDescription>{serverError}</AlertDescription></Alert>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map(({ key, label, placeholder, inputMode }) => (
              <div key={key}>
                <label htmlFor={`house-${key}`} className="mb-1.5 block text-sm text-slate-700">{label}</label>
                <Input
                  id={`house-${key}`}
                  value={values[key]}
                  inputMode={inputMode}
                  placeholder={placeholder}
                  aria-invalid={Boolean(errors[key])}
                  aria-describedby={errors[key] ? `house-${key}-error` : undefined}
                  onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
                />
                {errors[key] ? <p id={`house-${key}-error`} className="mt-1 text-sm text-red-600">{errors[key]}</p> : null}
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500">La fila y la columna ubican la vivienda dentro de su torre o manzana en el mapa. Si se dejan vacías, se coloca automáticamente en un espacio libre.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Cancelar</Button>
            <Button type="submit" disabled={submitting}>{submitting ? "Guardando…" : editing ? "Guardar cambios" : "Agregar vivienda"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
