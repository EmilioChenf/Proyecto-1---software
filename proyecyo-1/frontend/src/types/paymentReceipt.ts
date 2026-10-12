export interface PaymentReceipt {
  periodo?:string|null;concepto?:string|null;
  id_pago: number;
  id_cuota: number;
  numero_comprobante: string;
  servicio: string;
  monto_pagado: number;
  fecha_pago: string;
  titular_nombre: string;
  unidad: string;
  estado: "CONFIRMADO" | "APLICADO";
  moneda: "GTQ";
  proveedor: string;
  origen: "RECURRENTE" | "SIMULADO" | "HISTORICO";
  ambiente: "sandbox" | "production" | "academic" | "historical";
  reembolsado?: number; abono_neto?: number; reembolso_posterior?: boolean; estado_transaccion?: string;
  id_transaccion?: number;
  id_checkout?: number;
  referencia_transaccion?: string;
  referencia_pago_externa?: string | null;
}
