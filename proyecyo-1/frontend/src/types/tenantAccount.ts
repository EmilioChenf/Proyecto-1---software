import type { AccountQuotaStatus } from "@/types/account";
import type { FinancialBalanceDetails, FinancialReview } from "./financialBalance";

export interface TenantAccountQuota extends FinancialBalanceDetails {
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
  es_alquiler: boolean;
}

export interface TenantAccountSummary extends FinancialReview {
  total_cuotas: number;
  cuotas_pagadas: number;
  cuotas_pendientes: number;
  cuotas_vencidas: number;
  saldo_pendiente: number;
  alquiler_pendiente: number;
  cuotas_adicionales_pendientes: number;
  total_pagado: number; total_reembolsado?: number; abono_neto?: number;
  proximo_vencimiento: string | null;
  actualizado_en: string;
}

export interface TenantAccountHouse {
  id_casa: number;
  unidad: string;
  propietario: string;
}

export interface TenantAccountStatement {
  modelo_contractual?:boolean;
  responsabilidad_financiera?:boolean;
  mensaje?:string|null;
  casa: TenantAccountHouse;
  resumen: TenantAccountSummary;
  alquiler: TenantAccountQuota[];
  cuotas_adicionales: TenantAccountQuota[];
  reembolsos?: {id_reembolso:number;id_cuota:number;monto_centavos:number;fecha_reembolso:string;servicio:string}[];
  pagos: Array<{
    id_pago: number;
    id_cuota: number;
    servicio: string;
    monto_pagado: number;
    fecha_pago: string;
    numero_comprobante: string;
  }>;
  recargos: Array<{ id_recargo: number; id_cuota: number; servicio: string; monto_recargo: number; fecha_aplicacion: string }>;
  periodo: { desde: string | null; hasta: string | null };
}
