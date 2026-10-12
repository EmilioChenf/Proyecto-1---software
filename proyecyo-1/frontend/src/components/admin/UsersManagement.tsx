import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Search, Trash2, Users } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  createUserRequest,
  deleteUserRequest,
  getUserTypesRequest,
  getUsersRequest,
  updateUserRequest,
} from "@/services/usersService";
import type { UserFormValues, UserRecord, UserTypeOption } from "@/types/users";
import { UserFormModal } from "@/components/admin/UserFormModal";
import {PropertyContractWizard} from '@/components/houses/PropertyContractWizard';

export function UsersManagement() {
  const [contractOpen,setContractOpen]=useState(false);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [userTypes, setUserTypes] = useState<UserTypeOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");

  const visibleUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users.filter((user) => (!roleFilter || user.rol === roleFilter)
      && (!term || [user.nombre, user.correo, user.unidad, user.telefono].some((v) => String(v ?? "").toLowerCase().includes(term))));
  }, [users, search, roleFilter]);

  const roleStyles = useMemo(
    () => ({
      admin: "bg-slate-900 text-white",
      guardia: "bg-amber-100 text-amber-800",
      residente: "bg-emerald-100 text-emerald-800",
      inquilino: "bg-blue-100 text-blue-800",
    }),
    [],
  );

  const loadData = async () => {
    setIsLoading(true);
    setError("");

    try {
      const [usersResponse, typesResponse] = await Promise.all([
        getUsersRequest(),
        getUserTypesRequest(),
      ]);

      setUsers(usersResponse);
      setUserTypes(typesResponse);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible cargar usuarios.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleCreate = () => {
    setEditingUser(null);
    setIsModalOpen(true);
  };

  const handleEdit = (user: UserRecord) => {
    setEditingUser(user);
    setIsModalOpen(true);
  };

  const handleDelete = async (user: UserRecord) => {
    const confirmed = window.confirm(`¿Desea eliminar a ${user.nombre}? Esta acción no se puede deshacer.`);

    if (!confirmed) {
      return;
    }

    setError("");
    setFeedback("");
    setIsSubmitting(true);

    try {
      await deleteUserRequest(user.id_usuario);
      setFeedback("Usuario eliminado correctamente.");
      await loadData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible eliminar el usuario.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (values: UserFormValues) => {
    setError("");
    setFeedback("");
    setIsSubmitting(true);

    try {
      if (editingUser) {
        await updateUserRequest(editingUser.id_usuario, values);
        setFeedback("Usuario actualizado correctamente.");
      } else {
        await createUserRequest(values);
        setFeedback("Usuario creado correctamente.");
      }

      setIsModalOpen(false);
      setEditingUser(null);
      await loadData();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-2.5 px-4 pt-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Usuarios del sistema</CardTitle>
            <CardDescription>Altas, ediciones y bajas. Residentes e inquilinos se asignan a una vivienda desde el mapa.</CardDescription>
          </div>
          <Button onClick={handleCreate}>
            <Plus className="size-4" />
            Crear usuario
          </Button>
          <Button variant="outline" onClick={()=>setContractOpen(true)}>Vivienda, contrato y personas</Button>
        </CardHeader>
        <CardContent className="space-y-2.5 px-4 pb-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative w-full sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <Input aria-label="Buscar usuario" placeholder="Buscar por nombre, correo o vivienda" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <select aria-label="Filtrar por rol" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
              className="h-11 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
              <option value="">Todos los roles</option>
              {userTypes.map((type) => <option key={type.id} value={type.nombre}>{type.nombre}</option>)}
            </select>
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {feedback ? (
            <Alert>
              <AlertTitle>Operacion completada</AlertTitle>
              <AlertDescription>{feedback}</AlertDescription>
            </Alert>
          ) : null}

          {isLoading ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-center text-sm text-slate-500">
              Cargando usuarios...
            </div>
          ) : users.length > 0 && visibleUsers.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm text-slate-600">Ningún usuario coincide con la búsqueda o el filtro.</p>
          ) : users.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center">
              <Users className="mx-auto size-7 text-slate-400" />
              <p className="mt-2.5 text-sm text-slate-600">No hay usuarios registrados.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3.5 py-2.5 text-left text-[0.7rem] font-semibold uppercase tracking-wide text-slate-500">Nombre</th>
                      <th className="px-3.5 py-2.5 text-left text-[0.7rem] font-semibold uppercase tracking-wide text-slate-500">Correo</th>
                      <th className="px-3.5 py-2.5 text-left text-[0.7rem] font-semibold uppercase tracking-wide text-slate-500">Vivienda</th>
                      <th className="px-3.5 py-2.5 text-left text-[0.7rem] font-semibold uppercase tracking-wide text-slate-500">Telefono</th>
                      <th className="px-3.5 py-2.5 text-left text-[0.7rem] font-semibold uppercase tracking-wide text-slate-500">Rol</th>
                      <th className="px-3.5 py-2.5 text-right text-[0.7rem] font-semibold uppercase tracking-wide text-slate-500">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {visibleUsers.map((user) => (
                      <tr key={user.id_usuario}>
                        <td className="px-3.5 py-2.5 text-[0.82rem] text-slate-900">{user.nombre}</td>
                        <td className="px-3.5 py-2.5 text-[0.82rem] text-slate-600">{user.correo}</td>
                        <td className="px-3.5 py-2.5 text-[0.82rem] text-slate-600">{user.unidad || "-"}</td>
                        <td className="px-3.5 py-2.5 text-[0.82rem] text-slate-600">{user.telefono || "-"}</td>
                        <td className="px-3.5 py-2.5 text-[0.82rem]">
                          <span className={`rounded-full px-2.5 py-1 text-[0.7rem] font-medium ${roleStyles[user.rol]}`}>
                            {user.rol}
                          </span>
                        </td>
                        <td className="px-3.5 py-2.5">
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => handleEdit(user)} disabled={isSubmitting}>
                              <Pencil className="size-4" />
                              Editar
                            </Button>
                            <Button variant="destructive" size="sm" onClick={() => handleDelete(user)} disabled={isSubmitting}>
                              <Trash2 className="size-4" />
                              Eliminar
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <UserFormModal
        isOpen={isModalOpen}
        isSubmitting={isSubmitting}
        userTypes={userTypes}
        editingUser={editingUser}
        onClose={() => {
          if (!isSubmitting) {
            setIsModalOpen(false);
            setEditingUser(null);
          }
        }}
        onSubmit={handleSubmit}
        onConfigureContract={()=>{setIsModalOpen(false);setContractOpen(true);}}
      />
      {contractOpen&&<PropertyContractWizard open onClose={()=>setContractOpen(false)} onSaved={()=>{setFeedback('Configuración contractual guardada.');void loadData();}}/>}
    </>
  );
}
