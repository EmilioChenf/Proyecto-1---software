import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getResidentCheckoutStatusRequest, retryResidentCheckoutRequest, getTenantCheckoutStatusRequest, retryTenantCheckoutRequest, redirectToRecurrente } from "@/services/recurrenteCheckoutService";
import type { RecurrenteCheckoutStatus } from "@/types/recurrenteCheckout";

const titles: Record<RecurrenteCheckoutStatus["estado"], string> = {
  PENDIENTE: "Tu pago está pendiente de verificación", CONFIRMADO: "Pago confirmado por el servidor",
  CUOTA_PAGADA: "Cuota sin saldo pendiente", RECHAZADO: "Pago rechazado", FALLIDO: "Pago no completado",
  CANCELADO: "Intento de pago cancelado", INCIERTO: "Pago en verificación", NO_COMPLETADO: "Pago no completado",
};

export function ResidentePaymentReturnView({tenant=false}:{tenant?:boolean}) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const reference = params.get("referencia") || "";
  const validReference = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(reference);
  const [status, setStatus] = useState<RecurrenteCheckoutStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retrying = useRef(false);
  const mounted = useRef(false);
  const requestVersion = useRef(0);
  async function refresh() {
    const version = ++requestVersion.current;
    setLoading(true); setError(null);
    try {
      const result = await (tenant?getTenantCheckoutStatusRequest:getResidentCheckoutStatusRequest)(reference);
      if (mounted.current && version === requestVersion.current) setStatus(result);
    } catch {
      if (mounted.current && version === requestVersion.current) {
        setStatus(null); setError("No se pudo consultar el estado del pago. No se iniciará otro cobro sin verificarlo.");
      }
    } finally { if (mounted.current && version === requestVersion.current) setLoading(false); }
  }
  useEffect(() => {
    mounted.current = true; setStatus(null);
    if (validReference) void refresh();
    return () => { mounted.current = false; requestVersion.current++; };
  }, [reference, validReference, tenant]);
  async function retry() {
    if (retrying.current || loading || !status || status.accion === "NINGUNA") return;
    retrying.current = true; setBusy(true); setError(null);
    try {
      const checkout = await (tenant?retryTenantCheckoutRequest:retryResidentCheckoutRequest)(reference);
      redirectToRecurrente(checkout.checkout_url);
    } catch {
      setStatus(null);
      setError("No se pudo continuar el pago. Actualiza el estado para verificar si puede reintentarse de forma segura.");
    } finally { retrying.current = false; if (mounted.current) setBusy(false); }
  }
  return (
    <AppShell role={tenant?'inquilino':'residente'} title="Pago pendiente de verificación" subtitle="Consulta el estado de tu cuota.">
      <Alert>
        <AlertTitle>{status ? titles[status.estado] : titles.PENDIENTE}</AlertTitle>
        <AlertDescription>{status?.mensaje || "El regreso desde el checkout no confirma el pago. Consulta tu estado de cuenta para conocer el saldo registrado."}</AlertDescription>
      </Alert>
      {loading && <p role="status">Consultando el estado registrado…</p>}
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      {validReference && <Button type="button" disabled={loading || busy} onClick={() => void refresh()}>Actualizar estado</Button>}
      {status && status.accion !== "NINGUNA" && <Button type="button" disabled={loading || busy} onClick={() => void retry()}>
        {busy ? "Verificando checkout…" : status.accion === "CONTINUAR" ? "Verificar y continuar pago" : "Reintentar pago"}
      </Button>}
      <Button type="button" onClick={() => navigate(tenant?"/inquilino/estado-cuenta":"/residente/estado-cuenta")}>Volver al estado de cuenta</Button>
    </AppShell>
  );
}
