import { useEffect, useState } from "react";
import { CalendarClock, ImageOff, Pencil, Plus, Power, Trash2, Waves } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createAmenityRequest, deleteAmenityRequest, updateAmenityRequest } from "@/services/amenitiesService";
import type { Amenity, AmenityCatalogPayload } from "@/types/amenities";
import { confirmAction, notifyError, notifySuccess } from "@/utils/feedback";

const EMPTY: AmenityCatalogPayload = { nombre: "", descripcion: "", reglas: "", foto_url: "", hora_apertura: "08:00", hora_cierre: "22:00", intervalo_minutos: 60, activo: true };
const INTERVALS = [15, 30, 60];

/** Catálogo de amenidades del residencial: crear, editar, activar/desactivar y eliminar. */
export function AmenityCatalogDialog({ open, onClose, amenities, onChanged }: { open: boolean; onClose: () => void; amenities: Amenity[]; onChanged: () => Promise<void> | void }) {
  const [editing, setEditing] = useState<Amenity | "new" | null>(null);
  const [form, setForm] = useState<AmenityCatalogPayload>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [photoFailed, setPhotoFailed] = useState(false);

  useEffect(() => { if (!open) { setEditing(null); setError(""); } }, [open]);
  useEffect(() => { setPhotoFailed(false); }, [form.foto_url]);

  function startEdit(target: Amenity | "new") {
    setEditing(target);
    setError("");
    setForm(target === "new" ? EMPTY : {
      nombre: target.nombre, descripcion: target.descripcion || "", reglas: target.reglas || "", foto_url: target.foto_url || "",
      hora_apertura: target.hora_apertura, hora_cierre: target.hora_cierre, intervalo_minutos: target.intervalo_minutos, activo: target.activo,
    });
  }

  async function save() {
    if (form.nombre.trim().length < 3) { setError("Escribe un nombre de al menos 3 caracteres."); return; }
    if (form.hora_apertura >= form.hora_cierre) { setError("La hora de cierre debe ser mayor a la de apertura."); return; }
    if (form.foto_url && !/^https:\/\/\S+$/i.test(form.foto_url)) { setError("La foto debe ser un enlace que empiece con https://"); return; }
    setBusy(true);
    setError("");
    try {
      if (editing === "new") await createAmenityRequest(form);
      else if (editing) await updateAmenityRequest(editing.id_amenidad, form);
      await onChanged();
      void notifySuccess(editing === "new" ? `Amenidad ${form.nombre} creada.` : `Amenidad ${form.nombre} actualizada.`);
      setEditing(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible guardar la amenidad.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(amenity: Amenity) {
    const confirmed = await confirmAction({
      title: amenity.activo ? `¿Desactivar ${amenity.nombre}?` : `¿Activar ${amenity.nombre}?`,
      text: amenity.activo ? "Nadie podrá hacer nuevas reservas. Su historial se conserva." : "Volverá a estar disponible para reservar.",
      confirmText: amenity.activo ? "Sí, desactivar" : "Sí, activar", cancelText: "No, cancelar", tone: amenity.activo ? "danger" : "primary",
    });
    if (!confirmed) return;
    try {
      await updateAmenityRequest(amenity.id_amenidad, { activo: !amenity.activo });
      await onChanged();
      void notifySuccess(`${amenity.nombre} ${amenity.activo ? "desactivada" : "activada"}.`);
    } catch (reason) {
      void notifyError(reason, "No fue posible cambiar el estado.");
    }
  }

  async function remove(amenity: Amenity) {
    const confirmed = await confirmAction({ title: `¿Eliminar ${amenity.nombre}?`, text: "Solo se puede eliminar si nunca se reservó. Si tiene historial, desactívala.", confirmText: "Sí, eliminar", cancelText: "No, cancelar", tone: "danger" });
    if (!confirmed) return;
    try {
      await deleteAmenityRequest(amenity.id_amenidad);
      await onChanged();
      void notifySuccess(`${amenity.nombre} eliminada.`);
    } catch (reason) {
      void notifyError(reason, "No fue posible eliminar la amenidad.");
    }
  }

  const field = (key: keyof AmenityCatalogPayload) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value && !busy) onClose(); }}>
      <DialogContent className="max-h-[92dvh] w-[calc(100%-1rem)] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Amenidades del residencial</DialogTitle>
          <DialogDescription>Crea las áreas que los residentes pueden reservar, con su horario, foto y reglas.</DialogDescription>
        </DialogHeader>

        {editing ? (
          <div className="grid gap-5 md:grid-cols-[1fr_220px]">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-700 sm:col-span-2">Nombre<Input aria-label="Nombre de la amenidad" className="mt-1.5" value={form.nombre} onChange={field("nombre")} placeholder="Ej. Piscina, Gimnasio, Rancho BBQ" /></label>
              <label className="text-sm font-medium text-slate-700 sm:col-span-2">Descripción<Input aria-label="Descripción" className="mt-1.5" maxLength={200} value={form.descripcion} onChange={field("descripcion")} placeholder="Ej. Piscina climatizada con área de descanso" /></label>
              <label className="text-sm font-medium text-slate-700">Abre<Input aria-label="Hora de apertura" type="time" className="mt-1.5" value={form.hora_apertura} onChange={field("hora_apertura")} /></label>
              <label className="text-sm font-medium text-slate-700">Cierra<Input aria-label="Hora de cierre" type="time" className="mt-1.5" value={form.hora_cierre} onChange={field("hora_cierre")} /></label>
              <div className="sm:col-span-2">
                <p className="text-sm font-medium text-slate-700">Duración de cada reserva</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">{INTERVALS.map((minutes) => (
                  <button key={minutes} type="button" onClick={() => setForm((current) => ({ ...current, intervalo_minutos: minutes }))}
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${form.intervalo_minutos === minutes ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                    {minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}
                  </button>
                ))}</div>
                <p className="mt-1 text-xs text-slate-500">El horario de apertura a cierre debe dividirse exacto en bloques de esta duración.</p>
              </div>
              <label className="text-sm font-medium text-slate-700 sm:col-span-2">Reglas de uso<textarea aria-label="Reglas de uso" maxLength={500} value={form.reglas} onChange={field("reglas")} placeholder="Ej. Máximo 8 invitados. Prohibido vidrio. Dejar limpio el área."
                className="mt-1.5 min-h-20 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-300" /></label>
              <label className="text-sm font-medium text-slate-700 sm:col-span-2">Foto (enlace https://)<Input aria-label="Foto de la amenidad" className="mt-1.5" value={form.foto_url} onChange={field("foto_url")} placeholder="https://…/piscina.jpg" /></label>
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={form.activo} onChange={(e) => setForm((current) => ({ ...current, activo: e.target.checked }))} />Disponible para reservar</label>
            </div>
            <div className="space-y-3">
              <div className="aspect-[4/3] overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                {form.foto_url && !photoFailed ? <img src={form.foto_url} alt={`Foto de ${form.nombre || "la amenidad"}`} className="size-full object-cover" onError={() => setPhotoFailed(true)} />
                  : <div className="grid size-full place-items-center text-slate-400"><ImageOff className="size-8" /></div>}
              </div>
              <p className="font-semibold text-slate-900">{form.nombre || "Nombre de la amenidad"}</p>
              <p className="text-xs text-slate-500">{form.hora_apertura} – {form.hora_cierre} · bloques de {form.intervalo_minutos} min</p>
            </div>
            {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 md:col-span-2">{error}</p> : null}
            <div className="flex justify-end gap-2 md:col-span-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(null)}>Volver</Button>
              <Button type="button" disabled={busy} onClick={() => void save()}>{busy ? "Guardando…" : editing === "new" ? "Crear amenidad" : "Guardar cambios"}</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-end"><Button type="button" onClick={() => startEdit("new")}><Plus className="size-4" />Nueva amenidad</Button></div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {amenities.map((amenity) => (
                <li key={amenity.id_amenidad} className={`flex gap-3 rounded-2xl border p-3 ${amenity.activo ? "border-slate-200 bg-white" : "border-dashed border-slate-300 bg-slate-50 opacity-80"}`}>
                  <div className="size-16 shrink-0 overflow-hidden rounded-xl bg-blue-50 text-blue-600">
                    {amenity.foto_url ? <img src={amenity.foto_url} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center"><Waves className="size-6" /></div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-900">{amenity.nombre} {!amenity.activo ? <span className="ml-1 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600">Inactiva</span> : null}</p>
                    <p className="flex items-center gap-1 text-xs text-slate-500"><CalendarClock className="size-3.5" />{amenity.hora_apertura} – {amenity.hora_cierre} · {amenity.intervalo_minutos} min</p>
                    {amenity.descripcion ? <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{amenity.descripcion}</p> : null}
                    <div className="mt-2 flex gap-1.5">
                      <Button type="button" size="sm" variant="outline" onClick={() => startEdit(amenity)} aria-label={`Editar ${amenity.nombre}`}><Pencil className="size-3.5" />Editar</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => void toggle(amenity)} aria-label={`${amenity.activo ? "Desactivar" : "Activar"} ${amenity.nombre}`}><Power className="size-3.5" />{amenity.activo ? "Desactivar" : "Activar"}</Button>
                      <Button type="button" size="sm" variant="ghost" className="text-rose-600 hover:bg-rose-50" onClick={() => void remove(amenity)} aria-label={`Eliminar ${amenity.nombre}`}><Trash2 className="size-3.5" /></Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
