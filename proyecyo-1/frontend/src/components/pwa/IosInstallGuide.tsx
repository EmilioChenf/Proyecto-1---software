import { createPortal } from "react-dom";
import { MoreHorizontal, PlusSquare, Share, X } from "lucide-react";

const STEPS = [
  { icon: MoreHorizontal, title: "Toca los tres puntos •••", text: "Están abajo a la derecha, junto a la barra de la dirección. En versiones anteriores de Safari, toca directo el botón Compartir." },
  { icon: Share, title: "Toca “Compartir”", text: "Es el cuadro con una flecha hacia arriba." },
  { icon: PlusSquare, title: "Toca “Agregar a inicio”", text: "Si no lo ves, desliza hacia abajo o toca “Ver más”." },
  { icon: null, title: "Toca “Agregar”", text: "Listo: aparece el ícono Nexus en tu pantalla de inicio. Ábrela desde ahí y activa los avisos." },
];

/** Guía visual para instalar la app en iPhone (Apple no permite instalarla con un botón de la página). */
export function IosInstallGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  // Portal al body: dentro de tarjetas con animación, "fixed" quedaría recortado.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/50 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-label="Cómo instalar la app en iPhone" className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-8 shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Instalar en iPhone</h2>
            <p className="text-sm text-slate-500">Apple solo permite instalarla desde Safari, en 4 toques:</p>
          </div>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="rounded-lg p-1 text-slate-400"><X className="size-5" /></button>
        </div>
        <ol className="mt-4 space-y-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-3 rounded-2xl bg-slate-50 p-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-blue-600 text-sm font-bold text-white">{index + 1}</span>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 font-semibold text-slate-900">{step.icon ? <step.icon className="size-4 text-blue-600" aria-hidden /> : null}{step.title}</p>
                <p className="text-sm text-slate-600">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-slate-500">Debe ser en Safari (o Chrome en iOS 16.4 o superior). Los avisos funcionan solo con la app abierta desde el ícono de inicio.</p>
        <button type="button" onClick={onClose} className="mt-4 w-full rounded-xl bg-slate-900 py-3 font-semibold text-white">Entendido</button>
      </div>
    </div>,
    document.body,
  );
}
