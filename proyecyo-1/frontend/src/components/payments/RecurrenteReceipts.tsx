import { useFeedbackState } from "@/hooks/useFeedbackState";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getResidentRecurrenteReceiptsRequest, receiptErrorMessage } from "@/services/paymentReceiptService";
import type { PaymentReceipt } from "@/types/paymentReceipt";

export function RecurrenteReceipts({ totalPaid }: { totalPaid?: number }) {
  const navigate = useNavigate();
  const [receipts, setReceipts] = useState<PaymentReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useFeedbackState("error", "");
  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); setReceipts([]);
    getResidentRecurrenteReceiptsRequest().then((rows) => {
      if (active) setReceipts(rows.filter((row) => row.estado === "CONFIRMADO" && row.origen === "RECURRENTE"));
    }).catch((e) => { if (active) setError(receiptErrorMessage(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [totalPaid]);
  return <Card>
    <CardHeader><CardTitle>Comprobantes de pagos confirmados</CardTitle></CardHeader>
    <CardContent>
      {loading && <p role="status">Cargando comprobantes…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && !receipts.length && <p>No hay pagos confirmados con Recurrente.</p>}
      <div className="space-y-3">{receipts.map((receipt) => <div key={receipt.id_pago} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
        <div><p className="font-medium">{receipt.servicio}</p>
          <p>{receipt.numero_comprobante} · Q{receipt.monto_pagado.toFixed(2)} · {receipt.fecha_pago}</p>
          {receipt.reembolso_posterior && <p>Reembolsado posteriormente · Devuelto Q{(receipt.reembolsado || 0).toFixed(2)} · Neto Q{(receipt.abono_neto || 0).toFixed(2)}</p>}
          {receipt.ambiente === "sandbox" && <p className="font-semibold text-amber-800">Sandbox / Prueba</p>}
        </div>
        <Button onClick={() => navigate(`/residente/pagos/${receipt.id_pago}/comprobante`)} aria-label={`Ver comprobante ${receipt.numero_comprobante}`}>Ver comprobante</Button>
      </div>)}</div>
    </CardContent>
  </Card>;
}
