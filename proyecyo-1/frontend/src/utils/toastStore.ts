import Swal from "sweetalert2";

import { enqueueModal, modal } from "@/utils/alertQueue";

export type ToastTone = "success" | "error" | "warning" | "info";
export type ToastMessage = { id: number; tone: ToastTone; message: string; title?: string };

// Resultado de cada accion del sistema (creado, editado, eliminado, error...) como
// ventana de SweetAlert2 con icono, titulo, texto y boton OK. Se conserva esta API
// (pushToast/clearToasts) porque la usan useFeedbackState y feedback.ts en todas las
// vistas de todos los roles.
//
// Seguridad: solo titleText y text (texto plano); nunca title/html, que SweetAlert2
// interpreta como HTML y los mensajes incluyen datos escritos por usuarios.

export const DEFAULT_TITLES: Record<ToastTone, string> = {
  success: "¡Listo!",
  error: "No se pudo completar la acción",
  warning: "Atención",
  info: "Información",
};

let sequence = 0;
let messages: ToastMessage[] = [];
let showingId: number | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

type AlertPresenter = (item: ToastMessage) => Promise<unknown>;

/** Ventana de SweetAlert2 con icono, titulo, texto y boton OK. */
export const sweetAlertPresenter: AlertPresenter = (item) =>
  modal.fire({
    icon: item.tone,
    titleText: item.title || DEFAULT_TITLES[item.tone],
    text: item.message,
    confirmButtonText: "OK",
  });

let presenter: AlertPresenter = sweetAlertPresenter;

/** Solo para pruebas de vistas: registrar los avisos sin abrir ventanas modales. */
export function setAlertPresenter(next: AlertPresenter) {
  presenter = next;
}

async function showAlert(item: ToastMessage) {
  // Descartado mientras esperaba su turno (por ejemplo, al cerrar sesion).
  if (!messages.some((current) => current.id === item.id)) return null;
  showingId = item.id;
  try {
    return await presenter(item);
  } finally {
    showingId = null;
    dismissToast(item.id);
  }
}

/** Muestra el resultado de una accion; un mensaje identico pendiente no se repite. */
export function pushToast(tone: ToastTone, message: string, title?: string) {
  const duplicate = messages.find((item) => item.tone === tone && item.message === message);
  if (duplicate) return duplicate.id;
  const id = ++sequence;
  const item = { id, tone, message, title };
  messages = [...messages, item];
  emit();
  void enqueueModal(() => showAlert(item));
  return id;
}

export function dismissToast(id: number) {
  if (!messages.some((item) => item.id === id)) return;
  messages = messages.filter((item) => item.id !== id);
  emit();
}

/** Descarta los avisos pendientes y cierra el que esta abierto (no las confirmaciones). */
export function clearToasts() {
  const closeCurrent = showingId !== null;
  messages = [];
  emit();
  if (closeCurrent) Swal.close();
}

export const toastStore = {
  getSnapshot: () => messages,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};
