import { useFeedbackState } from "@/hooks/useFeedbackState";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getUnifiedAmenityAvailabilityRequest } from "@/services/amenitiesService";
import type { AmenityAvailabilityResponse, AmenityAvailabilitySlot } from "@/types/amenities";
import { guatemalaToday } from "@/utils/guatemalaTime";

// Fecha minima reservable: hoy en Guatemala (toISOString daria el dia UTC).
const today = () => guatemalaToday();

export function ResidenteUnifiedAmenitiesAvailabilityView() {
  const navigate = useNavigate();
  const [fecha, setFecha] = useState(today());
  const [data, setData] = useState<AmenityAvailabilityResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useFeedbackState("error", "");
  const [selected, setSelected] = useState<{ id: number; slot: AmenityAvailabilitySlot } | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setSelected(null);
    getUnifiedAmenityAvailabilityRequest(fecha)
      .then((response) => {
        if (active) setData(response.amenidades);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "No fue posible consultar disponibilidad.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fecha]);

  function continueToReservation() {
    if (!selected) return;
    navigate(
      `/residente/amenidades?amenidad=${selected.id}&fecha=${fecha}&inicio=${selected.slot.hora_inicio}&fin=${selected.slot.hora_fin}`,
    );
  }

  return (
    <AppShell
      role="residente"
      title="Disponibilidad general"
      subtitle="Compare todas las amenidades para una misma fecha."
    >
      <label className="flex max-w-xs flex-col gap-1">
        <span className="text-xs font-medium text-slate-500">Fecha</span>
        <Input aria-label="Fecha" type="date" value={fecha} min={today()} onChange={(event) => setFecha(event.target.value)} />
      </label>

      {error ? <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}

      {loading ? (
        <p className="py-8 text-center text-sm text-slate-500">Cargando disponibilidad...</p>
      ) : !error && data.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500">
          No hay amenidades disponibles para esta fecha.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.map((item) => (
            <section
              key={item.amenidad.id_amenidad}
              aria-label={item.amenidad.nombre}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <h2 className="text-base font-semibold text-slate-950">{item.amenidad.nombre}</h2>
              <p className="text-sm text-slate-500">
                {item.amenidad.hora_apertura}–{item.amenidad.hora_cierre}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {item.slots.map((slot) => {
                  const isSelected =
                    selected?.id === item.amenidad.id_amenidad && selected.slot.hora_inicio === slot.hora_inicio;
                  return (
                    <button
                      key={slot.hora_inicio}
                      type="button"
                      disabled={!slot.disponible}
                      aria-pressed={slot.disponible ? isSelected : undefined}
                      onClick={() => setSelected({ id: item.amenidad.id_amenidad, slot })}
                      className={`rounded-xl border p-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                        slot.disponible
                          ? isSelected
                            ? "border-blue-500 bg-blue-50 text-blue-700"
                            : "border-emerald-100 bg-emerald-50 text-emerald-700 hover:border-emerald-300"
                          : "cursor-not-allowed border-rose-100 bg-rose-50 text-rose-700"
                      }`}
                    >
                      <span>
                        {slot.hora_inicio}–{slot.hora_fin}
                      </span>
                      <small className="block">{slot.disponible ? "Disponible" : "Ocupado"}</small>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <Button disabled={!selected} onClick={continueToReservation}>
          Continuar a reservar
        </Button>
      </div>
    </AppShell>
  );
}
