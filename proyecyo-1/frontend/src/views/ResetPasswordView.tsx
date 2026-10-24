import { useRef, useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field-error";
import { getErrorMessage } from "@/utils/errorMessages";
import { Input } from "@/components/ui/input";
import { resetPasswordRequest } from "@/services/passwordResetService";

export function ResetPasswordView() {
  const [searchParams] = useSearchParams();
  const token = (searchParams.get("token") || "").trim();
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const [fieldErrors, setFieldErrors] = useState({ password: "", confirmation: "" });
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || message || !token) return;
    setError("");
    const errors = {
      password: password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)
        ? "La contraseña debe tener al menos 8 caracteres e incluir letras y números." : "",
      confirmation: !confirmation ? "Confirma tu nueva contraseña."
        : password !== confirmation ? "Las contraseñas no coinciden." : "",
    };
    setFieldErrors(errors);
    if (errors.password || errors.confirmation) {
      (errors.password ? passwordRef : confirmationRef).current?.focus();
      return;
    }
    try {
      setSubmitting(true);
      const response = await resetPasswordRequest(token, password);
      setMessage(response.message);
      setPassword("");
      setConfirmation("");
    } catch (reason) {
      setError(getErrorMessage(reason, "No fue posible actualizar la contraseña. Solicita un nuevo enlace o intenta nuevamente."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[linear-gradient(135deg,#eff6ff,#f8fafc)] p-4">
      <Card className="w-full max-w-md border-slate-200 shadow-xl">
        <CardHeader>
          <div className="mb-3 flex size-11 items-center justify-center rounded-2xl bg-blue-900 text-white"><KeyRound className="size-6" /></div>
          <CardTitle>Establecer nueva contraseña</CardTitle>
          <CardDescription>El enlace es de un solo uso. Al guardar, se cerrarán las sesiones abiertas de la cuenta.</CardDescription>
        </CardHeader>
        <CardContent>
          <form noValidate aria-busy={submitting} className="space-y-4" onSubmit={submit}>
            {message ? <Alert role="status"><AlertTitle>Contraseña actualizada</AlertTitle><AlertDescription>{message}</AlertDescription></Alert> : null}
            {!token ? <Alert variant="destructive"><AlertTitle>Enlace de recuperación inválido</AlertTitle><AlertDescription>Este enlace no contiene un código de recuperación. <Link to="/olvide-contrasena" className="font-semibold underline">Solicita un nuevo enlace</Link> para continuar.</AlertDescription></Alert> : null}
            {error ? <Alert variant="destructive"><AlertTitle>No fue posible continuar</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
            <div>
              <label htmlFor="new-password" className="mb-2 block text-sm font-medium text-slate-700">Nueva contraseña</label>
              <Input
                ref={passwordRef}
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setFieldErrors({ password: "", confirmation: "" });
                  setError("");
                }}
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby={fieldErrors.password ? "new-password-error password-help" : "password-help"}
                disabled={!token || submitting || Boolean(message)}
              />
              <p id="password-help" className="mt-2 text-sm text-slate-500">Usa al menos 8 caracteres, con letras y números.</p>
              <FieldError id="new-password-error" message={fieldErrors.password} />
            </div>
            <div>
              <label htmlFor="confirm-password" className="mb-2 block text-sm font-medium text-slate-700">Confirmar contraseña</label>
              <Input
                ref={confirmationRef}
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => {
                  setConfirmation(event.target.value);
                  setFieldErrors((current) => ({ ...current, confirmation: "" }));
                  setError("");
                }}
                aria-invalid={Boolean(fieldErrors.confirmation)}
                aria-describedby={fieldErrors.confirmation ? "confirm-password-error" : undefined}
                disabled={!token || submitting || Boolean(message)}
              />
              <FieldError id="confirm-password-error" message={fieldErrors.confirmation} />
            </div>
            <Button type="submit" className="w-full bg-blue-900" disabled={!token || submitting || Boolean(message)}>{submitting ? "Guardando..." : "Guardar nueva contraseña"}</Button>
            <Link to="/login" className="block text-center text-sm font-semibold text-blue-700 hover:text-blue-900">Ir al inicio de sesión</Link>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
