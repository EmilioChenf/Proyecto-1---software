import { useEffect, useRef, useState } from "react";
import { Download, Loader2, Lock, Pencil, Plus, Trash2, Upload, X } from "lucide-react";

import { AdminLayout } from "@/components/admin/AdminLayout";
import { CommunityTabs, type CommunityTab } from "@/components/community/CommunityTabs";
import { ContactList } from "@/components/community/ContactList";
import { PollCard } from "@/components/community/PollCard";
import { CONTACT_CATEGORIES, DOC_CATEGORIES, docCategory, formatSize } from "@/components/community/communityLabels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  closePollRequest, createPollRequest, deleteContactRequest, deleteDocumentRequest, deletePollRequest, downloadDocument,
  listContactsRequest, listDocumentsRequest, listPollsRequest, saveContactRequest, uploadDocumentRequest,
  type CommunityDocument, type Contact, type Poll,
} from "@/services/communityService";
import { confirmAction, notifyError, notifySuccess } from "@/utils/feedback";

const inAWeek = () => { const d = new Date(Date.now() + 7 * 86400000); d.setHours(18, 0, 0, 0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T18:00`; };
const EMPTY_POLL = () => ({ titulo: "", descripcion: "", opciones: ["Sí", "No"], fecha_cierre: inAWeek(), resultados_visibles: true });
const EMPTY_CONTACT = { nombre: "", categoria: "SERVICIOS", telefono: "", correo: "", nota: "", orden: 0 };
const readFile = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("No se pudo leer el archivo.")); reader.readAsDataURL(file); });

/** Comunidad (administración): crear votaciones, compartir documentos y mantener el directorio. */
export function AdminCommunityView() {
  const [tab, setTab] = useState<CommunityTab>("votaciones");
  const [polls, setPolls] = useState<Poll[]>([]);
  const [docs, setDocs] = useState<CommunityDocument[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [pollForm, setPollForm] = useState<ReturnType<typeof EMPTY_POLL> | null>(null);
  const [docForm, setDocForm] = useState<{ titulo: string; categoria: string; file: File | null; notificar: boolean } | null>(null);
  const [contactForm, setContactForm] = useState<(typeof EMPTY_CONTACT & { id?: number }) | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const [p, d, c] = await Promise.all([listPollsRequest(true), listDocumentsRequest(true), listContactsRequest(true)]);
      setPolls(p); setDocs(d); setContacts(c);
    } catch (reason) { void notifyError(reason, "No fue posible cargar la comunidad."); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function run(action: () => Promise<unknown>, success: string, after?: () => void) {
    setBusy(true); setError("");
    try { await action(); await load(); after?.(); void notifySuccess(success); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible guardar."); }
    finally { setBusy(false); }
  }

  async function confirmed(title: string, text: string, action: () => Promise<unknown>, success: string) {
    if (!(await confirmAction({ title, text, confirmText: "Sí, continuar", cancelText: "No, cancelar", tone: "danger" }))) return;
    try { await action(); await load(); void notifySuccess(success); } catch (reason) { void notifyError(reason, "No fue posible completar la acción."); }
  }

  const newButton = tab === "votaciones" ? <Button type="button" onClick={() => { setPollForm(EMPTY_POLL()); setError(""); }}><Plus className="size-4" />Nueva votación</Button>
    : tab === "documentos" ? <Button type="button" onClick={() => { setDocForm({ titulo: "", categoria: "REGLAMENTO", file: null, notificar: true }); setError(""); }}><Upload className="size-4" />Subir documento</Button>
    : <Button type="button" onClick={() => { setContactForm({ ...EMPTY_CONTACT }); setError(""); }}><Plus className="size-4" />Nuevo contacto</Button>;

  return (
    <AdminLayout title="Votaciones y documentos" subtitle="Asambleas digitales, documentos oficiales y directorio de la comunidad." actions={newButton}>
      <CommunityTabs value={tab} onChange={setTab} counts={{ votaciones: polls.filter((p) => p.abierta).length }} />
      {loading ? <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" />Cargando…</p> : tab === "votaciones" ? (
        polls.length === 0 ? <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">Crea la primera votación: cada vivienda vota una vez y ves la participación en tiempo real.</p> : (
          <div className="grid gap-4 lg:grid-cols-2">{polls.map((poll) => (
            <PollCard key={poll.id_votacion} poll={poll} actions={<>
              {poll.abierta ? <Button type="button" size="sm" variant="outline" onClick={() => void confirmed(`¿Cerrar "${poll.titulo}"?`, "Ya nadie podrá votar y todos verán los resultados.", () => closePollRequest(poll.id_votacion), "Votación cerrada.")}><Lock className="size-3.5" />Cerrar ahora</Button> : null}
              <Button type="button" size="sm" variant="ghost" className="text-rose-600 hover:bg-rose-50" aria-label={`Eliminar ${poll.titulo}`} onClick={() => void confirmed(`¿Eliminar "${poll.titulo}"?`, "Se borran la votación y sus votos.", () => deletePollRequest(poll.id_votacion), "Votación eliminada.")}><Trash2 className="size-3.5" /></Button>
            </>} />
          ))}</div>
        )
      ) : tab === "documentos" ? (
        docs.length === 0 ? <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">Sube el reglamento, las actas de asamblea o los estados financieros (PDF, Word, Excel o imagen, hasta 3 MB).</p> : (
          <ul className="grid gap-2 md:grid-cols-2">{docs.map((doc) => (
            <li key={doc.id_documento} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
              <span className="text-2xl" aria-hidden>{docCategory(doc.categoria).emoji}</span>
              <div className="min-w-0 flex-1"><p className="truncate font-semibold text-slate-900">{doc.titulo}</p><p className="text-xs text-slate-500">{docCategory(doc.categoria).label} · {doc.tipo} · {formatSize(doc.tamano)} · {doc.creado_en} · {doc.subido_por}</p></div>
              <button type="button" aria-label={`Descargar ${doc.titulo}`} onClick={() => void downloadDocument(doc, true).catch((reason) => notifyError(reason, "No fue posible descargar."))} className="rounded-xl border border-slate-200 p-2 text-slate-700 hover:bg-slate-50"><Download className="size-4" /></button>
              <button type="button" aria-label={`Eliminar ${doc.titulo}`} onClick={() => void confirmed(`¿Eliminar "${doc.titulo}"?`, "Los residentes ya no podrán descargarlo.", () => deleteDocumentRequest(doc.id_documento), "Documento eliminado.")} className="rounded-xl p-2 text-rose-600 hover:bg-rose-50"><Trash2 className="size-4" /></button>
            </li>
          ))}</ul>
        )
      ) : (
        <ContactList contacts={contacts} renderActions={(contact) => (
          <div className="flex flex-col gap-1">
            <button type="button" aria-label={`Editar ${contact.nombre}`} onClick={() => { setContactForm({ id: contact.id_contacto, nombre: contact.nombre, categoria: contact.categoria, telefono: contact.telefono ?? "", correo: contact.correo ?? "", nota: contact.nota ?? "", orden: contact.orden }); setError(""); }} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><Pencil className="size-3.5" /></button>
            <button type="button" aria-label={`Eliminar ${contact.nombre}`} onClick={() => void confirmed(`¿Eliminar a ${contact.nombre}?`, "Se quita del directorio.", () => deleteContactRequest(contact.id_contacto), "Contacto eliminado.")} className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50"><Trash2 className="size-3.5" /></button>
          </div>
        )} />
      )}

      {pollForm ? (
        <Modal title="Nueva votación" onClose={() => setPollForm(null)}>
          <label className="block text-sm font-medium text-slate-700">Pregunta<Input aria-label="Pregunta" className="mt-1.5" maxLength={150} value={pollForm.titulo} onChange={(e) => setPollForm({ ...pollForm, titulo: e.target.value })} placeholder="Ej. ¿Aprobamos instalar cámaras en la entrada?" /></label>
          <label className="block text-sm font-medium text-slate-700">Contexto (opcional)<textarea aria-label="Contexto" maxLength={1000} value={pollForm.descripcion} onChange={(e) => setPollForm({ ...pollForm, descripcion: e.target.value })} className="mt-1.5 min-h-20 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Costo estimado Q12,000, se pagaría en 3 cuotas." /></label>
          <div><p className="text-sm font-medium text-slate-700">Opciones</p>
            <ul className="mt-1.5 space-y-2">{pollForm.opciones.map((option, index) => (
              <li key={index} className="flex gap-2"><Input aria-label={`Opción ${index + 1}`} maxLength={120} value={option} onChange={(e) => setPollForm({ ...pollForm, opciones: pollForm.opciones.map((o, i) => (i === index ? e.target.value : o)) })} />
                {pollForm.opciones.length > 2 ? <button type="button" aria-label={`Quitar opción ${index + 1}`} onClick={() => setPollForm({ ...pollForm, opciones: pollForm.opciones.filter((_, i) => i !== index) })} className="rounded-lg px-2 text-slate-400 hover:text-rose-600"><X className="size-4" /></button> : null}</li>
            ))}</ul>
            {pollForm.opciones.length < 8 ? <button type="button" onClick={() => setPollForm({ ...pollForm, opciones: [...pollForm.opciones, ""] })} className="mt-2 text-sm font-medium text-blue-700">+ Agregar opción</button> : null}
          </div>
          <label className="block text-sm font-medium text-slate-700">Cierra el<Input aria-label="Fecha de cierre" type="datetime-local" className="mt-1.5" value={pollForm.fecha_cierre} onChange={(e) => setPollForm({ ...pollForm, fecha_cierre: e.target.value })} /></label>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={pollForm.resultados_visibles} onChange={(e) => setPollForm({ ...pollForm, resultados_visibles: e.target.checked })} />Mostrar resultados parciales a quien ya votó</label>
          <p className="rounded-xl bg-blue-50 p-3 text-xs text-blue-800">Vota el residente responsable de cada vivienda (un voto por casa). Se notificará a toda la comunidad.</p>
          {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
          <Button type="button" className="w-full" disabled={busy} onClick={() => void run(() => createPollRequest({ ...pollForm, opciones: pollForm.opciones.map((o) => o.trim()).filter(Boolean) }), "Votación publicada y comunidad notificada.", () => setPollForm(null))}>{busy ? "Publicando…" : "Publicar votación"}</Button>
        </Modal>
      ) : null}

      {docForm ? (
        <Modal title="Subir documento" onClose={() => setDocForm(null)}>
          <label className="block text-sm font-medium text-slate-700">Título<Input aria-label="Título del documento" className="mt-1.5" maxLength={150} value={docForm.titulo} onChange={(e) => setDocForm({ ...docForm, titulo: e.target.value })} placeholder="Ej. Acta de asamblea de octubre" /></label>
          <div className="flex flex-wrap gap-1.5">{DOC_CATEGORIES.map((category) => (
            <button key={category.id} type="button" aria-pressed={docForm.categoria === category.id} onClick={() => setDocForm({ ...docForm, categoria: category.id })} className={`rounded-full border px-3 py-1 text-xs font-medium ${docForm.categoria === category.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600"}`}>{category.emoji} {category.label}</button>
          ))}</div>
          <input ref={fileRef} type="file" className="sr-only" aria-label="Archivo" accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png" onChange={(e) => { const file = e.target.files?.[0] ?? null; setDocForm({ ...docForm, file, titulo: docForm.titulo || (file?.name.replace(/\.[^.]+$/, "") ?? "") }); }} />
          <button type="button" onClick={() => fileRef.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 p-5 text-sm font-medium text-slate-600 hover:bg-slate-50"><Upload className="size-5" />{docForm.file ? `${docForm.file.name} · ${formatSize(docForm.file.size)}` : "Elegir archivo (PDF, Word, Excel o imagen · máx. 3 MB)"}</button>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={docForm.notificar} onChange={(e) => setDocForm({ ...docForm, notificar: e.target.checked })} />Avisar a residentes e inquilinos</label>
          {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
          <Button type="button" className="w-full" disabled={busy || !docForm.file} onClick={() => void run(async () => {
            if (!docForm.file) return;
            if (docForm.file.size > 3 * 1024 * 1024) throw new Error("El archivo supera 3 MB. Comprímelo o divídelo.");
            await uploadDocumentRequest({ titulo: docForm.titulo, categoria: docForm.categoria, nombre_archivo: docForm.file.name, archivo: await readFile(docForm.file), notificar: docForm.notificar });
          }, "Documento compartido con la comunidad.", () => setDocForm(null))}>{busy ? "Subiendo…" : "Compartir documento"}</Button>
        </Modal>
      ) : null}

      {contactForm ? (
        <Modal title={contactForm.id ? "Editar contacto" : "Nuevo contacto"} onClose={() => setContactForm(null)}>
          <label className="block text-sm font-medium text-slate-700">Nombre<Input aria-label="Nombre del contacto" className="mt-1.5" maxLength={120} value={contactForm.nombre} onChange={(e) => setContactForm({ ...contactForm, nombre: e.target.value })} placeholder="Ej. Plomero Don Luis" /></label>
          <div className="flex flex-wrap gap-1.5">{CONTACT_CATEGORIES.map((category) => (
            <button key={category.id} type="button" aria-pressed={contactForm.categoria === category.id} onClick={() => setContactForm({ ...contactForm, categoria: category.id })} className={`rounded-full border px-3 py-1 text-xs font-medium ${contactForm.categoria === category.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600"}`}>{category.emoji} {category.label}</button>
          ))}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">Teléfono<Input aria-label="Teléfono" className="mt-1.5" maxLength={30} value={contactForm.telefono} onChange={(e) => setContactForm({ ...contactForm, telefono: e.target.value })} placeholder="5555-1234" /></label>
            <label className="text-sm font-medium text-slate-700">Correo<Input aria-label="Correo" className="mt-1.5" maxLength={160} value={contactForm.correo} onChange={(e) => setContactForm({ ...contactForm, correo: e.target.value })} /></label>
          </div>
          <label className="block text-sm font-medium text-slate-700">Nota<Input aria-label="Nota" className="mt-1.5" maxLength={200} value={contactForm.nota} onChange={(e) => setContactForm({ ...contactForm, nota: e.target.value })} placeholder="Ej. Atiende fines de semana" /></label>
          {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
          <Button type="button" className="w-full" disabled={busy} onClick={() => void run(() => saveContactRequest(contactForm.id ?? null, contactForm), "Directorio actualizado.", () => setContactForm(null))}>{busy ? "Guardando…" : "Guardar contacto"}</Button>
        </Modal>
      ) : null}
    </AdminLayout>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-label={title} className="max-h-[92dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="text-lg font-bold text-slate-900">{title}</h2><button type="button" aria-label="Cerrar" onClick={onClose}><X className="size-5 text-slate-400" /></button></div>
        {children}
      </div>
    </div>
  );
}
