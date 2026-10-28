import { useFeedbackState } from "@/hooks/useFeedbackState";
import { useEffect, useState } from "react";
import { Download, Loader2, Play } from "lucide-react";
import { apiDownload, apiRequest, ApiError } from "@/services/api";
import { Button } from "@/components/ui/button";

type Config = { activo: boolean; frecuencia: "DIARIO" | "SEMANAL" | "MENSUAL"; hora: string; retencion: number };
type Record = { id_respaldo: number; nombre_archivo: string; tipo: string; estado: string; tamano_bytes: number; duracion_ms: number; iniciado_en: string };
const initial: Config = { activo: false, frecuencia: "DIARIO", hora: "02:00", retencion: 7 };

export function AutomaticBackupsSettings() {
  const [config, setConfig] = useState<Config>(initial);
  const [records, setRecords] = useState<Record[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useFeedbackState("info", "");

  async function load() {
    try {
      const [next, history] = await Promise.all([
        apiRequest<Config>("/admin/respaldos/configuracion"),
        apiRequest<Record[]>("/admin/respaldos"),
      ]);
      setConfig(next); setRecords(history);
    } catch (error) { setMessage(error instanceof ApiError ? error.message : "No fue posible cargar los respaldos."); }
  }
  useEffect(() => { void load(); }, []);

  async function save() {
    setBusy(true); setMessage("");
    try { setConfig(await apiRequest<Config>("/admin/respaldos/configuracion", { method: "PUT", body: config })); setMessage("Configuración guardada."); }
    catch (error) { setMessage(error instanceof ApiError ? error.message : "No fue posible guardar."); }
    finally { setBusy(false); }
  }
  async function execute() {
    setBusy(true); setMessage("Generando respaldo...");
    try { await apiRequest("/admin/respaldos/ejecutar", { method: "POST" }); setMessage("Respaldo completado."); await load(); }
    catch (error) { setMessage(error instanceof ApiError ? error.message : "No fue posible generar el respaldo."); }
    finally { setBusy(false); }
  }
  async function download(id: number, filename: string) {
    // apiDownload envía el token Bearer de la sesión; antes se usaban cabeceras heredadas
    // (x-user-role / x-user-id) que el backend no acepta fuera de pruebas y la descarga fallaba.
    let blob: Blob;
    try { blob = await apiDownload(`/admin/respaldos/${id}/descargar`); }
    catch (error) { setMessage(error instanceof ApiError ? error.message : "No fue posible descargar el respaldo."); return; }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
    setMessage("Descarga del respaldo iniciada.");
  }

  return (
    <section className="mb-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-950">Respaldos automáticos</h2>
      <p className="mt-1 text-sm text-slate-500">Programa, ejecuta y descarga respaldos compatibles con Restauración.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <label className="text-sm">Estado<select className="mt-1 w-full rounded-md border p-2" value={String(config.activo)} onChange={(e) => setConfig({ ...config, activo: e.target.value === "true" })}><option value="false">Inactivo</option><option value="true">Activo</option></select></label>
        <label className="text-sm">Frecuencia<select className="mt-1 w-full rounded-md border p-2" value={config.frecuencia} onChange={(e) => setConfig({ ...config, frecuencia: e.target.value as Config["frecuencia"] })}><option>DIARIO</option><option>SEMANAL</option><option>MENSUAL</option></select></label>
        <label className="text-sm">Hora<input className="mt-1 w-full rounded-md border p-2" type="time" value={config.hora} onChange={(e) => setConfig({ ...config, hora: e.target.value })} /></label>
        <label className="text-sm">Retención<input className="mt-1 w-full rounded-md border p-2" type="number" min="1" max="30" value={config.retencion} onChange={(e) => setConfig({ ...config, retencion: Number(e.target.value) })} /></label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2"><Button onClick={save} disabled={busy}>Guardar</Button><Button variant="outline" onClick={execute} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}Ejecutar ahora</Button></div>
      {message && <p className="mt-3 text-sm text-slate-600">{message}</p>}
      <div className="mt-5 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">Fecha</th><th>Tipo</th><th>Estado</th><th>Tamaño</th><th>Acción</th></tr></thead><tbody>
        {!records.length && <tr><td className="p-3 text-slate-500" colSpan={5}>Todavía no hay respaldos.</td></tr>}
        {records.map((item) => <tr className="border-b" key={item.id_respaldo}><td className="p-2">{new Date(item.iniciado_en).toLocaleString()}</td><td>{item.tipo}</td><td>{item.estado}</td><td>{Math.ceil(item.tamano_bytes / 1024)} KB</td><td>{item.estado === "COMPLETADO" && <Button size="sm" variant="ghost" onClick={() => void download(item.id_respaldo, item.nombre_archivo)}><Download className="size-4" />Descargar</Button>}</td></tr>)}
      </tbody></table></div>
    </section>
  );
}
