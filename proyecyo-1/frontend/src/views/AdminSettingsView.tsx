import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  AlertCircle,
  CheckCircle2,
  DatabaseBackup,
  FileCheck2,
  FileUp,
  Loader2,
  RotateCcw,
} from "lucide-react";

import { AdminLayout } from "@/components/admin/AdminLayout";
import { VisitScheduleSettings } from "@/components/admin/VisitScheduleSettings";
import { FinancialRulesSettings } from "@/components/admin/FinancialRulesSettings";
import { AutomaticBackupsSettings } from "@/components/admin/AutomaticBackupsSettings";
import { GeneralSettings } from "@/components/admin/GeneralSettings";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/services/api";
import {
  getRestoreHistoryRequest,
  restoreBackupRequest,
  validateBackupRequest,
} from "@/services/restoresService";
import type { BackupPayload, BackupValidation, RestoreHistoryRecord } from "@/types/restores";
import { formatUtcTimestamp } from "@/utils/guatemalaTime";
import { confirmAction } from "@/utils/feedback";

type ProcessStatus = "idle" | "selected" | "validating" | "valid" | "restoring" | "completed" | "error";

const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getStatusLabel(status: ProcessStatus) {
  const labels: Record<ProcessStatus, string> = {
    idle: "Sin archivo",
    selected: "Archivo cargado",
    validating: "Validando",
    valid: "Validado",
    restoring: "Restaurando",
    completed: "Completado",
    error: "Revisar",
  };

  return labels[status];
}

export function AdminSettingsView() {
  const [backup, setBackup] = useState<BackupPayload | null>(null);
  const [validation, setValidation] = useState<BackupValidation | null>(null);
  const [history, setHistory] = useState<RestoreHistoryRecord[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [status, setStatus] = useState<ProcessStatus>("idle");
  const [message, setMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const affectedTables = useMemo(() => {
    if (!validation?.tablas_afectadas.length) {
      return "Sin tablas detectadas";
    }

    return validation.tablas_afectadas.join(", ");
  }, [validation]);

  async function loadHistory() {
    try {
      const records = await getRestoreHistoryRequest();
      setHistory(records);
      setHistoryError("");
    } catch (error) {
      // Un fallo no se presenta como historial vacio.
      setHistoryError(error instanceof Error && error.message ? error.message : "No fue posible cargar el historial.");
    }
  }

  useEffect(() => {
    void loadHistory();
  }, []);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    setValidation(null);
    setMessage("");

    if (!file) {
      setBackup(null);
      setStatus("idle");
      return;
    }

    if (!file.name.toLowerCase().endsWith(".sql")) {
      setBackup(null);
      setStatus("error");
      setMessage("Selecciona un respaldo con extension .sql.");
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setBackup(null);
      setStatus("error");
      setMessage("El respaldo supera el tamano maximo permitido de 2 MB.");
      return;
    }

    const content = await file.text();
    setBackup({ filename: file.name, content });
    setStatus("selected");
    setMessage("Archivo listo para validar.");
  }

  async function handleValidate() {
    if (!backup) {
      return;
    }

    setStatus("validating");
    setMessage("Validando respaldo...");

    try {
      const result = await validateBackupRequest(backup);
      setValidation(result);
      setStatus("valid");
      setMessage(result.mensaje);
    } catch (error) {
      setValidation(null);
      setStatus("error");
      setMessage(error instanceof ApiError ? error.message : "No fue posible validar el respaldo.");
    }
  }

  async function handleRestore() {
    if (!backup || !validation) {
      return;
    }

    const confirmed = await confirmAction({
      title: "¿Restaurar este respaldo?",
      text: "La restauración reemplazará información de la base de datos.",
      confirmText: "Restaurar",
      tone: "danger",
    });

    if (!confirmed) {
      return;
    }

    setStatus("restoring");
    setMessage("Restaurando base de datos...");

    try {
      const result = await restoreBackupRequest(backup);
      setStatus("completed");
      setMessage(result.mensaje);
      await loadHistory();
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof ApiError ? error.message : "No fue posible restaurar el respaldo.");
      await loadHistory();
    }
  }

  function resetSelection() {
    setBackup(null);
    setValidation(null);
    setStatus("idle");
    setMessage("");

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  const isBusy = status === "validating" || status === "restoring";
  const canValidate = Boolean(backup) && !isBusy;
  const canRestore = Boolean(backup && validation) && !isBusy;
  const isError = status === "error";
  const isSuccess = status === "valid" || status === "completed";

  return (
    <AdminLayout
      title="Restaurar informacion desde respaldos"
      subtitle="Carga, valida y restaura respaldos SQL del sistema residencial."
      actions={
        <Button type="button" variant="outline" onClick={resetSelection} disabled={isBusy}>
          <RotateCcw className="size-4" />
          Reiniciar
        </Button>
      }
    >
      <GeneralSettings />
      <VisitScheduleSettings />
      <FinancialRulesSettings />
      <AutomaticBackupsSettings />
      <section className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex size-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <DatabaseBackup className="size-5" />
              </div>
              <h2 className="mt-4 text-[1.12rem] font-semibold text-slate-950">
                Respaldo de base de datos
              </h2>
              <p className="mt-1 text-sm text-slate-500">Archivo SQL, maximo 2 MB.</p>
            </div>

            <span className="inline-flex items-center justify-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              {getStatusLabel(status)}
            </span>
          </div>

          <label className="mt-5 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center transition hover:border-blue-300 hover:bg-blue-50/60">
            <FileUp className="size-9 text-blue-600" />
            <span className="mt-3 text-sm font-semibold text-slate-800">
              {backup?.filename || "Seleccionar respaldo"}
            </span>
            <span className="mt-1 text-xs text-slate-500">
              {backup ? formatBytes(new Blob([backup.content]).size) : "Formato .sql"}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".sql"
              className="sr-only"
              onChange={handleFileChange}
              disabled={isBusy}
            />
          </label>

          {message ? (
            <Alert
              className="mt-4"
              variant={isError ? "destructive" : "default"}
            >
              {isError ? (
                <AlertCircle className="mr-2 inline size-4 align-[-2px]" />
              ) : isSuccess ? (
                <CheckCircle2 className="mr-2 inline size-4 align-[-2px] text-green-600" />
              ) : null}
              <AlertTitle>Estado del proceso</AlertTitle>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ) : null}

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Button type="button" variant="outline" onClick={handleValidate} disabled={!canValidate}>
              {status === "validating" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileCheck2 className="size-4" />
              )}
              Validar respaldo
            </Button>
            <Button type="button" onClick={handleRestore} disabled={!canRestore}>
              {status === "restoring" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <DatabaseBackup className="size-4" />
              )}
              Restaurar BD
            </Button>
          </div>

          {validation ? (
            <div className="mt-5 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">Sentencias</p>
                  <p className="mt-1 text-lg font-semibold text-slate-950">
                    {validation.total_sentencias}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">Tamano</p>
                  <p className="mt-1 text-lg font-semibold text-slate-950">
                    {formatBytes(validation.size)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">Tablas</p>
                  <p className="mt-1 text-lg font-semibold text-slate-950">
                    {validation.tablas_afectadas.length}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">Tablas afectadas</p>
                <p className="mt-1 text-sm text-slate-700">{affectedTables}</p>
              </div>
            </div>
          ) : null}
        </div>

        <aside className="rounded-lg border border-slate-200 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          <h2 className="text-[1.12rem] font-semibold text-slate-950">Historial</h2>
          <div className="mt-4 grid gap-3">
            {historyError ? (
              <p role="alert" className="rounded-lg bg-rose-50 px-3.5 py-3 text-sm text-rose-700">{historyError}</p>
            ) : history.length ? (
              history.map((record) => (
                <article
                  key={record.id_restauracion}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-950">
                        {record.nombre_archivo}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">{formatUtcTimestamp(record.creado_en)}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[0.68rem] font-semibold text-slate-600">
                      {record.estado}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-600">{record.mensaje}</p>
                </article>
              ))
            ) : (
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-500">
                Aun no hay restauraciones registradas.
              </p>
            )}
          </div>
        </aside>
      </section>
    </AdminLayout>
  );
}
