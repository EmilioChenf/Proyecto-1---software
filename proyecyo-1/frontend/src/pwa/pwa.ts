import { apiRequest } from "@/services/api";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
let deferredPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Registra el service worker (solo en producción) y escucha el aviso de instalación del navegador. */
export function registerPwa() {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); deferredPrompt = event as InstallPromptEvent; emit(); });
  window.addEventListener("appinstalled", () => { deferredPrompt = null; emit(); });
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => undefined); });
  }
}

export const onPwaChange = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const canPromptInstall = () => Boolean(deferredPrompt);
export const isStandalone = () => typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
export const isIos = () => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);

export async function promptInstall() {
  if (!deferredPrompt) return false;
  await deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice;
  deferredPrompt = null; emit();
  return choice.outcome === "accepted";
}

function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

export const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export async function getPushState(): Promise<"no-soportado" | "no-configurado" | "bloqueado" | "activo" | "inactivo"> {
  if (!pushSupported()) return "no-soportado";
  const { activo } = await apiRequest<{ activo: boolean; clave: string | null }>("/push/clave-publica");
  if (!activo) return "no-configurado";
  if (Notification.permission === "denied") return "bloqueado";
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? "activo" : "inactivo";
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
}

/** Espera a que el service worker quede activo; si falla al instalarse, avisa en lugar de quedarse esperando. */
async function activeRegistration() {
  const registration = (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
  if (registration.active) return registration;
  const worker = registration.installing ?? registration.waiting;
  if (worker) {
    await withTimeout(new Promise<void>((resolve, reject) => {
      worker.addEventListener("statechange", () => {
        if (worker.state === "activated") resolve();
        if (worker.state === "redundant") reject(new Error("No se pudo preparar la app en este navegador. Recarga la página e inténtalo de nuevo."));
      });
    }), 15000, "La app tardó demasiado en prepararse. Recarga la página e inténtalo de nuevo.");
  }
  return withTimeout(navigator.serviceWorker.ready, 15000, "La app tardó demasiado en prepararse. Recarga la página e inténtalo de nuevo.");
}

/** Pide permiso y registra este dispositivo para recibir avisos. */
export async function enablePush() {
  // El permiso se pide primero, directo del toque: Safari (iPhone) lo ignora si antes hubo una espera de red.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied"
    ? "Las notificaciones están bloqueadas. Actívalas en Ajustes del navegador → Notificaciones y vuelve a intentar."
    : "Debes tocar \"Permitir\" cuando el navegador lo pregunte.");
  const { clave } = await apiRequest<{ activo: boolean; clave: string | null }>("/push/clave-publica");
  if (!clave) throw new Error("Las notificaciones push aún no están activadas en el servidor.");
  const registration = await activeRegistration();
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    try {
      subscription = await withTimeout(registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(clave) }), 20000, "El servicio de avisos del celular no respondió. Inténtalo de nuevo.");
    } catch (error) {
      throw new Error(error instanceof Error && /tard|respondi/.test(error.message) ? error.message : "Este navegador no pudo activar los avisos. Revisa que la llave pública del servidor sea correcta o prueba con Chrome.");
    }
  }
  await apiRequest("/push/suscripciones", { method: "POST", body: subscription.toJSON() });
}

export async function disablePush() {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await apiRequest("/push/suscripciones", { method: "DELETE", body: { endpoint: subscription.endpoint } }).catch(() => undefined);
  await subscription.unsubscribe();
}
