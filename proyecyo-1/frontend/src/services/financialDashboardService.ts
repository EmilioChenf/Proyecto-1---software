import { apiRequest } from './api';

export type FinancialDashboard = {
  fecha_corte: string;
  periodo: { desde: string; hasta: string };
  saldos: { pendiente: number; capital_pendiente: number; recargo_pendiente: number; mora: number;
    cuotas_pendientes: number; cuotas_morosas: number; responsables_morosos: number; cuotas_sin_responsable: number;
    sobrepago: number; reembolso_inconsistente: number };
  movimientos: { cobrado: number; devuelto: number; neto: number; cantidad_pagos: number };
  recargos: { registrado: number; cantidad: number };
  conceptos: { concepto: string; capital: number; recargo: number; pendiente: number; cuotas: number }[];
  serie: { fecha: string; cobrado: number; devuelto: number; neto: number }[];
};
export function getFinancialDashboard(desde: string, hasta: string, signal?: AbortSignal) {
  return apiRequest<FinancialDashboard>(`/admin/finanzas/resumen?${new URLSearchParams({ desde, hasta })}`, { signal });
}
export const financialMoney = (value: number) => new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(value);
