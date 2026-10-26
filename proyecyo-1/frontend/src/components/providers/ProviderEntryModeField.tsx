import { providerEntryModeLabels, type ProviderEntryMode } from "@/utils/providerAccess";

/** HU-C06.3/C06.4: medio de ingreso del proveedor dentro de los formularios de visitas. */
export function ProviderEntryModeField({
  value,
  onChange,
  className = "h-14 w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 text-sm outline-none focus:border-blue-300",
}: {
  value: ProviderEntryMode;
  onChange: (value: ProviderEntryMode) => void;
  className?: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-slate-800">Medio de ingreso del proveedor *</span>
      <select value={value} onChange={(event) => onChange(event.target.value as ProviderEntryMode)} className={className}>
        {(Object.keys(providerEntryModeLabels) as ProviderEntryMode[]).map((mode) => (
          <option key={mode} value={mode}>
            {providerEntryModeLabels[mode]}
          </option>
        ))}
      </select>
      <span className="block text-xs text-slate-500">
        {value === "VEHICULO"
          ? "En vehículo la placa es obligatoria."
          : "A pie el DPI es obligatorio para identificarlo."}
      </span>
    </label>
  );
}
