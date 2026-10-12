import { apiRequest } from "@/services/api";
import type { RecurrenteCheckout, RecurrenteCheckoutStatus } from "@/types/recurrenteCheckout";

export function getResidentCheckoutStatusRequest(reference: string) {
  return apiRequest<RecurrenteCheckoutStatus>(`/residente/pagos/recurrente/checkouts/${encodeURIComponent(reference)}`);
}
export function retryResidentCheckoutRequest(referencia_local: string) {
  return apiRequest<RecurrenteCheckout>("/residente/pagos/recurrente/reintentar", {
    method: "POST", body: { referencia_local },
  });
}

export function createResidentCheckoutRequest(id_cuota: number) {
  return apiRequest<RecurrenteCheckout>("/residente/pagos/recurrente/checkout", {
    method: "POST", body: { id_cuota },
  });
}
export function createTenantCheckoutRequest(id_cuota:number){
  return apiRequest<RecurrenteCheckout>('/inquilino/pagos/recurrente/checkout',{method:'POST',body:{id_cuota}});
}
export function getTenantCheckoutStatusRequest(reference:string){
  return apiRequest<RecurrenteCheckoutStatus>(`/inquilino/pagos/recurrente/checkouts/${encodeURIComponent(reference)}`);
}
export function retryTenantCheckoutRequest(referencia_local:string){
  return apiRequest<RecurrenteCheckout>('/inquilino/pagos/recurrente/reintentar',{method:'POST',body:{referencia_local}});
}

export function redirectToRecurrente(checkoutUrl: string) {
  let target: URL;
  try {
    if (typeof checkoutUrl !== "string" || checkoutUrl.length > 2048
      || /[\u0000-\u0020\u007f\\]/.test(checkoutUrl)) throw new Error();
    target = new URL(checkoutUrl);
    if (target.protocol !== "https:" || target.hostname !== "app.recurrente.com" || target.port
      || target.username || target.password || target.search || target.hash
      || !/^\/checkout-session\/ch_[A-Za-z0-9_-]+$/.test(target.pathname)) throw new Error();
  } catch { throw new Error("No se recibió una dirección válida para abrir el checkout de Recurrente."); }
  window.location.assign(target.href);
}
