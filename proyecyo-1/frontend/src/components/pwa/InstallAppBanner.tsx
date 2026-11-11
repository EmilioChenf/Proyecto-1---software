import { useEffect, useState } from "react";
import { BellRing, Download, Share, X } from "lucide-react";

import { canPromptInstall, enablePush, getPushState, isIos, isStandalone, onPwaChange, promptInstall } from "@/pwa/pwa";
import { notifyError, notifySuccess } from "@/utils/feedback";

const DISMISS_KEY = "nexus.app-banner-oculto";
const readDismissed = () => { try { return window.localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; } };

/**
 * Aviso visible arriba de cada pantalla: instalar la app en el celular y activar avisos push.
 * Solo aparece cuando hay algo que hacer en este dispositivo y se puede ocultar.
 */
export function InstallAppBanner() {
  const [dismissed, setDismissed] = useState(readDismissed);
  const [installable, setInstallable] = useState(canPromptInstall());
  const [push, setPush] = useState<string>("cargando");
  const [busy, setBusy] = useState(false);
  const installed = isStandalone();

  useEffect(() => onPwaChange(() => setInstallable(canPromptInstall())), []);
  useEffect(() => { if (!dismissed) getPushState().then(setPush).catch(() => setPush("no-configurado")); }, [dismissed]);

  const showInstall = !installed && (installable || isIos());
  const showPush = push === "inactivo";
  if (dismissed || (!showInstall && !showPush)) return null;

  function hide() {
    try { window.localStorage.setItem(DISMISS_KEY, "1"); } catch { /* sin almacenamiento: se oculta solo en esta visita */ }
    setDismissed(true);
  }

  async function activate() {
    setBusy(true);
    try { await enablePush(); setPush("activo"); void notifySuccess("Listo: recibirás avisos aunque la app esté cerrada."); }
    catch (reason) { void notifyError(reason, "No fue posible activar los avisos."); }
    finally { setBusy(false); }
  }

  return (
    <div role="region" aria-label="Instalar la app" className="flex flex-wrap items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
      <span className="text-xl" aria-hidden>📱</span>
      <p className="min-w-0 flex-1 font-medium">
        {showInstall && isIos() && !installable
          ? <>Instala la app: toca <Share className="inline size-4 align-text-bottom" /> <b>Compartir</b> y luego <b>“Agregar a inicio”</b>.</>
          : showInstall ? "Instala la app en tu celular para entrar con un toque." : "Activa los avisos para enterarte al instante de visitas, pagos y comunicados."}
      </p>
      {showInstall && installable ? <button type="button" onClick={() => void promptInstall()} className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 font-semibold text-white"><Download className="size-4" />Instalar app</button> : null}
      {showPush ? <button type="button" disabled={busy} onClick={() => void activate()} className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 font-semibold text-white disabled:opacity-60"><BellRing className="size-4" />Activar avisos</button> : null}
      <button type="button" onClick={hide} aria-label="Ocultar aviso de la app" className="rounded-lg p-1 text-blue-700 hover:bg-blue-100"><X className="size-4" /></button>
    </div>
  );
}
