import Swal, { type SweetAlertOptions } from "sweetalert2";

import { ApiError } from "@/services/api";
import { getErrorMessage } from "@/utils/errorMessages";
import { pushToast } from "@/utils/toastStore";

// HU-C02: mensajes flotantes globales para el resultado de ACCIONES:
// éxito, error y advertencia. SweetAlert2 conserva las confirmaciones y prompts.
// Los errores de campo también se conservan junto al campo (FieldError / aria-invalid).
//
// Seguridad: en SweetAlert2 "title" y "html" se interpretan como HTML. Aqui SOLO se usan
// "titleText" y "text" (texto plano), porque los mensajes incluyen datos de usuarios
// (nombres de visitantes, servicios, etc.).

const COLORS = { primary: "#2563EB", danger: "#DC2626", warning: "#D97706", cancel: "#64748B" };

// heightAuto:false evita que SweetAlert2 fuerce height:auto en html/body, lo que
// rompe los layouts con min-h-screen y el sidebar fijo.
const base = Swal.mixin({
  heightAuto: false,
  returnFocus: true,
  confirmButtonColor: COLORS.primary,
  cancelButtonColor: COLORS.cancel,
});

type ConfirmOptions = {
  title: string;
  text?: string;
  confirmText?: string;
  cancelText?: string;
  /** "danger" para acciones destructivas o irreversibles; "info" para confirmar datos. */
  tone?: "danger" | "warning" | "primary" | "info";
};

/** Opciones de SweetAlert2 para una confirmacion (separadas para poder verificarlas). */
export function buildConfirmOptions({
  title,
  text,
  confirmText = "Confirmar",
  cancelText = "Cancelar",
  tone = "primary",
}: ConfirmOptions): SweetAlertOptions {
  return {
    titleText: title,
    text,
    icon: tone === "primary" ? "question" : tone === "info" ? "info" : "warning",
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: cancelText,
    confirmButtonColor: tone === "info" ? COLORS.primary : COLORS[tone],
    reverseButtons: true,
    // En acciones destructivas el foco inicial queda en "Cancelar".
    focusCancel: tone === "danger",
  };
}

/** Confirmacion de una accion. Devuelve true solo si el usuario confirma. */
export async function confirmAction(options: ConfirmOptions): Promise<boolean> {
  const result = await base.fire(buildConfirmOptions(options));
  return result.isConfirmed;
}

type PromptOptions = ConfirmOptions & {
  label: string;
  placeholder?: string;
  maxLength?: number;
};

/**
 * Confirmacion con un texto opcional (por ejemplo, el motivo de una cancelacion).
 * Devuelve el texto (puede ser "") si el usuario confirma, o null si cancela.
 * inputLabel/inputPlaceholder se asignan como texto plano en SweetAlert2.
 */
export async function promptText({ label, placeholder, maxLength = 255, ...options }: PromptOptions): Promise<string | null> {
  const result = await base.fire({
    ...buildConfirmOptions(options),
    input: "textarea",
    inputLabel: label,
    inputPlaceholder: placeholder,
    inputAttributes: { maxlength: String(maxLength), "aria-label": label },
    inputValidator: (value: string) =>
      value && value.length > maxLength ? `Máximo ${maxLength} caracteres.` : undefined,
  });
  return result.isConfirmed ? String(result.value ?? "").trim() : null;
}

/** Exito de una accion: aviso breve que no bloquea la pantalla. */
export function notifySuccess(message: string, title?: string) {
  pushToast("success", message, title);
  return Promise.resolve(null);
}

/** Advertencia que el usuario debe leer antes de continuar. */
export function notifyWarning(message: string, title = "Atencion") {
  pushToast("warning", message, title);
  return Promise.resolve(null);
}

export function notifyInfo(message: string, title?: string) {
  pushToast("info", message, title);
  return Promise.resolve(null);
}

/**
 * Error de una accion (no de validacion de campos). El texto se sanea con las mismas
 * reglas que el resto de la app: nunca muestra detalles internos del backend.
 * Un 401 no se muestra: la app ya cierra la sesion y redirige al inicio de sesion.
 */
export function notifyError(error: unknown, fallback = "No fue posible completar la operacion.", title = "No se pudo completar la accion") {
  if (error instanceof ApiError && error.status === 401) return Promise.resolve(null);
  const message = typeof error === "string" ? getErrorMessage(new Error(error), fallback) : getErrorMessage(error, fallback);
  pushToast("error", message, title);
  return Promise.resolve(null);
}
