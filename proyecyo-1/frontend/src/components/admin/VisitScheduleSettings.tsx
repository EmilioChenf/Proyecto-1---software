import { useFeedbackState } from "@/hooks/useFeedbackState";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAdminVisitScheduleConfigRequest, updateVisitScheduleConfigRequest } from "@/services/configurationService";
import type { VisitScheduleConfig } from "@/types/configuration";

const DAYS = [["Dom", 0], ["Lun", 1], ["Mar", 2], ["Mié", 3], ["Jue", 4], ["Vie", 5], ["Sáb", 6]] as const;
const INITIAL: VisitScheduleConfig = { hora_apertura: "06:00", hora_cierre: "22:00", duracion_maxima_horas: 4, activo: true, dias_habilitados: [1, 2, 3, 4, 5, 6, 0] };

export function VisitScheduleSettings() {
  const [form, setForm] = useState(INITIAL);
  const [message, setMessage] = useFeedbackState("info", "");
  const [saving, setSaving] = useState(false);
  useEffect(() => { getAdminVisitScheduleConfigRequest().then(setForm).catch((e) => setMessage(e.message)); }, []);
  async function save() {
    if (!form.dias_habilitados.length || form.hora_apertura >= form.hora_cierre) return setMessage("Selecciona días y un rango válido.");
    try {
      setSaving(true);
      setForm(await updateVisitScheduleConfigRequest(form));
      setMessage("Horarios de visita actualizados.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible guardar.");
    } finally { setSaving(false); }
  }
  return (
    <section className="mb-5 rounded-[20px] border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold">Horarios generales de visita</h2>
      <p className="mt-1 text-sm text-slate-500">Días y rango aplicados por el backend.</p>
      <div className="mt-4 flex flex-wrap gap-2">{DAYS.map(([label, day]) => (
        <label key={day} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <input type="checkbox" checked={form.dias_habilitados.includes(day)} onChange={() => setForm((current) => ({ ...current, dias_habilitados: current.dias_habilitados.includes(day) ? current.dias_habilitados.filter((value) => value !== day) : [...current.dias_habilitados, day] }))} />{label}
        </label>
      ))}</div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <Input type="time" value={form.hora_apertura} onChange={(e) => setForm({ ...form, hora_apertura: e.target.value })} />
        <Input type="time" value={form.hora_cierre} onChange={(e) => setForm({ ...form, hora_cierre: e.target.value })} />
        <Input type="number" min={1} max={12} value={form.duracion_maxima_horas} onChange={(e) => setForm({ ...form, duracion_maxima_horas: Number(e.target.value) })} />
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} />Autorizaciones activas</label>
      {message ? <p className="mt-3 text-sm text-slate-600">{message}</p> : null}
      <Button className="mt-4" type="button" disabled={saving} onClick={save}>{saving ? "Guardando..." : "Guardar horario"}</Button>
    </section>
  );
}
