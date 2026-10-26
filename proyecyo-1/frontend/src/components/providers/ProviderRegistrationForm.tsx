import { useEffect, useState } from "react";
import { BriefcaseBusiness } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError, invalidControlClassName } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/services/api";
import { registerProviderRequest } from "@/services/providersService";
import type {
  ProviderRegistrationPayload,
  ProviderRegistrationResult,
  ProviderRegistrationRole,
} from "@/types/providers";
import { confirmAction } from "@/utils/feedback";
import { guatemalaToday } from "@/utils/guatemalaTime";
import {
  getPastVisitWindowErrors,
  getProviderIdentifierErrors,
  guatemalaCurrentTime,
  normalizeDpi,
  providerEntryModeLabels,
  type ProviderEntryMode,
} from "@/utils/providerAccess";
import { normalizeVehiclePlate } from "@/utils/vehiclePlate";

export interface ProviderHouseOption {
  id_casa: number;
  etiqueta: string;
}

type FormField = keyof Omit<ProviderRegistrationPayload, "confirmar_actualizacion">;
type FormErrors = Partial<Record<FormField, string>>;

interface ProviderRegistrationFormProps {
  role: ProviderRegistrationRole;
  /** Casas seleccionables (admin y propietario con varias unidades). */
  houses?: ProviderHouseOption[];
  /** Unidad fija del inquilino, solo informativa. */
  fixedHouseLabel?: string;
  /** Guarda un borrador local del formulario mientras se completa. */
  storageKey?: string;
  description?: string;
  onRegistered?: (result: ProviderRegistrationResult) => void | Promise<void>;
}

function addHours(time: string, hours: number) {
  const [h, m] = time.split(":").map(Number);
  const total = Math.min(h * 60 + m + hours * 60, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function createInitialForm(houseId?: number): ProviderRegistrationPayload {
  const start = guatemalaCurrentTime();
  return {
    nombre: "",
    motivo_servicio: "",
    medio_ingreso: "VEHICULO",
    placa: "",
    dpi: "",
    fecha: guatemalaToday(),
    hora_inicio: start,
    hora_fin: addHours(start, 2),
    observaciones: "",
    id_casa: houseId,
  };
}

function readDraft(storageKey?: string): Partial<ProviderRegistrationPayload> {
  if (!storageKey) return {};
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as Partial<ProviderRegistrationPayload>) : {};
  } catch {
    return {};
  }
}

/** HU-C06: validaciones visibles antes de enviar, alineadas con el backend. */
export function validateProviderForm(form: ProviderRegistrationPayload, { requireHouse = false } = {}): FormErrors {
  const errors: FormErrors = {};

  if (!form.nombre.trim()) errors.nombre = "El nombre del proveedor es obligatorio.";
  if (!form.motivo_servicio.trim()) errors.motivo_servicio = "Indica el servicio que realizara el proveedor.";
  if (requireHouse && !form.id_casa) errors.id_casa = "Selecciona la casa a la que ingresara el proveedor.";

  Object.assign(errors, getProviderIdentifierErrors(form));

  if (!form.fecha) errors.fecha = "La fecha es obligatoria.";
  if (!form.hora_inicio) errors.hora_inicio = "La hora de inicio es obligatoria.";
  if (!form.hora_fin) errors.hora_fin = "La hora de fin es obligatoria.";

  if (form.hora_inicio && form.hora_fin && form.hora_inicio >= form.hora_fin) {
    errors.hora_fin = "La hora de fin debe ser mayor a la hora de inicio.";
  }

  if (!errors.fecha && !errors.hora_inicio && !errors.hora_fin) {
    Object.assign(errors, getPastVisitWindowErrors(form.fecha, form.hora_inicio, form.hora_fin));
  }

  if ((form.observaciones || "").length > 255) {
    errors.observaciones = "Las observaciones no pueden superar 255 caracteres.";
  }

  return errors;
}

/** Codigo de error del backend (VISITOR_DATA_CONFLICT, PROVIDER_PLATE_REQUIRED, ...). */
function getErrorCode(error: unknown) {
  if (error instanceof ApiError && error.payload && typeof error.payload === "object") {
    return (error.payload as { code?: string }).code;
  }
  return undefined;
}

const fieldByErrorCode: Record<string, FormField> = {
  PROVIDER_PLATE_REQUIRED: "placa",
  INVALID_VEHICLE_PLATE: "placa",
  PROVIDER_DOCUMENT_REQUIRED: "dpi",
  INVALID_DPI: "dpi",
  VISIT_DATE_IN_PAST: "fecha",
  VISIT_TIME_IN_PAST: "hora_inicio",
  VISIT_WINDOW_EXPIRED: "hora_fin",
};

export function ProviderRegistrationForm({
  role,
  houses = [],
  fixedHouseLabel,
  storageKey,
  description = "Autoriza un proveedor para ingresar con fecha y horario definidos. Se genera su QR al registrarlo.",
  onRegistered,
}: ProviderRegistrationFormProps) {
  const requireHouse = role === "admin" || houses.length > 1;
  const [form, setForm] = useState<ProviderRegistrationPayload>(() => ({
    ...createInitialForm(houses[0]?.id_casa),
    ...readDraft(storageKey),
  }));
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!form.id_casa && houses[0]) {
      setForm((current) => ({ ...current, id_casa: houses[0].id_casa }));
    }
  }, [houses, form.id_casa]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(form));
    } catch {
      // El borrador es una comodidad; si el navegador lo bloquea el formulario sigue funcionando.
    }
  }, [form, storageKey]);

  function update<K extends keyof ProviderRegistrationPayload>(field: K, value: ProviderRegistrationPayload[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setSuccessMessage("");
  }

  function fieldProps(field: FormField) {
    return {
      "aria-invalid": Boolean(errors[field]) || undefined,
      "aria-describedby": errors[field] ? `provider-${field}-error` : undefined,
    };
  }

  async function submit(payload: ProviderRegistrationPayload) {
    try {
      setIsSubmitting(true);
      setFormError("");
      const result = await registerProviderRequest(role, {
        ...payload,
        placa: normalizeVehiclePlate(payload.placa),
        dpi: normalizeDpi(payload.dpi),
        id_casa: role === "inquilino" ? undefined : payload.id_casa,
      });
      setForm(createInitialForm(payload.id_casa));
      setErrors({});
      if (storageKey) window.localStorage.removeItem(storageKey);
      setSuccessMessage(
        `Proveedor ${result.proveedor?.nombre || payload.nombre} registrado. Su QR ya esta disponible en los accesos.`,
      );
      await onRegistered?.(result);
    } catch (error) {
      const code = getErrorCode(error);

      if (code === "VISITOR_DATA_CONFLICT" && !payload.confirmar_actualizacion) {
        const confirmed = await confirmAction({
          title: "Visitante existente",
          text: error instanceof Error ? error.message : "Ya existe un visitante con esos datos.",
          confirmText: "Actualizar y registrar",
          tone: "info",
        });
        if (confirmed) {
          await submit({ ...payload, confirmar_actualizacion: true });
        }
        return;
      }

      const message = error instanceof Error ? error.message : "No fue posible registrar el proveedor.";
      const field = code ? fieldByErrorCode[code] : undefined;
      if (field) setErrors((current) => ({ ...current, [field]: message }));
      setFormError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmit() {
    setSuccessMessage("");
    const nextErrors = validateProviderForm(form, { requireHouse });
    setErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      setFormError("Revisa los campos marcados antes de registrar el proveedor.");
      return;
    }

    await submit(form);
  }

  const controlClassName = "h-14 rounded-2xl border-slate-100 bg-slate-50 px-4";
  const selectClassName =
    "h-14 w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 text-sm outline-none focus:border-blue-300";
  const labelClassName = "block text-sm font-medium text-slate-800";

  return (
    <Card className="border-0 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-2xl text-slate-900">
          <BriefcaseBusiness className="size-6 text-blue-600" />
          Registrar proveedor
        </CardTitle>
        <CardDescription className="mt-2">{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {formError ? (
          <Alert variant="destructive">
            <AlertTitle>No se registro el proveedor</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
        {successMessage ? (
          <Alert className="border-emerald-200 bg-emerald-50 text-emerald-700">
            <AlertTitle>Proveedor registrado</AlertTitle>
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="provider-nombre" className={labelClassName}>Nombre del proveedor *</label>
            <Input
              id="provider-nombre"
              value={form.nombre}
              onChange={(event) => update("nombre", event.target.value)}
              placeholder="Ej. Mantenimiento Lopez"
              maxLength={100}
              className={controlClassName}
              {...fieldProps("nombre")}
            />
            <FieldError id="provider-nombre-error" message={errors.nombre} />
          </div>

          <div className="space-y-2">
            <label htmlFor="provider-motivo_servicio" className={labelClassName}>Servicio que realizara *</label>
            <Input
              id="provider-motivo_servicio"
              value={form.motivo_servicio}
              onChange={(event) => update("motivo_servicio", event.target.value)}
              placeholder="Ej. Reparacion electrica"
              maxLength={120}
              className={controlClassName}
              {...fieldProps("motivo_servicio")}
            />
            <FieldError id="provider-motivo_servicio-error" message={errors.motivo_servicio} />
          </div>

          {requireHouse ? (
            <div className="space-y-2">
              <label htmlFor="provider-id_casa" className={labelClassName}>Casa / unidad *</label>
              <select
                id="provider-id_casa"
                value={form.id_casa ?? ""}
                onChange={(event) => update("id_casa", Number(event.target.value) || undefined)}
                className={`${selectClassName} ${invalidControlClassName}`}
                {...fieldProps("id_casa")}
              >
                {houses.length === 0 ? <option value="">Sin casas disponibles</option> : null}
                {houses.map((house) => (
                  <option key={house.id_casa} value={house.id_casa}>
                    {house.etiqueta}
                  </option>
                ))}
              </select>
              <FieldError id="provider-id_casa-error" message={errors.id_casa} />
            </div>
          ) : fixedHouseLabel ? (
            <div className="space-y-2">
              <label htmlFor="provider-casa-fija" className={labelClassName}>Casa / unidad</label>
              <Input
                id="provider-casa-fija"
                value={fixedHouseLabel}
                readOnly
                className="h-14 rounded-2xl border-slate-100 bg-slate-100 px-4 text-slate-500"
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <label htmlFor="provider-medio_ingreso" className={labelClassName}>Medio de ingreso *</label>
            <select
              id="provider-medio_ingreso"
              value={form.medio_ingreso}
              aria-describedby="provider-medio_ingreso-hint"
              onChange={(event) => {
                update("medio_ingreso", event.target.value as ProviderEntryMode);
                setErrors((current) => ({ ...current, placa: undefined, dpi: undefined }));
              }}
              className={selectClassName}
            >
              {(Object.keys(providerEntryModeLabels) as ProviderEntryMode[]).map((mode) => (
                <option key={mode} value={mode}>
                  {providerEntryModeLabels[mode]}
                </option>
              ))}
            </select>
            <p id="provider-medio_ingreso-hint" className="text-xs text-slate-500">
              {form.medio_ingreso === "VEHICULO"
                ? "En vehículo la placa es obligatoria."
                : "A pie el DPI es obligatorio para identificarlo."}
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="provider-placa" className={labelClassName}>
              Placa {form.medio_ingreso === "VEHICULO" ? "*" : "(opcional)"}
            </label>
            <Input
              id="provider-placa"
              value={form.placa}
              onChange={(event) => update("placa", event.target.value.toUpperCase())}
              onBlur={() => update("placa", normalizeVehiclePlate(form.placa))}
              placeholder="P-123ABC"
              maxLength={14}
              className={controlClassName}
              {...fieldProps("placa")}
            />
            <FieldError id="provider-placa-error" message={errors.placa} />
          </div>

          <div className="space-y-2">
            <label htmlFor="provider-dpi" className={labelClassName}>
              DPI {form.medio_ingreso === "PEATONAL" ? "*" : "(opcional)"}
            </label>
            <Input
              id="provider-dpi"
              value={form.dpi}
              onChange={(event) => update("dpi", event.target.value)}
              placeholder="1234567890123"
              inputMode="numeric"
              maxLength={15}
              className={controlClassName}
              {...fieldProps("dpi")}
            />
            <FieldError id="provider-dpi-error" message={errors.dpi} />
          </div>

          <div className="space-y-2">
            <label htmlFor="provider-fecha" className={labelClassName}>Fecha *</label>
            <Input
              id="provider-fecha"
              type="date"
              value={form.fecha}
              min={guatemalaToday()}
              onChange={(event) => update("fecha", event.target.value)}
              className={controlClassName}
              {...fieldProps("fecha")}
            />
            <FieldError id="provider-fecha-error" message={errors.fecha} />
          </div>

          <div className="space-y-2">
            <label htmlFor="provider-hora_inicio" className={labelClassName}>Hora de inicio *</label>
            <Input
              id="provider-hora_inicio"
              type="time"
              value={form.hora_inicio}
              onChange={(event) => update("hora_inicio", event.target.value)}
              className={controlClassName}
              {...fieldProps("hora_inicio")}
            />
            <FieldError id="provider-hora_inicio-error" message={errors.hora_inicio} />
          </div>

          <div className="space-y-2">
            <label htmlFor="provider-hora_fin" className={labelClassName}>Hora de fin *</label>
            <Input
              id="provider-hora_fin"
              type="time"
              value={form.hora_fin}
              onChange={(event) => update("hora_fin", event.target.value)}
              className={controlClassName}
              {...fieldProps("hora_fin")}
            />
            <FieldError id="provider-hora_fin-error" message={errors.hora_fin} />
          </div>

          <div className="space-y-2">
            <label htmlFor="provider-observaciones" className={labelClassName}>Observaciones</label>
            <Input
              id="provider-observaciones"
              value={form.observaciones || ""}
              onChange={(event) => update("observaciones", event.target.value)}
              placeholder="Ej. Trae herramientas grandes"
              maxLength={255}
              className={controlClassName}
              {...fieldProps("observaciones")}
            />
            <FieldError id="provider-observaciones-error" message={errors.observaciones} />
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting}
            className="h-12 rounded-2xl bg-blue-600 px-6 text-white hover:bg-blue-700"
          >
            {isSubmitting ? (
              <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <BriefcaseBusiness className="size-4" />
            )}
            Registrar proveedor
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
