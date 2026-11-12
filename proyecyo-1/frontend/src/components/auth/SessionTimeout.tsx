import { useCallback, useEffect, useRef, useState } from "react";

import { currentSessionUserId } from "@/services/sessionStore";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import {
  ACTIVITY_THROTTLE_MS,
  LOGOUT_EVENT_KEY,
  SESSION_TIMEOUT_MS,
  SESSION_WARNING_MS,
} from "@/config/session";

// Eventos que se consideran "actividad" del usuario y reinician el temporizador.
const ACTIVITY_EVENTS = ["click", "keydown", "pointermove", "popstate"];

/**
 * Cierra la sesion automaticamente tras un periodo de inactividad.
 * Muestra un aviso previo con cuenta regresiva y sincroniza el cierre entre pestañas.
 */
export function SessionTimeout() {
  const { isAuthenticated, logout } = useAuth();
  const [showWarning, setShowWarning] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  const lastActivityRef = useRef(0);
  const warningTimerRef = useRef<number>();
  const logoutTimerRef = useRef<number>();
  const countdownRef = useRef<number>();

  const clearTimers = useCallback(() => {
    window.clearTimeout(warningTimerRef.current);
    window.clearTimeout(logoutTimerRef.current);
    window.clearInterval(countdownRef.current);
  }, []);

  // Cierra la sesion y avisa a las demas pestañas.
  const endSession = useCallback(() => {
    clearTimers();
    setShowWarning(false);
    try { localStorage.setItem(LOGOUT_EVENT_KEY, `${currentSessionUserId() ?? ""}:${Date.now()}`); } catch { /* sin almacenamiento */ }
    logout();
  }, [clearTimers, logout]);

  // Reinicia el temporizador de inactividad (por actividad o al continuar la sesion).
  const resetTimer = useCallback(() => {
    if (!isAuthenticated) {
      return;
    }

    clearTimers();
    setShowWarning(false);

    // Aviso previo antes de cerrar la sesion.
    warningTimerRef.current = window.setTimeout(() => {
      setShowWarning(true);
      setRemainingSeconds(Math.ceil(SESSION_WARNING_MS / 1000));
      countdownRef.current = window.setInterval(() => {
        setRemainingSeconds((value) => Math.max(0, value - 1));
      }, 1000);
    }, Math.max(0, SESSION_TIMEOUT_MS - SESSION_WARNING_MS));

    // Cierre efectivo de la sesion.
    logoutTimerRef.current = window.setTimeout(endSession, SESSION_TIMEOUT_MS);
  }, [clearTimers, endSession, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      clearTimers();
      return;
    }

    resetTimer();

    // Detecta la actividad del usuario (limitada por un intervalo para no reiniciar en exceso).
    const handleActivity = () => {
      const now = Date.now();
      if (now - lastActivityRef.current >= ACTIVITY_THROTTLE_MS) {
        lastActivityRef.current = now;
        resetTimer();
      }
    };

    // Sincroniza el cierre de sesion entre pestañas abiertas.
    const handleStorage = (event: StorageEvent) => {
      // Solo cierra las pestañas del mismo usuario: las de otros roles siguen abiertas.
      const sender = String(event.newValue || "").split(":")[0];
      if (event.key === LOGOUT_EVENT_KEY && (!sender || sender === String(currentSessionUserId() ?? ""))) {
        logout();
      }
    };

    ACTIVITY_EVENTS.forEach((eventName) => window.addEventListener(eventName, handleActivity));
    window.addEventListener("storage", handleStorage);

    return () => {
      clearTimers();
      ACTIVITY_EVENTS.forEach((eventName) => window.removeEventListener(eventName, handleActivity));
      window.removeEventListener("storage", handleStorage);
    };
  }, [clearTimers, isAuthenticated, logout, resetTimer]);

  if (!showWarning) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-label="Sesion proxima a expirar"
      className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/50"
    >
      <div className="mx-4 max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900">Sesion proxima a expirar</h2>
        <p className="mt-2 text-sm text-slate-600">
          Tu sesion se cerrara en {remainingSeconds} segundos por inactividad.
        </p>
        <div className="mt-5 flex gap-3">
          <Button onClick={resetTimer}>Continuar sesion</Button>
          <Button variant="outline" onClick={endSession}>
            Cerrar sesión ahora
          </Button>
        </div>
      </div>
    </div>
  );
}
