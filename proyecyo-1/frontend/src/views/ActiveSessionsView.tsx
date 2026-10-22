import { useEffect, useState } from "react";
import { Clock3, Laptop, MapPin, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

import { ChangePasswordCard } from "@/components/auth/ChangePasswordCard";
import { AppShell } from "@/components/layout/AppShell";
import { rolesWithSidebar } from "@/components/layout/roleNavigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { closeActiveSessionRequest, getActiveSessionsRequest } from "@/services/sessionsService";
import type { ActiveSession } from "@/types/sessions";
import { formatUtcTimestamp } from "@/utils/guatemalaTime";

// Las marcas de sesion (NOW()) son instantes UTC; se muestran en hora de Guatemala.
function formatDate(value: string) {
  return formatUtcTimestamp(value);
}

export function ActiveSessionsView() {
  const { user, logout } = useAuth();
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState<string | null>(null);
  const [error, setError] = useState("");
  // Tras cambiar la contrasena las sesiones previas quedan revocadas: se recarga la lista.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    getActiveSessionsRequest()
      .then((response) => {
        if (active) setSessions(response);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "No fue posible cargar las sesiones.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [reloadKey]);

  async function closeSession(session: ActiveSession) {
    try {
      setClosing(session.id_sesion);
      setError("");
      const result = await closeActiveSessionRequest(session.id_sesion);
      if (result.actual) {
        logout();
        return;
      }
      setSessions((current) => current.filter((item) => item.id_sesion !== session.id_sesion));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible cerrar la sesion.");
    } finally {
      setClosing(null);
    }
  }

  const home = user ? `/${user.role}` : "/";
  return (
    <AppShell role={user?.role ?? "residente"} title="Sesiones activas" subtitle="Revisa los dispositivos con acceso a tu cuenta y cierra los que no reconozcas.">
      {/* Los roles con sidebar persistente no necesitan este enlace; admin lo conserva. */}
      {!user || !rolesWithSidebar.has(user.role) ? <Link className="text-sm font-semibold text-blue-700 hover:text-blue-900" to={home}>Volver al panel</Link> : null}
      {error ? <Alert variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      <Card className="border-slate-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5 text-blue-700" /> Dispositivos conectados</CardTitle>
          <CardDescription>Al cerrar una sesion, su token deja de ser valido inmediatamente.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? <p className="py-8 text-center text-sm text-slate-500">Cargando sesiones...</p> : null}
          {!loading && sessions.length === 0 ? <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">No hay sesiones activas.</p> : null}
          {sessions.map((session) => (
            <article key={session.id_sesion} className="flex flex-col gap-4 rounded-2xl border border-slate-200 p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="flex items-center gap-2 font-semibold text-slate-950"><Laptop className="size-5 text-blue-700" /> {session.dispositivo}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span className="flex items-center gap-1"><MapPin className="size-3.5" /> {session.direccion_ip || "IP no disponible"}</span>
                  <span className="flex items-center gap-1"><Clock3 className="size-3.5" /> Ultima actividad: {formatDate(session.ultima_actividad_en)}</span>
                </div>
                {session.actual ? <span className="mt-2 inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Este dispositivo</span> : null}
              </div>
              <Button type="button" variant={session.actual ? "default" : "outline"} disabled={closing !== null} onClick={() => void closeSession(session)}>
                {closing === session.id_sesion ? "Cerrando..." : "Cerrar sesion"}
              </Button>
            </article>
          ))}
        </CardContent>
      </Card>
      <ChangePasswordCard onChanged={() => setReloadKey((current) => current + 1)} />
    </AppShell>
  );
}
