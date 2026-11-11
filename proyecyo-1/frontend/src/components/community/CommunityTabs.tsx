export type CommunityTab = "votaciones" | "documentos" | "directorio";
const TABS: Array<{ id: CommunityTab; label: string; emoji: string }> = [
  { id: "votaciones", label: "Votaciones", emoji: "🗳️" },
  { id: "documentos", label: "Documentos", emoji: "📁" },
  { id: "directorio", label: "Directorio", emoji: "📞" },
];

export function CommunityTabs({ value, onChange, counts = {} }: { value: CommunityTab; onChange: (tab: CommunityTab) => void; counts?: Partial<Record<CommunityTab, number>> }) {
  return (
    <div role="tablist" aria-label="Secciones de comunidad" className="mb-5 inline-flex flex-wrap gap-1 rounded-2xl bg-slate-100 p-1">
      {TABS.map((tab) => (
        <button key={tab.id} role="tab" type="button" aria-selected={value === tab.id} onClick={() => onChange(tab.id)}
          className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${value === tab.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
          <span aria-hidden className="mr-1.5">{tab.emoji}</span>{tab.label}{counts[tab.id] ? <span className="ml-1.5 rounded-full bg-slate-900 px-1.5 text-[11px] text-white">{counts[tab.id]}</span> : null}
        </button>
      ))}
    </div>
  );
}
