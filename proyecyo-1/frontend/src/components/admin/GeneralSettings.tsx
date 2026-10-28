import { useFeedbackState } from "@/hooks/useFeedbackState";
import { useEffect, useState, type FormEvent } from "react";
import { Building2, CheckCircle2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getGeneralConfigurationRequest, updateGeneralConfigurationRequest } from "@/services/configurationService";
import type { GeneralConfiguration } from "@/types/configuration";

const INITIAL: GeneralConfiguration = {
  nombre: "NexusResidencial",
  direccion: "",
  correo_contacto: "administracion@nexusresidencial.local",
  telefono_contacto: "",
  zona_horaria: "America/Guatemala",
  moneda: "GTQ",
};

export function GeneralSettings() {
  const [form, setForm] = useState(INITIAL);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useFeedbackState("error", "");
  const [success, setSuccess] = useFeedbackState("success", "");

  useEffect(() => {
    let active = true;
    getGeneralConfigurationRequest()
      .then((response) => { if (active) setForm(response); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "No fue posible cargar la configuracion."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (form.nombre.trim().length < 3 || !/^\S+@\S+\.\S+$/.test(form.correo_contacto)) {
      setError("Revisa el nombre y el correo de contacto antes de guardar.");
      return;
    }
    try {
      setSaving(true);
      setForm(await updateGeneralConfigurationRequest(form));
      setSuccess("La configuracion general fue guardada correctamente.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible guardar la configuracion.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mb-5 rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3"><div className="rounded-xl bg-blue-50 p-2.5 text-blue-700"><Building2 className="size-5" /></div><div><h2 className="text-lg font-semibold text-slate-950">Configuracion general del residencial</h2><p className="text-sm text-slate-500">Parametros publicos de operacion y contacto. No almacenes credenciales en este formulario.</p></div></div>
      {error ? <Alert variant="destructive" className="mt-4"><AlertTitle>Error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      {success ? <Alert className="mt-4 border-emerald-200 bg-emerald-50"><CheckCircle2 className="mr-2 inline size-4 text-emerald-700" /><AlertTitle>Configuracion guardada</AlertTitle><AlertDescription>{success}</AlertDescription></Alert> : null}
      <form className="mt-5 grid gap-4 md:grid-cols-2" onSubmit={submit}>
        <div><label htmlFor="residential-name" className="mb-1.5 block text-sm font-medium text-slate-700">Nombre del residencial</label><Input id="residential-name" value={form.nombre} maxLength={120} disabled={loading} onChange={(event) => setForm({ ...form, nombre: event.target.value })} /></div>
        <div><label htmlFor="contact-email" className="mb-1.5 block text-sm font-medium text-slate-700">Correo de contacto</label><Input id="contact-email" type="email" value={form.correo_contacto} disabled={loading} onChange={(event) => setForm({ ...form, correo_contacto: event.target.value })} /></div>
        <div><label htmlFor="contact-phone" className="mb-1.5 block text-sm font-medium text-slate-700">Telefono de contacto</label><Input id="contact-phone" value={form.telefono_contacto} maxLength={25} disabled={loading} onChange={(event) => setForm({ ...form, telefono_contacto: event.target.value })} /></div>
        <div><label htmlFor="time-zone" className="mb-1.5 block text-sm font-medium text-slate-700">Zona horaria</label><select id="time-zone" className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm" value={form.zona_horaria} disabled={loading} onChange={(event) => setForm({ ...form, zona_horaria: event.target.value })}><option value="America/Guatemala">America/Guatemala</option><option value="America/Mexico_City">America/Mexico_City</option><option value="America/Costa_Rica">America/Costa_Rica</option><option value="America/Panama">America/Panama</option></select></div>
        <div className="md:col-span-2"><label htmlFor="residential-address" className="mb-1.5 block text-sm font-medium text-slate-700">Direccion</label><Input id="residential-address" value={form.direccion} maxLength={200} disabled={loading} onChange={(event) => setForm({ ...form, direccion: event.target.value })} /></div>
        <div><label htmlFor="currency" className="mb-1.5 block text-sm font-medium text-slate-700">Moneda</label><select id="currency" className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm" value={form.moneda} disabled={loading} onChange={(event) => setForm({ ...form, moneda: event.target.value as GeneralConfiguration["moneda"] })}><option value="GTQ">Quetzal (GTQ)</option><option value="USD">Dolar (USD)</option></select></div>
        <div className="flex items-end"><Button type="submit" className="w-full md:w-auto" disabled={loading || saving}>{saving ? "Guardando..." : "Guardar configuracion"}</Button></div>
      </form>
    </section>
  );
}
