import { useEffect, useState, type FormEvent } from "react";
import { Filter, ShieldCheck } from "lucide-react";

import { AdminLayout } from "@/components/admin/AdminLayout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAuditLogsRequest } from "@/services/auditService";
import type { AuditFilters, AuditRecord } from "@/types/audit";
import { formatUtcTimestamp } from "@/utils/guatemalaTime";

const actions = [
  ["", "Todas las acciones"],
  ["USER_CREATED", "Usuario creado"],
  ["USER_UPDATED", "Usuario actualizado"],
  ["USER_DELETED", "Usuario eliminado"],
  ["SESSION_REVOKED", "Sesion cerrada"],
  ["PASSWORD_RESET", "Contrasena recuperada"],
  ["PASSWORD_CHANGED", "Contrasena cambiada por el usuario"],
  ["VISIT_SCHEDULE_UPDATED", "Horario de visitas actualizado"],
  ["GENERAL_CONFIGURATION_UPDATED", "Configuracion general actualizada"],
  ["HOUSE_CREATED", "Vivienda creada"],
  ["HOUSE_UPDATED", "Vivienda actualizada"],
  ["HOUSE_ACTIVATED", "Vivienda activada"],
  ["HOUSE_DEACTIVATED", "Vivienda desactivada"],
  ["VISIT_ENTRY_REGISTERED", "Ingreso de visita registrado"],
  ["VISIT_EXIT_REGISTERED", "Salida de visita registrada"],
];

function formatData(value: Record<string, unknown> | null) {
  return value ? JSON.stringify(value, null, 2) : "Sin datos";
}

export function AdminAuditView() {
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [filters, setFilters] = useState<AuditFilters>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(nextFilters: AuditFilters = filters) {
    try {
      setLoading(true);
      setError("");
      setRecords(await getAuditLogsRequest(nextFilters));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible cargar la auditoria.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load({}); }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(filters);
  }

  return (
    <AdminLayout title="Auditoria de operaciones" subtitle="Consulta quien realizo cambios sensibles, cuando ocurrieron y que informacion fue modificada.">
      <form className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-5" onSubmit={submit}>
        <Input aria-label="Id de usuario" inputMode="numeric" placeholder="Id de usuario" value={filters.userId || ""} onChange={(event) => setFilters((current) => ({ ...current, userId: event.target.value }))} />
        <select aria-label="Accion" className="h-11 rounded-md border border-slate-200 bg-white px-3 text-sm" value={filters.action || ""} onChange={(event) => setFilters((current) => ({ ...current, action: event.target.value }))}>
          {actions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <Input aria-label="Desde" type="date" value={filters.from || ""} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} />
        <Input aria-label="Hasta" type="date" value={filters.to || ""} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} />
        <Button type="submit" disabled={loading}><Filter className="size-4" /> Aplicar filtros</Button>
      </form>

      {error ? <Alert variant="destructive" className="mt-4"><AlertTitle>Error de auditoria</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}

      <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4"><ShieldCheck className="size-5 text-blue-700" /><h2 className="font-semibold text-slate-950">Registros ({records.length})</h2></div>
        {loading ? <p className="p-8 text-center text-sm text-slate-500">Cargando registros...</p> : null}
        {!loading && records.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">No hay operaciones para los filtros seleccionados.</p> : null}
        <div className="divide-y divide-slate-100">
          {records.map((record) => (
            <article key={record.id_auditoria} className="grid gap-3 p-5 lg:grid-cols-[180px_220px_minmax(0,1fr)]">
              <div><p className="text-xs text-slate-500">{formatUtcTimestamp(record.creado_en)}</p><p className="mt-1 text-sm font-semibold text-blue-700">{record.accion}</p></div>
              <div><p className="text-sm font-semibold text-slate-900">{record.usuario_nombre || "Sistema"}</p><p className="text-xs text-slate-500">{record.usuario_correo || `Usuario #${record.id_usuario || "-"}`}</p><p className="mt-1 text-xs text-slate-500">{record.entidad} {record.entidad_id ? `#${record.entidad_id}` : ""}</p></div>
              <details className="rounded-xl bg-slate-50 p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-700">Ver cambios</summary><div className="mt-3 grid gap-3 md:grid-cols-2"><div><p className="text-xs font-semibold uppercase text-slate-500">Anterior</p><pre className="mt-1 overflow-auto whitespace-pre-wrap text-xs text-slate-700">{formatData(record.datos_anteriores)}</pre></div><div><p className="text-xs font-semibold uppercase text-slate-500">Nuevo</p><pre className="mt-1 overflow-auto whitespace-pre-wrap text-xs text-slate-700">{formatData(record.datos_nuevos)}</pre></div></div></details>
            </article>
          ))}
        </div>
      </section>
    </AdminLayout>
  );
}
