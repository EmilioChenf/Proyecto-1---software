import Swal, { type SweetAlertIcon, type SweetAlertOptions } from "sweetalert2";

import { ApiError } from "@/services/api";
import { getErrorMessage } from "@/utils/errorMessages";

// HU-C02: mensajes flotantes globales (SweetAlert2) para el resultado de ACCIONES:
// confirmar, exito, error y advertencia. Los errores de un formulario o modal NO van
// aqui: se muestran junto al campo correspondiente (FieldError / aria-invalid).
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

const toast = Swal.mixin({
  toast: true,
  position: "top-end",
  showConfirmButton: false,
  timer: 3500,
  timerProgressBar: true,
  heightAuto: false,
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

/** Exito de una accion: aviso breve que no bloquea la pantalla. */
export function notifySuccess(message: string, title?: string) {
  return toast.fire({ icon: "success", titleText: title ?? message, text: title ? message : undefined });
}

/** Advertencia que el usuario debe leer antes de continuar. */
export function notifyWarning(message: string, title = "Atencion") {
  return showOnce("warning", title, message);
}

/**
 * Error de una accion (no de validacion de campos). El texto se sanea con las mismas
 * reglas que el resto de la app: nunca muestra detalles internos del backend.
 * Un 401 no se muestra: la app ya cierra la sesion y redirige al inicio de sesion.
 */
export function notifyError(error: unknown, fallback = "No fue posible completar la operacion.", title = "No se pudo completar la accion") {
  if (error instanceof ApiError && error.status === 401) return Promise.resolve(null);
  const message = typeof error === "string" ? getErrorMessage(new Error(error), fallback) : getErrorMessage(error, fallback);
  return showOnce("error", title, message);
}

// Evita apilar el mismo mensaje dos veces si la accion se reintenta rapido.
function showOnce(icon: SweetAlertIcon, title: string, text: string) {
  const open = Swal.getPopup();
  // Se comprueba el DOM (popup conectado y no cerrandose); Swal.isVisible() depende del
  // tamano renderizado y no es fiable en todos los entornos.
  const showing = Boolean(open?.isConnected) && !open?.classList.contains("swal2-hide");
  if (showing && Swal.getTitle()?.textContent === title && Swal.getHtmlContainer()?.textContent === text) {
    return Promise.resolve(null);
  }
  return base.fire({ icon, titleText: title, text, confirmButtonText: "Entendido" });
}
