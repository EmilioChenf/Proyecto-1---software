import { useFeedbackState } from "@/hooks/useFeedbackState";
import { useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { ApiError } from "@/services/api";

type Field = "currentPassword" | "newPassword" | "confirmPassword";
const EMPTY = { currentPassword: "", newPassword: "", confirmPassword: "" };

const FIELDS: Array<{ name: Field; label: string; autoComplete: string }> = [
  { name: "currentPassword", label: "Contrasena actual", autoComplete: "current-password" },
  { name: "newPassword", label: "Nueva contrasena", autoComplete: "new-password" },
  { name: "confirmPassword", label: "Confirmar nueva contrasena", autoComplete: "new-password" },
];

// HU-C01: el usuario cambia su propia contrasena. Las reglas definitivas las aplica
// el backend; aqui solo se adelantan las mismas para dar respuesta inmediata.
function validate(values: typeof EMPTY): Partial<Record<Field, string>> {
  const errors: Partial<Record<Field, string>> = {};
  if (!values.currentPassword) errors.currentPassword = "Ingresa tu contrasena actual.";
  if (!values.newPassword) errors.newPassword = "Ingresa la nueva contrasena.";
  else if (values.newPassword.length < 8 || values.newPassword.length > 128 || !/[A-Za-z]/.test(values.newPassword) || !/\d/.test(values.newPassword)) {
    errors.newPassword = "La contrasena debe tener entre 8 y 128 caracteres e incluir letras y numeros.";
  } else if (values.newPassword !== values.newPassword.trim()) {
    errors.newPassword = "La contrasena no puede iniciar ni terminar con espacios.";
  }
  if (!values.confirmPassword) errors.confirmPassword = "Confirma la nueva contrasena.";
  else if (values.newPassword && values.confirmPassword !== values.newPassword) {
    errors.confirmPassword = "La confirmacion no coincide con la nueva contrasena.";
  }
  return errors;
}

export function ChangePasswordCard({ onChanged }: { onChanged?: () => void }) {
  const { changePassword } = useAuth();
  const [values, setValues] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useFeedbackState("error", "");
  const [message, setMessage] = useFeedbackState("info", "");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    const errors = validate(values);
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    try {
      setSubmitting(true);
      const response = await changePassword(values);
      setValues(EMPTY);
      setMessage(response.message);
      onChanged?.();
    } catch (reason) {
      if (reason instanceof ApiError && reason.fieldErrors.length) {
        setFieldErrors(Object.fromEntries(reason.fieldErrors.map((item) => [item.field, item.message])));
      }
      setError(reason instanceof Error ? reason.message : "No fue posible cambiar la contrasena.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-slate-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><KeyRound className="size-5 text-blue-700" /> Cambiar contrasena</CardTitle>
        <CardDescription>Usa al menos 8 caracteres con letras y numeros. Al guardar se cerraran tus demas sesiones.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={submit} noValidate>
          {message ? <Alert><AlertTitle>Contrasena actualizada</AlertTitle><AlertDescription>{message}</AlertDescription></Alert> : null}
          {error ? <Alert variant="destructive"><AlertTitle>No fue posible cambiar la contrasena</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
          {FIELDS.map((field) => (
            <div key={field.name}>
              <label htmlFor={`change-${field.name}`} className="mb-2 block text-sm font-medium text-slate-700">{field.label}</label>
              <Input
                id={`change-${field.name}`}
                type="password"
                autoComplete={field.autoComplete}
                value={values[field.name]}
                aria-invalid={Boolean(fieldErrors[field.name])}
                aria-describedby={fieldErrors[field.name] ? `change-${field.name}-error` : undefined}
                onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                disabled={submitting}
              />
              {fieldErrors[field.name] ? <p id={`change-${field.name}-error`} className="mt-1 text-sm text-rose-700">{fieldErrors[field.name]}</p> : null}
            </div>
          ))}
          <Button type="submit" disabled={submitting}>{submitting ? "Guardando..." : "Cambiar contrasena"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
