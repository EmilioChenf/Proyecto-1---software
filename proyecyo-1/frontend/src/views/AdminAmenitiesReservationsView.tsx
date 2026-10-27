import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  PlusCircle,
  Settings2,
  Users,
  X,
} from "lucide-react";

import { AdminLayout } from "@/components/admin/AdminLayout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  adminCancelAmenitiesReservationRequest,
  createAdminAmenitiesReservationRequest,
  getAdminAmenityAvailabilityRequest,
  getAdminAmenitiesRequest,
  getAdminAmenitiesReservationsRequest,
  getAdminAmenitiesUsersRequest,
  updateAmenityScheduleRequest,
  validateAdminAmenityConflictRequest,
} from "@/services/amenitiesService";
import type {
  Amenity,
  AmenityAvailabilityResponse,
  AmenityReservation,
  CreateAmenityReservationPayload,
  ReservableUserOption,
  UpdateAmenitySchedulePayload,
} from "@/types/amenities";
import { confirmAction, notifyError, notifySuccess, promptText } from "@/utils/feedback";

type CalendarDay = {
  date: string;
  dayNumber: number;
  isCurrentMonth: boolean;
};

type ReservationFormState = {
  id_usuario: number | "";
  id_amenidad: number | "";
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
};

type AvailabilityFormState = {
  id_amenidad: number | "";
  fecha: string;
};

type ScheduleFormState = UpdateAmenitySchedulePayload & {
  id_amenidad: number | "";
};

const FIELD_CLASS_NAME =
  "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-[0.82rem] text-slate-700 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function parseDate(value: string) {
  return new Date(`${value}T00:00:00`);
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function getCalendarDays(referenceDate: Date) {
  const firstDay = startOfMonth(referenceDate);
  const lastDay = endOfMonth(referenceDate);
  const start = addDays(firstDay, -firstDay.getDay());
  const end = addDays(lastDay, 6 - lastDay.getDay());
  const days: CalendarDay[] = [];

  for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
    days.push({
      date: formatDate(cursor),
      dayNumber: cursor.getDate(),
      isCurrentMonth: cursor.getMonth() === referenceDate.getMonth(),
    });
  }

  return days;
}

function getMonthRange(referenceDate: Date) {
  return {
    from: formatDate(startOfMonth(referenceDate)),
    to: formatDate(endOfMonth(referenceDate)),
  };
}

function getFetchRange(referenceDate: Date) {
  return {
    from: formatDate(addDays(startOfMonth(referenceDate), -7)),
    to: formatDate(addDays(endOfMonth(referenceDate), 7)),
  };
}

function getWeekRange(baseDate: Date) {
  const start = addDays(baseDate, -baseDate.getDay());
  const end = addDays(start, 6);
  return {
    from: formatDate(start),
    to: formatDate(end),
  };
}

function formatLongDate(value: string) {
  return new Intl.DateTimeFormat("es-GT", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(parseDate(value));
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("es-GT", {
    day: "numeric",
    month: "short",
  }).format(parseDate(value));
}

function formatMonthLabel(referenceDate: Date) {
  return new Intl.DateTimeFormat("es-GT", {
    month: "long",
    year: "numeric",
  }).format(referenceDate);
}

function getCurrentTime() {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function toMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function buildAmenitySlots(amenity: Amenity) {
  const slots = [];
  let cursor = toMinutes(amenity.hora_apertura);
  const limit = toMinutes(amenity.hora_cierre);

  while (cursor + amenity.intervalo_minutos <= limit) {
    slots.push({
      hora_inicio: `${Math.floor(cursor / 60).toString().padStart(2, "0")}:${(cursor % 60)
        .toString()
        .padStart(2, "0")}`,
      hora_fin: `${Math.floor((cursor + amenity.intervalo_minutos) / 60)
        .toString()
        .padStart(2, "0")}:${((cursor + amenity.intervalo_minutos) % 60)
        .toString()
        .padStart(2, "0")}`,
    });
    cursor += amenity.intervalo_minutos;
  }

  return slots;
}

function overlapsReservation(
  slot: { hora_inicio: string; hora_fin: string },
  reservation: AmenityReservation,
) {
  return reservation.hora_inicio < slot.hora_fin && reservation.hora_fin > slot.hora_inicio;
}

function getReservationStatusMeta(status: AmenityReservation["estado_actual"]) {
  if (status === "EN_CURSO") {
    return {
      label: "Ocupado",
      className: "bg-rose-100 text-rose-700",
    };
  }

  if (status === "PENDIENTE") {
    return {
      label: "Pendiente",
      className: "bg-amber-100 text-amber-700",
    };
  }

  if (status === "FINALIZADA") {
    return {
      label: "Finalizada",
      className: "bg-slate-100 text-slate-600",
    };
  }

  if (status === "CANCELADA") {
    return {
      label: "Cancelada",
      className: "bg-slate-100 text-slate-500",
    };
  }

  return {
    label: "Confirmada",
    className: "bg-emerald-100 text-emerald-700",
  };
}

function OverlayPanel({
  isOpen,
  title,
  description,
  onClose,
  children,
}: {
  isOpen: boolean;
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-7">
      <div className="w-full max-w-[680px] rounded-[20px] bg-white shadow-[0_40px_100px_rgba(15,23,42,0.24)]">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3.5">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
            <p className="mt-1 text-[0.82rem] text-slate-500">{description}</p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose}>
            <X className="size-5" />
          </Button>
        </div>
        <div className="px-4 py-4">{children}</div>
      </div>
    </div>
  );
}

export function AdminAmenitiesReservationsView() {
  const today = useMemo(() => formatDate(new Date()), []);
  const [monthReference, setMonthReference] = useState(new Date());
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [users, setUsers] = useState<ReservableUserOption[]>([]);
  const [reservations, setReservations] = useState<AmenityReservation[]>([]);
  const [selectedAmenityFilter, setSelectedAmenityFilter] = useState<number | "all">("all");
  const [selectedUserFilter, setSelectedUserFilter] = useState<number | "all">("all");
  const [unitFilter, setUnitFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isReservationModalOpen, setIsReservationModalOpen] = useState(false);
  const [isAvailabilityModalOpen, setIsAvailabilityModalOpen] = useState(false);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [isSubmittingReservation, setIsSubmittingReservation] = useState(false);
  const [isSubmittingSchedule, setIsSubmittingSchedule] = useState(false);
  const [cancellingKey, setCancellingKey] = useState<string | null>(null);
  const [availabilityPreview, setAvailabilityPreview] =
    useState<AmenityAvailabilityResponse | null>(null);
  const [reservationAvailability, setReservationAvailability] =
    useState<AmenityAvailabilityResponse | null>(null);
  const [isLoadingAvailability, setIsLoadingAvailability] = useState(false);
  const [isLoadingReservationAvailability, setIsLoadingReservationAvailability] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [reservationError, setReservationError] = useState("");
  const [scheduleError, setScheduleError] = useState("");
  const [availabilityError, setAvailabilityError] = useState("");
  const [reservationForm, setReservationForm] = useState<ReservationFormState>({
    id_usuario: "",
    id_amenidad: "",
    fecha: today,
    hora_inicio: "",
    hora_fin: "",
  });
  const [availabilityForm, setAvailabilityForm] = useState<AvailabilityFormState>({
    id_amenidad: "",
    fecha: today,
  });
  const [scheduleForm, setScheduleForm] = useState<ScheduleFormState>({
    id_amenidad: "",
    descripcion: "",
    hora_apertura: "08:00",
    hora_cierre: "22:00",
    intervalo_minutos: 60,
    activo: true,
  });

  const fetchRange = useMemo(() => getFetchRange(monthReference), [monthReference]);
  const monthRange = useMemo(() => getMonthRange(monthReference), [monthReference]);
  const calendarDays = useMemo(() => getCalendarDays(monthReference), [monthReference]);

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      try {
        setIsLoading(true);
        setErrorMessage("");
        const [amenitiesResponse, usersResponse, reservationsResponse] = await Promise.all([
          getAdminAmenitiesRequest(),
          getAdminAmenitiesUsersRequest(),
          getAdminAmenitiesReservationsRequest({ ...fetchRange,
            id_amenidad: selectedAmenityFilter === "all" ? null : selectedAmenityFilter,
            id_usuario: selectedUserFilter === "all" ? null : selectedUserFilter,
            unidad: unitFilter || undefined, estado: statusFilter || undefined }),
        ]);

        if (!active) {
          return;
        }

        setAmenities(amenitiesResponse);
        setUsers(usersResponse);
        setReservations(reservationsResponse);
      } catch (error) {
        if (active) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "No fue posible cargar Amenidades / Reservas.",
          );
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadDashboard();

    return () => {
      active = false;
    };
  }, [fetchRange, selectedAmenityFilter, selectedUserFilter, unitFilter, statusFilter]);

  useEffect(() => {
    if (amenities.length === 0) {
      return;
    }

    setReservationForm((current) => ({
      ...current,
      id_usuario: current.id_usuario || users[0]?.id_usuario || "",
      id_amenidad:
        current.id_amenidad ||
        (selectedAmenityFilter === "all" ? amenities[0].id_amenidad : selectedAmenityFilter),
    }));

    setAvailabilityForm((current) => ({
      ...current,
      id_amenidad:
        current.id_amenidad ||
        (selectedAmenityFilter === "all" ? amenities[0].id_amenidad : selectedAmenityFilter),
    }));

    setScheduleForm((current) => {
      if (current.id_amenidad) {
        return current;
      }

      const amenity =
        amenities.find((item) => item.id_amenidad === selectedAmenityFilter) || amenities[0];

      return {
        id_amenidad: amenity.id_amenidad,
        descripcion: amenity.descripcion,
        hora_apertura: amenity.hora_apertura,
        hora_cierre: amenity.hora_cierre,
        intervalo_minutos: amenity.intervalo_minutos,
        activo: amenity.activo,
      };
    });
  }, [amenities, users, selectedAmenityFilter]);

  useEffect(() => {
    if (!isAvailabilityModalOpen || !availabilityForm.id_amenidad || !availabilityForm.fecha) {
      return;
    }

    let active = true;

    async function loadAvailability() {
      try {
        setIsLoadingAvailability(true);
        setAvailabilityError("");
        const response = await getAdminAmenityAvailabilityRequest(
          Number(availabilityForm.id_amenidad),
          availabilityForm.fecha,
        );

        if (active) {
          setAvailabilityPreview(response);
        }
      } catch (error) {
        if (active) {
          setAvailabilityError(
            error instanceof Error ? error.message : "No fue posible consultar la disponibilidad.",
          );
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
  }, [availabilityForm, isAvailabilityModalOpen]);

  useEffect(() => {
    if (!isReservationModalOpen || !reservationForm.id_amenidad || !reservationForm.fecha) {
      return;
    }

    let active = true;

    async function loadAvailability() {
      try {
        setIsLoadingReservationAvailability(true);
        setReservationError("");
        const response = await getAdminAmenityAvailabilityRequest(
          Number(reservationForm.id_amenidad),
          reservationForm.fecha,
        );

        if (active) {
          setReservationAvailability(response);
        }
      } catch (error) {
        if (active) {
          setReservationError(
            error instanceof Error ? error.message : "No fue posible cargar los horarios reales.",
          );
        }
      } finally {
        if (active) {
          setIsLoadingReservationAvailability(false);
        }
      }
    }

    void loadAvailability();

    return () => {
      active = false;
    };
  }, [isReservationModalOpen, reservationForm.id_amenidad, reservationForm.fecha]);

  const monthReservations = useMemo(
    () =>
      reservations.filter(
        (reservation) =>
          reservation.fecha >= monthRange.from &&
          reservation.fecha <= monthRange.to &&
          (selectedAmenityFilter === "all" ||
            reservation.id_amenidad === Number(selectedAmenityFilter)),
      ),
    [monthRange, reservations, selectedAmenityFilter],
  );

  // HU-C05.7: el calendario solo marca como ocupado lo que sigue activo; las
  // canceladas se cuentan aparte para no perder el historial del dia.
  const reservationsByDate = useMemo(() => {
    return monthReservations.reduce<Record<string, AmenityReservation[]>>((accumulator, reservation) => {
      if (reservation.estado === "CANCELADA") {
        return accumulator;
      }

      if (!accumulator[reservation.fecha]) {
        accumulator[reservation.fecha] = [];
      }

      accumulator[reservation.fecha].push(reservation);
      return accumulator;
    }, {});
  }, [monthReservations]);

  const cancelledByDate = useMemo(
    () =>
      monthReservations.reduce<Record<string, number>>((accumulator, reservation) => {
        if (reservation.estado === "CANCELADA") {
          accumulator[reservation.fecha] = (accumulator[reservation.fecha] || 0) + 1;
        }
        return accumulator;
      }, {}),
    [monthReservations],
  );

  const actionAmenity = useMemo(() => {
    if (amenities.length === 0) {
      return null;
    }

    if (selectedAmenityFilter === "all") {
      return amenities[0];
    }

    return amenities.find((item) => item.id_amenidad === selectedAmenityFilter) || amenities[0];
  }, [amenities, selectedAmenityFilter]);

  const amenitySummaries = useMemo(() => {
    const currentTime = getCurrentTime();

    return amenities.map((amenity) => {
      // HU-C05.7: una reserva cancelada no ocupa bloques ni cuenta como reserva activa.
      const todayReservations = reservations.filter(
        (reservation) =>
          reservation.id_amenidad === amenity.id_amenidad &&
          reservation.fecha === today &&
          reservation.estado !== "CANCELADA",
      );
      const slots = buildAmenitySlots(amenity);
      const occupiedSlots = slots.filter((slot) =>
        todayReservations.some((reservation) => overlapsReservation(slot, reservation)),
      ).length;
      const isBusyNow = todayReservations.some(
        (reservation) =>
          reservation.estado_actual !== "CANCELADA" &&
          currentTime >= reservation.hora_inicio &&
          currentTime < reservation.hora_fin,
      );

      return {
        amenity,
        isBusyNow,
        occupiedSlots,
        totalSlots: slots.length,
        reservationsToday: todayReservations.length,
      };
    });
  }, [amenities, reservations, today]);

  const upcomingReservations = useMemo(() => {
    const currentDate = today;
    const currentTime = getCurrentTime();

    return reservations
      .filter((reservation) => {
        if (reservation.estado === "CANCELADA") {
          return false;
        }

        return (
          reservation.fecha > currentDate ||
          (reservation.fecha === currentDate && reservation.hora_fin >= currentTime)
        );
      })
      .sort((left, right) =>
        `${left.fecha} ${left.hora_inicio}`.localeCompare(`${right.fecha} ${right.hora_inicio}`),
      )
      .slice(0, 8);
  }, [reservations, today]);

  const cancelledReservations = useMemo(
    () =>
      reservations
        .filter((reservation) => reservation.estado === "CANCELADA")
        .sort((left, right) => String(right.cancelada_en || "").localeCompare(String(left.cancelada_en || "")))
        .slice(0, 8),
    [reservations],
  );

  const weeklyStats = useMemo(() => {
    const currentWeek = getWeekRange(new Date());
    const previousWeekStart = addDays(parseDate(currentWeek.from), -7);
    const previousWeek = getWeekRange(previousWeekStart);

    const active = reservations.filter((reservation) => reservation.estado !== "CANCELADA");
    const currentTotal = active.filter(
      (reservation) => reservation.fecha >= currentWeek.from && reservation.fecha <= currentWeek.to,
    ).length;
    const previousTotal = active.filter(
      (reservation) =>
        reservation.fecha >= previousWeek.from && reservation.fecha <= previousWeek.to,
    ).length;

    return {
      currentTotal,
      previousTotal,
      delta: currentTotal - previousTotal,
    };
  }, [reservations]);

  async function refreshDashboard() {
    const [amenitiesResponse, usersResponse, reservationsResponse] = await Promise.all([
      getAdminAmenitiesRequest(),
      getAdminAmenitiesUsersRequest(),
      getAdminAmenitiesReservationsRequest(fetchRange),
    ]);

    setAmenities(amenitiesResponse);
    setUsers(usersResponse);
    setReservations(reservationsResponse);
  }

  function openReservationModal(prefill?: Partial<ReservationFormState>) {
    const fallbackAmenityId =
      prefill?.id_amenidad ||
      (selectedAmenityFilter === "all" ? amenities[0]?.id_amenidad : selectedAmenityFilter) ||
      "";

    setReservationError("");
    setReservationAvailability(null);
    setReservationForm({
      id_usuario: prefill?.id_usuario || users[0]?.id_usuario || "",
      id_amenidad: fallbackAmenityId,
      fecha: prefill?.fecha || today,
      hora_inicio: prefill?.hora_inicio || "",
      hora_fin: prefill?.hora_fin || "",
    });
    setIsReservationModalOpen(true);
  }

  function openAvailabilityModal(prefill?: Partial<AvailabilityFormState>) {
    setAvailabilityError("");
    setAvailabilityPreview(null);
    setAvailabilityForm({
      id_amenidad:
        prefill?.id_amenidad ||
        (selectedAmenityFilter === "all" ? amenities[0]?.id_amenidad : selectedAmenityFilter) ||
        "",
      fecha: prefill?.fecha || today,
    });
    setIsAvailabilityModalOpen(true);
  }

  function openScheduleModal() {
    const amenity =
      amenities.find((item) => item.id_amenidad === selectedAmenityFilter) || amenities[0];

    if (!amenity) {
      return;
    }

    setScheduleError("");
    setScheduleForm({
      id_amenidad: amenity.id_amenidad,
      descripcion: amenity.descripcion,
      hora_apertura: amenity.hora_apertura,
      hora_cierre: amenity.hora_cierre,
      intervalo_minutos: amenity.intervalo_minutos,
      activo: amenity.activo,
    });
    setIsScheduleModalOpen(true);
  }

  async function handleReservationSubmit() {
    if (!reservationForm.id_usuario || !reservationForm.id_amenidad || !reservationForm.hora_inicio) {
      setReservationError("Completa residente, amenidad, fecha y horario antes de guardar.");
      return;
    }

    const payload: CreateAmenityReservationPayload = {
      id_usuario: Number(reservationForm.id_usuario),
      id_amenidad: Number(reservationForm.id_amenidad),
      fecha: reservationForm.fecha,
      hora_inicio: reservationForm.hora_inicio,
      hora_fin: reservationForm.hora_fin,
    };

    try {
      setIsSubmittingReservation(true);
      setReservationError("");
      const conflict = await validateAdminAmenityConflictRequest(payload);

      if (conflict.conflicto) {
        setReservationError("Ese bloque ya fue tomado por otra reserva. Recarga la disponibilidad.");
        return;
      }

      if (conflict.limite_alcanzado) {
        setReservationError(
          conflict.mensaje_limite ||
            `El usuario ya alcanzo el limite de ${conflict.limite_reservas} reservas activas.`,
        );
        return;
      }

      // HU-C05.10: confirmar explicitamente que se reserva en nombre de otra persona.
      const owner = users.find((item) => item.id_usuario === payload.id_usuario);
      const amenityName = amenities.find((item) => item.id_amenidad === payload.id_amenidad)?.nombre || "la amenidad";
      const confirmed = await confirmAction({
        title: "¿Reservar en nombre de otra persona?",
        text:
          `Vas a reservar ${amenityName} el ${payload.fecha} de ${payload.hora_inicio} a ${payload.hora_fin} ` +
          `para ${owner?.nombre || "el usuario seleccionado"} (${owner?.unidad || "sin unidad"}). ` +
          "La reserva quedará registrada como creada por tu cuenta de administrador.",
        confirmText: "Confirmar reserva",
      });
      if (!confirmed) {
        return;
      }

      await createAdminAmenitiesReservationRequest(payload);
      await refreshDashboard();
      setSuccessMessage("La reserva se registro correctamente en la base de datos.");
      setIsReservationModalOpen(false);

      if (isAvailabilityModalOpen && availabilityForm.id_amenidad === payload.id_amenidad) {
        openAvailabilityModal({
          id_amenidad: payload.id_amenidad,
          fecha: payload.fecha,
        });
      }
    } catch (error) {
      setReservationError(
        error instanceof Error ? error.message : "No fue posible guardar la reserva.",
      );
    } finally {
      setIsSubmittingReservation(false);
    }
  }

  // HU-C05.4/C05.5: cancelacion administrativa con motivo; el residente o inquilino
  // la ve en su historial y recibe una notificacion.
  async function handleAdminCancel(reservation: AmenityReservation) {
    const motivo = await promptText({
      title: "¿Cancelar esta reserva?",
      text:
        `${reservation.amenidad_nombre} · ${reservation.fecha} ${reservation.hora_inicio}-${reservation.hora_fin} · ` +
        `${reservation.usuario_nombre || "Residente"} (${reservation.unidad || "sin unidad"}). ` +
        "El horario quedará libre y se notificará al usuario.",
      label: "Motivo de la cancelación (opcional)",
      placeholder: "Ej. mantenimiento de la amenidad",
      confirmText: "Cancelar reserva",
      cancelText: "Volver",
      tone: "danger",
    });
    if (motivo === null) {
      return;
    }

    try {
      setCancellingKey(reservation.reservation_key);
      await adminCancelAmenitiesReservationRequest(reservation.reservation_key, motivo || undefined);
      await refreshDashboard();
      void notifySuccess(`Reserva de ${reservation.usuario_nombre || "el usuario"} cancelada; el horario quedó libre.`);
    } catch (error) {
      void notifyError(error, "No fue posible cancelar la reserva.");
    } finally {
      setCancellingKey(null);
    }
  }

  async function handleScheduleSubmit() {
    if (!scheduleForm.id_amenidad) {
      setScheduleError("Selecciona una amenidad valida.");
      return;
    }

    try {
      setIsSubmittingSchedule(true);
      setScheduleError("");
      await updateAmenityScheduleRequest(Number(scheduleForm.id_amenidad), {
        descripcion: scheduleForm.descripcion,
        hora_apertura: scheduleForm.hora_apertura,
        hora_cierre: scheduleForm.hora_cierre,
        intervalo_minutos: scheduleForm.intervalo_minutos,
        activo: scheduleForm.activo,
      });
      await refreshDashboard();
      setSuccessMessage("El horario de la amenidad fue actualizado.");
      setIsScheduleModalOpen(false);
    } catch (error) {
      setScheduleError(
        error instanceof Error ? error.message : "No fue posible actualizar el horario.",
      );
    } finally {
      setIsSubmittingSchedule(false);
    }
  }

  return (
    <AdminLayout title="Amenidades" subtitle="Gestion de reservas y disponibilidad.">
      <div className="space-y-4">
        <section className="grid gap-3 rounded-2xl border bg-white p-4 md:grid-cols-4" aria-label="Filtros de historial">
          <select aria-label="Usuario" value={selectedUserFilter} onChange={e=>setSelectedUserFilter(e.target.value==="all"?"all":Number(e.target.value))} className={FIELD_CLASS_NAME}><option value="all">Todos los usuarios</option>{users.map(u=><option key={u.id_usuario} value={u.id_usuario}>{u.nombre}</option>)}</select>
          <Input aria-label="Unidad" placeholder="Unidad/casa" value={unitFilter} onChange={e=>setUnitFilter(e.target.value)} />
          <select aria-label="Estado" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} className={FIELD_CLASS_NAME}><option value="">Todos los estados</option><option value="CONFIRMADA">Confirmada</option><option value="PENDIENTE">Pendiente</option><option value="CANCELADA">Cancelada</option></select>
          <p className="self-center text-sm text-slate-500">El calendario define el rango de fechas.</p>
        </section>
        {errorMessage ? (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}

        {successMessage ? (
          <Alert className="border-emerald-200 bg-emerald-50 text-emerald-700">
            <AlertTitle>Operacion completada</AlertTitle>
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {amenitySummaries.map((summary) => (
            <button
              key={summary.amenity.id_amenidad}
              type="button"
              onClick={() => {
                setSelectedAmenityFilter(summary.amenity.id_amenidad);
                setSuccessMessage("");
              }}
              className={`rounded-[18px] border bg-white p-3.5 text-left shadow-[0_12px_32px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 ${
                selectedAmenityFilter === summary.amenity.id_amenidad
                  ? "border-blue-200 ring-2 ring-blue-100"
                  : "border-slate-200"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="rounded-xl bg-blue-50 p-2.5 text-blue-600">
                  <CalendarDays className="size-5" />
                </div>
                <span
                  className={`mt-1 inline-flex size-3 rounded-full ${
                    summary.isBusyNow ? "bg-rose-500" : summary.amenity.activo ? "bg-emerald-500" : "bg-slate-400"
                  }`}
                />
              </div>
              <h3 className="mt-2.5 text-sm font-medium text-slate-950">{summary.amenity.nombre}</h3>
              <p
                className={`mt-1.5 text-[0.82rem] font-medium ${
                  summary.isBusyNow ? "text-rose-600" : summary.amenity.activo ? "text-emerald-600" : "text-slate-500"
                }`}
              >
                {summary.isBusyNow ? "Ocupado" : summary.amenity.activo ? "Disponible" : "Inactiva"}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {summary.occupiedSlots}/{summary.totalSlots} bloques ocupados hoy
              </p>
            </button>
          ))}

          {!isLoading && amenitySummaries.length === 0 ? (
            <Card className="md:col-span-2 xl:col-span-3 2xl:col-span-6">
              <CardContent className="py-10 text-center text-slate-500">
                No hay amenidades configuradas en la base de datos.
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_300px]">
          <Card className="border-slate-200 shadow-[0_20px_48px_rgba(15,23,42,0.07)]">
            <CardHeader className="gap-2.5 px-4 pt-4">
              <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle className="text-lg font-semibold text-slate-950">
                    Calendario de Reservas
                  </CardTitle>
                  <CardDescription>
                    Vista mensual con ocupacion real desde la base de datos.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <select
                    value={selectedAmenityFilter === "all" ? "all" : String(selectedAmenityFilter)}
                    onChange={(event) => {
                      const value = event.target.value;
                      setSelectedAmenityFilter(value === "all" ? "all" : Number(value));
                    }}
                    className={`${FIELD_CLASS_NAME} min-w-[190px]`}
                  >
                    <option value="all">Todas las amenidades</option>
                    {amenities.map((amenity) => (
                      <option key={amenity.id_amenidad} value={amenity.id_amenidad}>
                        {amenity.nombre}
                      </option>
                    ))}
                  </select>

                  <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-2 py-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setMonthReference(
                          new Date(monthReference.getFullYear(), monthReference.getMonth() - 1, 1),
                        )
                      }
                    >
                      <ChevronLeft className="size-4" />
                    </Button>
                    <span className="min-w-[124px] text-center text-sm font-medium capitalize text-slate-700">
                      {formatMonthLabel(monthReference)}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setMonthReference(
                          new Date(monthReference.getFullYear(), monthReference.getMonth() + 1, 1),
                        )
                      }
                    >
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-3 px-4 pb-4">
              <div className="grid grid-cols-7 gap-2 text-center text-[0.72rem] text-slate-500">
                {["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"].map((dayName) => (
                  <div key={dayName}>{dayName}</div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-2">
                {calendarDays.map((day) => {
                  const dayReservations = reservationsByDate[day.date] || [];
                  const isToday = day.date === today;

                  return (
                    <button
                      key={day.date}
                      type="button"
                      onClick={() =>
                        openAvailabilityModal({
                          id_amenidad:
                            selectedAmenityFilter === "all"
                              ? amenities[0]?.id_amenidad || ""
                              : selectedAmenityFilter,
                          fecha: day.date,
                        })
                      }
                      className={`min-h-[78px] rounded-2xl border p-2 text-left transition ${
                        isToday
                          ? "border-blue-500 bg-blue-600 text-white"
                          : dayReservations.length > 0
                            ? "border-rose-100 bg-rose-50 text-rose-700"
                            : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300"
                      } ${!day.isCurrentMonth ? "opacity-45" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-sm font-semibold">{day.dayNumber}</span>
                        {dayReservations.length > 0 ? (
                          <span
                            className={`rounded-full px-2 py-1 text-[11px] font-medium ${
                              isToday ? "bg-white/15 text-white" : "bg-white text-rose-600"
                            }`}
                          >
                            {dayReservations.length}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-4 text-[0.72rem]">
                        {dayReservations.length > 0
                          ? `${dayReservations.length} reserva${dayReservations.length === 1 ? "" : "s"}`
                          : "Disponible"}
                      </div>
                      {cancelledByDate[day.date] ? (
                        <div className="text-[0.65rem] opacity-80">
                          {cancelledByDate[day.date]} cancelada{cancelledByDate[day.date] === 1 ? "" : "s"}
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                <div className="flex items-center gap-2">
                  <span className="size-4 rounded bg-emerald-500" />
                  Disponible
                </div>
                <div className="flex items-center gap-2">
                  <span className="size-4 rounded bg-rose-500" />
                  Ocupado
                </div>
                <div className="flex items-center gap-2">
                  <span className="size-4 rounded bg-blue-600" />
                  Hoy
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-[0_20px_48px_rgba(15,23,42,0.07)]">
            <CardHeader className="px-4 pt-4">
              <CardTitle className="text-lg font-semibold text-slate-950">
                Acciones Rapidas
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 px-4 pb-4">
              <Button
                type="button"
                onClick={() => openReservationModal()}
                className="h-10 w-full rounded-xl bg-blue-600 text-[0.82rem] text-white hover:bg-blue-700"
              >
                <PlusCircle className="size-4" />
                Nueva Reserva
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={() => openAvailabilityModal()}
                className="h-10 w-full rounded-xl border-slate-200 text-[0.82rem]"
              >
                <Eye className="size-4" />
                Ver Disponibilidad
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={openScheduleModal}
                className="h-10 w-full rounded-xl border-slate-200 text-[0.82rem]"
              >
                <Settings2 className="size-4" />
                Configurar Horarios
              </Button>

              <div className="border-t border-slate-100 pt-4">
                <p className="text-[0.82rem] text-slate-500">Reservas esta semana</p>
                <div className="mt-2 flex items-end gap-2.5">
                  <span className="text-3xl font-semibold text-slate-950">
                    {weeklyStats.currentTotal}
                  </span>
                  <span
                    className={`pb-1.5 text-[0.82rem] font-medium ${
                      weeklyStats.delta >= 0 ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    {weeklyStats.delta >= 0 ? "+" : ""}
                    {weeklyStats.delta} vs semana anterior
                  </span>
                </div>
              </div>

              {actionAmenity ? (
                <div className="rounded-[18px] bg-slate-50 p-3.5 text-sm text-slate-600">
                  <p className="font-medium text-slate-900">{actionAmenity.nombre}</p>
                  <p className="mt-1">
                    Horario: {actionAmenity.hora_apertura} - {actionAmenity.hora_cierre}
                  </p>
                  <p className="mt-1">
                    Intervalo: {actionAmenity.intervalo_minutos} minutos
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <Card className="border-slate-200 shadow-[0_20px_48px_rgba(15,23,42,0.07)]">
          <CardHeader className="px-4 pt-4">
            <CardTitle className="text-lg font-semibold text-slate-950">
              Proximas Reservas
            </CardTitle>
            <CardDescription>
              Reservas activas y proximas con informacion real de residente e inmueble.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="px-4 pb-4 text-sm text-slate-500">Cargando reservas...</div>
            ) : upcomingReservations.length === 0 ? (
              <div className="px-4 pb-4 text-sm text-slate-500">
                No hay reservas proximas en el rango consultado.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-[0.7rem] font-semibold uppercase tracking-wide text-slate-500">
                        Amenidad
                      </th>
                      <th className="px-4 py-2.5 text-left text-[0.7rem] font-semibold uppercase tracking-wide text-slate-500">
                        Residente
                      </th>
                      <th className="px-4 py-2.5 text-left text-[0.7rem] font-semibold uppercase tracking-wide text-slate-500">
                        Unidad
                      </th>
                      <th className="px-4 py-2.5 text-left text-[0.7rem] font-semibold uppercase tracking-wide text-slate-500">
                        Fecha
                      </th>
                      <th className="px-4 py-2.5 text-left text-[0.7rem] font-semibold uppercase tracking-wide text-slate-500">
                        Horario
                      </th>
                      <th className="px-4 py-2.5 text-left text-[0.7rem] font-semibold uppercase tracking-wide text-slate-500">
                        Estado
                      </th>
                      <th className="px-4 py-2.5 text-left text-[0.7rem] font-semibold uppercase tracking-wide text-slate-500">
                        Accion
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {upcomingReservations.map((reservation) => {
                      const statusMeta = getReservationStatusMeta(reservation.estado_actual);

                      return (
                        <tr key={reservation.reservation_key}>
                          <td className="px-4 py-3 text-[0.82rem] text-slate-900">
                            {reservation.amenidad_nombre}
                          </td>
                          <td className="px-4 py-3 text-[0.82rem] text-slate-700">
                            <div className="flex items-center gap-2">
                              <Users className="size-4 text-slate-400" />
                              {reservation.usuario_nombre || "Sin dato"}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-[0.82rem] text-slate-600">
                            {reservation.unidad || "Sin unidad"}
                          </td>
                          <td className="px-4 py-3 text-[0.82rem] text-slate-600">
                            {formatShortDate(reservation.fecha)}
                          </td>
                          <td className="px-4 py-3 text-[0.82rem] text-slate-600">
                            <div className="flex items-center gap-2">
                              <Clock3 className="size-4 text-slate-400" />
                              {reservation.hora_inicio} - {reservation.hora_fin}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-[0.82rem]">
                            <span className={`rounded-full px-2.5 py-1 text-[0.7rem] font-medium ${statusMeta.className}`}>
                              {statusMeta.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-[0.82rem]">
                            <div className="flex flex-wrap items-center gap-3">
                              <Button
                                type="button"
                                variant="link"
                                className="h-auto px-0 text-blue-600"
                                onClick={() =>
                                  openAvailabilityModal({
                                    id_amenidad: reservation.id_amenidad,
                                    fecha: reservation.fecha,
                                  })
                                }
                              >
                                Ver detalle
                              </Button>
                              {reservation.estado_actual !== "FINALIZADA" ? (
                                <Button
                                  type="button"
                                  variant="link"
                                  className="h-auto px-0 text-rose-600"
                                  disabled={cancellingKey === reservation.reservation_key}
                                  aria-label={`Cancelar reserva de ${reservation.usuario_nombre || "residente"} en ${reservation.amenidad_nombre}`}
                                  onClick={() => void handleAdminCancel(reservation)}
                                >
                                  {cancellingKey === reservation.reservation_key ? "Cancelando..." : "Cancelar"}
                                </Button>
                              ) : null}
                            </div>
                            {reservation.creada_por_admin && reservation.creada_por_nombre ? (
                              <p className="mt-1 text-[0.7rem] text-slate-400">Creada por {reservation.creada_por_nombre}</p>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
        {cancelledReservations.length > 0 ? (
          <Card className="border-slate-200 shadow-[0_20px_48px_rgba(15,23,42,0.07)]">
            <CardHeader className="px-4 pt-4">
              <CardTitle className="text-lg font-semibold text-slate-950">Cancelaciones recientes</CardTitle>
              <CardDescription>Quién canceló, cuándo y por qué. El horario ya está libre.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 px-4 pb-4">
              {cancelledReservations.map((reservation) => (
                <div key={reservation.reservation_key} className="rounded-xl bg-slate-50 px-3 py-2 text-[0.8rem] text-slate-600">
                  <p className="font-medium text-slate-800">
                    {reservation.amenidad_nombre} · {formatShortDate(reservation.fecha)} {reservation.hora_inicio}-{reservation.hora_fin} ·{" "}
                    {reservation.usuario_nombre || "Sin dato"} ({reservation.unidad || "Sin unidad"})
                  </p>
                  <p>
                    Cancelada por {reservation.cancelada_por_nombre || "registro anterior sin autor"}
                    {reservation.cancelada_en ? ` el ${reservation.cancelada_en} (UTC)` : ""}
                    {reservation.motivo_cancelacion ? ` · Motivo: ${reservation.motivo_cancelacion}` : ""}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <OverlayPanel
        isOpen={isAvailabilityModalOpen}
        title="Disponibilidad real"
        description="Consulta los bloques ocupados y libres por amenidad."
        onClose={() => setIsAvailabilityModalOpen(false)}
      >
        <div className="space-y-5">
          {availabilityError ? (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{availabilityError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Amenidad</label>
              <select
                value={availabilityForm.id_amenidad ? String(availabilityForm.id_amenidad) : ""}
                onChange={(event) =>
                  setAvailabilityForm((current) => ({
                    ...current,
                    id_amenidad: Number(event.target.value),
                  }))
                }
                className={FIELD_CLASS_NAME}
              >
                {amenities.map((amenity) => (
                  <option key={amenity.id_amenidad} value={amenity.id_amenidad}>
                    {amenity.nombre}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Fecha</label>
              <Input
                type="date"
                value={availabilityForm.fecha}
                min={today}
                onChange={(event) =>
                  setAvailabilityForm((current) => ({
                    ...current,
                    fecha: event.target.value,
                  }))
                }
              />
            </div>
          </div>

          {isLoadingAvailability ? (
            <div className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">
              Cargando disponibilidad...
            </div>
          ) : availabilityPreview ? (
            <div className="space-y-4">
              <div className="rounded-[20px] border border-slate-200 bg-slate-50 p-4">
                <p className="text-lg font-medium text-slate-950">
                  {availabilityPreview.amenidad.nombre}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {formatLongDate(availabilityPreview.fecha)} |{" "}
                  {availabilityPreview.amenidad.hora_apertura} - {availabilityPreview.amenidad.hora_cierre}
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {availabilityPreview.slots.map((slot) => (
                  <div
                    key={`${slot.hora_inicio}-${slot.hora_fin}`}
                    className={`rounded-2xl border px-4 py-4 ${
                      slot.disponible
                        ? "border-emerald-200 bg-emerald-50"
                        : "border-rose-200 bg-rose-50"
                    }`}
                  >
                    <p className="text-sm font-medium text-slate-900">
                      {slot.hora_inicio} - {slot.hora_fin}
                    </p>
                    <p
                      className={`mt-1 text-xs font-medium ${
                        slot.disponible ? "text-emerald-700" : "text-rose-700"
                      }`}
                    >
                      {slot.disponible ? "Disponible" : "Ocupado"}
                    </p>
                    {slot.reserva ? (
                      <p className="mt-2 text-xs text-slate-500">
                        {slot.reserva.usuario_nombre} | {slot.reserva.unidad}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </OverlayPanel>

      <OverlayPanel
        isOpen={isReservationModalOpen}
        title="Nueva reserva"
        description="Crea una reserva usando disponibilidad real y validacion de conflicto."
        onClose={() => {
          if (!isSubmittingReservation) {
            setIsReservationModalOpen(false);
          }
        }}
      >
        <div className="space-y-5">
          {reservationError ? (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{reservationError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Residente / usuario</label>
              <select
                value={reservationForm.id_usuario ? String(reservationForm.id_usuario) : ""}
                onChange={(event) =>
                  setReservationForm((current) => ({
                    ...current,
                    id_usuario: Number(event.target.value),
                  }))
                }
                className={FIELD_CLASS_NAME}
              >
                {users.map((user) => (
                  <option key={user.id_usuario} value={user.id_usuario}>
                    {user.nombre} | {user.unidad}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Amenidad</label>
              <select
                value={reservationForm.id_amenidad ? String(reservationForm.id_amenidad) : ""}
                onChange={(event) =>
                  setReservationForm((current) => ({
                    ...current,
                    id_amenidad: Number(event.target.value),
                    hora_inicio: "",
                    hora_fin: "",
                  }))
                }
                className={FIELD_CLASS_NAME}
              >
                {amenities.map((amenity) => (
                  <option key={amenity.id_amenidad} value={amenity.id_amenidad}>
                    {amenity.nombre}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-slate-700">Fecha</label>
              <Input
                type="date"
                value={reservationForm.fecha}
                min={today}
                onChange={(event) =>
                  setReservationForm((current) => ({
                    ...current,
                    fecha: event.target.value,
                    hora_inicio: "",
                    hora_fin: "",
                  }))
                }
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-700">Bloques disponibles</p>
              {isLoadingReservationAvailability ? (
                <span className="text-xs text-slate-500">Consultando horarios...</span>
              ) : null}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {(reservationAvailability?.slots || []).map((slot) => {
                const isSelected =
                  reservationForm.hora_inicio === slot.hora_inicio &&
                  reservationForm.hora_fin === slot.hora_fin;

                return (
                  <button
                    key={`${slot.hora_inicio}-${slot.hora_fin}`}
                    type="button"
                    disabled={!slot.disponible}
                    onClick={() =>
                      setReservationForm((current) => ({
                        ...current,
                        hora_inicio: slot.hora_inicio,
                        hora_fin: slot.hora_fin,
                      }))
                    }
                    className={`rounded-2xl border px-4 py-4 text-left transition ${
                      !slot.disponible
                        ? "cursor-not-allowed border-rose-200 bg-rose-50 text-rose-700"
                        : isSelected
                          ? "border-blue-300 bg-blue-50 text-blue-800"
                          : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <p className="text-sm font-medium">
                      {slot.hora_inicio} - {slot.hora_fin}
                    </p>
                    <p className="mt-1 text-xs">
                      {slot.disponible
                        ? "Disponible"
                        : `Ocupado por ${slot.reserva?.usuario_nombre || "otra reserva"}`}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsReservationModalOpen(false)}
              disabled={isSubmittingReservation}
            >
              Cancelar
            </Button>
            <Button type="button" onClick={handleReservationSubmit} disabled={isSubmittingReservation}>
              {isSubmittingReservation ? "Guardando..." : "Guardar reserva"}
            </Button>
          </div>
        </div>
      </OverlayPanel>

      <OverlayPanel
        isOpen={isScheduleModalOpen}
        title="Configurar horarios"
        description="Actualiza apertura, cierre, intervalo y estado activo de la amenidad."
        onClose={() => {
          if (!isSubmittingSchedule) {
            setIsScheduleModalOpen(false);
          }
        }}
      >
        <div className="space-y-5">
          {scheduleError ? (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{scheduleError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-slate-700">Amenidad</label>
              <select
                value={scheduleForm.id_amenidad ? String(scheduleForm.id_amenidad) : ""}
                onChange={(event) => {
                  const amenity = amenities.find(
                    (item) => item.id_amenidad === Number(event.target.value),
                  );

                  if (!amenity) {
                    return;
                  }

                  setScheduleForm({
                    id_amenidad: amenity.id_amenidad,
                    descripcion: amenity.descripcion,
                    hora_apertura: amenity.hora_apertura,
                    hora_cierre: amenity.hora_cierre,
                    intervalo_minutos: amenity.intervalo_minutos,
                    activo: amenity.activo,
                  });
                }}
                className={FIELD_CLASS_NAME}
              >
                {amenities.map((amenity) => (
                  <option key={amenity.id_amenidad} value={amenity.id_amenidad}>
                    {amenity.nombre}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-slate-700">Descripcion</label>
              <Input
                type="text"
                value={scheduleForm.descripcion}
                onChange={(event) =>
                  setScheduleForm((current) => ({
                    ...current,
                    descripcion: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Hora apertura</label>
              <Input
                type="time"
                value={scheduleForm.hora_apertura}
                onChange={(event) =>
                  setScheduleForm((current) => ({
                    ...current,
                    hora_apertura: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Hora cierre</label>
              <Input
                type="time"
                value={scheduleForm.hora_cierre}
                onChange={(event) =>
                  setScheduleForm((current) => ({
                    ...current,
                    hora_cierre: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Intervalo</label>
              <select
                value={String(scheduleForm.intervalo_minutos)}
                onChange={(event) =>
                  setScheduleForm((current) => ({
                    ...current,
                    intervalo_minutos: Number(event.target.value),
                  }))
                }
                className={FIELD_CLASS_NAME}
              >
                <option value="15">15 minutos</option>
                <option value="30">30 minutos</option>
                <option value="60">60 minutos</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Estado</label>
              <select
                value={scheduleForm.activo ? "activo" : "inactivo"}
                onChange={(event) =>
                  setScheduleForm((current) => ({
                    ...current,
                    activo: event.target.value === "activo",
                  }))
                }
                className={FIELD_CLASS_NAME}
              >
                <option value="activo">Activa</option>
                <option value="inactivo">Inactiva</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsScheduleModalOpen(false)}
              disabled={isSubmittingSchedule}
            >
              Cancelar
            </Button>
            <Button type="button" onClick={handleScheduleSubmit} disabled={isSubmittingSchedule}>
              {isSubmittingSchedule ? "Guardando..." : "Guardar horario"}
            </Button>
          </div>
        </div>
      </OverlayPanel>
    </AdminLayout>
  );
}
