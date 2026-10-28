import { useEffect, useState, useSyncExternalStore } from "react";
import { CheckCircle2, CircleAlert, Info, TriangleAlert, X } from "lucide-react";

import { dismissToast, toastStore, type ToastMessage } from "@/utils/toastStore";

const themes = {
  success: { icon: CheckCircle2, color: "border-emerald-300 text-emerald-900", label: "Éxito" },
  error: { icon: CircleAlert, color: "border-red-300 text-red-900", label: "Error" },
  warning: { icon: TriangleAlert, color: "border-amber-300 text-amber-900", label: "Atención" },
  info: { icon: Info, color: "border-blue-300 text-blue-900", label: "Información" },
};

function ActionToast({ toast }: { toast: ToastMessage }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const theme = themes[toast.tone];
  const Icon = theme.icon;
  useEffect(() => {
    if (hovered || focused) return;
    const timer = window.setTimeout(() => dismissToast(toast.id), toast.tone === "success" ? 4500 : 8000);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.tone, hovered, focused]);

  return (
    <div
      role={toast.tone === "error" ? "alert" : "status"}
      aria-atomic="true"
      className={`pointer-events-auto flex items-start gap-3 rounded-xl border bg-white p-4 shadow-xl ${theme.color}`}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    >
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 break-words text-sm">
        <p className="font-semibold">{toast.title || theme.label}</p>
        <p className="mt-1">{toast.message}</p>
      </div>
      <button type="button" aria-label="Cerrar notificación" className="-m-2 flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600" onClick={() => dismissToast(toast.id)}>
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Mounted above the router so feedback survives redirects for every role. */
export function ActionToasts() {
  const messages = useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot);
  return (
    <section aria-label="Notificaciones de acciones" className="pointer-events-none fixed right-3 top-3 z-[11000] grid max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] max-w-sm gap-3 overflow-y-auto sm:right-5 sm:top-5">
      {messages.map((toast) => <ActionToast key={toast.id} toast={toast} />)}
    </section>
  );
}
