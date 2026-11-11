import { useEffect, useState } from "react";
import { ArrowRight, Rocket } from "lucide-react";
import { Link } from "react-router-dom";

import { getSetupStatusRequest, type SetupStatus } from "@/services/setupService";

/** Aviso en el panel mientras falta configurar el residencial . */
export function SetupBanner() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  // Un rol personalizado sin acceso a Configuración recibe 403 y simplemente no ve el aviso.
  useEffect(() => { getSetupStatusRequest().then(setStatus).catch(() => undefined); }, []);
  if (!status || !Array.isArray(status.pasos) || status.oculto || status.completados === status.total) return null;
  const next = status.pasos.find((p) => !p.done);
  return (
    <Link to="/admin/primeros-pasos" className="mb-5 flex items-center gap-4 rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50 to-white p-4 transition hover:shadow-sm">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-blue-600 text-white"><Rocket className="size-5" /></span>
      <span className="min-w-0 flex-1"><span className="block font-semibold text-slate-900">Termina de configurar tu residencial · {status.completados} de {status.total}</span><span className="block text-sm text-slate-600">Siguiente: {next?.label}</span></span>
      <ArrowRight className="size-5 text-blue-600" />
    </Link>
  );
}
