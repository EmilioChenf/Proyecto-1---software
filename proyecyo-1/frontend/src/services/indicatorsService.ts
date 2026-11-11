import { apiRequest } from "@/services/api";

export type Indicators = {
  periodo: { meses: number; dias: number; desde: string; hasta: string };
  resumen: { morosidad_actual: number | null; morosidad_promedio: number | null; ocupacion_amenidades: number; visitas_promedio_dia: number; dia_mas_concurrido: string | null; viviendas: number; viviendas_ocupadas: number };
  morosidad: Array<{ mes: string; etiqueta: string; cuotas: number; emitido: number; pagado_a_tiempo: number; pendiente_hoy: number; cuotas_tarde: number; porcentaje: number | null }>;
  ocupacion: Array<{ id_amenidad: number; nombre: string; reservas: number; horas_reservadas: number; porcentaje: number }>;
  visitas: Array<{ dia: string; dia_semana: number; visitas: number; especiales: number }>;
  fallas: Array<{ mes: string; etiqueta: string; abiertas: number; resueltas: number }>;
};

export const getIndicatorsRequest = (meses = 6, dias = 30) => apiRequest<Indicators>(`/admin/indicadores?meses=${meses}&dias=${dias}`);
