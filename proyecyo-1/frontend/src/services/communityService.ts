import { apiDownload, apiRequest } from "@/services/api";

export type Poll = {
  id_votacion: number; titulo: string; descripcion: string | null; fecha_cierre: string; abierta: boolean; resultados_visibles: boolean;
  total_votos: number; viviendas: number; participacion: number; opciones: Array<{ id_opcion: number; texto: string; votos: number | null }>;
  mostrar_resultados: boolean; mi_voto: number | null; puede_votar: boolean; sin_vivienda: boolean;
};
export type CommunityDocument = { id_documento: number; titulo: string; categoria: string; nombre_archivo: string; tipo: string; tamano: number; creado_en: string; subido_por: string };
export type Contact = { id_contacto: number; nombre: string; categoria: string; telefono: string | null; correo: string | null; nota: string | null; orden: number };

const base = (admin: boolean) => (admin ? "/admin/comunidad" : "/comunidad");
export const listPollsRequest = (admin = false) => apiRequest<Poll[]>(`${base(admin)}/votaciones`);
export const votePollRequest = (id: number, id_opcion: number) => apiRequest<Poll>(`/comunidad/votaciones/${id}/votar`, { method: "POST", body: { id_opcion } });
export const createPollRequest = (body: { titulo: string; descripcion: string; opciones: string[]; fecha_cierre: string; resultados_visibles: boolean }) => apiRequest<Poll>("/admin/comunidad/votaciones", { method: "POST", body });
export const closePollRequest = (id: number) => apiRequest<Poll>(`/admin/comunidad/votaciones/${id}/cerrar`, { method: "POST" });
export const deletePollRequest = (id: number) => apiRequest(`/admin/comunidad/votaciones/${id}`, { method: "DELETE" });
export const listDocumentsRequest = (admin = false) => apiRequest<CommunityDocument[]>(`${base(admin)}/documentos`);
export const uploadDocumentRequest = (body: { titulo: string; categoria: string; nombre_archivo: string; archivo: string; notificar: boolean }) => apiRequest<CommunityDocument>("/admin/comunidad/documentos", { method: "POST", body });
export const deleteDocumentRequest = (id: number) => apiRequest(`/admin/comunidad/documentos/${id}`, { method: "DELETE" });
export const listContactsRequest = (admin = false) => apiRequest<Contact[]>(`${base(admin)}/directorio`);
export const saveContactRequest = (id: number | null, body: Omit<Contact, "id_contacto">) => apiRequest<Contact>(id ? `/admin/comunidad/directorio/${id}` : "/admin/comunidad/directorio", { method: id ? "PUT" : "POST", body });
export const deleteContactRequest = (id: number) => apiRequest(`/admin/comunidad/directorio/${id}`, { method: "DELETE" });

/** Descarga un documento y lo guarda con su nombre original. */
export async function downloadDocument(doc: CommunityDocument, admin = false) {
  const blob = await apiDownload(`${base(admin)}/documentos/${doc.id_documento}/archivo`);
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: doc.nombre_archivo });
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
