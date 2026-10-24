import { useState, type FormEvent } from "react";
import { Building2, Mail } from "lucide-react";
import { Link } from "react-router-dom";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requestPasswordReset } from "@/services/passwordResetService";

export function ForgotPasswordView() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("Ingresa un correo valido.");
      return;
    }
    try {
      setSubmitting(true);
      const response = await requestPasswordReset(email.trim().toLowerCase());
      setMessage(response.message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible procesar la solicitud.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[linear-gradient(135deg,#eff6ff,#f8fafc)] p-4">
      <Card className="w-full max-w-md border-slate-200 shadow-xl">
        <CardHeader>
          <div className="mb-3 flex size-11 items-center justify-center rounded-2xl bg-blue-900 text-white"><Building2 className="size-6" /></div>
          <CardTitle>Recuperar contrasena</CardTitle>
          <CardDescription>Escribe el correo de tu cuenta. Por seguridad, la respuesta sera la misma exista o no el usuario.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            {message ? <Alert><AlertTitle>Solicitud recibida</AlertTitle><AlertDescription>{message}</AlertDescription></Alert> : null}
            {error ? <Alert variant="destructive"><AlertTitle>Revisa la informacion</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
            <label className="block text-sm font-medium text-slate-700" htmlFor="recovery-email">Correo electronico</label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
              <Input id="recovery-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="pl-11" />
            </div>
            <Button type="submit" className="w-full bg-blue-900" disabled={submitting}>{submitting ? "Enviando..." : "Enviar instrucciones"}</Button>
            <Link to="/login" className="block text-center text-sm font-semibold text-blue-700 hover:text-blue-900">Volver al inicio de sesion</Link>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
