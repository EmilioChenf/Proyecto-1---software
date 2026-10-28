import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { useFeedbackState } from "@/hooks/useFeedbackState";
import { useReservationUpdates } from "@/hooks/useReservationUpdates";
import { getTenantAmenitiesHistoryRequest, getTenantAmenitiesReservationsRequest } from "@/services/amenitiesService";
import type { AmenityReservation, AmenityReservationHistory } from "@/types/amenities";
import { formatUtcTimestamp, guatemalaToday } from "@/utils/guatemalaTime";

export function TenantAmenitiesHistoryView() {
  const revision = useReservationUpdates();
  const [range, setRange] = useState(() => ({ from: guatemalaToday(-30), to: guatemalaToday(365) }));
  const [draft, setDraft] = useState(range);
  const [reservations, setReservations] = useState<AmenityReservation[]>([]);
  const [history, setHistory] = useState<AmenityReservationHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useFeedbackState("error", "");
  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([getTenantAmenitiesReservationsRequest(range), getTenantAmenitiesHistoryRequest()])
      .then(([items, events]) => { if (active) { setReservations(items); setHistory(events); setError(""); } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "No fue posible consultar tus reservas."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [range, revision, retry]);

  return <AppShell role="inquilino" title="Mis reservas" subtitle="Consulta las reservas que administración realizó en tu nombre y su historial.">
    <form className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4" onSubmit={(event) => {
      event.preventDefault();
      if (!draft.from || !draft.to || draft.from > draft.to) { setError("Revisa la fecha inicial y final."); return; }
      setRange({ ...draft });
    }}>
      <label className="text-sm">Desde<input aria-label="Desde" type="date" required className="mt-1 block rounded-md border p-2" value={draft.from} max={draft.to} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label>
      <label className="text-sm">Hasta<input aria-label="Hasta" type="date" required className="mt-1 block rounded-md border p-2" value={draft.to} min={draft.from} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></label>
      <Button disabled={loading} type="submit">Consultar</Button>
      <Button disabled={loading} type="button" variant="outline" onClick={() => setRetry((value) => value + 1)}>Actualizar</Button>
    </form>
    {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-4 text-red-800">{error}</p>}
    {loading && <p role="status">Actualizando reservas…</p>}
    <section aria-label="Reservas de mi cuenta" className="space-y-3">
      {!loading && !reservations.length && <p>No hay reservas en este período.</p>}
      {reservations.map((reservation) => <article key={reservation.reservation_key} className="rounded-xl border bg-white p-4">
        <h2 className="font-semibold">{reservation.amenidad_nombre} · {reservation.fecha}</h2>
        <p>{reservation.hora_inicio}–{reservation.hora_fin} · {reservation.estado_actual === "CANCELADA" ? "Cancelada" : reservation.estado_actual === "FINALIZADA" ? "Finalizada" : reservation.estado_actual === "EN_CURSO" ? "En curso" : reservation.estado_actual === "PENDIENTE" ? "Pendiente" : "Confirmada"}</p>
        {reservation.creada_por_admin && <p className="mt-2 text-sm text-slate-600">Creada por administración: {reservation.creada_por_nombre || "Administrador"}.</p>}
        {reservation.estado_actual === "CANCELADA" && <p className="mt-2 text-sm text-slate-700">Cancelada por {reservation.cancelada_por_nombre || "administración"}{reservation.cancelada_en ? ` el ${formatUtcTimestamp(reservation.cancelada_en)}` : ""}.{reservation.motivo_cancelacion ? ` Motivo: ${reservation.motivo_cancelacion}` : ""}</p>}
      </article>)}
    </section>
    <section aria-label="Historial de mis reservas" className="mt-6 rounded-xl border bg-white p-4">
      <h2 className="mb-3 text-lg font-semibold">Historial de mis reservas</h2>
      <p className="mb-3 text-sm text-slate-600">Últimos 20 eventos de tu cuenta. Horas de Guatemala.</p>
      {!loading && !history.length && <p>No hay movimientos registrados.</p>}
      <ol className="space-y-3">{history.map((event) => <li key={event.id_historial} className="border-b pb-3">
        <p>{event.detalle}</p><p className="mt-1 text-sm text-slate-600">{formatUtcTimestamp(event.creado_en)}</p>
      </li>)}</ol>
    </section>
  </AppShell>;
}
