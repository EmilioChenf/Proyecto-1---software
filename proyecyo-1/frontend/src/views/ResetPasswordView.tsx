import { useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { resetPasswordRequest } from "@/services/passwordResetService";

export function ResetPasswordView() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(token ? "" : "El enlace de recuperacion no contiene un token valido.");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      setError("La contrasena debe tener al menos 8 caracteres e incluir letras y numeros.");
      return;
    }
    if (password !== confirmation) {
      setError("Las contrasenas no coinciden.");
      return;
    }
    try {
      setSubmitting(true);
      const response = await resetPasswordRequest(token, password);
      setMessage(response.message);
      setPassword("");
      setConfirmation("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible actualizar la contrasena.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[linear-gradient(135deg,#eff6ff,#f8fafc)] p-4">
      <Card className="w-full max-w-md border-slate-200 shadow-xl">
        <CardHeader>
          <div className="mb-3 flex size-11 items-center justify-center rounded-2xl bg-blue-900 text-white"><KeyRound className="size-6" /></div>
          <CardTitle>Establecer nueva contrasena</CardTitle>
          <CardDescription>El enlace es de un solo uso. Al guardar, se cerraran las sesiones abiertas de la cuenta.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            {message ? <Alert><AlertTitle>Contrasena actualizada</AlertTitle><AlertDescription>{message}</AlertDescription></Alert> : null}
            {error ? <Alert variant="destructive"><AlertTitle>No fue posible continuar</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
            <div><label htmlFor="new-password" className="mb-2 block text-sm font-medium text-slate-700">Nueva contrasena</label><Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={Boolean(message)} /></div>
            <div><label htmlFor="confirm-password" className="mb-2 block text-sm font-medium text-slate-700">Confirmar contrasena</label><Input id="confirm-password" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={Boolean(message)} /></div>
            <Button type="submit" className="w-full bg-blue-900" disabled={!token || submitting || Boolean(message)}>{submitting ? "Guardando..." : "Guardar nueva contrasena"}</Button>
            <Link to="/login" className="block text-center text-sm font-semibold text-blue-700 hover:text-blue-900">Ir al inicio de sesion</Link>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
