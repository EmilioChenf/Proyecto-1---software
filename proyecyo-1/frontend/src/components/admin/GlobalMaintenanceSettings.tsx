import { useFeedbackState } from "@/hooks/useFeedbackState";
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {getGlobalMaintenanceRequest,saveGlobalMaintenanceRequest} from '@/services/propertyContractsService';
import type {MaintenanceTariff} from '@/types/propertyContracts';
export function GlobalMaintenanceSettings(){
  const [history,setHistory]=useState<MaintenanceTariff[]>([]),[amount,setAmount]=useState(''),[since,setSince]=useState(''),[message, setMessage] = useFeedbackState("info", ''),[busy,setBusy]=useState(false);
  useEffect(()=>{getGlobalMaintenanceRequest().then(v=>setHistory(v.historial)).catch(e=>setMessage(e.message));},[]);
  async function save(){setBusy(true);setMessage('');try{const tariff=await saveGlobalMaintenanceRequest({monto:amount,vigente_desde:since});setHistory([tariff,...history]);setMessage('Tarifa global programada. Los períodos emitidos conservan sus importes.');}catch(e){setMessage(e instanceof Error?e.message:'No fue posible guardar.');}finally{setBusy(false);}}
  return <section className="mb-5 space-y-4 rounded-[20px] border bg-background p-5"><h2 className="text-lg font-semibold">Mantenimiento global</h2><p className="text-sm text-muted-foreground">Una tarifa para todas las casas activas con contrato. Cada cambio comienza el primer día de un mes futuro.</p>
    <div className="grid gap-3 sm:grid-cols-3"><label>Monto mensual<Input aria-label="Mantenimiento global mensual" inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)}/></label><label>Vigente desde<Input aria-label="Vigencia del mantenimiento" type="date" value={since} onChange={e=>setSince(e.target.value)}/></label><Button className="self-end" disabled={busy||!since||!amount} onClick={()=>void save()}>Programar tarifa</Button></div>
    {message&&<p role="status">{message}</p>}<ul className="space-y-1 text-sm">{history.map(t=><li key={t.id_tarifa}>{t.vigente_desde} · Q{Number(t.monto).toFixed(2)}</li>)}</ul>{!history.length&&<p>Sin tarifa configurada. No se emitirán cobros mensuales hasta configurarla.</p>}
  </section>;
}
