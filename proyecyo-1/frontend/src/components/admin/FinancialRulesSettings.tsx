import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/services/api";
import {GlobalMaintenanceSettings} from './GlobalMaintenanceSettings';

type Rule = {
  dia_limite: number;
  tipo: "PORCENTAJE" | "FIJO";
  porcentaje: number;
  monto_fijo: number;
  dias_gracia: number;
  activo: boolean;
  vigente_desde: string;
};

type ApplyResult = { aplicados: number; activo?: boolean; fecha_revision?: string };

const initial: Rule = { dia_limite: 10, tipo: "PORCENTAJE", porcentaje: 5, monto_fijo: 0, dias_gracia: 0, activo: true, vigente_desde: "2026-01-01" };

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function FinancialRulesSettings() {
  const [rule, setRule] = useState(initial);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingApply, setConfirmingApply] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [applyError, setApplyError] = useState("");

  useEffect(() => {
    apiRequest<Rule>("/admin/configuracion-financiera").then(setRule).catch((e) => setMessage(errorText(e, "No fue posible cargar la regla.")));
  }, []);

  async function save() {
    try {
      setBusy(true);
      setRule(await apiRequest<Rule>("/admin/configuracion-financiera", { method: "PUT", body: rule }));
      setMessage("Configuración financiera guardada.");
    } catch (e) {
      setMessage(errorText(e, "Error"));
    } finally {
      setBusy(false);
    }
  }

  // HU32: aplicacion manual y explicita de recargos (no hay scheduler automatico).
  async function applySurcharges() {
    try {
      setApplying(true);
      setApplyError("");
      setApplyResult(await apiRequest<ApplyResult>("/admin/recargos/aplicar", { method: "POST" }));
    } catch (e) {
      setApplyError(errorText(e, "No fue posible aplicar los recargos."));
    } finally {
      setApplying(false);
      setConfirmingApply(false);
    }
  }

  const surchargeDescription =
    rule.tipo === "PORCENTAJE" ? `${rule.porcentaje}% del capital pendiente` : `un monto fijo de Q${rule.monto_fijo.toFixed(2)}`;

  return (
    <><GlobalMaintenanceSettings/><section className="mb-5 rounded-[20px] border bg-white p-5">
      <h2 className="text-lg font-semibold">Fechas límite y recargos</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label className="text-sm">
          Día límite
          <Input aria-label="Día límite" type="number" min={1} max={28} value={rule.dia_limite} onChange={(e) => setRule({ ...rule, dia_limite: Number(e.target.value) })} />
        </label>
        <label className="text-sm">
          Tipo de recargo
          <select
            aria-label="Tipo de recargo"
            className="mt-1 h-11 w-full rounded-md border px-3"
            value={rule.tipo}
            onChange={(e) => setRule({ ...rule, tipo: e.target.value as Rule["tipo"], porcentaje: 0, monto_fijo: 0 })}
          >
            <option value="PORCENTAJE">Porcentaje</option>
            <option value="FIJO">Monto fijo</option>
          </select>
        </label>
        <label className="text-sm">
          {rule.tipo === "PORCENTAJE" ? "Porcentaje" : "Monto fijo"}
          <Input
            aria-label={rule.tipo === "PORCENTAJE" ? "Porcentaje" : "Monto fijo"}
            type="number"
            min={0}
            value={rule.tipo === "PORCENTAJE" ? rule.porcentaje : rule.monto_fijo}
            onChange={(e) =>
              rule.tipo === "PORCENTAJE"
                ? setRule({ ...rule, porcentaje: Number(e.target.value) })
                : setRule({ ...rule, monto_fijo: Number(e.target.value) })
            }
          />
        </label>
        <label className="text-sm">
          Días de gracia
          <Input aria-label="Días de gracia" type="number" min={0} max={90} value={rule.dias_gracia} onChange={(e) => setRule({ ...rule, dias_gracia: Number(e.target.value) })} />
        </label>
        <label className="text-sm">
          Vigente desde
          <Input aria-label="Vigente desde" type="date" value={rule.vigente_desde} onChange={(e) => setRule({ ...rule, vigente_desde: e.target.value })} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={rule.activo} onChange={(e) => setRule({ ...rule, activo: e.target.checked })} />
          Regla activa
        </label>
      </div>
      {message ? <p className="mt-3 text-sm">{message}</p> : null}
      <Button className="mt-4" disabled={busy} onClick={save}>Guardar regla</Button>

      <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50/60 p-4" aria-label="Aplicar recargos">
        <h3 className="text-base font-semibold text-slate-900">Aplicar recargos</h3>
        <p className="mt-1 text-sm text-slate-600">
          Registra un recargo de {surchargeDescription} en cada cuota vencida desde {rule.vigente_desde}, con más de{" "}
          {rule.dias_gracia} día{rule.dias_gracia === 1 ? "" : "s"} de gracia y capital pendiente. Usa la regla guardada en el
          servidor y la fecha de Guatemala. Cada cuota recibe como máximo un recargo: repetir la acción no los duplica. Los
          recargos no se aplican automáticamente.
        </p>
        {applyError ? <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{applyError}</p> : null}
        {applyResult ? (
          <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {applyResult.activo === false
              ? "La regla de recargos está desactivada: no se aplicó ningún recargo."
              : `Recargos aplicados: ${applyResult.aplicados}.`}
            {applyResult.fecha_revision ? ` Fecha de revisión: ${applyResult.fecha_revision}.` : ""}
          </p>
        ) : null}
        {confirmingApply ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-slate-800">¿Confirma que desea aplicar los recargos ahora?</p>
            <Button type="button" variant="destructive" disabled={applying} onClick={() => void applySurcharges()}>
              {applying ? "Aplicando..." : "Sí, aplicar recargos"}
            </Button>
            <Button type="button" variant="outline" disabled={applying} onClick={() => setConfirmingApply(false)}>Cancelar</Button>
          </div>
        ) : (
          <Button type="button" variant="outline" className="mt-3" onClick={() => { setApplyResult(null); setApplyError(""); setConfirmingApply(true); }}>
            Aplicar recargos
          </Button>
        )}
      </div>
    </section></>
  );
}
