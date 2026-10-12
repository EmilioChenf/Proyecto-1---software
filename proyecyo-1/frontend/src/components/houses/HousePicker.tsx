import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Home, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getHousesRequest } from "@/services/housesService";
import type { HouseList, HouseRecord, HouseSelectionRole } from "@/types/houses";
import { formatQuetzales, statusBadge } from "./HouseDetailPanel";
import { HouseMap, houseStatusLabels } from "./HouseMap";

interface HousePickerProps {
  role: HouseSelectionRole;
  userId: number | null;
  value: HouseRecord | null;
  onChange: (house: HouseRecord | null) => void;
  // Cambia cuando el backend rechaza la vivienda (p. ej. otra persona la ocupo): recarga el mapa.
  refreshKey?: number;
  // Al editar: vivienda actual del usuario, para mostrarla como seleccionada.
  initialHouseId?: number | null;
}

function HouseSummaryRows({ house, role }: { house: HouseRecord; role: HouseSelectionRole }) {
  const rows: Array<[string, string]> = [
    ["Casa", house.codigo],
    ["Torre / manzana", house.torre || "—"],
    ...(role === "inquilino"
      ? [["Residente", house.residente?.nombre ?? "—"], ["Inquilinos actuales", String(house.cantidad_inquilinos)]] as Array<[string, string]>
      : [["Precio", formatQuetzales(house.precio)]] as Array<[string, string]>),
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents"><dt className="text-slate-500">{label}</dt><dd className="text-right font-medium text-slate-900">{value}</dd></div>
      ))}
      <div className="contents">
        <dt className="text-slate-500">Estado</dt>
        <dd className="text-right"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadge[house.estado]}`}>{houseStatusLabels[house.estado]}</span></dd>
      </div>
    </dl>
  );
}

export function HousePicker({ role, userId, value, onChange, refreshKey = 0, initialHouseId = null }: HousePickerProps) {
  const [data, setData] = useState<HouseList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [candidate, setCandidate] = useState<HouseRecord | null>(null);
  const [open, setOpen] = useState(!value);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await getHousesRequest({ seleccion: role, id_usuario: userId }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible cargar las viviendas.");
    } finally {
      setLoading(false);
    }
  }, [role, userId]);

  useEffect(() => { void load(); }, [load, refreshKey]);
  useEffect(() => {
    if (value || !initialHouseId || !data) return;
    const current = data.viviendas.find((h) => h.id_casa === initialHouseId && h.elegible);
    if (current) { onChange(current); setOpen(false); }
  }, [data, initialHouseId, value, onChange]);
  useEffect(() => { setCandidate(null); if (!value) setOpen(true); }, [role, refreshKey, value]);

  const helper = role==='contrato' ? 'Selecciona una vivienda activa para revisar o configurar su contrato y sus personas.' : role === "residente"
    ? "Selecciona una vivienda disponible. Al crear el usuario la vivienda pasará a Ocupada."
    : "Selecciona una vivienda ocupada: el inquilino quedará vinculado a la vivienda de su residente.";

  return (
    <fieldset className="min-w-0 rounded-xl border border-slate-200 p-3 sm:p-4">
      <legend className="px-1 text-sm font-semibold text-slate-900">Seleccionar vivienda</legend>

      {value ? (
        <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 p-3" aria-live="polite">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-blue-900"><CheckCircle2 className="size-4" aria-hidden="true" />Vivienda seleccionada</p>
          <HouseSummaryRows house={value} role={role} />
          {!open ? <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setOpen(true)}>Cambiar vivienda</Button> : null}
        </div>
      ) : null}

      {open ? (
        <>
          <p className="mb-3 text-sm text-slate-600">{helper}</p>
          {loading && !data ? (
            <p role="status" className="rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-500">Cargando viviendas…</p>
          ) : error ? (
            <div role="alert" className="space-y-2 rounded-lg bg-rose-50 p-4 text-sm text-rose-700">
              <p>{error}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="size-4" />Reintentar</Button>
            </div>
          ) : data && data.viviendas.every((h) => !h.elegible) ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm text-slate-600">
              <Home className="mx-auto mb-2 size-6 text-slate-400" aria-hidden="true" />
              {role === "residente" ? "No hay viviendas disponibles. Agrega una en el módulo Viviendas." : "No hay viviendas ocupadas a las que vincular un inquilino."}
            </div>
          ) : data ? (
            <HouseMap
              key={role}
              houses={data.viviendas}
              summary={data.resumen}
              selectedId={candidate?.id_casa ?? value?.id_casa ?? null}
              onSelect={setCandidate}
              selectable={(house) => ({ ok: Boolean(house.elegible), motivo: house.motivo })}
              initialVisible={role==='contrato'?{}:role === "residente" ? { OCUPADA: false } : { DISPONIBLE: false }}
              title="Selector de vivienda"
            />
          ) : null}

          {candidate ? (
            <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
              <HouseSummaryRows house={candidate} role={role} />
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setCandidate(null)}>Descartar</Button>
                <Button type="button" size="sm" onClick={() => { onChange(candidate); setCandidate(null); setOpen(false); }}>
                  Confirmar vivienda {candidate.codigo}
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </fieldset>
  );
}
