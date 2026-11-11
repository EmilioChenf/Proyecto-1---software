const { query } = require("../database/mysql");

const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const pad = (value) => String(value).padStart(2, "0");
const isoDate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const round1 = (value) => Math.round(value * 10) / 10;
const money = (value) => Math.round(Number(value || 0) * 100) / 100;

function lastMonths(count, now) {
  const list = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const start = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    list.push({ key: `${start.getFullYear()}-${pad(start.getMonth() + 1)}`, label: `${MONTHS[start.getMonth()]} ${String(start.getFullYear()).slice(2)}`, start: isoDate(start), end: isoDate(end) });
  }
  return list;
}

function minutesOf(time) {
  const [h, m] = String(time || "00:00").split(":").map(Number);
  return h * 60 + (m || 0);
}

/**
 * Indicadores del negocio para la junta y el administrador:
 * morosidad mes a mes, ocupación de amenidades, visitas por día y fallas.
 */
async function getIndicators(input = {}, now = new Date()) {
  const monthsCount = Math.min(12, Math.max(3, Number(input.meses) || 6));
  const days = Math.min(90, Math.max(7, Number(input.dias) || 30));
  const months = lastMonths(monthsCount, now);
  const today = isoDate(now);
  const fromDay = isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1));

  // Morosidad: de lo que vencía en el mes, cuánto no se pagó a tiempo (antes de la fecha límite).
  const delinquencyRows = await query(
    `SELECT DATE_FORMAT(cu.fecha_limite, '%Y-%m') mes, COUNT(*) cuotas, SUM(cu.monto) emitido,
            SUM(LEAST(cu.monto, COALESCE(pt.a_tiempo, 0))) pagado_a_tiempo,
            SUM(CASE WHEN COALESCE(pt.a_tiempo, 0) < cu.monto THEN 1 ELSE 0 END) cuotas_tarde,
            SUM(GREATEST(cu.monto - COALESCE(pt.total, 0), 0)) pendiente_hoy
       FROM CUOTA cu
       LEFT JOIN (SELECT p.id_cuota, SUM(p.monto_pagado) total,
                         SUM(CASE WHEN p.fecha_pago <= c.fecha_limite THEN p.monto_pagado ELSE 0 END) a_tiempo
                    FROM PAGO p JOIN CUOTA c ON c.id_cuota = p.id_cuota GROUP BY p.id_cuota) pt ON pt.id_cuota = cu.id_cuota
      WHERE cu.fecha_limite BETWEEN ? AND LEAST(?, ?)
      GROUP BY mes`,
    [months[0].start, months[months.length - 1].end, today],
  );
  const morosidad = months.map((month) => {
    const row = delinquencyRows.find((item) => item.mes === month.key);
    const emitido = money(row?.emitido);
    const aTiempo = money(row?.pagado_a_tiempo);
    return {
      mes: month.key, etiqueta: month.label, cuotas: Number(row?.cuotas || 0), emitido,
      pagado_a_tiempo: aTiempo, pendiente_hoy: money(row?.pendiente_hoy), cuotas_tarde: Number(row?.cuotas_tarde || 0),
      porcentaje: emitido > 0 ? round1(((emitido - aTiempo) / emitido) * 100) : null,
    };
  });

  // Ocupación: horas reservadas / horas disponibles en el periodo, por amenidad activa.
  const amenities = await query("SELECT id_amenidad, nombre, hora_apertura, hora_cierre FROM AMENIDAD WHERE activo = 1 ORDER BY nombre");
  const booked = await query(
    `SELECT id_amenidad, COUNT(*) reservas, SUM(TIME_TO_SEC(TIMEDIFF(hora_fin, hora_inicio))) / 60 minutos
       FROM RESERVA WHERE fecha BETWEEN ? AND ? AND COALESCE(estado, 'CONFIRMADA') <> 'CANCELADA' GROUP BY id_amenidad`,
    [fromDay, today],
  );
  const ocupacion = amenities.map((amenity) => {
    const row = booked.find((item) => Number(item.id_amenidad) === Number(amenity.id_amenidad));
    const available = Math.max(0, minutesOf(amenity.hora_cierre) - minutesOf(amenity.hora_apertura)) * days;
    const used = Number(row?.minutos || 0);
    return { id_amenidad: Number(amenity.id_amenidad), nombre: amenity.nombre, reservas: Number(row?.reservas || 0), horas_reservadas: round1(used / 60), porcentaje: available ? round1(Math.min(100, (used / available) * 100)) : 0 };
  });

  // Visitas por día (sin canceladas ni eliminadas) y día más concurrido de la semana.
  const visitRows = await query(
    `SELECT DATE_FORMAT(fecha, '%Y-%m-%d') dia, COUNT(*) visitas, SUM(CASE WHEN es_acceso_especial THEN 1 ELSE 0 END) especiales
       FROM ACCESO WHERE fecha BETWEEN ? AND ? AND cancelado_en IS NULL AND eliminado_en IS NULL GROUP BY dia`,
    [fromDay, today],
  );
  const visitas = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = isoDate(date);
    const row = visitRows.find((item) => item.dia === key);
    visitas.push({ dia: key, dia_semana: date.getDay(), visitas: Number(row?.visitas || 0), especiales: Number(row?.especiales || 0) });
  }
  const weekday = [0, 0, 0, 0, 0, 0, 0];
  visitas.forEach((item) => { weekday[item.dia_semana] += item.visitas; });
  const busiest = weekday.indexOf(Math.max(...weekday));

  // Fallas: abiertas y resueltas por mes.
  const ticketRows = await query(
    `SELECT DATE_FORMAT(creado_en, '%Y-%m') mes, COUNT(*) abiertas, SUM(CASE WHEN resuelto_en IS NOT NULL THEN 1 ELSE 0 END) resueltas
       FROM TICKET WHERE creado_en >= ? GROUP BY mes`,
    [months[0].start],
  );
  const fallas = months.map((month) => {
    const row = ticketRows.find((item) => item.mes === month.key);
    return { mes: month.key, etiqueta: month.label, abiertas: Number(row?.abiertas || 0), resueltas: Number(row?.resueltas || 0) };
  });

  const [houses] = await query(
    `SELECT COUNT(*) total,
            SUM(CASE WHEN EXISTS (SELECT 1 FROM RESIDENTE r JOIN USUARIO u ON u.id_usuario = r.id_usuario WHERE r.id_residente = c.id_residente AND u.activo = 1) THEN 1 ELSE 0 END) ocupadas
       FROM CASA c`,
  );
  const withData = morosidad.filter((item) => item.porcentaje !== null);
  const totalVisits = visitas.reduce((sum, item) => sum + item.visitas, 0);
  return {
    periodo: { meses: monthsCount, dias: days, desde: fromDay, hasta: today },
    resumen: {
      morosidad_actual: withData.length ? withData[withData.length - 1].porcentaje : null,
      morosidad_promedio: withData.length ? round1(withData.reduce((sum, item) => sum + item.porcentaje, 0) / withData.length) : null,
      ocupacion_amenidades: ocupacion.length ? round1(ocupacion.reduce((sum, item) => sum + item.porcentaje, 0) / ocupacion.length) : 0,
      visitas_promedio_dia: round1(totalVisits / days),
      dia_mas_concurrido: totalVisits ? ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"][busiest] : null,
      viviendas: Number(houses?.total || 0),
      viviendas_ocupadas: Number(houses?.ocupadas || 0),
    },
    morosidad, ocupacion, visitas, fallas,
  };
}

module.exports = { getIndicators };
