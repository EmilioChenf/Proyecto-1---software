import { useFeedbackState } from "@/hooks/useFeedbackState";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { AdminLayout } from "@/components/admin/AdminLayout";
import {
  getAdminAccessesRequest,
  getAdminAccessHourlyChartRequest,
  getAdminAccessSummaryRequest,
} from "@/services/adminAccessesService";
import { getAdminAmenityStatsRequest } from "@/services/amenitiesService";
import type { AdminAccessHourlyPoint, AdminAccessRecord, AdminAccessSummary, AdminAccessType } from "@/types/accesses";
import type { AmenityStatsResponse } from "@/types/amenities";
import { subscribeToAccessCounterUpdates } from "@/utils/accessCounterUpdates";
import { GUATEMALA_TIMEZONE, guatemalaToday } from "@/utils/guatemalaTime";

// Trazos de iconos del diseño "Dashboard · Administrador" (viewBox 24x24, stroke).
const ICONS = {
  key: "M8 21a5 5 0 1 1 4.6-7L21 5.6M17 9.5l2.5 2.5M14.5 12l2 2",
  check: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12.5l3 3 5-6",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  cross: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9 9l6 6M15 9l-6 6",
  bell: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0",
  arrow: "M5 12h14M13 6l6 6-6 6",
  calendar: "M3.5 5h17v15h-17zM3.5 10h17M8 3v4M16 3v4",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5",
  empty: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5M8.5 11h5",
  amenity: "M12 3l4 7h-3l4 6H7l4-6H8zM12 16v5",
  user: "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a8 8 0 0 1 16 0v1",
};

function StrokeIcon({ d, size = 18, width = 1.9 }: { d: string; size?: number; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

// Icono y color por amenidad según su nombre real; las desconocidas rotan una paleta.
const AMENITY_STYLES: { match: RegExp; color: string; d: string }[] = [
  { match: /tenis|cancha|futbol|basquet/, color: "#2563EB", d: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6c3 3 3 9.8 0 12.8M18.4 5.6c-3 3-3 9.8 0 12.8" },
  { match: /evento|salon social|fiesta/, color: "#7C3AED", d: "M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4l-5.2 2.7 1-5.8L3.5 9.2l5.9-.9z" },
  { match: /parrill|asador|bbq|rancho/, color: "#EA580C", d: "M12 21c-4 0-6-2.7-6-6 0-4 4-6 4-10 3 2 8 5 8 10 0 3.3-2 6-6 6z" },
  { match: /gimnasio|gym/, color: "#0F766E", d: "M6 8v8M3 10v4M18 8v8M21 10v4M6 12h12" },
  { match: /piscina|alberca/, color: "#0284C7", d: "M2 18c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M8 14V5a2 2 0 0 1 4 0M16 14V5a2 2 0 0 0-4 0M8 9h8" },
  { match: /infantil|nino|juego/, color: "#DB2777", d: "M12 15c3 0 5-3 5-6a5 5 0 0 0-10 0c0 3 2 6 5 6zM12 15l-1 2h2zM12 17c0 2-2 2-2 4" },
];
const AMENITY_FALLBACK_COLORS = ["#4F46E5", "#059669", "#CA8A04", "#9333EA", "#0891B2", "#E11D48"];

function amenityStyle(name: string, index: number) {
  const normalized = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const found = AMENITY_STYLES.find(({ match }) => match.test(normalized));
  return found ?? { color: AMENITY_FALLBACK_COLORS[index % AMENITY_FALLBACK_COLORS.length], d: ICONS.amenity };
}

const typeLabels: Record<string, string> = {
  RESIDENTE: "Residente",
  VISITANTE: "Visitante",
  PROVEEDOR: "Proveedor",
};

const typePills: Record<string, { bg: string; fg: string }> = {
  RESIDENTE: { bg: "#EFF6FF", fg: "#1D4ED8" },
  VISITANTE: { bg: "#FAF5FF", fg: "#7E22CE" },
  PROVEEDOR: { bg: "#FFFBEB", fg: "#B45309" },
};

const accessStatusLabels: Record<string, string> = {
  APROBADO: "Aprobado",
  PENDIENTE: "Pendiente",
  RECHAZADO: "Rechazado",
};

const statusPills: Record<string, { bg: string; fg: string; dot: string }> = {
  APROBADO: { bg: "#ECFDF5", fg: "#047857", dot: "#10B981" },
  PENDIENTE: { bg: "#FFFBEB", fg: "#B45309", dot: "#F59E0B" },
  RECHAZADO: { bg: "#FEF2F2", fg: "#B91C1C", dot: "#EF4444" },
};

const AVATAR_COLORS = [["#EFF6FF", "#1D4ED8"], ["#FDF2F8", "#BE185D"], ["#ECFDF5", "#047857"], ["#FFF7ED", "#C2410C"]];

const ACCESS_FILTERS: { id: "TODOS" | AdminAccessType; label: string }[] = [
  { id: "TODOS", label: "Todos" },
  { id: "VISITANTE", label: "Visitantes" },
  { id: "RESIDENTE", label: "Residentes" },
  { id: "PROVEEDOR", label: "Proveedores" },
];

const MAX_ACCESS_ROWS = 8;

const pad = (value: number) => String(value).padStart(2, "0");

function formatRefreshTime(date: Date | null) {
  if (!date) {
    return "Sin sincronizar";
  }
  return new Intl.DateTimeFormat("es-GT", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: GUATEMALA_TIMEZONE,
  }).format(date);
}

function guatemalaHour(date: Date) {
  return Number(
    new Intl.DateTimeFormat("en-US", { hour: "2-digit", hour12: false, timeZone: GUATEMALA_TIMEZONE }).format(date),
  ) % 24;
}

function longDateLabel(date: Date) {
  const label = new Intl.DateTimeFormat("es-GT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: GUATEMALA_TIMEZONE,
  }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function prefersReducedMotion() {
  return typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Cuenta animada hasta `target` (ease-out cúbico, ~1 s); sin animación si el usuario la reduce. */
function useCountUp(target: number) {
  const [display, setDisplay] = useState(() => (prefersReducedMotion() ? target : 0));
  const fromRef = useRef(display);

  useEffect(() => {
    if (prefersReducedMotion() || typeof window.requestAnimationFrame !== "function") {
      fromRef.current = target;
      setDisplay(target);
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 1000);
      const value = Math.round(from + (target - from) * (1 - Math.pow(1 - progress, 3)));
      fromRef.current = value;
      setDisplay(value);
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [target]);

  return display;
}

type KpiCardProps = {
  label: string;
  value: number;
  ink: string;
  bg: string;
  fg: string;
  d: string;
  width: string;
  note: string;
  delay: string;
};

function KpiCard({ label, value, ink, bg, fg, d, width, note, delay }: KpiCardProps) {
  const shown = useCountUp(value);
  return (
    <article className="nd-card nd-kpi nd-rise flex flex-col gap-3.5 p-5" style={{ animationDelay: delay }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13.5px] font-semibold text-slate-500">{label}</span>
          <span className="text-[38px] font-extrabold leading-none tracking-[-0.04em]" style={{ color: ink }} aria-label={String(value)}>
            {shown}
          </span>
        </div>
        <span className="nd-kico flex size-[46px] items-center justify-center rounded-[14px]" style={{ background: bg, color: fg }}>
          <StrokeIcon d={d} size={22} width={2} />
        </span>
      </div>
      <div className="flex flex-col gap-2">
        <div className="nd-track">
          <div className="nd-fill" style={{ width, background: fg }} />
        </div>
        <span className="text-[12.5px] text-slate-500">{note}</span>
      </div>
    </article>
  );
}

function DonutCenter({ total }: { total: number }) {
  const shown = useCountUp(total);
  return <>{shown}</>;
}

export function AdminView() {
  const today = guatemalaToday();
  const [summary, setSummary] = useState<AdminAccessSummary>({
    total_dia: 0,
    aprobados: 0,
    pendientes: 0,
    rechazados: 0,
  });
  const [accesses, setAccesses] = useState<AdminAccessRecord[]>([]);
  const [hourlyAccesses, setHourlyAccesses] = useState<AdminAccessHourlyPoint[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [statsFrom, setStatsFrom] = useState(today);
  const [statsTo, setStatsTo] = useState(today);
  const [amenityStats, setAmenityStats] = useState<AmenityStatsResponse | null>(null);
  const [amenityStatsError, setAmenityStatsError] = useFeedbackState("error", "");
  const [now, setNow] = useState(() => new Date());
  const [grown, setGrown] = useState(false);
  const [accessFilter, setAccessFilter] = useState<"TODOS" | AdminAccessType>("TODOS");
  const [query, setQuery] = useState("");
  const [hoverAmenity, setHoverAmenity] = useState<number | null>(null);
  const [hoverHour, setHoverHour] = useState<number | null>(null);
  const latestAccessRequestRef = useRef(0);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 1000);
    // Las barras crecen desde 0 tras la entrada de las tarjetas.
    const grow = window.setTimeout(() => setGrown(true), 250);
    return () => {
      window.clearInterval(clock);
      window.clearTimeout(grow);
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadDashboard(options: { silent?: boolean } = {}) {
      const requestId = latestAccessRequestRef.current + 1;
      latestAccessRequestRef.current = requestId;
      try {
        if (options.silent) {
          setIsRefreshing(true);
        }
        const [summaryResponse, hourlyResponse, accessesResponse] = await Promise.all([
          getAdminAccessSummaryRequest(),
          getAdminAccessHourlyChartRequest(),
          getAdminAccessesRequest({}),
        ]);
        if (active && requestId === latestAccessRequestRef.current) {
          setSummary(summaryResponse);
          setHourlyAccesses(hourlyResponse);
          setAccesses(accessesResponse);
          setLastUpdatedAt(new Date());
          setRefreshError(false);
        }
      } catch {
        if (active && requestId === latestAccessRequestRef.current) {
          setRefreshError(true);
        }
      } finally {
        if (active && requestId === latestAccessRequestRef.current) {
          setIsRefreshing(false);
        }
      }
    }

    void loadDashboard();
    const interval = window.setInterval(() => {
      void loadDashboard({ silent: true });
    }, 30000);
    const refresh = () => void loadDashboard({ silent: true });
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };
    const unsubscribe = subscribeToAccessCounterUpdates(refresh);

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      active = false;
      window.clearInterval(interval);
      unsubscribe();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  useEffect(() => {
    let active = true;

    getAdminAmenityStatsRequest({ from: statsFrom, to: statsTo })
      .then((response) => {
        if (active) {
          setAmenityStats(response);
          setAmenityStatsError("");
        }
      })
      .catch((error) => {
        // Un fallo de la API no se presenta como "Sin reservas en el rango".
        if (active) {
          setAmenityStats(null);
          setAmenityStatsError(error instanceof Error && error.message ? error.message : "No fue posible cargar las estadisticas de amenidades.");
        }
      });

    return () => {
      active = false;
    };
  }, [statsFrom, statsTo]);

  // KPIs: valores del backend; la barra muestra la proporción sobre el total del día.
  const pct = (value: number) => (summary.total_dia ? Math.round((value / summary.total_dia) * 100) : 0);
  const barWidth = (value: number) => `${grown ? pct(value) : 0}%`;
  const latest = accesses[0];
  const kpis: KpiCardProps[] = [
    {
      label: "Accesos Hoy",
      value: summary.total_dia,
      ink: "#0F172A",
      bg: "#EFF6FF",
      fg: "#2563EB",
      d: ICONS.key,
      width: grown && summary.total_dia ? "100%" : "0%",
      note: latest ? `Último registro: ${latest.hora.slice(0, 5)} · ${latest.nombre}` : "Sin registros todavía hoy",
      delay: "0.08s",
    },
    {
      label: "Aprobados",
      value: summary.aprobados,
      ink: "#047857",
      bg: "#ECFDF5",
      fg: "#10B981",
      d: ICONS.check,
      width: barWidth(summary.aprobados),
      note: `${pct(summary.aprobados)}% de los accesos de hoy`,
      delay: "0.15s",
    },
    {
      label: "Pendientes",
      value: summary.pendientes,
      ink: "#B45309",
      bg: "#FFFBEB",
      fg: "#F59E0B",
      d: ICONS.clock,
      width: barWidth(summary.pendientes),
      note: summary.pendientes ? `${pct(summary.pendientes)}% en espera` : "Sin solicitudes en espera",
      delay: "0.22s",
    },
    {
      label: "Cancelados / rechazados",
      value: summary.rechazados,
      ink: "#B91C1C",
      bg: "#FEF2F2",
      fg: "#EF4444",
      d: ICONS.cross,
      width: barWidth(summary.rechazados),
      note: summary.rechazados ? `${pct(summary.rechazados)}% del total` : "Sin incidencias hoy",
      delay: "0.29s",
    },
  ];

  // Amenidades: ranking por reservas en el rango + dona proporcional.
  const amenities = useMemo(
    () =>
      [...(amenityStats?.por_amenidad || [])]
        .sort((a, b) => b.total_reservas - a.total_reservas || a.ranking - b.ranking)
        .map((item, index) => ({ ...item, ...amenityStyle(item.nombre, index) })),
    [amenityStats],
  );
  const amenityTotal = amenities.reduce((total, item) => total + item.total_reservas, 0);
  const amenityMax = Math.max(1, ...amenities.map((item) => item.total_reservas));
  const donutBackground = useMemo(() => {
    if (!amenityTotal) return "conic-gradient(#E2E8F0 0deg 360deg)";
    let accumulated = 0;
    const stops: string[] = [];
    amenities.forEach((item) => {
      if (!item.total_reservas) return;
      const from = (accumulated / amenityTotal) * 360;
      accumulated += item.total_reservas;
      const to = (accumulated / amenityTotal) * 360;
      const gap = amenities.length > 1 ? Math.min(1.5, (to - from) / 3) : 0;
      const color =
        hoverAmenity === null || hoverAmenity === item.id_amenidad
          ? item.color
          : `color-mix(in srgb, ${item.color} 22%, #FFFFFF)`;
      stops.push(`${color} ${from.toFixed(1)}deg ${(to - gap).toFixed(1)}deg`, `#FFFFFF ${(to - gap).toFixed(1)}deg ${to.toFixed(1)}deg`);
    });
    return `conic-gradient(${stops.join(", ")})`;
  }, [amenities, amenityTotal, hoverAmenity]);
  const hoveredAmenity = amenities.find((item) => item.id_amenidad === hoverAmenity) ?? null;

  // Accesos del día: filtro por tipo y búsqueda local sobre los registros cargados.
  const normalizedQuery = query.trim().toLowerCase();
  const filteredAccesses = accesses
    .filter((row) => accessFilter === "TODOS" || row.tipo === accessFilter)
    .filter(
      (row) =>
        !normalizedQuery ||
        `${row.nombre} ${row.casa_unidad} ${row.placa}`.toLowerCase().includes(normalizedQuery),
    );
  const visibleAccesses = filteredAccesses.slice(0, MAX_ACCESS_ROWS);

  // Accesos por hora en bloques de 2 horas (se suman ambas horas del bloque).
  const hourBuckets = useMemo(() => {
    const buckets = Array.from({ length: 12 }, (_unused, index) => ({ start: index * 2, total: 0 }));
    hourlyAccesses.forEach((point) => {
      const hour = Number.parseInt(point.hora, 10);
      if (Number.isFinite(hour) && hour >= 0 && hour < 24) {
        buckets[Math.floor(hour / 2)].total += point.total;
      }
    });
    return buckets;
  }, [hourlyAccesses]);
  const hourPeakValue = Math.max(...hourBuckets.map((bucket) => bucket.total));
  const hourAxisMax = Math.max(2, Math.ceil(hourPeakValue / 2) * 2);
  const peakLabel = hourPeakValue
    ? hourBuckets
        .filter((bucket) => bucket.total === hourPeakValue)
        .map((bucket) => `${pad(bucket.start)}:00`)
        .join(" y ")
    : "sin registros";

  const hour = guatemalaHour(now);
  const greeting = hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";

  return (
    <AdminLayout
      title={`${greeting}, Administrador`}
      subtitle={`Resumen general del residencial · ${longDateLabel(now)}`}
      actions={
        <>
          <div
            className="nd-mono flex min-h-[46px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-[12.5px] text-slate-500"
            title={`Actualizado: ${formatRefreshTime(lastUpdatedAt)}`}
          >
            {refreshError ? (
              <>
                <span className="size-2 rounded-full bg-rose-500" />
                <span className="font-semibold text-rose-700">Sincronizacion fallida</span>
              </>
            ) : (
              <>
                <span className="relative flex size-2">
                  {isRefreshing ? <span className="nd-ping-dot absolute inset-0 rounded-full bg-emerald-500" /> : null}
                  <span className="nd-pulse relative size-2 rounded-full bg-emerald-500" />
                </span>
                <span className="font-semibold text-emerald-700">En vivo</span>
              </>
            )}
            <span className="text-slate-900">{formatRefreshTime(now)}</span>
          </div>
          <Link to="/admin/recordatorios" className="nd-icon-btn" aria-label="Recordatorios" title="Recordatorios">
            <StrokeIcon d={ICONS.bell} size={20} />
          </Link>
          <Link to="/admin/accesos" className="nd-primary">
            Ver accesos
            <span className="nd-plus">
              <StrokeIcon d={ICONS.arrow} size={18} width={2.4} />
            </span>
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-[22px]">
        <section aria-label="Indicadores de hoy" className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.label} {...kpi} />
          ))}
        </section>

        <section className="nd-card nd-rise flex flex-col gap-[18px] p-6" aria-labelledby="nd-am-title" style={{ animationDelay: ".25s" }}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h2 id="nd-am-title" className="m-0 text-[19px] font-extrabold tracking-[-0.02em]">Estadísticas de amenidades</h2>
              <p className="m-0 text-[13.5px] text-slate-500">Uso, ranking y reservas por amenidad con datos reales.</p>
            </div>
            <div className="nd-range">
              <span className="text-slate-500"><StrokeIcon d={ICONS.calendar} size={16} width={2} /></span>
              <input type="date" aria-label="Desde" value={statsFrom} max={statsTo} onChange={(event) => setStatsFrom(event.target.value)} />
              <span className="text-slate-400" aria-hidden="true">→</span>
              <input type="date" aria-label="Hasta" value={statsTo} min={statsFrom} onChange={(event) => setStatsTo(event.target.value)} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-7">
            <div className="flex min-w-0 flex-[999_1_480px] flex-col gap-0.5">
              {amenities.map((item, index) => (
                <div
                  key={item.id_amenidad}
                  className={`nd-am${hoverAmenity === item.id_amenidad ? " is-hi" : ""}`}
                  onMouseEnter={() => setHoverAmenity(item.id_amenidad)}
                  onMouseLeave={() => setHoverAmenity(null)}
                >
                  <span className="nd-mono text-xs font-semibold text-slate-500">#{index + 1}</span>
                  <span
                    className="flex size-9 items-center justify-center rounded-[11px]"
                    style={{ background: `color-mix(in srgb, ${item.color} 12%, #FFFFFF)`, color: item.color }}
                  >
                    <StrokeIcon d={item.d} />
                  </span>
                  <span className="truncate text-sm font-semibold">{item.nombre}</span>
                  <div className="nd-track" style={{ height: 10 }}>
                    <div
                      className="nd-fill"
                      style={{
                        width: grown ? `${Math.max(item.total_reservas ? 4 : 0, (item.total_reservas / amenityMax) * 100)}%` : "0%",
                        background: item.color,
                        transitionDelay: `${(0.1 + index * 0.08).toFixed(2)}s`,
                      }}
                    />
                  </div>
                  <span className="nd-am-count text-right text-[13px] text-slate-500">
                    <b className="text-slate-900">{item.total_reservas}</b> {item.total_reservas === 1 ? "reserva" : "reservas"}
                  </span>
                </div>
              ))}
              {amenityStatsError ? (
                <p role="alert" className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-700">{amenityStatsError}</p>
              ) : !amenityStats ? (
                <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">Cargando estadisticas...</p>
              ) : !amenityStats.por_amenidad.length ? (
                <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">Sin reservas en el rango.</p>
              ) : null}
            </div>

            <div className="flex flex-[1_1_240px] flex-col items-center gap-4">
              <div className="nd-donut relative size-[200px] rounded-full" style={{ background: donutBackground }}>
                <div className="absolute inset-[26px] flex flex-col items-center justify-center gap-1 rounded-full bg-white p-2.5 text-center">
                  <span className="text-[40px] font-extrabold leading-none tracking-[-0.04em]">
                    {hoveredAmenity && amenityTotal
                      ? `${Math.round((hoveredAmenity.total_reservas / amenityTotal) * 100)}%`
                      : <DonutCenter total={amenityTotal} />}
                  </span>
                  <span className="max-w-[120px] text-[12.5px] text-slate-500">
                    {hoveredAmenity ? hoveredAmenity.nombre : "reservas en el período"}
                  </span>
                </div>
              </div>
              <p className="m-0 max-w-[240px] text-center text-[12.5px] text-slate-500">
                Pase el cursor por una amenidad para ver su participación.
              </p>
            </div>
          </div>
        </section>

        <div className="flex flex-wrap items-stretch gap-[22px]">
          <section className="nd-card nd-rise flex min-w-0 flex-[2_1_600px] flex-col overflow-hidden" aria-labelledby="nd-rt-title" style={{ animationDelay: ".35s" }}>
            <div className="flex flex-col gap-3.5 px-6 pb-4 pt-[22px]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <h2 id="nd-rt-title" className="m-0 text-[19px] font-extrabold tracking-[-0.02em]">Accesos en tiempo real</h2>
                  <span className="nd-pulse size-2 rounded-full bg-emerald-500" />
                </div>
                <label className="nd-search flex-[0_1_260px]">
                  <span className="text-slate-400"><StrokeIcon d={ICONS.search} size={16} width={2} /></span>
                  <input
                    type="search"
                    placeholder="Buscar nombre, unidad o placa"
                    aria-label="Buscar accesos"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
              </div>
              <div className="nd-seg flex-wrap self-start" role="group" aria-label="Filtrar por tipo">
                {ACCESS_FILTERS.map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    className={accessFilter === filter.id ? "is-on" : ""}
                    aria-pressed={accessFilter === filter.id}
                    onClick={() => setAccessFilter(filter.id)}
                  >
                    {filter.label}
                    <span className="nd-count">
                      {filter.id === "TODOS" ? accesses.length : accesses.filter((row) => row.tipo === filter.id).length}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[680px]">
                <div className="nd-row bg-[#F8FAFC] py-2.5 text-[11.5px] font-bold uppercase tracking-[0.08em] text-slate-500">
                  <span>Hora</span><span>Tipo</span><span>Nombre</span><span>Unidad</span><span>Placa</span><span>Estado</span><span />
                </div>
                {visibleAccesses.map((row, index) => {
                  const typePill = typePills[row.tipo] ?? typePills.VISITANTE;
                  const statusPill = statusPills[row.estado] ?? statusPills.PENDIENTE;
                  const [avatarBg, avatarFg] = AVATAR_COLORS[index % AVATAR_COLORS.length];
                  return (
                    <div key={row.id_acceso} className="nd-row body" style={{ animationDelay: `${(0.45 + index * 0.08).toFixed(2)}s` }}>
                      <span className="nd-mono text-[13.5px] font-semibold">{row.hora.slice(0, 5)}</span>
                      <span>
                        <span className="nd-pill" style={{ background: typePill.bg, color: typePill.fg }}>{typeLabels[row.tipo] ?? row.tipo}</span>
                      </span>
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span className="flex size-8 flex-none items-center justify-center rounded-full text-xs font-extrabold" style={{ background: avatarBg, color: avatarFg }}>
                          {initials(row.nombre)}
                        </span>
                        <span className="truncate text-sm font-semibold">{row.nombre}</span>
                      </span>
                      <span className="text-[13.5px] text-slate-600">{row.casa_unidad}</span>
                      <span>{row.placa ? <span className="nd-plate nd-mono">{row.placa}</span> : <span className="text-slate-400">—</span>}</span>
                      <span>
                        <span className="nd-pill" style={{ background: statusPill.bg, color: statusPill.fg }}>
                          <span className="size-1.5 rounded-full" style={{ background: statusPill.dot }} />
                          {accessStatusLabels[row.estado] ?? row.estado}
                        </span>
                      </span>
                      <Link to="/admin/accesos" className="nd-more" aria-label={`Ver detalle de ${row.nombre}`}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" />
                        </svg>
                      </Link>
                    </div>
                  );
                })}
                {visibleAccesses.length === 0 ? (
                  <div className="nd-rise flex flex-col items-center gap-2.5 border-t border-[#EEF2F7] px-6 py-10 text-center">
                    <span className="flex size-[52px] items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                      <StrokeIcon d={ICONS.empty} size={24} />
                    </span>
                    {accesses.length === 0 ? (
                      <span className="text-sm font-bold">No hay accesos registrados para hoy.</span>
                    ) : (
                      <>
                        <span className="text-sm font-bold">Sin accesos para este filtro</span>
                        <span className="text-[13px] text-slate-500">Pruebe con otro tipo o limpie la búsqueda.</span>
                      </>
                    )}
                  </div>
                ) : null}
                {filteredAccesses.length > MAX_ACCESS_ROWS ? (
                  <div className="border-t border-[#EEF2F7] px-6 py-3 text-[13px] text-slate-500">
                    Mostrando {MAX_ACCESS_ROWS} de {filteredAccesses.length}.{" "}
                    <Link to="/admin/accesos" className="font-semibold text-blue-700 hover:underline">Ver todos</Link>
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <section className="nd-card nd-rise flex min-w-0 flex-[1_1_340px] flex-col gap-4 px-6 py-[22px]" aria-labelledby="nd-h-title" style={{ animationDelay: ".45s" }}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <h2 id="nd-h-title" className="m-0 text-[19px] font-extrabold tracking-[-0.02em]">Accesos por hora</h2>
                <p className="m-0 text-[13px] text-slate-500">Hora pico: <b className="text-slate-900">{peakLabel}</b></p>
              </div>
              <span className="nd-mono rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs text-slate-600">Hoy</span>
            </div>
            <div className="flex min-h-[260px] flex-1 gap-2.5">
              <div className="nd-mono flex flex-col justify-between pb-[26px] text-right text-[11px] text-slate-400">
                <span>{hourAxisMax}</span><span>{hourAxisMax / 2}</span><span>0</span>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="relative flex-1">
                  <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
                    <span className="border-t border-dashed border-slate-200" />
                    <span className="border-t border-dashed border-slate-200" />
                    <span className="border-t border-slate-200" />
                  </div>
                  <div className="absolute inset-0 flex items-stretch gap-1">
                    {hourBuckets.map((bucket, index) => {
                      const range = `${pad(bucket.start)}:00–${pad(bucket.start + 1)}:59`;
                      const count = `${bucket.total} ${bucket.total === 1 ? "acceso" : "accesos"}`;
                      return (
                        <button
                          key={bucket.start}
                          type="button"
                          className="nd-bar"
                          aria-label={`De ${pad(bucket.start)}:00 a ${pad(bucket.start + 1)}:59, ${count}`}
                          onMouseEnter={() => setHoverHour(index)}
                          onMouseLeave={() => setHoverHour(null)}
                          onFocus={() => setHoverHour(index)}
                          onBlur={() => setHoverHour(null)}
                        >
                          <span
                            className="nd-bar-fill"
                            style={{
                              height: grown ? `${bucket.total ? (bucket.total / hourAxisMax) * 100 : 2}%` : "0%",
                              background: bucket.total
                                ? hoverHour === index
                                  ? "color-mix(in srgb, var(--nd-accent) 80%, #000)"
                                  : "var(--nd-accent)"
                                : "#E2E8F0",
                              transitionDelay: `${(0.3 + index * 0.04).toFixed(2)}s`,
                            }}
                          />
                          {hoverHour === index ? <span className="nd-tip">{range} · {count}</span> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="nd-mono flex gap-1 text-[10.5px] text-slate-400">
                  {hourBuckets.map((bucket) => (
                    <span key={bucket.start} className="flex-1 text-center">{pad(bucket.start)}</span>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* HU32: accesos directos a modulos reales; se eliminaron las tarjetas decorativas
            ("Mantenimiento" no tenia fuente de datos ni accion). */}
        <section className="grid gap-4 md:grid-cols-2">
          {[
            {
              title: "Monitoreo de accesos",
              text: "Registro del dia con busqueda por nombre, unidad o placa y filtros por tipo y estado.",
              d: ICONS.user,
              to: "/admin/accesos",
              cta: "Ir a control con filtros",
            },
            {
              title: "Reservas de amenidades",
              text: "Consulte, cree reservas y ajuste horarios de las amenidades del residencial.",
              d: ICONS.calendar,
              to: "/admin/amenidades",
              cta: "Ir a amenidades",
            },
          ].map(({ title, text, d, to, cta }, index) => (
            <Link key={title} to={to} className="nd-card nd-kpi nd-rise p-5" style={{ animationDelay: `${(0.55 + index * 0.07).toFixed(2)}s` }}>
              <span className="nd-kico flex size-[46px] items-center justify-center rounded-[14px] bg-blue-50 text-blue-600">
                <StrokeIcon d={d} size={22} width={2} />
              </span>
              <h2 className="mt-4 text-[17px] font-extrabold tracking-[-0.02em] text-slate-900">{title}</h2>
              <p className="mt-1.5 text-[13px] leading-5 text-slate-500">{text}</p>
              <p className="mt-3 text-[13px] font-semibold text-blue-700">{cta} →</p>
            </Link>
          ))}
        </section>
      </div>
    </AdminLayout>
  );
}
