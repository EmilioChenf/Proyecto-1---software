import { useFeedbackState } from "@/hooks/useFeedbackState";
import { useEffect, useState } from "react";
import { Search, ShieldCheck, UserCheck } from "lucide-react";

import { AdminLayout } from "@/components/admin/AdminLayout";
import { Input } from "@/components/ui/input";
import { getAuthorizedUsersRequest } from "@/services/authorizedUsersService";
import type { AuthorizedUserRecord } from "@/types/authorizedUsers";

export function AdminAuthorizedUsersView() {
  const [users, setUsers] = useState<AuthorizedUserRecord[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useFeedbackState("error", "");

  async function loadData() {
    try {
      setIsLoading(true);
      setErrorMessage("");
      const response = await getAuthorizedUsersRequest({ search });
      setUsers(response);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "No fue posible cargar los usuarios autorizados.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [search]);

  return (
    <AdminLayout
      title="Usuarios autorizados"
      subtitle="Inquilinos autorizados y sus permisos activos por unidad."
    >
      <section className="grid gap-3 lg:grid-cols-3">
        <div className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nombre, correo o unidad..."
            className="h-11 rounded-2xl border-slate-100 bg-white pl-11"
          />
        </div>
        <div className="flex items-center gap-2.5 rounded-2xl border border-slate-200 bg-white px-4 py-2.5">
          <div className="rounded-xl bg-blue-50 p-2 text-blue-600">
            <UserCheck className="size-4" />
          </div>
          <div>
            <p className="text-[0.72rem] text-slate-500">Autorizados</p>
            <p className="text-sm font-semibold text-slate-950">{users.length}</p>
          </div>
        </div>
      </section>

      {errorMessage ? (
        <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {errorMessage}
        </div>
      ) : null}

      <section className="mt-5 rounded-[20px] border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-[1.24rem] font-semibold text-slate-950">Listado de inquilinos autorizados</h2>
          <p className="mt-1 text-[0.82rem] text-slate-500">
            Unidad asignada y permisos vigentes de cada usuario autorizado.
          </p>
        </div>

        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-6 text-center text-sm text-slate-500">Cargando usuarios autorizados...</div>
          ) : users.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">
              No hay usuarios autorizados que coincidan con la busqueda.
            </div>
          ) : (
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.1em] text-slate-500">
                  <th className="px-5 py-3 font-semibold">Nombre</th>
                  <th className="px-5 py-3 font-semibold">Correo</th>
                  <th className="px-5 py-3 font-semibold">Unidad</th>
                  <th className="px-5 py-3 font-semibold">Permisos activos</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id_usuario} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-5 py-3 text-sm text-slate-950">{user.nombre}</td>
                    <td className="px-5 py-3 text-sm text-slate-600">{user.correo}</td>
                    <td className="px-5 py-3 text-sm text-slate-600">{user.unidades}</td>
                    <td className="px-5 py-3">
                      {user.permisos_activos.length === 0 ? (
                        <span className="text-sm text-slate-400">Sin permisos activos</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {user.permisos_activos.map((permiso) => (
                            <span
                              key={permiso}
                              className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[0.7rem] font-medium text-emerald-700"
                            >
                              <ShieldCheck className="size-3" />
                              {permiso}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </AdminLayout>
  );
}
