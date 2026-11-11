import { useEffect, useState } from "react";
import { AlertTriangle, Clock, Siren } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { requestEmergencyAccessRequest } from "@/services/visitsService";
import type { VisitScheduleConfig } from "@/types/configuration";
import { notifyError, notifySuccess } from "@/utils/feedback";
import {
  formatVisitScheduleSummary,
  getVisitScheduleNotice,
  validateVisitTimesAgainstSchedule,
} from "@/utils/visitSchedule";

type VisitDraft = {
  nombre: string;
  dpi?: string;
  placa?: string;
  tipo_visita?: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
};

/**
 * Paso de horario de la visita: muestra las reglas antes de elegir, avisa en vivo si
 * el horario elegido no se puede autorizar y ofrece pedir un acceso de emergencia.
 */
export function VisitScheduleGuide({ schedule, draft, onEmergencySent }: { schedule: VisitScheduleConfig | null; draft: VisitDraft; onEmergencySent?: () => void }) {
  const [open, setOpen] = useState(false);
  if (!schedule) return null;

  const notice = getVisitScheduleNotice(draft.fecha, schedule);
  const problem = draft.hora_inicio && draft.hora_fin ? validateVisitTimesAgainstSchedule(draft.hora_inicio, draft.hora_fin, schedule) : null;
  const highlight = Boolean(notice || problem);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>
          <span className="font-semibold">Horario de visitas:</span> {formatVisitScheduleSummary(schedule)}. Las visitas no pueden pasar de la medianoche.
        </p>
      </div>

      {[notice, problem].filter((text, index, all): text is string => Boolean(text) && all.indexOf(text) === index).map((text) => (
        <div key={text} role="alert" className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{text}</p>
        </div>
      ))}

      <div className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm ${highlight ? "border-rose-200 bg-rose-50 text-rose-900" : "border-slate-200 bg-white text-slate-600"}`}>
        <p className="min-w-0 flex-1">
          ¿Es urgente y está fuera de horario? Envía una solicitud de emergencia: la administración la revisa y, al aprobarla, recibes el QR.
        </p>
        <Button type="button" variant={highlight ? "default" : "outline"} onClick={() => setOpen(true)} className={highlight ? "bg-rose-600 hover:bg-rose-700" : ""}>
          <Siren className="size-4" aria-hidden />
          Solicitar acceso de emergencia
        </Button>
      </div>

      <EmergencyAccessDialog open={open} onClose={() => setOpen(false)} draft={draft} onSent={onEmergencySent} />
    </div>
  );
}

export function EmergencyAccessDialog({ open, onClose, draft, onSent }: { open: boolean; onClose: () => void; draft: VisitDraft; onSent?: () => void }) {
  const [values, setValues] = useState({ fecha: draft.fecha, hora_inicio: draft.hora_inicio, hora_fin: draft.hora_fin, motivo: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setValues({ fecha: draft.fecha, hora_inicio: draft.hora_inicio, hora_fin: draft.hora_fin > draft.hora_inicio ? draft.hora_fin : "23:59", motivo: "" });
      setError("");
    }
  }, [open, draft.fecha, draft.hora_inicio, draft.hora_fin]);

  async function submit() {
    if (!draft.nombre.trim() || (!draft.dpi && !draft.placa)) {
      setError("Primero completa el nombre y el DPI del visitante en el paso 1.");
      return;
    }
    if (!values.fecha || !values.hora_inicio || !values.hora_fin) {
      setError("Indica la fecha y el horario del ingreso.");
      return;
    }
    if (values.hora_fin <= values.hora_inicio) {
      setError("La hora de fin debe ser posterior a la de inicio (el mismo día).");
      return;
    }
    if (!values.motivo.trim()) {
      setError("Explica brevemente el motivo de la emergencia.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await requestEmergencyAccessRequest({
        nombre: draft.nombre,
        dpi: draft.dpi || undefined,
        placa: draft.placa || undefined,
        tipo_visita: draft.tipo_visita || "VISITA",
        fecha: values.fecha,
        hora_inicio: values.hora_inicio,
        hora_fin: values.hora_fin,
        motivo_excepcion: values.motivo.trim(),
      });
      onClose();
      onSent?.();
      void notifySuccess("Solicitud de emergencia enviada. La administración y la garita fueron notificadas; te avisaremos cuando se apruebe y el QR aparecerá en tus visitas.", "Solicitud enviada");
    } catch (requestError) {
      void notifyError(requestError, "No fue posible enviar la solicitud de emergencia.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value && !busy) onClose(); }}>
      <DialogContent className="max-h-[92dvh] w-[calc(100%-1rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Solicitar acceso de emergencia</DialogTitle>
          <DialogDescription>
            Para ingresos urgentes fuera del horario de visitas. La administración debe aprobarla; mientras tanto no se genera QR. En emergencias médicas, bomberos o policía, la garita da paso sin esperar la aprobación.
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
          Visitante: <strong>{draft.nombre || "sin nombre"}</strong>{draft.dpi ? ` · DPI ${draft.dpi}` : ""}{draft.placa ? ` · Placa ${draft.placa}` : ""}
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">Fecha<Input type="date" value={values.fecha} onChange={(e) => setValues({ ...values, fecha: e.target.value })} /></label>
          <label className="text-sm">Desde<Input type="time" value={values.hora_inicio} onChange={(e) => setValues({ ...values, hora_inicio: e.target.value })} /></label>
          <label className="text-sm">Hasta<Input type="time" value={values.hora_fin} onChange={(e) => setValues({ ...values, hora_fin: e.target.value })} /></label>
        </div>
        <label className="block text-sm">
          Motivo de la emergencia
          <textarea
            value={values.motivo}
            maxLength={200}
            onChange={(e) => setValues({ ...values, motivo: e.target.value })}
            placeholder="Ej. Fuga de agua, viene el fontanero"
            className="mt-1 min-h-24 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-300"
          />
        </label>
        {error ? <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancelar</Button>
          <Button type="button" disabled={busy} onClick={() => void submit()} className="bg-rose-600 hover:bg-rose-700">
            {busy ? "Enviando…" : "Enviar solicitud"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
