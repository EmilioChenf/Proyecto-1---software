import { useRef, useState, type FormEvent } from "react";
import { Building2, Mail } from "lucide-react";
import { Link } from "react-router-dom";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field-error";
import { getErrorMessage } from "@/utils/errorMessages";
import { Input } from "@/components/ui/input";
import { requestPasswordReset } from "@/services/passwordResetService";

export function ForgotPasswordView() {
  const emailRef = useRef<HTMLInputElement>(null);
  const [emailError, setEmailError] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setEmailError("");
    setMessage("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setEmailError(email.trim() ? "Ingresa un correo válido, por ejemplo nombre@dominio.com." : "Ingresa el correo electrónico de tu cuenta.");
      emailRef.current?.focus();
      return;
    }
    try {
      setSubmitting(true);
      const response = await requestPasswordReset(email.trim().toLowerCase());
      setMessage(response.message);
    } catch (reason) {
      setError(getErrorMessage(reason, "No fue posible enviar las instrucciones. Intenta nuevamente."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[linear-gradient(135deg,#eff6ff,#f8fafc)] p-4">
      <Card className="w-full max-w-md border-slate-200 shadow-xl">
        <CardHeader>
          <div className="mb-3 flex size-11 items-center justify-center rounded-2xl bg-blue-900 text-white"><Building2 className="size-6" /></div>
          <CardTitle>Recuperar contraseña</CardTitle>
          <CardDescription>Escribe el correo de tu cuenta. Por seguridad, la respuesta será la misma exista o no el usuario.</CardDescription>
        </CardHeader>
        <CardContent>
          <form noValidate aria-busy={submitting} className="space-y-4" onSubmit={submit}>
            {message ? <Alert role="status"><AlertTitle>Solicitud recibida</AlertTitle><AlertDescription>{message}</AlertDescription></Alert> : null}
            {error ? <Alert variant="destructive"><AlertTitle>No fue posible enviar las instrucciones</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
            <label className="block text-sm font-medium text-slate-700" htmlFor="recovery-email">Correo electrónico</label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
              <Input
                ref={emailRef}
                id="recovery-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setEmailError("");
                  setError("");
                  setMessage("");
                }}
                aria-invalid={Boolean(emailError)}
                aria-describedby={emailError ? "recovery-email-error" : undefined}
                disabled={submitting}
                className="pl-11"
              />
            </div>
            <FieldError id="recovery-email-error" message={emailError} />
            <Button type="submit" className="w-full bg-blue-900" disabled={submitting}>{submitting ? "Enviando..." : "Enviar instrucciones"}</Button>
            <Link to="/login" className="block text-center text-sm font-semibold text-blue-700 hover:text-blue-900">Volver al inicio de sesión</Link>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
