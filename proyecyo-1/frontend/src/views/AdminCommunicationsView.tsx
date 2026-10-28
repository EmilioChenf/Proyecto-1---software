import { useFeedbackState } from "@/hooks/useFeedbackState";
import { useEffect, useMemo, useState } from "react";
import { BellRing, CheckCircle2, History, Megaphone, Send } from "lucide-react";

import { AdminLayout } from "@/components/admin/AdminLayout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getAnnouncementsRequest,
  sendAnnouncementRequest,
} from "@/services/announcementsService";
import type { AnnouncementRecipientType, AnnouncementRecord } from "@/types/announcements";
import { formatUtcTimestamp } from "@/utils/guatemalaTime";

const recipientOptions: Array<{ value: AnnouncementRecipientType; label: string }> = [
  { value: "todos", label: "Todos los usuarios" },
  { value: "residente", label: "Residentes" },
  { value: "inquilino", label: "Inquilinos" },
  { value: "guardia", label: "Guardias" },
  { value: "admin", label: "Administradores" },
];

const recipientLabels: Record<AnnouncementRecipientType, string> = {
  todos: "Todos",
  residente: "Residentes",
  inquilino: "Inquilinos",
  guardia: "Guardias",
  admin: "Administradores",
};

function formatDateTime(value: string) {
  if (!value) return "--";
  // enviado_en es un instante UTC (NOW()); se muestra en hora de Guatemala.
  return formatUtcTimestamp(value, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function AdminCommunicationsView() {
  const [announcements, setAnnouncements] = useState<AnnouncementRecord[]>([]);
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [tipoUsuario, setTipoUsuario] = useState<AnnouncementRecipientType>("todos");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [errorMessage, setErrorMessage] = useFeedbackState("error", "");
  const [successMessage, setSuccessMessage] = useFeedbackState("success", "");

  const selectedRecipientLabel = useMemo(() => recipientLabels[tipoUsuario], [tipoUsuario]);

  async function loadAnnouncements() {
    setIsLoading(true);
    setErrorMessage("");
    try {
      setAnnouncements(await getAnnouncementsRequest());
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "No fue posible cargar el historial de comunicados.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadAnnouncements();
  }, []);

  function handleOpenConfirmation() {
    setErrorMessage("");
    setSuccessMessage("");
    if (!titulo.trim()) {
      setErrorMessage("El titulo del comunicado es obligatorio.");
      return;
    }
    if (!descripcion.trim()) {
      setErrorMessage("La descripcion del comunicado es obligatoria.");
      return;
    }
    setShowConfirmation(true);
  }

  async function handleSendAnnouncement() {
    setIsSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const created = await sendAnnouncementRequest({
        titulo: titulo.trim(),
        descripcion: descripcion.trim(),
        tipo_usuario: tipoUsuario,
      });
      setAnnouncements((current) => [created, ...current]);
      setTitulo("");
      setDescripcion("");
      setTipoUsuario("todos");
      setShowConfirmation(false);
      setSuccessMessage(
        `Comunicado enviado correctamente a ${created.total_destinatarios} destinatarios.`,
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "No fue posible enviar el comunicado.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AdminLayout
      title="Comunicados masivos"
      subtitle="Notificaciones masivas segmentadas por tipo de usuario."
    >
      {errorMessage ? (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {successMessage ? (
        <Alert className="mb-4 border-emerald-200 bg-emerald-50 text-emerald-800">
          <CheckCircle2 className="size-4" />
          <AlertTitle>Envio confirmado</AlertTitle>
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Megaphone className="size-5 text-blue-600" />
              Crear formulario comunicado
            </CardTitle>
            <CardDescription>
              Selecciona tipo de usuario e implementa envio masivo.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label htmlFor="titulo-comunicado" className="mb-2 block text-sm font-medium text-slate-700">
                Titulo
              </label>
              <input
                id="titulo-comunicado"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Ej. Mantenimiento de amenidades"
                className="h-11 w-full rounded-xl border border-slate-200 px-4 outline-none focus:border-blue-300"
              />
            </div>
            <div>
              <label htmlFor="descripcion-comunicado" className="mb-2 block text-sm font-medium text-slate-700">
                Descripcion
              </label>
              <textarea
                id="descripcion-comunicado"
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                rows={5}
                placeholder="Escribe el contenido del aviso..."
                className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-300"
              />
            </div>
            <div>
              <label htmlFor="tipo-usuario" className="mb-2 block text-sm font-medium text-slate-700">
                Seleccionar tipo de usuario
              </label>
              <select
                id="tipo-usuario"
                value={tipoUsuario}
                onChange={(e) => setTipoUsuario(e.target.value as AnnouncementRecipientType)}
                className="h-11 w-full rounded-xl border border-slate-200 px-4 outline-none focus:border-blue-300"
              >
                {recipientOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <Button type="button" onClick={handleOpenConfirmation} className="rounded-xl">
              <Send className="size-4" />
              Implementar envio masivo
            </Button>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="size-5 text-blue-600" />
              Historial de comunicados
            </CardTitle>
            <CardDescription>Comunicados guardados y enviados.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <div className="rounded-xl border border-slate-200 p-4 text-sm text-slate-500">
                Cargando historial...
              </div>
            ) : announcements.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                Aun no hay comunicados enviados.
              </div>
            ) : (
              announcements.map((item) => (
                <article key={item.id_comunicado} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-950">{item.titulo}</p>
                      <p className="mt-1 text-sm text-slate-600">{item.descripcion}</p>
                    </div>
                    <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700">
                      {recipientLabels[item.tipo_destinatario]}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
                    <span>{formatDateTime(item.enviado_en)}</span>
                    <span>{item.total_destinatarios} destinatarios</span>
                  </div>
                </article>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {showConfirmation ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-lg rounded-[20px] bg-white p-6 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                <BellRing className="size-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Crear confirmacion de envio</h2>
                <p className="text-sm text-slate-500">
                  El comunicado se enviara a {selectedRecipientLabel.toLowerCase()}.
                </p>
              </div>
            </div>
            <div className="mt-5 space-y-2 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
              <p>
                <span className="font-medium text-slate-900">Titulo:</span> {titulo}
              </p>
              <p>
                <span className="font-medium text-slate-900">Destinatarios:</span> {selectedRecipientLabel}
              </p>
              <p>
                <span className="font-medium text-slate-900">Mensaje:</span> {descripcion}
              </p>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowConfirmation(false)}
                disabled={isSubmitting}
                className="rounded-xl"
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={() => void handleSendAnnouncement()}
                disabled={isSubmitting}
                className="rounded-xl"
              >
                {isSubmitting ? "Enviando..." : "Confirmar envio"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </AdminLayout>
  );
}
