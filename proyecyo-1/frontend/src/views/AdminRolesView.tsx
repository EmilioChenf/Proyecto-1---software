import { useEffect, useMemo, useState } from "react";
import { Check, Eye, Loader2, Pencil, Plus, ShieldCheck, Sparkles, Trash2, Users } from "lucide-react";
import { Link } from "react-router-dom";

import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ROLE_MODULE_META, type ModuleLevel } from "@/config/roleModules";
import { createRoleRequest, deleteRoleRequest, listRolesRequest, updateRoleRequest, type CustomRole, type RoleModule } from "@/services/rolesService";
import { confirmAction, notifyError, notifySuccess } from "@/utils/feedback";

type Level = ModuleLevel | "NINGUNO";
type Draft = { id?: number; nombre: string; descripcion: string; color: string; permisos: Record<string, Level> };

// Plantillas para empezar rápido: el administrador solo ajusta lo que necesite.
const TEMPLATES: Array<{ nombre: string; descripcion: string; color: string; permisos: Record<string, ModuleLevel> }> = [
  { nombre: "Contador", descripcion: "Revisa ingresos, pagos y reportes", color: "#059669", permisos: { dashboard: "VER", finanzas: "VER", pagos: "EDITAR", reportes: "VER", recordatorios: "VER" } },
  { nombre: "Junta directiva", descripcion: "Consulta todo, decide en votaciones", color: "#7C3AED", permisos: { dashboard: "VER", finanzas: "VER", reportes: "VER", comunicados: "EDITAR", comunidad: "EDITAR", sanciones: "VER", fallas: "VER" } },
  { nombre: "Recepción", descripcion: "Atiende visitas, proveedores y reservas", color: "#0E7490", permisos: { accesos: "EDITAR", accesos_especiales: "EDITAR", amenidades: "EDITAR", comunicados: "VER" } },
  { nombre: "Mantenimiento", descripcion: "Atiende fallas y áreas comunes", color: "#D97706", permisos: { fallas: "EDITAR", amenidades: "VER" } },
];
const NEXT: Record<Level, Level> = { NINGUNO: "VER", VER: "EDITAR", EDITAR: "NINGUNO" };
const EMPTY: Draft = { nombre: "", descripcion: "", color: "#2563EB", permisos: {} };

/** Roles personalizados: el administrador elige, módulo por módulo, qué ve cada rol. */
export function AdminRolesView() {
  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [modules, setModules] = useState<RoleModule[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    try {
      const data = await listRolesRequest();
      setRoles(data.roles); setModules(data.modulos); setColors(data.colores);
    } catch (reason) { void notifyError(reason, "No fue posible cargar los roles."); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const chosen = useMemo(() => modules.filter((module) => draft && draft.permisos[module.id] && draft.permisos[module.id] !== "NINGUNO"), [modules, draft]);

  function setLevel(moduleId: string, level: Level) {
    setDraft((current) => current && ({ ...current, permisos: { ...current.permisos, [moduleId]: level } }));
  }

  async function save() {
    if (!draft) return;
    if (draft.nombre.trim().length < 3) { setError("Ponle un nombre al rol (mínimo 3 letras)."); return; }
    if (chosen.length === 0) { setError("Toca al menos un módulo para que este rol pueda verlo."); return; }
    setSaving(true); setError("");
    try {
      const body = { nombre: draft.nombre.trim(), descripcion: draft.descripcion.trim(), color: draft.color, permisos: draft.permisos };
      const saved = draft.id ? await updateRoleRequest(draft.id, body) : await createRoleRequest(body);
      await load(); setDraft(null);
      void notifySuccess(draft.id ? `Rol ${saved.nombre} actualizado. Los cambios aplican al instante.` : `Rol ${saved.nombre} creado. Ya puedes asignarlo en Usuarios.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible guardar el rol."); } finally { setSaving(false); }
  }

  async function remove(role: CustomRole) {
    const ok = await confirmAction({ title: `¿Eliminar el rol ${role.nombre}?`, text: role.usuarios ? `Lo tienen ${role.usuarios} usuario(s); primero asígnales otro rol.` : "Esta acción no se puede deshacer.", confirmText: "Sí, eliminar", cancelText: "No, cancelar", tone: "danger" });
    if (!ok) return;
    try { await deleteRoleRequest(role.id); await load(); void notifySuccess(`Rol ${role.nombre} eliminado.`); } catch (reason) { void notifyError(reason, "No fue posible eliminar el rol."); }
  }

  const levelStyle = (level: Level) => level === "EDITAR" ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/30" : level === "VER" ? "border-blue-400 bg-blue-50 ring-2 ring-blue-400/20" : "border-slate-200 bg-white opacity-70 hover:opacity-100";

  return (
    <AdminLayout title="Roles y permisos" subtitle="Crea roles como Contador o Junta directiva y elige qué módulos ve cada uno."
      actions={!draft ? <Button type="button" onClick={() => { setDraft({ ...EMPTY, color: colors[0] ?? EMPTY.color }); setError(""); }}><Plus className="size-4" />Nuevo rol</Button> : null}>
      {loading ? <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" />Cargando roles…</p> : draft ? (
        <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
          <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            {!draft.id ? (
              <div>
                <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-700"><Sparkles className="size-4 text-amber-500" />Empieza con una plantilla</p>
                <div className="mt-2 flex flex-wrap gap-2">{TEMPLATES.map((template) => (
                  <button key={template.nombre} type="button" onClick={() => setDraft({ ...template, permisos: { ...template.permisos } })}
                    className="rounded-full border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-400"><span className="mr-1.5 inline-block size-2.5 rounded-full" style={{ background: template.color }} />{template.nombre}</button>
                ))}</div>
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-700">Nombre del rol<Input aria-label="Nombre del rol" className="mt-1.5" maxLength={50} value={draft.nombre} onChange={(e) => setDraft({ ...draft, nombre: e.target.value })} placeholder="Ej. Contador" /></label>
              <label className="text-sm font-medium text-slate-700">Para qué sirve<Input aria-label="Descripción del rol" className="mt-1.5" maxLength={200} value={draft.descripcion} onChange={(e) => setDraft({ ...draft, descripcion: e.target.value })} placeholder="Ej. Revisa pagos y reportes" /></label>
              <div className="sm:col-span-2"><p className="text-sm font-medium text-slate-700">Color</p><div className="mt-1.5 flex gap-2">{colors.map((color) => (
                <button key={color} type="button" aria-label={`Color ${color}`} onClick={() => setDraft({ ...draft, color })} className="grid size-8 place-items-center rounded-full ring-offset-2 transition" style={{ background: color, boxShadow: draft.color === color ? `0 0 0 2px white, 0 0 0 4px ${color}` : undefined }}>{draft.color === color ? <Check className="size-4 text-white" /> : null}</button>
              ))}</div></div>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-700">¿Qué puede ver y hacer?</p>
              <p className="text-xs text-slate-500">Toca una tarjeta para cambiar: <b>sin acceso</b> → <b className="text-blue-600">solo ver</b> → <b className="text-emerald-600">ver y editar</b>.</p>
              <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">{modules.map((module) => {
                const level = draft.permisos[module.id] ?? "NINGUNO";
                const meta = ROLE_MODULE_META[module.id] ?? { emoji: "•", hint: "" };
                return (
                  <button key={module.id} type="button" aria-label={`${module.label}: ${level === "NINGUNO" ? "sin acceso" : level === "VER" ? "solo ver" : "ver y editar"}`}
                    onClick={() => setLevel(module.id, module.solo_lectura && level === "VER" ? "NINGUNO" : NEXT[level])}
                    className={`relative rounded-2xl border p-3 text-left transition ${levelStyle(level)}`}>
                    <span className="text-2xl" aria-hidden>{meta.emoji}</span>
                    <span className="mt-1 block text-sm font-semibold text-slate-900">{module.label}</span>
                    <span className="block text-xs text-slate-500">{meta.hint}</span>
                    <span className={`absolute right-2.5 top-2.5 rounded-full px-2 py-0.5 text-[10px] font-bold ${level === "EDITAR" ? "bg-emerald-600 text-white" : level === "VER" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"}`}>
                      {level === "EDITAR" ? "Editar" : level === "VER" ? (module.solo_lectura ? "Ver (solo lectura)" : "Ver") : "Sin acceso"}
                    </span>
                  </button>
                );
              })}</div>
            </div>
            {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={saving} onClick={() => setDraft(null)}>Cancelar</Button><Button type="button" disabled={saving} onClick={() => void save()}>{saving ? "Guardando…" : draft.id ? "Guardar cambios" : "Crear rol"}</Button></div>
          </section>
          <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:sticky xl:top-6">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><Eye className="size-3.5" />Así verá su menú</p>
            <div className="mt-3 flex items-center gap-2 rounded-xl p-2.5 text-white" style={{ background: draft.color }}><ShieldCheck className="size-5" /><span className="truncate font-semibold">{draft.nombre || "Nuevo rol"}</span></div>
            <ul className="mt-3 space-y-1">{chosen.length === 0 ? <li className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-xs text-slate-400">Aún no eligió módulos</li> : chosen.map((module) => (
              <li key={module.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"><span aria-hidden>{ROLE_MODULE_META[module.id]?.emoji}</span><span className="flex-1 truncate">{module.label}</span>{draft.permisos[module.id] === "VER" ? <Eye className="size-3.5 text-blue-500" /> : <Pencil className="size-3.5 text-emerald-600" />}</li>
            ))}</ul>
            <p className="mt-3 text-xs text-slate-500">Respaldos, restauraciones y la gestión de roles quedan siempre reservados al administrador principal.</p>
          </aside>
        </div>
      ) : roles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <ShieldCheck className="mx-auto size-10 text-slate-300" />
          <p className="mt-2 font-semibold text-slate-800">Aún no hay roles personalizados</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">Crea un rol como Contador o Junta directiva, elige qué módulos ve y asígnalo a una persona desde Usuarios.</p>
          <Button type="button" className="mt-4" onClick={() => setDraft({ ...EMPTY, color: colors[0] ?? EMPTY.color })}><Plus className="size-4" />Crear el primer rol</Button>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{roles.map((role) => (
          <li key={role.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="h-1.5" style={{ background: role.color }} />
            <div className="p-4">
              <div className="flex items-start justify-between gap-2"><div><p className="text-lg font-bold text-slate-900">{role.nombre}</p>{role.descripcion ? <p className="text-sm text-slate-500">{role.descripcion}</p> : null}</div>
                <Link to="/admin/usuarios" className="flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200"><Users className="size-3.5" />{role.usuarios}</Link></div>
              <div className="mt-3 flex flex-wrap gap-1.5">{Object.entries(role.permisos).map(([module, level]) => (
                <span key={module} className={`rounded-full px-2 py-0.5 text-xs font-medium ${level === "EDITAR" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"}`}>{ROLE_MODULE_META[module]?.emoji} {modules.find((m) => m.id === module)?.label ?? module}</span>
              ))}</div>
              <div className="mt-4 flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => { setDraft({ id: role.id, nombre: role.nombre, descripcion: role.descripcion ?? "", color: role.color, permisos: { ...role.permisos } }); setError(""); }}><Pencil className="size-3.5" />Editar</Button>
                <Button type="button" size="sm" variant="ghost" className="text-rose-600 hover:bg-rose-50" aria-label={`Eliminar ${role.nombre}`} onClick={() => void remove(role)}><Trash2 className="size-3.5" /></Button></div>
            </div>
          </li>
        ))}</ul>
      )}
    </AdminLayout>
  );
}
