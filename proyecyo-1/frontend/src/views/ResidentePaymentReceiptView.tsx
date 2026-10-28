import { useFeedbackState } from "@/hooks/useFeedbackState";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getResidentPaymentReceiptRequest, downloadPaymentReceiptRequest, receiptErrorMessage, savePaymentReceipt } from "@/services/paymentReceiptService";
import type { PaymentReceipt } from "@/types/paymentReceipt";

export function ResidentePaymentReceiptView() {
  const { paymentId = "" } = useParams();
  const navigate = useNavigate();
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useFeedbackState("error", "");
  const downloadInProgress = useRef(false);
  useEffect(() => {
    let active = true;
    setReceipt(null); setLoading(true); setError("");
    if (!/^\d+$/.test(paymentId) || !Number.isSafeInteger(Number(paymentId)) || Number(paymentId) <= 0 || Number(paymentId) > 2147483647) {
      setError("No se encontró el comprobante solicitado."); setLoading(false);
      return;
    }
    getResidentPaymentReceiptRequest(Number(paymentId)).then((data) => { if (active) setReceipt(data); })
      .catch((e) => { if (active) setError(receiptErrorMessage(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [paymentId]);
  async function download() {
    if (!receipt || downloadInProgress.current) return;
    downloadInProgress.current = true; setDownloading(true); setError("");
    try { savePaymentReceipt(await downloadPaymentReceiptRequest(receipt.id_pago), receipt.numero_comprobante); }
    catch (e) { setError(receiptErrorMessage(e)); }
    finally { downloadInProgress.current = false; setDownloading(false); }
  }
  const fields = receipt ? [
    ["Número", receipt.numero_comprobante], ["Estado", receipt.estado === "CONFIRMADO" ? "Confirmado" : "Aplicado"],
    ["Fecha del pago", receipt.fecha_pago], ["Concepto", receipt.servicio],
    ["Monto", `Q${receipt.monto_pagado.toFixed(2)}`], ["Moneda", receipt.moneda],
    ["Proveedor", receipt.proveedor], ["Residente / titular", receipt.titular_nombre], ["Unidad", receipt.unidad],
    ...(receipt.referencia_transaccion ? [["Referencia de transacción", receipt.referencia_transaccion]] : []),
    ...(receipt.reembolso_posterior ? [["Reembolso posterior", "Reembolsado"], ["Monto devuelto", `Q${(receipt.reembolsado || 0).toFixed(2)}`], ["Abono neto actual", `Q${(receipt.abono_neto || 0).toFixed(2)}`]] : []),
    ["Referencia interna", `Pago ${receipt.id_pago}${receipt.id_transaccion ? ` · Transacción ${receipt.id_transaccion} · Checkout ${receipt.id_checkout}` : ""}`],
  ] : [];
  return <AppShell role="residente" title="Comprobante de pago" subtitle="Pago registrado por NexusResidencial.">
    {loading && <p role="status">Cargando comprobante…</p>}
    {error && <Alert variant="destructive" role="alert"><AlertTitle>Comprobante no disponible</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    {receipt && <Card><CardContent className="space-y-5 p-6">
      <h2 className="text-xl font-bold">COMPROBANTE DE PAGO</h2>
      {receipt.ambiente === "sandbox" && <Alert className="border-amber-300 bg-amber-50 text-amber-900"><AlertTitle>Sandbox / Prueba</AlertTitle><AlertDescription>Este comprobante corresponde a un pago de prueba.</AlertDescription></Alert>}
      {receipt.origen === "SIMULADO" && <p>Pago simulado / académico</p>}
      {receipt.origen === "HISTORICO" && <p>Pago histórico</p>}
      <dl className="grid gap-4 sm:grid-cols-2">{fields.map(([label, value]) => <div key={label}><dt className="text-sm text-slate-500">{label}</dt><dd className="break-words font-medium">{value}</dd></div>)}</dl>
      <Button disabled={downloading} onClick={() => void download()}>{downloading ? "Descargando comprobante…" : "Descargar PDF"}</Button>
    </CardContent></Card>}
    <Button variant="outline" onClick={() => navigate("/residente/estado-cuenta")}>Volver al estado de cuenta</Button>
  </AppShell>;
}
