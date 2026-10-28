import { useFeedbackState } from "@/hooks/useFeedbackState";
import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";

import { AdminLayout } from "@/components/admin/AdminLayout";
import { HouseExplorer } from "@/components/houses/HouseExplorer";
import {PropertyContractWizard} from '@/components/houses/PropertyContractWizard';
import {TenantRequestsPanel} from '@/components/residente/TenantRequestsPanel';
import { HouseFormModal } from "@/components/houses/HouseFormModal";
import { Button } from "@/components/ui/button";
import {
  createHouseRequest,
  getHouseDetailRequest,
  getHousesRequest,
  setHouseActiveRequest,
  updateHouseRequest,
} from "@/services/housesService";
import type { HouseDetail, HouseFormValues, HouseList, HouseRecord } from "@/types/houses";

const message = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

export function AdminHousesView({ webglSupported }: { webglSupported?: boolean } = {}) {
  const [contractOpen,setContractOpen]=useState(false);
  const [data, setData] = useState<HouseList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useFeedbackState("error", "");
  const [selected, setSelected] = useState<HouseRecord | null>(null);
  const [detail, setDetail] = useState<HouseDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useFeedbackState("error", "");
  const [modal, setModal] = useState<{ open: boolean; editing: HouseDetail | null }>({ open: false, editing: null });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useFeedbackState("info", "");

  const loadList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await getHousesRequest();
      setData(next);
      // Mantener la seleccion con los datos frescos de la BD.
      setSelected((current) => (current ? next.viviendas.find((h) => h.id_casa === current.id_casa) ?? null : null));
    } catch (requestError) {
      setError(message(requestError, "No fue posible cargar las viviendas."));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    setDetailError("");
    try {
      setDetail(await getHouseDetailRequest(id));
    } catch (requestError) {
      setDetail(null);
      setDetailError(message(requestError, "No fue posible cargar la vivienda."));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);

  const select = useCallback((house: HouseRecord) => {
    setSelected(house);
    setFeedback("");
    void loadDetail(house.id_casa);
  }, [loadDetail]);

  const close = useCallback(() => { setSelected(null); setDetail(null); setDetailError(""); }, []);

  const save = async (values: HouseFormValues) => {
    setBusy(true);
    try {
      const saved = modal.editing ? await updateHouseRequest(modal.editing.id_casa, values) : await createHouseRequest(values);
      setModal({ open: false, editing: null });
      setFeedback(modal.editing ? `Vivienda ${saved.codigo} actualizada.` : `Vivienda ${saved.codigo} agregada.`);
      setDetail(saved);
      setSelected(saved as unknown as HouseRecord);
      await loadList();
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (house: HouseDetail) => {
    setBusy(true);
    setFeedback("");
    try {
      const saved = await setHouseActiveRequest(house.id_casa, !house.activo);
      setDetail(saved);
      setFeedback(`Vivienda ${saved.codigo} ${saved.activo ? "activada" : "desactivada"}.`);
      await loadList();
    } catch (requestError) {
      setFeedback(message(requestError, "No fue posible cambiar el estado de la vivienda."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminLayout
      title="Viviendas"
      subtitle="Mapa del residencial: estado real de cada vivienda, residentes e inquilinos."
      actions={<div className="flex flex-wrap gap-2"><Button onClick={() => setModal({ open: true, editing: null })}><Plus className="size-4" />Agregar vivienda</Button><Button variant="outline" onClick={()=>setContractOpen(true)}>Configurar contrato</Button></div>}
    >
      {loading && !data ? (
        <p role="status" className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Cargando viviendas…</p>
      ) : error ? (
        <div role="alert" className="space-y-3 rounded-2xl bg-rose-50 p-6 text-sm text-rose-700">
          <p>{error}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadList()}><RefreshCw className="size-4" />Reintentar</Button>
        </div>
      ) : data && data.viviendas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-600">
          No hay viviendas registradas. Usa “Agregar vivienda” para crear la primera.
        </div>
      ) : data ? (
        <HouseExplorer
          houses={data.viviendas}
          summary={data.resumen}
          selected={selected}
          detail={detail}
          detailLoading={detailLoading}
          detailError={detailError}
          feedback={feedback}
          busy={busy}
          onSelect={select}
          onClose={close}
          onRetryDetail={() => selected && void loadDetail(selected.id_casa)}
          onEdit={(d) => setModal({ open: true, editing: d })}
          onToggleActive={(d) => void toggleActive(d)}
          webglSupported={webglSupported}
        />
      ) : null}

      <HouseFormModal open={modal.open} editing={modal.editing} submitting={busy} onClose={() => !busy && setModal({ open: false, editing: null })} onSubmit={save} />
      <details className="mt-5 rounded-xl border bg-background p-4"><summary className="cursor-pointer font-semibold">Solicitudes de arrendatarios de la residencial</summary><TenantRequestsPanel company/></details>
      {contractOpen&&<PropertyContractWizard open initialHouse={selected} onClose={()=>setContractOpen(false)} onSaved={()=>{setFeedback('Contrato y personas guardados.');void loadList();if(selected)void loadDetail(selected.id_casa);}}/>}
    </AdminLayout>
  );
}
