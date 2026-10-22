import { AlertCircle } from "lucide-react";

import { cn } from "./utils";

/**
 * HU-C02: error de un campo, junto al propio campo. Icono + texto (no solo color).
 * El campo debe declarar aria-invalid y aria-describedby={id} para que el lector de
 * pantalla anuncie el mensaje al enfocarlo.
 */
export function FieldError({ id, message, className }: { id: string; message?: string | null; className?: string }) {
  if (!message) return null;
  return (
    <p id={id} data-slot="field-error" className={cn("mt-1.5 flex items-start gap-1.5 text-sm font-medium text-red-600", className)}>
      <AlertCircle className="mt-0.5 size-4 flex-none" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}

/** Clases para marcar un control nativo (select, textarea) como invalido, igual que Input. */
export const invalidControlClassName =
  "aria-invalid:border-red-500 aria-invalid:bg-red-50/40 aria-invalid:ring-[3px] aria-invalid:ring-red-500/15";
