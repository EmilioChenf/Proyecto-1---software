import type { FinancialBalanceDetails, FinancialReview } from "./financialBalance";
export type AccountQuotaStatus = "PAGADA" | "PENDIENTE" | "VENCIDA";

export interface AccountSummary extends FinancialReview {
  total_cuotas: number;
  cuotas_pagadas: number;
  cuotas_pendientes: number;
  cuotas_vencidas: number;
  saldo_pendiente: number;
  total_pagado: number; total_reembolsado?: number; abono_neto?: number;
  proximo_vencimiento: string | null;
  actualizado_en: string;
}

export interface AccountQuota extends FinancialBalanceDetails {
  periodo?: string | null;
  concepto?: string | null;
  numero_cuota?: number | null;
  id_cuota: number;
  id_casa: number;
  casa_unidad: string;
  servicio: string;
  tipo_servicio: string;
  monto: number;
  monto_base: number;
  recargo: number;
  monto_pagado: number;
  saldo_pendiente: number;
  fecha_limite: string;
  ultimo_pago: string | null;
  estado: AccountQuotaStatus;
}

export interface AccountStatement {
  resumen: AccountSummary;
  cuotas: AccountQuota[];
}
