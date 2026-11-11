import { Navigate, Outlet, useLocation } from "react-router-dom";

import { canOpenAdminPath, firstAllowedAdminPath } from "@/config/roleModules";

import { useAuth } from "@/hooks/useAuth";
import { rolePaths } from "@/routes/rolePaths";
import type { UserRole } from "@/types/auth";

export function ProtectedRoute({ allowedRoles }: { allowedRoles: UserRole[] }) {
  const { user, isLoading } = useAuth();
  const { pathname } = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-slate-600">Cargando sesión...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!allowedRoles.includes(user.role)) {
    return <Navigate to={rolePaths[user.role]} replace />;
  }

  // Rol personalizado: solo entra a las pantallas de sus módulos (la API también lo valida).
  if (user.permisos && pathname.startsWith("/admin") && (pathname === "/admin/roles" || !canOpenAdminPath(user.permisos, pathname))) {
    const target = firstAllowedAdminPath(user.permisos);
    if (target !== pathname) return <Navigate to={target} replace />;
  }

  return <Outlet />;
}
