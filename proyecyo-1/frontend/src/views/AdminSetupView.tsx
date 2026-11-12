import { useEffect, useState } from "react";
import { ArrowRight, Check, FileSpreadsheet, Loader2, PartyPopper, Users, Waves } from "lucide-react";
import { Link } from "react-router-dom";

import { AdminLayout } from "@/components/admin/AdminLayout";
import { AmenityCatalogDialog } from "@/components/amenities/AmenityCatalogDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setResidentialBrand, useResidentialBrand } from "@/hooks/useResidentialBrand";
import { getAdminAmenitiesRequest } from "@/services/amenitiesService";
import { getAdminVisitScheduleConfigRequest, getGeneralConfigurationRequest, updateBrandRequest, updateGeneralConfigurationRequest, updateVisitScheduleConfigRequest } from "@/services/configurationService";
import { getGlobalMaintenanceRequest, saveGlobalMaintenanceRequest } from "@/services/propertyContractsService";
import { getSetupStatusRequest, hideSetupRequest, markSetupStepRequest, type SetupStatus } from "@/services/setupService";
import type { Amenity } from "@/types/amenities";
import type { GeneralConfiguration, VisitScheduleConfig } from "@/types/configuration";
import { notifyError, notifySuccess } from "@/utils/feedback";

const COLORS = ["#2563EB", "#0E7490", "#059669", "#7C3AED", "#D97706", "#DC2626", "#DB2777", "#1E293B"];
const DAYS = [["L", 1], ["M", 2], ["X", 3], ["J", 4], ["V", 5], ["S", 6], ["D", 0]] as const;
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
function nextMonth() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`, label: `1 de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}` };
}

/** Asistente de primeros pasos para dejar listo un residencial nuevo. */
export function AdminSetupView() {
  const brand = useResidentialBrand();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [step, setStep] = useState("marca");
  const [general, setGeneral] = useState<GeneralConfiguration | null>(null);
  const [logo, setLogo] = useState(brand.logo_url);
  const [color, setColor] = useState(brand.color);
  const [fee, setFee] = useState("");
  const [currentFee, setCurrentFee] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<VisitScheduleConfig | null>(null);
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const month = nextMonth();

  async function refresh() { const s = await getSetupStatusRequest(); setStatus(s); return s; }
  useEffect(() => {
    Promise.all([refresh(), getGeneralConfigurationRequest(), getAdminVisitScheduleConfigRequest(), getGlobalMaintenanceRequest(), getAdminAmenitiesRequest()])
      .then(([s, g, v, m, a]) => {
        setGeneral(g); setSchedule(v); setAmenities(a);
        if (m.historial?.[0]) setCurrentFee(`Q${Number(m.historial[0].monto).toFixed(2)} desde ${m.historial[0].vigente_desde}`);
        setStep(s.pasos.find((p) => !p.done)?.id ?? "marca");
      })
      .catch((reason) => void notifyError(reason, "No fue posible cargar la configuración."));
  }, []);

  async function save(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await action();
      const s = await refresh();
      void notifySuccess(message);
      const index = s.pasos.findIndex((p) => p.id === step);
      const next = s.pasos.slice(index + 1).find((p) => !p.done) ?? s.pasos.find((p) => !p.done);
      if (next) setStep(next.id);
    } catch (reason) { void notifyError(reason, "No fue posible guardar."); } finally { setBusy(false); }
  }

  if (!status || !general || !schedule) return <AdminLayout title="Primeros pasos" subtitle="Deja listo tu residencial en unos minutos."><p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" />Cargando…</p></AdminLayout>;

  const allDone = status.completados === status.total;
  return (
    <AdminLayout title="Primeros pasos" subtitle="Deja listo tu residencial en unos minutos. Puedes volver aquí cuando quieras.">
      <div className="mb-5 h-2.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={status.completados} aria-valuemax={status.total} aria-label="Avance de la configuración">
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(status.completados / status.total) * 100}%` }} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <ol className="space-y-1.5">{status.pasos.map((item, index) => (
          <li key={item.id}><button type="button" onClick={() => setStep(item.id)} aria-current={step === item.id ? "step" : undefined}
            className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${step === item.id ? "border-slate-900 bg-white shadow-sm" : "border-transparent hover:bg-white"}`}>
            <span className={`grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold ${item.done ? "bg-emerald-500 text-white" : step === item.id ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-600"}`}>{item.done ? <Check className="size-4" /> : index + 1}</span>
            <span className="text-sm font-semibold text-slate-800">{item.label}</span>
          </button></li>
        ))}
          <li className="pt-3 text-center text-xs text-slate-500">{status.completados} de {status.total} listos</li>
        </ol>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {allDone ? (
            <div className="mb-6 flex items-center gap-3 rounded-2xl bg-emerald-50 p-4 text-emerald-800"><PartyPopper className="size-6" /><div><p className="font-semibold">¡Tu residencial está listo!</p><p className="text-sm">Ya puedes compartir el acceso con residentes y guardias.</p></div></div>
          ) : null}

          {step === "marca" ? (
            <div className="grid gap-5 md:grid-cols-[1fr_240px]">
              <div className="space-y-4">
                <h2 className="text-xl font-bold text-slate-900">¿Cómo se llama tu residencial?</h2>
                <label className="block text-sm font-medium text-slate-700">Nombre<Input aria-label="Nombre del residencial" className="mt-1.5" value={general.nombre === "NexusResidencial" ? "" : general.nombre} onChange={(e) => setGeneral({ ...general, nombre: e.target.value })} placeholder="Ej. Residencial Las Brisas" /></label>
                <label className="block text-sm font-medium text-slate-700">Teléfono de la administración<Input aria-label="Teléfono de la administración" className="mt-1.5" value={general.telefono_contacto} onChange={(e) => setGeneral({ ...general, telefono_contacto: e.target.value })} placeholder="2222-3333" /></label>
                <label className="block text-sm font-medium text-slate-700">Logo (enlace https://, opcional)<Input aria-label="Logo" className="mt-1.5" value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://…/logo.png" /></label>
                <div><p className="text-sm font-medium text-slate-700">Color</p><div className="mt-1.5 flex flex-wrap gap-2">{COLORS.map((c) => (
                  <button key={c} type="button" aria-label={`Color ${c}`} onClick={() => setColor(c)} className="grid size-9 place-items-center rounded-full" style={{ background: c, boxShadow: color.toUpperCase() === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : undefined }}>{color.toUpperCase() === c ? <Check className="size-4 text-white" /> : null}</button>
                ))}</div></div>
                <Button type="button" disabled={busy || general.nombre.trim().length < 3 || general.nombre === "NexusResidencial"} onClick={() => void save(async () => {
                  if (logo && !/^https:\/\/\S+$/i.test(logo.trim())) throw new Error("El logo debe ser un enlace que empiece con https://");
                  await updateGeneralConfigurationRequest({ ...general, nombre: general.nombre.trim() });
                  setResidentialBrand(await updateBrandRequest({ logo_url: logo.trim(), color }));
                }, "Marca guardada: ya aparece en el menú, los correos y los PDF.")}>Guardar y continuar<ArrowRight className="size-4" /></Button>
              </div>
              <div aria-hidden className="h-fit overflow-hidden rounded-2xl border border-slate-200">
                <div className="flex items-center gap-2 p-4 text-white" style={{ background: color }}>
                  {logo && /^https:\/\//.test(logo) ? <img src={logo} alt="" className="size-9 rounded-lg bg-white object-contain p-1" /> : <span className="grid size-9 place-items-center rounded-lg bg-white/20 font-bold">{(general.nombre || "R").slice(0, 1)}</span>}
                  <span className="font-bold">{general.nombre && general.nombre !== "NexusResidencial" ? general.nombre : "Tu residencial"}</span>
                </div>
                <div className="space-y-2 p-4"><div className="h-2.5 w-3/4 rounded bg-slate-100" /><div className="h-2.5 w-1/2 rounded bg-slate-100" /><div className="mt-3 inline-block rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background: color }}>Así se ven los botones</div></div>
              </div>
            </div>
          ) : step === "mantenimiento" ? (
            <div className="max-w-md space-y-4">
              <h2 className="text-xl font-bold text-slate-900">¿Cuánto es la cuota de mantenimiento?</h2>
              <p className="text-sm text-slate-600">Es el cobro mensual de cada vivienda. Empieza a cobrarse el <b>{month.label}</b> y se genera solo cada mes.</p>
              {currentFee ? <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">Tarifa registrada: {currentFee}</p> : null}
              <label className="block text-sm font-medium text-slate-700">Monto mensual (Q)<Input aria-label="Cuota de mantenimiento" type="number" min="0" step="0.01" className="mt-1.5 text-lg" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="450.00" /></label>
              <Button type="button" disabled={busy || !(Number(fee) > 0)} onClick={() => void save(async () => { await saveGlobalMaintenanceRequest({ monto: Number(fee).toFixed(2), vigente_desde: month.iso }); setCurrentFee(`Q${Number(fee).toFixed(2)} desde ${month.iso}`); }, "Cuota de mantenimiento registrada.")}>Guardar y continuar<ArrowRight className="size-4" /></Button>
            </div>
          ) : step === "visitas" ? (
            <div className="max-w-lg space-y-4">
              <h2 className="text-xl font-bold text-slate-900">¿En qué horario se reciben visitas?</h2>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm font-medium text-slate-700">Desde<Input aria-label="Visitas desde" type="time" className="mt-1.5" value={schedule.hora_apertura} onChange={(e) => setSchedule({ ...schedule, hora_apertura: e.target.value })} /></label>
                <label className="text-sm font-medium text-slate-700">Hasta<Input aria-label="Visitas hasta" type="time" className="mt-1.5" value={schedule.hora_cierre} onChange={(e) => setSchedule({ ...schedule, hora_cierre: e.target.value })} /></label>
              </div>
              <div><p className="text-sm font-medium text-slate-700">Días</p><div className="mt-1.5 flex gap-1.5">{DAYS.map(([label, day]) => {
                const on = schedule.dias_habilitados.includes(day);
                return <button key={day} type="button" aria-pressed={on} aria-label={`Día ${label}`} onClick={() => setSchedule({ ...schedule, dias_habilitados: on ? schedule.dias_habilitados.filter((d) => d !== day) : [...schedule.dias_habilitados, day] })} className={`size-10 rounded-full text-sm font-bold ${on ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>{label}</button>;
              })}</div></div>
              <label className="block text-sm font-medium text-slate-700">Duración máxima de una visita (horas)<Input aria-label="Duración máxima" type="number" min="1" max="12" className="mt-1.5 w-28" value={schedule.duracion_maxima_horas} onChange={(e) => setSchedule({ ...schedule, duracion_maxima_horas: Number(e.target.value) })} /></label>
              <Button type="button" disabled={busy || schedule.dias_habilitados.length === 0} onClick={() => void save(async () => { await updateVisitScheduleConfigRequest(schedule); await markSetupStepRequest("visitas"); }, "Horario de visitas guardado.")}>Guardar y continuar<ArrowRight className="size-4" /></Button>
            </div>
          ) : step === "amenidades" ? (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-slate-900">¿Qué áreas se pueden reservar?</h2>
              <p className="text-sm text-slate-600">Piscina, salón social, rancho, gimnasio… cada una con su horario, foto y reglas.</p>
              {amenities.length ? <ul className="flex flex-wrap gap-2">{amenities.map((a) => <li key={a.id_amenidad} className="rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-800">{a.nombre}</li>)}</ul> : null}
              <Button type="button" onClick={() => setCatalogOpen(true)}><Waves className="size-4" />{amenities.length ? "Gestionar amenidades" : "Agregar amenidades"}</Button>
              <AmenityCatalogDialog open={catalogOpen} onClose={() => setCatalogOpen(false)} amenities={amenities} onChanged={async () => { setAmenities(await getAdminAmenitiesRequest()); await refresh(); }} />
            </div>
          ) : step === "viviendas" ? (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-slate-900">Agrega las viviendas y sus residentes</h2>
              <p className="text-sm text-slate-600">Hoy hay {status.conteos.viviendas} vivienda(s) y {status.conteos.personas} residente(s)/inquilino(s).</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Link to="/admin/importar" className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-4 hover:border-emerald-400"><FileSpreadsheet className="size-7 text-emerald-600" /><p className="mt-2 font-semibold text-slate-900">Importar desde Excel</p><p className="text-sm text-slate-600">Lo más rápido si ya tienes la lista: viviendas, personas y saldos.</p></Link>
                <Link to="/admin/viviendas" className="rounded-2xl border-2 border-slate-200 p-4 hover:border-slate-400"><span className="text-2xl">🏠</span><p className="mt-2 font-semibold text-slate-900">Una por una</p><p className="text-sm text-slate-600">Dibuja el mapa y crea cada vivienda con su contrato.</p></Link>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-slate-900">Crea los usuarios de garita</h2>
              <p className="text-sm text-slate-600">Los guardias registran visitas, validan códigos QR y ven los accesos especiales. Hoy hay {status.conteos.guardias}.</p>
              <Link to="/admin/usuarios" className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white"><Users className="size-4" />Ir a Usuarios</Link>
            </div>
          )}

          <div className="mt-8 flex justify-end border-t border-slate-100 pt-4">
            <button type="button" className="text-xs text-slate-500 underline-offset-2 hover:underline" onClick={() => void hideSetupRequest(!status.oculto).then(setStatus)}>{status.oculto ? "Volver a mostrar el aviso en el panel" : "Ocultar el aviso de primeros pasos en el panel"}</button>
          </div>
        </section>
      </div>
    </AdminLayout>
  );
}
