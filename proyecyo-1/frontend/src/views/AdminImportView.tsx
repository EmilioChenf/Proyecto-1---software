import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, RotateCcw, Upload } from "lucide-react";

import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { applyImportRequest, downloadImportTemplate, previewImportRequest, type ImportPreview, type ImportReport, type ImportRow } from "@/services/importService";
import { confirmAction, notifyError, notifySuccess } from "@/utils/feedback";

type SheetKey = "viviendas" | "residentes" | "inquilinos" | "saldos";
const SHEETS: Array<{ key: SheetKey; label: string; emoji: string }> = [
  { key: "viviendas", label: "Viviendas", emoji: "🏠" },
  { key: "residentes", label: "Residentes", emoji: "👤" },
  { key: "inquilinos", label: "Inquilinos", emoji: "🧳" },
  { key: "saldos", label: "Saldos iniciales", emoji: "💰" },
];
const STATUS: Record<ImportRow["estado"], { label: string; className: string }> = {
  NUEVA: { label: "Se importará", className: "bg-emerald-50 text-emerald-700" },
  NUEVO: { label: "Se importará", className: "bg-emerald-50 text-emerald-700" },
  YA_EXISTE: { label: "Ya existe · se omite", className: "bg-slate-100 text-slate-600" },
  ERROR: { label: "Con error", className: "bg-rose-50 text-rose-700" },
};
const readFile = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("No se pudo leer el archivo.")); reader.readAsDataURL(file); });

/** Importación inicial desde Excel en tres pasos: plantilla, vista previa y confirmación. */
export function AdminImportView() {
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [sheet, setSheet] = useState<SheetKey>("viviendas");
  const [invite, setInvite] = useState(true);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const step = report ? 3 : preview ? 2 : 1;

  async function pick(selected: File | undefined) {
    if (!selected) return;
    if (!/\.xlsx$/i.test(selected.name)) { void notifyError(new Error("Usa la plantilla en formato .xlsx."), "Archivo no válido."); return; }
    setBusy(true); setReport(null);
    try {
      const data = await readFile(selected);
      const result = await previewImportRequest(data);
      setFile({ name: selected.name, data }); setPreview(result);
      setSheet(SHEETS.find((s) => result[s.key].length > 0)?.key ?? "viviendas");
    } catch (reason) { void notifyError(reason, "No fue posible revisar el archivo."); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  async function apply() {
    if (!file || !preview) return;
    const ok = await confirmAction({ title: `¿Importar ${preview.resumen.listas} registros?`, text: preview.resumen.errores ? `${preview.resumen.errores} fila(s) con error se omitirán. Puedes corregirlas y volver a importar después.` : "Se crearán las viviendas, personas y saldos de la vista previa.", confirmText: "Sí, importar", cancelText: "No, revisar" });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await applyImportRequest(file.data, invite);
      setReport(result);
      void notifySuccess("Importación terminada.");
    } catch (reason) { void notifyError(reason, "No fue posible importar."); } finally { setBusy(false); }
  }

  function reset() { setFile(null); setPreview(null); setReport(null); }

  return (
    <AdminLayout title="Importar desde Excel" subtitle="Pasa al sistema las viviendas, residentes, inquilinos y saldos que hoy tienes en hojas de cálculo.">
      <ol className="mb-5 grid gap-2 sm:grid-cols-3">{["Descarga la plantilla", "Sube y revisa", "Importa"].map((label, index) => (
        <li key={label} className={`flex items-center gap-3 rounded-2xl border p-3 ${step === index + 1 ? "border-slate-900 bg-white shadow-sm" : step > index + 1 ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white/60"}`}>
          <span className={`grid size-8 place-items-center rounded-full text-sm font-bold ${step > index + 1 ? "bg-emerald-600 text-white" : step === index + 1 ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>{step > index + 1 ? "✓" : index + 1}</span>
          <span className="text-sm font-semibold text-slate-800">{label}</span>
        </li>
      ))}</ol>

      {report ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <CheckCircle2 className="size-10 text-emerald-600" />
          <h2 className="mt-2 text-xl font-bold text-slate-900">Importación terminada</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-4">{[["Viviendas", report.viviendas], ["Residentes", report.residentes], ["Inquilinos", report.inquilinos], ["Saldos", report.saldos]].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="text-2xl font-bold text-slate-900">{value}</p></div>
          ))}</div>
          <p className="mt-3 text-sm text-slate-600">{report.omitidas} fila(s) omitidas (ya existían o tenían error).{invite ? ` Se enviaron ${report.invitaciones} invitación(es) por correo para crear contraseña.` : ""}</p>
          {report.fallidas.length ? <ul className="mt-3 space-y-1 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{report.fallidas.map((f) => <li key={`${f.hoja}-${f.fila}`}>{f.hoja}, fila {f.fila}: {f.error}</li>)}</ul> : null}
          <Button type="button" variant="outline" className="mt-4" onClick={reset}><RotateCcw className="size-4" />Importar otro archivo</Button>
        </section>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <aside className="space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <FileSpreadsheet className="size-8 text-emerald-600" />
              <p className="mt-2 font-semibold text-slate-900">1. Plantilla</p>
              <p className="text-sm text-slate-500">Trae 4 hojas con ejemplos e instrucciones. Las filas de ejemplo se ignoran solas.</p>
              <Button type="button" variant="outline" className="mt-3 w-full" onClick={() => void downloadImportTemplate().catch((reason) => notifyError(reason, "No fue posible descargar."))}><Download className="size-4" />Descargar plantilla</Button>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="font-semibold text-slate-900">2. Sube tu archivo</p>
              <input ref={fileRef} type="file" accept=".xlsx" className="sr-only" aria-label="Archivo de Excel" onChange={(e) => void pick(e.target.files?.[0])} />
              <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 p-5 text-sm font-medium text-slate-600 hover:bg-slate-50">
                {busy && !preview ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}{file ? file.name : "Elegir archivo .xlsx"}
              </button>
              <p className="mt-2 text-xs text-slate-500">Nada se guarda hasta que confirmes en el paso 3.</p>
            </div>
          </aside>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            {!preview ? (
              <div className="grid min-h-64 place-items-center text-center text-sm text-slate-500"><div><FileSpreadsheet className="mx-auto mb-2 size-10 text-slate-300" />Sube el archivo para ver la vista previa fila por fila.</div></div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs text-emerald-700">Listas para importar</p><p className="text-2xl font-bold text-emerald-700">{preview.resumen.listas}</p></div>
                  <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Ya existen (se omiten)</p><p className="text-2xl font-bold text-slate-700">{preview.resumen.existentes}</p></div>
                  <div className="rounded-xl bg-rose-50 p-3"><p className="text-xs text-rose-700">Con error</p><p className="text-2xl font-bold text-rose-700">{preview.resumen.errores}</p></div>
                </div>
                <div role="tablist" aria-label="Hojas" className="mt-4 flex flex-wrap gap-1.5">{SHEETS.map((s) => {
                  const errors = preview[s.key].filter((r) => r.estado === "ERROR").length;
                  return <button key={s.key} role="tab" type="button" aria-selected={sheet === s.key} onClick={() => setSheet(s.key)} className={`rounded-full border px-3 py-1.5 text-sm font-medium ${sheet === s.key ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600"}`}>{s.emoji} {s.label} ({preview[s.key].length}){errors ? <span className="ml-1 text-rose-400">· {errors} ⚠</span> : null}</button>;
                })}</div>
                <div className="mt-3 max-h-[420px] overflow-auto rounded-xl border border-slate-100">
                  {preview[sheet].length === 0 ? <p className="p-6 text-center text-sm text-slate-500">Esta hoja está vacía.</p> : (
                    <table className="w-full text-sm"><thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-3 py-2">Fila</th><th>Registro</th><th>Estado</th></tr></thead>
                      <tbody>{preview[sheet].map((row) => (
                        <tr key={row.fila} className="border-t border-slate-100 align-top">
                          <td className="px-3 py-2 text-slate-500">{row.fila}</td>
                          <td className="py-2 pr-3"><p className="font-medium text-slate-800">{row.nombre ?? (row.monto != null ? `Q${row.monto.toLocaleString("es-GT", { minimumFractionDigits: 2 })}` : `Vivienda ${row.vivienda}`)}</p><p className="text-xs text-slate-500">{[row.correo, row.nombre || row.monto != null ? `Vivienda ${row.vivienda}` : null, row.fecha_limite].filter(Boolean).join(" · ")}</p>
                            {row.errores.map((error) => <p key={error} className="mt-0.5 flex items-start gap-1 text-xs text-rose-700"><AlertTriangle className="mt-0.5 size-3 shrink-0" />{error}</p>)}</td>
                          <td className="py-2 pr-3"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS[row.estado].className}`}>{STATUS[row.estado].label}</span></td>
                        </tr>
                      ))}</tbody></table>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                  <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} />Enviar a cada persona un correo para crear su contraseña</label>
                  <div className="flex gap-2"><Button type="button" variant="outline" onClick={reset}>Cancelar</Button><Button type="button" disabled={busy || preview.resumen.listas === 0} onClick={() => void apply()}>{busy ? "Importando…" : `3. Importar ${preview.resumen.listas} registros`}</Button></div>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </AdminLayout>
  );
}
