import { Mail, Phone } from "lucide-react";

import type { Contact } from "@/services/communityService";
import { CONTACT_CATEGORIES } from "./communityLabels";

/** Directorio agrupado por categoría; los teléfonos se marcan con un toque en el celular. */
export function ContactList({ contacts, renderActions }: { contacts: Contact[]; renderActions?: (contact: Contact) => React.ReactNode }) {
  return (
    <div className="space-y-5">
      {CONTACT_CATEGORIES.map((category) => {
        const items = contacts.filter((contact) => contact.categoria === category.id);
        if (!items.length) return null;
        return (
          <section key={category.id}>
            <h3 className="mb-2 text-sm font-semibold text-slate-700"><span aria-hidden className="mr-1">{category.emoji}</span>{category.label}</h3>
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{items.map((contact) => (
              <li key={contact.id_contacto} className={`flex items-center gap-3 rounded-2xl border bg-white p-3 ${category.id === "EMERGENCIA" ? "border-rose-200" : "border-slate-200"}`}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-900">{contact.nombre}</p>
                  {contact.nota ? <p className="truncate text-xs text-slate-500">{contact.nota}</p> : null}
                  {contact.correo ? <a href={`mailto:${contact.correo}`} className="flex items-center gap-1 truncate text-xs text-blue-700"><Mail className="size-3" />{contact.correo}</a> : null}
                </div>
                {contact.telefono ? <a href={`tel:${contact.telefono.replace(/[^0-9+]/g, "")}`} aria-label={`Llamar a ${contact.nombre}`} className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold ${category.id === "EMERGENCIA" ? "bg-rose-600 text-white" : "bg-slate-900 text-white"}`}><Phone className="size-4" />{contact.telefono}</a> : null}
                {renderActions?.(contact)}
              </li>
            ))}</ul>
          </section>
        );
      })}
    </div>
  );
}
