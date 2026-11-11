import { useEffect, useState } from "react";
import { Download, FileText, Loader2, Vote } from "lucide-react";

import { CommunityTabs, type CommunityTab } from "@/components/community/CommunityTabs";
import { ContactList } from "@/components/community/ContactList";
import { PollCard } from "@/components/community/PollCard";
import { docCategory, formatSize } from "@/components/community/communityLabels";
import { TenantLayout } from "@/components/inquilino/TenantLayout";
import { ResidentLayout } from "@/components/residente/ResidentLayout";
import { downloadDocument, listContactsRequest, listDocumentsRequest, listPollsRequest, votePollRequest, type CommunityDocument, type Contact, type Poll } from "@/services/communityService";
import { confirmAction, notifyError, notifySuccess } from "@/utils/feedback";

/** Comunidad para residentes e inquilinos: votar, descargar documentos y ver el directorio. */
export function CommunityView({ role = "residente" }: { role?: "residente" | "inquilino" }) {
  const [tab, setTab] = useState<CommunityTab>("votaciones");
  const [polls, setPolls] = useState<Poll[]>([]);
  const [docs, setDocs] = useState<CommunityDocument[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([listPollsRequest(), listDocumentsRequest(), listContactsRequest()])
      .then(([p, d, c]) => { setPolls(p); setDocs(d); setContacts(c); })
      .catch((reason) => void notifyError(reason, "No fue posible cargar la comunidad."))
      .finally(() => setLoading(false));
  }, []);

  async function vote(poll: Poll, optionId: number) {
    const option = poll.opciones.find((o) => o.id_opcion === optionId);
    const ok = await confirmAction({ title: `¿Votar "${option?.texto}"?`, text: "Es un voto por vivienda y no se puede cambiar.", confirmText: "Sí, votar", cancelText: "No, revisar" });
    if (!ok) return;
    setBusy(true);
    try {
      const updated = await votePollRequest(poll.id_votacion, optionId);
      setPolls((current) => current.map((p) => (p.id_votacion === updated.id_votacion ? updated : p)));
      void notifySuccess("Tu voto quedó registrado. ¡Gracias por participar!");
    } catch (reason) { void notifyError(reason, "No fue posible registrar tu voto."); } finally { setBusy(false); }
  }

  const pending = polls.filter((p) => p.puede_votar).length;
  const content = loading ? <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" />Cargando…</p> : (
    <>
      <CommunityTabs value={tab} onChange={setTab} counts={{ votaciones: pending }} />
      {tab === "votaciones" ? (
        polls.length === 0 ? <Empty icon={<Vote className="size-9" />} text="No hay votaciones por ahora." /> : (
          <div className="grid gap-4 lg:grid-cols-2">{polls.map((poll) => <PollCard key={poll.id_votacion} poll={poll} busy={busy} onVote={(id) => void vote(poll, id)} />)}</div>
        )
      ) : tab === "documentos" ? (
        docs.length === 0 ? <Empty icon={<FileText className="size-9" />} text="La administración aún no ha compartido documentos." /> : (
          <ul className="grid gap-2 md:grid-cols-2">{docs.map((doc) => (
            <li key={doc.id_documento} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
              <span className="text-2xl" aria-hidden>{docCategory(doc.categoria).emoji}</span>
              <div className="min-w-0 flex-1"><p className="truncate font-semibold text-slate-900">{doc.titulo}</p><p className="text-xs text-slate-500">{docCategory(doc.categoria).label} · {doc.tipo} · {formatSize(doc.tamano)} · {doc.creado_en}</p></div>
              <button type="button" aria-label={`Descargar ${doc.titulo}`} onClick={() => void downloadDocument(doc).catch((reason) => notifyError(reason, "No fue posible descargar."))} className="rounded-xl border border-slate-200 p-2.5 text-slate-700 hover:bg-slate-50"><Download className="size-4" /></button>
            </li>
          ))}</ul>
        )
      ) : <ContactList contacts={contacts} />}
    </>
  );
  const subtitle = "Votaciones de la comunidad, documentos oficiales y teléfonos importantes.";
  return role === "inquilino"
    ? <TenantLayout title="Comunidad" subtitle={subtitle}>{content}</TenantLayout>
    : <ResidentLayout title="Comunidad" subtitle={subtitle}>{content}</ResidentLayout>;
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500"><div className="mx-auto mb-2 w-fit text-slate-300">{icon}</div>{text}</div>;
}
