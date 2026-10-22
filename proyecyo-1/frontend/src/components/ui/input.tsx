import * as React from "react";

import { cn } from "./utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground border-input flex h-11 w-full min-w-0 rounded-md border bg-input-background px-3 py-2 text-base outline-none transition-[color,box-shadow] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        // HU-C02: campo invalido (aria-invalid) con el mismo aspecto en toda la app.
        "aria-invalid:border-red-500 aria-invalid:bg-red-50/40 aria-invalid:ring-[3px] aria-invalid:ring-red-500/15",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
