import { useFeedbackState } from "@/hooks/useFeedbackState";
import { useReservationUpdates } from "@/hooks/useReservationUpdates";
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, History, Pencil, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { useAuth } from "@/hooks/useAuth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  createAmenitiesReservationRequest,
  cancelAmenitiesReservationRequest,
  getAmenityAvailabilityRequest,
  getAmenitiesRequest,
  getAmenitiesReservationHistoryRequest,
  getAmenitiesReservationsRequest,
  updateAmenitiesReservationRequest,
  validateAmenityConflictRequest,
} from "@/services/amenitiesService";
import type {
  Amenity,
  AmenityAvailabilityResponse,
  AmenityReservation,
  AmenityReservationHistory,
} from "@/types/amenities";
import { formatUtcTimestamp, guatemalaToday } from "@/utils/guatemalaTime";
import { guatemalaCurrentTime } from "@/utils/providerAccess";
import { getApiErrorCode } from "@/utils/apiErrorDetails";
import { confirmAction, notifyError } from "@/utils/feedback";

// HU-C05.1: un bloque que ya empezo (o de un dia pasado) no se puede reservar.
function isPastSlot(fecha: string, horaInicio: string, now = new Date()) {
  const today = guatemalaToday(0, now);
  if (fecha < today) return true;
  return fecha === today && horaInicio <= guatemalaCurrentTime(now);
}

const historyActionLabels: Record<string, string> = {
  CREACION: "Creada",
  MODIFICACION: "Modificada",
  CANCELACION: "Cancelada",
  CANCELACION_ADMIN: "Cancelada por administración",
  CREACION_ADMIN: "Creada por administración",
};

type SlotSelection = {
  hora_inicio: string;
  hora_fin: string;
};

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatLongDate(value: string) {
  return new Intl.DateTimeFormat("es-GT", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${value}T00:00:00`));
}

function getWeekDates(baseDate: Date) {
  const current = new Date(baseDate);
  const day = current.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  current.setDate(current.getDate() + mondayOffset);

  return Array.from({ length: 7 }, (_, index) => {
    const item = new Date(current);
    item.setDate(current.getDate() + index);
    return formatDate(item);
  });
}

export function ResidenteAmenitiesView() {
  const reservationRevision = useReservationUpdates();
  const initialParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const navigate = useNavigate();
  const { user } = useAuth();
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [reservations, setReservations] = useState<AmenityReservation[]>([]);
  const [reservationHistory, setReservationHistory] = useState<AmenityReservationHistory[]>([]);
  const [availability, setAvailability] = useState<AmenityAvailabilityResponse | null>(null);
  const [selectedAmenityId, setSelectedAmenityId] = useState<number | null>(() => Number(initialParams.get("amenidad")) || null);
  const [selectedDate, setSelectedDate] = useState(() => initialParams.get("fecha") || "");
  const [selectedSlot, setSelectedSlot] = useState<SlotSelection | null>(() => {
    const horaInicio = initialParams.get("inicio");
    const horaFin = initialParams.get("fin");
    return horaInicio && horaFin ? { hora_inicio: horaInicio, hora_fin: horaFin } : null;
  });
  const [weekReference, setWeekReference] = useState(() => new Date(`${guatemalaToday()}T12:00:00`));
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingAvailability, setIsLoadingAvailability] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingReservation, setEditingReservation] = useState<AmenityReservation | null>(null);
  const [updatingReservationKey, setUpdatingReservationKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useFeedbackState("error", "");
  const [successMessage, setSuccessMessage] = useFeedbackState("success", "");

  const weekDates = useMemo(() => getWeekDates(weekReference), [weekReference]);

  useEffect(() => {
    if (!selectedDate && weekDates.length > 0) {
      setSelectedDate(weekDates.includes(guatemalaToday()) ? guatemalaToday() : weekDates[0]);
    }
  }, [selectedDate, weekDates]);

  useEffect(() => {
    let active = true;

    async function loadData() {
      try {
        setIsLoading(true);
        setErrorMessage("");
        const [amenitiesResponse, reservationsResponse, historyResponse] = await Promise.all([
          getAmenitiesRequest(),
          getAmenitiesReservationsRequest({
            from: weekDates[0],
            to: weekDates[6],
          }),
          getAmenitiesReservationHistoryRequest(),
        ]);

        if (!active) {
          return;
        }

        setAmenities(amenitiesResponse);
        setReservations(reservationsResponse);
        setReservationHistory(historyResponse);
        if (amenitiesResponse.length > 0) {
          setSelectedAmenityId((current) => current ?? amenitiesResponse[0].id_amenidad);
        }
      } catch (error) {
        if (active) {
          setErrorMessage(
            error instanceof Error ? error.message : "No fue posible cargar las amenidades.",
          );
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadData();

    return () => {
      active = false;
    };
  }, [weekDates, reservationRevision]);

  useEffect(() => {
    if (!selectedAmenityId || !selectedDate) {
      return;
    }

    let active = true;

    async function loadAvailability() {
      try {
        setIsLoadingAvailability(true);
        const response = await getAmenityAvailabilityRequest(selectedAmenityId, selectedDate);

        if (active) {
          setAvailability(response);
        }
      } catch (error) {
        if (active) {
          setErrorMessage(
            error instanceof Error ? error.message : "No fue posible cargar la disponibilidad.",
          );
          setAvailability(null);
        }
      } finally {
        if (active) {
          setIsLoadingAvailability(false);
        }
      }
    }

    void loadAvailability();

    return () => {
      active = false;
    };
  }, [selectedAmenityId, selectedDate, reservationRevision]);

  const selectedAmenity = useMemo(
    () => amenities.find((item) => item.id_amenidad === selectedAmenityId) || null,
    [amenities, selectedAmenityId],
  );
  const selectedDateIsPast = Boolean(selectedDate) && selectedDate < guatemalaToday();

  const selectedReservations = useMemo(() => {
    if (availability?.fecha === selectedDate && availability.amenidad.id_amenidad === selectedAmenityId) {
      return availability.reservas;
    }

    if (!selectedAmenityId || !selectedDate) {
      return [];
    }

    return reservations.filter(
      (item) => item.id_amenidad === selectedAmenityId && item.fecha === selectedDate,
    );
  }, [availability, reservations, selectedAmenityId, selectedDate]);

  const selectedSlotIsBusy = useMemo(() => {
    if (!selectedSlot) {
      return true;
    }

    const slot = availability?.slots.find(
      (item) =>
        item.hora_inicio === selectedSlot.hora_inicio && item.hora_fin === selectedSlot.hora_fin,
    );

    return !slot || !slot.disponible;
  }, [availability, selectedSlot]);

  async function handleConfirmReservation() {
    if (!selectedAmenityId || !selectedDate || !selectedSlot) {
      setErrorMessage("Selecciona amenidad, dia y horario antes de confirmar.");
      return;
    }

    if (selectedSlotIsBusy) {
      setErrorMessage("Ese horario ya no esta disponible.");
      return;
    }

    if (isPastSlot(selectedDate, selectedSlot.hora_inicio)) {
      void notifyError("La fecha u hora seleccionada ya pasó. Elige un horario futuro.", undefined, "No se puede reservar en el pasado");
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage("");
      setSuccessMessage("");
      const conflict = await validateAmenityConflictRequest({
        id_amenidad: selectedAmenityId,
        fecha: selectedDate,
        hora_inicio: selectedSlot.hora_inicio,
        hora_fin: selectedSlot.hora_fin,
      });

      if (conflict.limite_alcanzado) {
        setErrorMessage(
          conflict.mensaje_limite ||
            `Ya alcanzaste el limite de ${conflict.limite_reservas} reservas activas.`,
        );
        return;
      }

      if (conflict.conflicto) {
        setErrorMessage("Ese horario ya no esta disponible.");
        return;
      }

      const created = await createAmenitiesReservationRequest({
        id_amenidad: selectedAmenityId,
        fecha: selectedDate,
        hora_inicio: selectedSlot.hora_inicio,
        hora_fin: selectedSlot.hora_fin,
      });

      setReservations((current) => [...current, created]);
      setSuccessMessage(
        `Reserva confirmada para ${created.amenidad_nombre} el ${formatLongDate(created.fecha)} a las ${created.hora_inicio}.`,
      );
      setSelectedSlot(null);
      await refreshAfterSaved();
    } catch (error) {
      // HU-C05.1: el error de la accion se muestra flotante, visible aunque la
      // cuadricula este lejos del encabezado de la pagina.
      void notifyError(
        error,
        "No fue posible confirmar la reserva.",
        getApiErrorCode(error) === "RESERVATION_IN_PAST" ? "No se puede reservar en el pasado" : undefined,
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function canChangeReservation(reservation: AmenityReservation) {
    const start = new Date(`${reservation.fecha}T${reservation.hora_inicio}:00-06:00`);
    return (
      reservation.id_usuario === user?.id &&
      reservation.estado_actual !== "CANCELADA" &&
      reservation.estado_actual !== "EN_CURSO" &&
      reservation.estado_actual !== "FINALIZADA" &&
      start.getTime() - Date.now() >= 120 * 60 * 1000
    );
  }

  async function refreshReservations() {
    const [reservationsResponse, historyResponse] = await Promise.all([
      getAmenitiesReservationsRequest({
        from: weekDates[0],
        to: weekDates[6],
      }),
      getAmenitiesReservationHistoryRequest(),
    ]);
    setReservations(reservationsResponse);
    setReservationHistory(historyResponse);

    if (selectedAmenityId && selectedDate) {
      setAvailability(await getAmenityAvailabilityRequest(selectedAmenityId, selectedDate));
    }
  }

  async function refreshAfterSaved() {
    try { await refreshReservations(); }
    catch { setErrorMessage("La reserva se guardó, pero no fue posible actualizar el calendario. Actualiza la vista para consultar su estado."); }
  }

  async function handleUpdateReservation() {
    if (!editingReservation || !selectedSlot) {
      setErrorMessage("Selecciona un nuevo horario para modificar la reserva.");
      return;
    }

    try {
      setUpdatingReservationKey(editingReservation.reservation_key);
      setErrorMessage("");
      setSuccessMessage("");
      const updated = await updateAmenitiesReservationRequest(editingReservation.reservation_key, {
        id_amenidad: selectedAmenityId || editingReservation.id_amenidad,
        fecha: selectedDate || editingReservation.fecha,
        hora_inicio: selectedSlot.hora_inicio,
        hora_fin: selectedSlot.hora_fin,
      });
      setReservations((current) => current.map((item) => item.reservation_key === editingReservation.reservation_key ? updated : item));
      setEditingReservation(null);
      setSelectedSlot(null);
      setSuccessMessage(`Reserva modificada para ${updated.amenidad_nombre} el ${formatLongDate(updated.fecha)}.`);
      await refreshAfterSaved();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No fue posible modificar la reserva.");
    } finally {
      setUpdatingReservationKey(null);
    }
  }

  async function handleCancelReservation(reservation: AmenityReservation) {
    if (!await confirmAction({ title: "¿Cancelar esta reserva?", text: `${reservation.amenidad_nombre} · ${reservation.fecha} ${reservation.hora_inicio}-${reservation.hora_fin}. El horario quedará libre.`, confirmText: "Cancelar reserva", cancelText: "Volver", tone: "danger" })) return;
    try {
      setUpdatingReservationKey(reservation.reservation_key);
      setErrorMessage("");
      setSuccessMessage("");
      await cancelAmenitiesReservationRequest(reservation.reservation_key);
      setReservations((current) => current.map((item) => item.reservation_key === reservation.reservation_key ? { ...item, estado: "CANCELADA", estado_actual: "CANCELADA" } : item));
      if (editingReservation?.reservation_key === reservation.reservation_key) { setEditingReservation(null); setSelectedSlot(null); }
      setSuccessMessage(`Reserva de ${reservation.amenidad_nombre} cancelada correctamente.`);
      await refreshAfterSaved();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No fue posible cancelar la reserva.");
    } finally {
      setUpdatingReservationKey(null);
    }
  }

  return (
    <AppShell
      role="residente"
      title="Amenidades"
      subtitle="Disponibilidad real, reservas y confirmación inmediata."
      actions={
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate("/residente/amenidades/disponibilidad-general")}
        >
          Comparar todas las amenidades
        </Button>
      }
    >
      <div className="space-y-6">

        {errorMessage ? (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}

        {successMessage ? (
          <Alert className="border-emerald-200 bg-emerald-50 text-emerald-700">
            <AlertTitle>Reserva confirmada</AlertTitle>
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        ) : null}

        <Card className="border-white/70 bg-white shadow-[0_16px_40px_rgba(30,41,59,0.08)]">
          <CardHeader>
            <CardTitle className="text-xl">Amenidades disponibles</CardTitle>
            <CardDescription>
              Selecciona la amenidad y consulta solo horarios almacenados en la base de datos.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
                Cargando amenidades...
              </div>
            ) : amenities.length === 0 ? (
              <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
                No hay amenidades configuradas.
              </div>
            ) : (
              amenities.map((amenity) => (
                <button
                  key={amenity.id_amenidad}
                  type="button"
                  onClick={() => {
                    setSelectedAmenityId(amenity.id_amenidad);
                    setSelectedSlot(null);
                  }}
                  className={`flex w-full items-center justify-between rounded-2xl border px-5 py-4 text-left transition ${
                    amenity.id_amenidad === selectedAmenityId
                      ? "border-blue-300 bg-blue-50"
                      : "border-slate-200 bg-slate-50 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <CalendarDays className="size-5 text-blue-600" />
                    <div>
                      <span className="font-medium text-slate-900">{amenity.nombre}</span>
                      <p className="mt-1 text-xs text-slate-500">
                        {amenity.hora_apertura} - {amenity.hora_cierre}
                      </p>
                    </div>
                  </div>
                  <span className="text-sm text-slate-500">
                    {amenity.activo ? "Ver horarios" : "Inactiva"}
                  </span>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-white/70 bg-white shadow-[0_16px_40px_rgba(30,41,59,0.08)]">
          <CardHeader className="gap-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xl">Calendario semanal</CardTitle>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    const previous = new Date(weekReference);
                    previous.setDate(previous.getDate() - 7);
                    setWeekReference(previous);
                  }}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    const next = new Date(weekReference);
                    next.setDate(next.getDate() + 7);
                    setWeekReference(next);
                  }}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
            <CardDescription>
              Cambia el dia para consultar la disponibilidad real de la amenidad seleccionada.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4 lg:grid-cols-7">
            {weekDates.map((day) => (
              <button
                key={day}
                type="button"
                onClick={() => {
                  setSelectedDate(day);
                  setSelectedSlot(null);
                }}
                className={`rounded-2xl border px-3 py-3 text-left transition ${
                  selectedDate === day
                    ? "border-blue-300 bg-blue-50 text-blue-900"
                    : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300"
                }`}
              >
                <p className="text-xs uppercase">
                  {new Date(`${day}T00:00:00`).toLocaleDateString("es-GT", { weekday: "short" })}
                </p>
                <p className="text-sm font-semibold">{formatLongDate(day)}</p>
                <p className="mt-2 text-xs text-slate-500">
                  {reservations.filter((item) => item.fecha === day).length} reserva(s)
                </p>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="border-white/70 bg-white shadow-[0_16px_40px_rgba(30,41,59,0.08)]">
          <CardHeader>
            <CardTitle className="text-xl">Cuadricula de horarios</CardTitle>
            <CardDescription>
              {selectedAmenity ? `${selectedAmenity.nombre} | ${formatLongDate(selectedDate)}` : "Selecciona una amenidad"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedDateIsPast ? (
              <Alert variant="destructive">
                <AlertTitle>Fecha pasada</AlertTitle>
                <AlertDescription>
                  No se pueden registrar reservas en fechas pasadas. Elige hoy o un día futuro.
                </AlertDescription>
              </Alert>
            ) : null}
            {isLoadingAvailability ? (
              <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
                Cargando disponibilidad...
              </div>
            ) : availability && availability.slots.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
                {availability.slots.map((slot) => {
                  const isSelected =
                    selectedSlot?.hora_inicio === slot.hora_inicio &&
                    selectedSlot?.hora_fin === slot.hora_fin;
                  const isPast = isPastSlot(selectedDate, slot.hora_inicio);

                  return (
                    <button
                      key={`${slot.hora_inicio}-${slot.hora_fin}`}
                      type="button"
                      disabled={!slot.disponible || !selectedAmenity || isPast}
                      onClick={() =>
                        setSelectedSlot({
                          hora_inicio: slot.hora_inicio,
                          hora_fin: slot.hora_fin,
                        })
                      }
                      className={`rounded-2xl border px-4 py-3 text-left transition ${
                        isPast
                          ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                          : !slot.disponible
                          ? "cursor-not-allowed border-rose-200 bg-rose-50 text-rose-700"
                          : isSelected
                            ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                            : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300"
                      }`}
                    >
                      <p className="flex items-center gap-2 text-sm font-medium">
                        <Clock3 className="size-4" />
                        {slot.hora_inicio} - {slot.hora_fin}
                      </p>
                      <p className="mt-1 text-xs">
                        {isPast ? "Horario pasado" : slot.disponible ? "Disponible" : "Ocupado"}
                      </p>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
                No hay bloques configurados para esta amenidad en la fecha seleccionada.
              </div>
            )}

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              <p className="font-medium text-slate-900">Reservas del dia</p>
              <div className="mt-3 space-y-2">
                {selectedReservations.length > 0 ? (
                  selectedReservations.map((reservation) => (
                    <div
                      key={reservation.reservation_key}
                      className="flex flex-col gap-3 rounded-xl bg-white px-4 py-3 md:flex-row md:items-center md:justify-between"
                    >
                      <div>
                        <span>
                          {reservation.hora_inicio} - {reservation.hora_fin}
                        </span>
                        <span className="ml-3 rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-700">
                          {reservation.estado_actual}
                        </span>
                      </div>
                      {canChangeReservation(reservation) ? (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            disabled={updatingReservationKey === reservation.reservation_key}
                            onClick={() => {
                              setEditingReservation(reservation);
                              setSelectedAmenityId(reservation.id_amenidad);
                              setSelectedDate(reservation.fecha);
                              setSelectedSlot({
                                hora_inicio: reservation.hora_inicio,
                                hora_fin: reservation.hora_fin,
                              });
                            }}
                            className="rounded-xl"
                          >
                            <Pencil className="size-4" />
                            Modificar reserva
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={updatingReservationKey === reservation.reservation_key}
                            onClick={() => void handleCancelReservation(reservation)}
                            className="rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50"
                          >
                            <XCircle className="size-4" />
                            Cancelar reserva
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="text-slate-500">Sin reservas para este dia.</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          {editingReservation ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditingReservation(null);
                  setSelectedSlot(null);
                }}
                className="h-12 rounded-2xl"
              >
                Cancelar edicion
              </Button>
              <Button
                type="button"
                disabled={!selectedAmenity || !selectedDate || !selectedSlot || selectedSlotIsBusy}
                onClick={() => void handleUpdateReservation()}
                className="h-12 rounded-2xl bg-blue-600 px-8 text-white hover:bg-blue-700"
              >
                Guardar modificacion
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              disabled={!selectedAmenity || !selectedDate || !selectedSlot || selectedSlotIsBusy || isSubmitting}
              onClick={handleConfirmReservation}
              className="h-12 rounded-2xl bg-[linear-gradient(90deg,#3b82f6_0%,#1d4ed8_100%)] px-8 text-white hover:opacity-95"
            >
              {isSubmitting ? "Confirmando..." : "Confirmar reserva"}
            </Button>
          )}
        </div>

        <Card className="border-white/70 bg-white shadow-[0_16px_40px_rgba(30,41,59,0.08)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <History className="size-5 text-blue-600" />
              Historial de reservas
            </CardTitle>
            <CardDescription>
              Modificaciones y cancelaciones (incluidas las de administración, con su motivo) registradas en base de datos.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {reservationHistory.length === 0 ? (
              <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
                Sin movimientos recientes.
              </div>
            ) : (
              reservationHistory.slice(0, 6).map((entry) => (
                <article key={entry.id_historial} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-slate-900">{entry.amenidad_nombre}</p>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                      {historyActionLabels[entry.accion] || entry.accion}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-500">{entry.detalle}</p>
                  <p className="mt-2 text-xs text-slate-400">{formatUtcTimestamp(entry.creado_en)}</p>
                </article>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
