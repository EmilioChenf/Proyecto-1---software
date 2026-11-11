import { useEffect, useState } from "react";
import { BellRing, Download, Share, Smartphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { canPromptInstall, disablePush, enablePush, getPushState, isIos, isStandalone, onPwaChange, promptInstall } from "@/pwa/pwa";
import { notifyError, notifySuccess } from "@/utils/feedback";

type PushState = Awaited<ReturnType<typeof getPushState>> | "cargando";

/** Instalar la app en el celular y activar avisos push en este dispositivo. */
export function AppDeviceCard() {
  const [installable, setInstallable] = useState(canPromptInstall());
  const [push, setPush] = useState<PushState>("cargando");
  const [busy, setBusy] = useState(false);
  const installed = isStandalone();

  useEffect(() => onPwaChange(() => setInstallable(canPromptInstall())), []);
  useEffect(() => { getPushState().then(setPush).catch(() => setPush("no-configurado")); }, []);

  async function togglePush() {
    setBusy(true);
    try {
      if (push === "activo") { await disablePush(); setPush("inactivo"); void notifySuccess("Ya no recibirás avisos en este dispositivo."); }
      else { await enablePush(); setPush("activo"); void notifySuccess("Listo: recibirás avisos aunque la app esté cerrada."); }
    } catch (reason) { void notifyError(reason, "No fue posible cambiar los avisos."); } finally { setBusy(false); }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-blue-50 to-white p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-blue-600 text-white"><Smartphone className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-slate-900">Tu residencial en el celular</h2>
          <p className="text-sm text-slate-600">Instala la app en la pantalla de inicio y recibe avisos de visitas, pagos y comunicados al instante.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {installed ? <span className="rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-800">App instalada en este dispositivo</span>
              : installable ? <Button type="button" onClick={() => void promptInstall()}><Download className="size-4" />Instalar app</Button>
              : isIos() ? <p className="flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">En iPhone: toca <Share className="size-3.5" /> Compartir y luego “Agregar a inicio”.</p>
              : <p className="rounded-xl bg-white px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">Abre el menú del navegador y elige “Instalar app” o “Agregar a la pantalla de inicio”.</p>}
            {push === "activo" || push === "inactivo" ? (
              <Button type="button" variant={push === "activo" ? "outline" : "default"} disabled={busy} onClick={() => void togglePush()}><BellRing className="size-4" />{push === "activo" ? "Desactivar avisos aquí" : "Activar avisos en este dispositivo"}</Button>
            ) : push === "bloqueado" ? <p className="text-xs text-amber-700">Bloqueaste las notificaciones: actívalas en la configuración del navegador.</p>
              : push === "no-soportado" ? <p className="text-xs text-slate-500">{isIos() ? "En iPhone, los avisos funcionan después de instalar la app (iOS 16.4 o superior)." : "Este navegador no admite avisos push."}</p> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
