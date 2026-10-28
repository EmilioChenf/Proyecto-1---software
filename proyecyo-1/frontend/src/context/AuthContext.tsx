import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { ApiError } from "@/services/api";
import { notifyInfo, notifySuccess } from "@/utils/feedback";
import { clearToasts } from "@/utils/toastStore";
import { changePasswordRequest, getSessionRequest, loginRequest, logoutRequest } from "@/services/authService";
import type { AuthUser, ChangePasswordPayload, ChangePasswordResponse, LoginPayload, LoginResponse } from "@/types/auth";

const STORAGE_KEY = "nexus.session";

type AuthContextValue = {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (payload: LoginPayload) => Promise<LoginResponse>;
  logout: () => void;
  refreshSession: () => Promise<void>;
  changePassword: (payload: ChangePasswordPayload) => Promise<ChangePasswordResponse>;
};

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const persistSession = useCallback((session: AuthUser) => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    setUser(session);
  }, []);

  const clearSession = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setUser(null);
  }, []);

  const logout = useCallback(() => {
    void logoutRequest().catch(() => undefined);
    clearSession();
    clearToasts();
    void notifyInfo("Sesión cerrada.");
  }, [clearSession]);

  // Consulta al backend el rol y estado actuales del usuario y actualiza la sesion
  // si cambiaron los permisos. Si el usuario fue desactivado o eliminado, cierra la sesion.
  const refreshSession = useCallback(async () => {
    const rawSession = window.localStorage.getItem(STORAGE_KEY);

    if (!rawSession) {
      return;
    }

    let stored: AuthUser;
    try {
      stored = JSON.parse(rawSession) as AuthUser;
    } catch {
      clearSession();
      return;
    }

    try {
      const fresh = await getSessionRequest();

      if (fresh.id !== stored.id || fresh.role !== stored.role || fresh.email !== stored.email) {
        persistSession(fresh);
      }
    } catch (error) {
      // Si el backend indica que la sesion ya no es valida (usuario inactivo o eliminado),
      // se cierra la sesion. Los errores de red se ignoran para no cerrarla por fallos temporales.
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        clearSession();
      }
    }
  }, [clearSession, persistSession]);

  useEffect(() => {
    const rawSession = window.localStorage.getItem(STORAGE_KEY);

    if (rawSession) {
      try {
        setUser(JSON.parse(rawSession) as AuthUser);
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }

    setIsLoading(false);
    // Refresca los permisos al cargar la aplicacion.
    void refreshSession();
  }, [refreshSession]);

  // Refresca los permisos periodicamente y al volver a enfocar la ventana.
  useEffect(() => {
    if (!user) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshSession();
    }, 60_000);

    const handleFocus = () => {
      void refreshSession();
    };

    window.addEventListener("focus", handleFocus);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
    };
  }, [user, refreshSession]);

  useEffect(() => {
    window.addEventListener("nexus:session-expired", clearSession);
    return () => window.removeEventListener("nexus:session-expired", clearSession);
  }, [clearSession]);

  const login = useCallback(
    async (payload: LoginPayload) => {
      const response = await loginRequest(payload);
      persistSession(response);
      clearToasts();
      void notifySuccess("Sesión iniciada correctamente.");
      return response;
    },
    [persistSession],
  );

  // El token anterior queda revocado en el servidor: se guarda el que entrega la respuesta.
  const changePassword = useCallback(
    async (payload: ChangePasswordPayload) => {
      const response = await changePasswordRequest(payload);
      persistSession({ id: response.id, email: response.email, role: response.role, token: response.token });
      return response;
    },
    [persistSession],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isLoading,
      login,
      logout,
      refreshSession,
      changePassword,
    }),
    [isLoading, user, login, logout, refreshSession, changePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
