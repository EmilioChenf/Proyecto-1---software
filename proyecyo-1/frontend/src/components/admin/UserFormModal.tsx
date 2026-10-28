import { useFeedbackState } from "@/hooks/useFeedbackState";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";

import { HousePicker } from "@/components/houses/HousePicker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldError, invalidControlClassName } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/services/api";
import type { HouseRecord, HouseSelectionRole } from "@/types/houses";
import type { UserFormValues, UserRecord, UserTypeOption } from "@/types/users";

type UserFormModalProps = {
  isOpen: boolean;
  isSubmitting: boolean;
  userTypes: UserTypeOption[];
  editingUser: UserRecord | null;
  onClose: () => void;
  onSubmit: (values: UserFormValues) => Promise<void>;
  onConfigureContract?:()=>void;
};

type FormErrors = Partial<Record<keyof UserFormValues, string>>;

// HU-C02: orden visual de los campos y su control enfocable, para llevar al usuario al
// primer error aunque el modal sea largo (con el mapa de viviendas).
const FIELD_ORDER: Array<{ field: keyof UserFormValues; controlId: string }> = [
  { field: "nombre", controlId: "user-name" },
  { field: "correo", controlId: "user-email" },
  { field: "password", controlId: "user-password" },
  { field: "id_tipo_usuario", controlId: "user-role" },
  { field: "id_casa", controlId: "user-house" },
];
const SERVER_FIELDS = new Set<string>(FIELD_ORDER.map((item) => item.field));

const emptyValues: UserFormValues = {
  nombre: "",
  correo: "",
  password: "",
  telefono: "",
  id_tipo_usuario: "",
  id_casa: null,
};

// Rechazos del backend por la vivienda: se limpia la seleccion y se recarga el mapa.
const HOUSE_CONFLICTS = new Set(["VIVIENDA_OCUPADA", "VIVIENDA_INACTIVA", "VIVIENDA_NO_ELEGIBLE", "VIVIENDA_CONFLICTO"]);

export function UserFormModal({
  isOpen,
  isSubmitting,
  userTypes,
  editingUser,
  onClose,
  onSubmit,
  onConfigureContract,
}: UserFormModalProps) {
  const [values, setValues] = useState<UserFormValues>(emptyValues);
  const [house, setHouse] = useState<HouseRecord | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useFeedbackState("error", "");
  const [refreshKey, setRefreshKey] = useState(0);
  const titleId = useId();
  const serverErrorRef = useRef<HTMLDivElement>(null);

  const focusFirstInvalid = useCallback((fieldErrors: FormErrors) => {
    const first = FIELD_ORDER.find(({ field }) => fieldErrors[field]);
    if (!first) return;
    window.requestAnimationFrame(() => document.getElementById(first.controlId)?.focus());
  }, []);

  useEffect(() => {
    setErrors({});
    setServerError("");
    setHouse(null);
    if (!isOpen) {
      setValues(emptyValues);
      return;
    }
    setValues(editingUser ? {
      nombre: editingUser.nombre,
      correo: editingUser.correo,
      password: "",
      telefono: editingUser.telefono ?? "",
      id_tipo_usuario: String(editingUser.id_tipo_usuario),
      id_casa: editingUser.id_casa ?? null,
    } : emptyValues);
  }, [editingUser, isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !isSubmitting) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, isSubmitting, onClose]);

  const title = editingUser ? "Editar usuario" : "Crear usuario";
  const selectedRole = useMemo(
    () => userTypes.find((option) => String(option.id) === values.id_tipo_usuario)?.nombre?.toLowerCase() ?? "",
    [userTypes, values.id_tipo_usuario],
  );
  const houseRole: HouseSelectionRole | null = selectedRole === "residente" || selectedRole === "inquilino" ? selectedRole : null;
  // Al editar, la vivienda actual solo aplica si el rol no cambio.
  const sameRole = Boolean(editingUser && editingUser.rol === selectedRole);

  const chooseHouse = useCallback((next: HouseRecord | null) => {
    setHouse(next);
    setValues((current) => ({ ...current, id_casa: next?.id_casa ?? null }));
    setErrors((current) => ({ ...current, id_casa: undefined }));
  }, []);

  if (!isOpen) {
    return null;
  }

  const validate = () => {
    const nextErrors: FormErrors = {};
    if (!values.nombre.trim()) nextErrors.nombre = "El nombre es obligatorio.";
    if (!values.correo.trim()) nextErrors.correo = "El correo es obligatorio.";
    else if (!/\S+@\S+\.\S+/.test(values.correo)) nextErrors.correo = "Ingrese un correo valido.";
    if (!editingUser && !values.password.trim()) nextErrors.password = "La contrasena es obligatoria.";
    else if (values.password && values.password.trim().length < 4) nextErrors.password = "La contrasena debe tener al menos 4 caracteres.";
    if (!values.id_tipo_usuario) nextErrors.id_tipo_usuario = "Seleccione un rol.";
    if (houseRole && !values.id_casa && !(sameRole && !editingUser?.id_casa)) nextErrors.id_casa = "Selecciona y confirma una vivienda en el mapa.";
    setErrors(nextErrors);
    focusFirstInvalid(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleChange = (field: "nombre" | "correo" | "password" | "telefono", value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setServerError("");
    if (!validate()) return;

    try {
      await onSubmit({
        ...values,
        nombre: values.nombre.trim(),
        correo: values.correo.trim().toLowerCase(),
        telefono: values.telefono.trim(),
        password: values.password.trim(),
        id_casa: houseRole ? values.id_casa : null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "No fue posible guardar el usuario.";
      const code = error instanceof ApiError ? (error.payload as { code?: string } | undefined)?.code : undefined;
      // HU-C02: el error se muestra junto al campo que lo causa cuando se puede saber cual es.
      const fieldErrors: FormErrors = {};
      if (error instanceof ApiError) {
        for (const item of error.fieldErrors) {
          if (SERVER_FIELDS.has(item.field)) fieldErrors[item.field as keyof UserFormValues] = item.message;
        }
        if (code && HOUSE_CONFLICTS.has(code)) fieldErrors.id_casa = message;
        else if (error.status === 409 && !code && !Object.keys(fieldErrors).length) fieldErrors.correo = message; // correo ya registrado
      }
      if (code && HOUSE_CONFLICTS.has(code)) {
        chooseHouse(null);
        setRefreshKey((key) => key + 1);
      }
      if (Object.keys(fieldErrors).length) {
        setErrors(fieldErrors);
        focusFirstInvalid(fieldErrors);
      } else {
        setServerError(message);
        window.requestAnimationFrame(() => serverErrorRef.current?.scrollIntoView?.({ block: "nearest" }));
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 backdrop-blur-sm sm:items-center sm:p-4">
      <div role="dialog" aria-modal="true" aria-labelledby={titleId}
        className={`max-h-[94vh] w-full overflow-y-auto rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl ${houseRole ? "max-w-4xl" : "max-w-2xl"}`}>
        <div className="flex items-center justify-between px-5 pt-5">
          <h2 id={titleId} className="text-lg font-semibold text-slate-950">{title}</h2>
          <button type="button" aria-label="Cerrar" className="rounded-md p-1 text-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" onClick={onClose}>
            <X className="size-5" />
          </button>
        </div>
        <form className="space-y-5 p-5" onSubmit={handleSubmit} noValidate>
          {serverError ? (
            <div ref={serverErrorRef}>
              <Alert variant="destructive" role="alert">
                <AlertTitle>No se pudo guardar el usuario</AlertTitle>
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="user-name" className="mb-2 block text-sm text-slate-700">Nombre</label>
              <Input id="user-name" value={values.nombre} onChange={(event) => handleChange("nombre", event.target.value)}
                aria-invalid={Boolean(errors.nombre)} aria-describedby={errors.nombre ? "user-name-error" : undefined} />
              <FieldError id="user-name-error" message={errors.nombre} />
            </div>

            <div>
              <label htmlFor="user-email" className="mb-2 block text-sm text-slate-700">Correo</label>
              <Input id="user-email" type="email" value={values.correo} onChange={(event) => handleChange("correo", event.target.value)}
                aria-invalid={Boolean(errors.correo)} aria-describedby={errors.correo ? "user-email-error" : undefined} />
              <FieldError id="user-email-error" message={errors.correo} />
            </div>

            <div>
              <label htmlFor="user-password" className="mb-2 block text-sm text-slate-700">
                {editingUser ? "Nueva contrasena (opcional)" : "Contrasena"}
              </label>
              <Input type="password" id="user-password" value={values.password} onChange={(event) => handleChange("password", event.target.value)}
                aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? "user-password-error" : undefined} />
              <FieldError id="user-password-error" message={errors.password} />
            </div>

            <div>
              <label htmlFor="user-phone" className="mb-2 block text-sm text-slate-700">Telefono</label>
              <Input id="user-phone" value={values.telefono} onChange={(event) => handleChange("telefono", event.target.value)} />
            </div>

            <div className="md:col-span-2">
              <label htmlFor="user-role" className="mb-2 block text-sm text-slate-700">Tipo de usuario</label>
              <select
                id="user-role"
                value={values.id_tipo_usuario}
                onChange={(event) => {
                  const nextRoleId = event.target.value;
                  setValues((current) => ({ ...current, id_tipo_usuario: nextRoleId, id_casa: null }));
                  setHouse(null);
                }}
                aria-invalid={Boolean(errors.id_tipo_usuario)}
                aria-describedby={errors.id_tipo_usuario ? "user-role-error" : undefined}
                className={`flex h-11 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 focus-visible:ring-2 focus-visible:ring-blue-500 ${invalidControlClassName}`}
              >
                <option value="">Seleccione un rol</option>
                {userTypes.map((option) => (
                  <option key={option.id} value={option.id}>{option.nombre}</option>
                ))}
              </select>
              <FieldError id="user-role-error" message={errors.id_tipo_usuario} />
            </div>

            {houseRole ? (
              <div id="user-house" tabIndex={-1} aria-describedby={errors.id_casa ? "user-house-error" : undefined}
                className={`min-w-0 rounded-xl outline-none md:col-span-2 ${errors.id_casa ? "ring-2 ring-red-500/40 ring-offset-4" : ""}`}>
                {onConfigureContract&&<div className="mb-3 space-y-2 rounded-xl border p-3"><p>Configura la vivienda, el contrato, el responsable financiero y los habitantes desde el asistente.</p><Button type="button" variant="outline" onClick={onConfigureContract}>Abrir asistente de vivienda y contrato</Button></div>}
                {(!onConfigureContract||editingUser)&&<HousePicker
                  key={houseRole}
                  role={houseRole}
                  userId={editingUser?.id_usuario ?? null}
                  value={house}
                  onChange={chooseHouse}
                  refreshKey={refreshKey}
                  initialHouseId={sameRole ? editingUser?.id_casa ?? null : null}
                />}
                <FieldError id="user-house-error" message={errors.id_casa} />
              </div>
            ) : null}
          </div>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting||Boolean(onConfigureContract&&houseRole&&!editingUser)}>
              {isSubmitting ? "Guardando..." : editingUser ? "Actualizar usuario" : "Crear usuario"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
