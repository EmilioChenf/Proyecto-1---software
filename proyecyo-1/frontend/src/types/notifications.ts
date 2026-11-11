export type NotificationType =
  | "LLEGADA_VISITA"
  | "SALIDA_VISITA"
  | "ACCESO_CANCELADO"
  | "PAGO_CONFIRMADO"
  | "PAGO_NO_COMPLETADO"
  | "PAGO_CANCELADO"
  | "REEMBOLSO_CONFIRMADO"
  | "CUOTA_PROXIMA"
  | "CUOTA_HOY"
  | "CUOTA_VENCIDA"
  | string;

export interface NotificationRecord {
  id_notificacion: number;
  id_usuario: number;
  id_acceso: number | null;
  tipo: NotificationType;
  titulo: string;
  mensaje: string;
  leido: boolean;
  creado_en: string;
  leido_en: string | null;
  visitante?: string | null;
  casa?: string | null;
  accion_codigo?: "ESTADO_CUENTA" | "COMPROBANTE_PAGO" | null;
  id_pago?: number | null;
}

export interface UnreadNotificationsResponse {
  unread: number;
}

export type NotificationPageFilter = "TODOS" | "SIN_LEER" | "COMUNICADOS" | "OTROS";

export interface NotificationPage {
  items: NotificationRecord[];
  next_cursor: string | null;
}
