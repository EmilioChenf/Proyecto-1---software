import { useFeedbackState } from "@/hooks/useFeedbackState";
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, KeyRound } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { TenantRequestsPanel } from "@/components/residente/TenantRequestsPanel";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAmenitiesReservationsRequest } from "@/services/amenitiesService";
import { getVisitsRequest } from "@/services/visitsService";
import type { AmenityReservation } from "@/types/amenities";
import type { VisitRecord } from "@/types/visits";
import { guatemalaToday } from "@/utils/guatemalaTime";

type UnifiedFilter = "TODOS" | "ACCESOS" | "RESERVAS" | "ACTIVOS";

const filterLabels: Record<UnifiedFilter, string> = {
  TODOS: "Todos",
  ACTIVOS: "Activos",
  ACCESOS: "Accesos",
  RESERVAS: "Reservas",
};

// HU32: estados reales de ACCESO; solo AUTORIZADA es "Activo".
function accessStatusLabel(estado?: string) {
  switch (estado) {
    case "INGRESO_REGISTRADO":
    case "SALIDA_REGISTRADA":
      return "Utilizado";
    case "CANCELADA":
      return "Cancelado";
    case "RECHAZADA":
      return "Rechazado";
    case "PENDIENTE_APROBACION":
      return "Por aprobar";
    default:
      return "Activo";
  }
}

// "Hoy" y el rango de 30 dias se calculan en America/Guatemala, no en UTC.
function today() {
  return guatemalaToday();
}

function futureDate(days: number) {
  return guatemalaToday(days);
}

export function ResidenteUnifiedView() {
  const { user } = useAuth();
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [reservations, setReservations] = useState<AmenityReservation[]>([]);
  const [filter, setFilter] = useState<UnifiedFilter>("TODOS");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useFeedbackState("error", "");

  useEffect(() => {
    let active = true;

    Promise.all([
      getVisitsRequest(),
      getAmenitiesReservationsRequest({
        from: today(),
        to: futureDate(30),
        id_usuario: user?.id,
      }),
    ])
      .then(([visitsResponse, reservationsResponse]) => {
        if (active) {
          setError("");
          setVisits(visitsResponse);
          setReservations(reservationsResponse);
        }
      })
      .catch((reason) => {
        if (active) {
          setVisits([]);
          setReservations([]);
          setError(reason instanceof Error && reason.message ? reason.message : "No fue posible cargar accesos y reservas.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user?.id]);

  const items = useMemo(() => {
    const accessItems = visits.map((visit) => ({
      id: `access-${visit.id_acceso}`,
      type: "ACCESOS" as const,
      title: visit.nombre,
      subtitle: `${visit.casa} | ${visit.fecha} | ${visit.hora_inicio} - ${visit.hora_fin}`,
      status: accessStatusLabel(visit.estado_acceso),
      active: visit.estado_acceso === "AUTORIZADA",
    }));
    const reservationItems = reservations.map((reservation) => ({
      id: `reservation-${reservation.reservation_key}`,
      type: "RESERVAS" as const,
      title: reservation.amenidad_nombre,
      subtitle: `${reservation.fecha} | ${reservation.hora_inicio} - ${reservation.hora_fin}`,
      status: reservation.estado_actual,
      active: ["CONFIRMADA", "PENDIENTE", "EN_CURSO"].includes(reservation.estado_actual),
    }));

    return [...accessItems, ...reservationItems]
      .filter((item) => filter === "TODOS" || item.type === filter || (filter === "ACTIVOS" && item.active))
      .sort((first, second) => second.subtitle.localeCompare(first.subtitle));
  }, [filter, reservations, visits]);

  return (
    <AppShell role="residente" title="Accesos y reservas" subtitle="Vista unificada de accesos y reservas con filtros rápidos.">
      <TenantRequestsPanel />

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Resumen unificado</CardTitle>
              <CardDescription>Accesos autorizados y reservas de los próximos 30 días.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar accesos y reservas">
              {(["TODOS", "ACTIVOS", "ACCESOS", "RESERVAS"] as UnifiedFilter[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={filter === item}
                  onClick={() => setFilter(item)}
                  className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    filter === item ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {filterLabels[item]}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {loading ? (
            <p className="py-8 text-center text-sm text-slate-500 md:col-span-2">Cargando accesos y reservas...</p>
          ) : error ? (
            <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 md:col-span-2">{error}</p>
          ) : items.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500 md:col-span-2">
              No hay datos para el filtro seleccionado.
            </p>
          ) : (
            items.map((item) => (
              <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex gap-3">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                      {item.type === "ACCESOS" ? <KeyRound className="size-5" /> : <CalendarDays className="size-5" />}
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900">{item.title}</h3>
                      <p className="mt-1 text-sm text-slate-500">{item.subtitle}</p>
                    </div>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${item.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                    {item.status}
                  </span>
                </div>
              </article>
            ))
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
