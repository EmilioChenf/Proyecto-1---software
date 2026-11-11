export const DOC_CATEGORIES = [
  { id: "REGLAMENTO", label: "Reglamento", emoji: "📘" },
  { id: "ACTA", label: "Acta de asamblea", emoji: "📝" },
  { id: "FINANZAS", label: "Estado financiero", emoji: "📊" },
  { id: "AVISO", label: "Aviso", emoji: "📌" },
  { id: "OTRO", label: "Otro", emoji: "📄" },
];
export const CONTACT_CATEGORIES = [
  { id: "EMERGENCIA", label: "Emergencias", emoji: "🚨" },
  { id: "ADMINISTRACION", label: "Administración", emoji: "🏢" },
  { id: "JUNTA", label: "Junta directiva", emoji: "🤝" },
  { id: "SERVICIOS", label: "Servicios de confianza", emoji: "🧰" },
];
export const docCategory = (id: string) => DOC_CATEGORIES.find((c) => c.id === id) ?? DOC_CATEGORIES[4];
export const formatSize = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
