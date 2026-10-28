import { useFeedbackState } from "@/hooks/useFeedbackState";
import { useEffect, useMemo, useState } from "react";
import { BookOpen, Search } from "lucide-react";

import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getResidentRegulationsRequest } from "@/services/sprintStoriesService";
import type { Regulation } from "@/types/sprintStories";
import { formatUtcTimestamp } from "@/utils/guatemalaTime";

export function ResidenteRegulationsView() {
  const [regulations, setRegulations] = useState<Regulation[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useFeedbackState("error", "");

  useEffect(() => {
    let active = true;
    setLoading(true);

    getResidentRegulationsRequest({ search, category })
      .then((response) => {
        if (active) {
          setError("");
          setRegulations(response);
          setSelectedId((current) => current ?? response[0]?.id_reglamento ?? null);
        }
      })
      .catch((reason) => {
        if (active) {
          setRegulations([]);
          setError(reason instanceof Error && reason.message ? reason.message : "No fue posible cargar los reglamentos.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [category, search]);

  const categories = useMemo(
    () => Array.from(new Set(regulations.map((item) => item.categoria))).sort(),
    [regulations],
  );
  const selected = regulations.find((item) => item.id_reglamento === selectedId) || regulations[0] || null;

  return (
    <AppShell role="residente" title="Reglamentos" subtitle="Reglas del residencial por categoría, con búsqueda y detalle.">

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="size-5 text-blue-600" />
            Biblioteca de reglamentos
          </CardTitle>
          <CardDescription>Consulte las reglas vigentes del residencial.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
            <label className="relative block">
              <span className="sr-only">Buscar reglamento</span>
              <Search className="absolute left-3 top-3 size-4 text-slate-400" aria-hidden="true" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar reglamento..."
                className="h-11 rounded-2xl border-slate-100 bg-slate-50 pl-10"
              />
            </label>
            <select
              aria-label="Filtrar por categoría"
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setSelectedId(null);
              }}
              className="h-11 rounded-2xl border border-slate-100 bg-slate-50 px-4 text-sm"
            >
              <option value="">Todas las categorías</option>
              {categories.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="max-h-[460px] space-y-2 overflow-y-auto rounded-2xl bg-slate-50 p-3">
              {loading && regulations.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-slate-500">Cargando reglamentos...</p>
              ) : null}
              {error ? (
                <p role="alert" className="rounded-xl bg-rose-50 px-3 py-3 text-sm text-rose-700">{error}</p>
              ) : null}
              {!loading && !error && regulations.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-slate-500">No se encontraron reglamentos.</p>
              ) : null}
              {regulations.map((item) => (
                <button
                  key={item.id_reglamento}
                  type="button"
                  onClick={() => setSelectedId(item.id_reglamento)}
                  aria-pressed={selected?.id_reglamento === item.id_reglamento}
                  className={`w-full rounded-xl px-4 py-3 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    selected?.id_reglamento === item.id_reglamento ? "bg-blue-600 text-white" : "bg-white text-slate-700 hover:bg-blue-50"
                  }`}
                >
                  <span className="block text-xs opacity-80">{item.categoria}</span>
                  {item.titulo}
                </button>
              ))}
            </div>

            <article className="max-h-[460px] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5">
              {selected ? (
                <>
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                    {selected.categoria}
                  </span>
                  <h3 className="mt-4 text-2xl font-semibold text-slate-900">{selected.titulo}</h3>
                  <p className="mt-4 whitespace-pre-line text-sm leading-7 text-slate-600">{selected.contenido}</p>
                  <p className="mt-6 text-xs text-slate-400">Actualizado: {formatUtcTimestamp(selected.actualizado_en)}</p>
                </>
              ) : (
                <p className="text-sm text-slate-500">Seleccione un reglamento para ver el detalle.</p>
              )}
            </article>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
