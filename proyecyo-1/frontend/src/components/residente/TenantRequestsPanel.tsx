import { useFeedbackState } from "@/hooks/useFeedbackState";
import { useCallback, useEffect, useState } from "react";
import { Check, ShieldCheck, X } from "lucide-react";

import { notifySidebarCountersChanged } from "@/components/layout/sidebarCounters";
import { Button } from "@/components/ui/button";
import {
  getOwnerAuthorizationRequestsRequest,
  resolveOwnerAuthorizationRequest,
  getCompanyAuthorizationRequestsRequest,resolveCompanyAuthorizationRequest,
} from "@/services/sprintStoriesService";
import type { AuthorizationDecision, OwnerAuthorizationRequest } from "@/types/sprintStories";
import { formatUtcTimestamp } from "@/utils/guatemalaTime";

const statusStyles: Record<string, { label: string; className: string }> = {
  PENDIENTE: { label: "Pendiente", className: "bg-amber-50 text-amber-700" },
  APROBADO: { label: "Aprobada", className: "bg-emerald-50 text-emerald-700" },
  RECHAZADO: { label: "Rechazada", className: "bg-rose-50 text-rose-700" },
};

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Solicitudes de autorización enviadas por inquilinos de las unidades del
 * residente. El backend valida que la unidad pertenezca al residente.
 */
export function TenantRequestsPanel({company=false}:{company?:boolean}={}) {
  const [requests, setRequests] = useState<OwnerAuthorizationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useFeedbackState("error", "");
  const [actionError, setActionError] = useFeedbackState("error", "");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [lastResult, setLastResult] = useFeedbackState("success", "");

  const load = useCallback(async () => {
    try {
      setError("");
      setRequests(company?await getCompanyAuthorizationRequestsRequest():await getOwnerAuthorizationRequestsRequest("TODAS"));
    } catch (reason) {
      setError(errorText(reason, "No fue posible cargar las solicitudes de inquilinos."));
    } finally {
      setLoading(false);
    }
  }, [company]);

  useEffect(() => {
    void load();
  }, [load]);

  async function resolve(request: OwnerAuthorizationRequest, decision: AuthorizationDecision, respuesta = "") {
    try {
      setBusyId(request.id_solicitud);
      setActionError("");
      const updated = company?await resolveCompanyAuthorizationRequest(request.id_solicitud,decision,respuesta):await resolveOwnerAuthorizationRequest(request.id_solicitud, decision, respuesta);
      setRequests((current) => current.map((item) => (item.id_solicitud === updated.id_solicitud ? updated : item)));
      setRejectingId(null);
      setRejectReason("");
      setLastResult(`Solicitud "${updated.accion}" ${decision === "APROBADO" ? "aprobada" : "rechazada"}.`);
      notifySidebarCountersChanged();
    } catch (reason) {
      setActionError(errorText(reason, "No fue posible resolver la solicitud."));
      // Si otro dispositivo ya la resolvio, se refresca el estado real.
      void load();
    } finally {
      setBusyId(null);
    }
  }

  const pending = requests.filter((request) => request.estado === "PENDIENTE");
  const resolved = requests.filter((request) => request.estado !== "PENDIENTE").slice(0, 5);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Solicitudes de inquilinos">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-950">
          <ShieldCheck className="size-4 text-blue-600" aria-hidden="true" />
          Solicitudes de inquilinos
        </h2>
        {!loading && !error ? (
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700" aria-label={`${pending.length} solicitudes pendientes`}>
            {pending.length} pendiente{pending.length === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>
      <div className="space-y-3 p-5">
        {lastResult ? <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{lastResult}</p> : null}
        {actionError ? <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{actionError}</p> : null}
        {loading ? (
          <p className="py-4 text-center text-sm text-slate-500">Cargando solicitudes...</p>
        ) : error ? (
          <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>
        ) : pending.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-sm text-slate-500">
            No hay solicitudes pendientes de sus inquilinos.
          </p>
        ) : (
          <ul className="space-y-3">
            {pending.map((request) => {
              const busy = busyId === request.id_solicitud;
              const rejecting = rejectingId === request.id_solicitud;
              return (
                <li key={request.id_solicitud} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">{request.accion}</p>
                      <p className="mt-1 text-sm text-slate-600">{request.motivo}</p>
                      <p className="mt-1.5 text-xs text-slate-500">
                        {request.inquilino ?? "Inquilino"} · Unidad {request.unidad ?? "—"} · {formatUtcTimestamp(request.creado_en)}
                      </p>
                    </div>
                    {!rejecting ? (
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Button type="button" size="sm" disabled={busyId !== null} onClick={() => void resolve(request, "APROBADO")} aria-label={`Aprobar ${request.accion}`}>
                          <Check className="size-4" aria-hidden="true" />
                          Aprobar
                        </Button>
                        <Button type="button" size="sm" variant="outline" disabled={busyId !== null} onClick={() => { setRejectingId(request.id_solicitud); setRejectReason(""); }} aria-label={`Rechazar ${request.accion}`}>
                          <X className="size-4" aria-hidden="true" />
                          Rechazar
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  {rejecting ? (
                    <form
                      className="mt-3 space-y-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void resolve(request, "RECHAZADO", rejectReason.trim());
                      }}
                    >
                      <label className="block text-sm font-medium text-slate-700">
                        Motivo del rechazo
                        <textarea
                          className="mt-1 w-full rounded-md border border-slate-200 p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                          maxLength={255}
                          rows={2}
                          required
                          value={rejectReason}
                          onChange={(event) => setRejectReason(event.target.value)}
                        />
                      </label>
                      <div className="flex gap-2">
                        <Button type="submit" size="sm" variant="destructive" disabled={busy || !rejectReason.trim()}>
                          {busy ? "Guardando..." : "Confirmar rechazo"}
                        </Button>
                        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setRejectingId(null)}>
                          Cancelar
                        </Button>
                      </div>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {!loading && !error && resolved.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Resueltas recientemente</p>
            <ul className="divide-y divide-slate-100">
              {resolved.map((request) => (
                <li key={request.id_solicitud} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-slate-700">{request.accion} · {request.inquilino ?? "Inquilino"}</span>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs ${statusStyles[request.estado]?.className ?? "bg-slate-100 text-slate-600"}`}>
                    {statusStyles[request.estado]?.label ?? request.estado}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
