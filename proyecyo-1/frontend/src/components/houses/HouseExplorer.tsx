import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import type { HouseDetail, HouseRecord, HouseSummary } from "@/types/houses";
import { buildHouseMapLayout } from "@/utils/houseMapLayout";
import { supportsWebGL } from "./HouseMap";
import type { MapView, SceneAmbient } from "./HouseMap3D";
import {contractLabels} from '@/types/propertyContracts';
import "./houseExplorer.css";

// Pagina /admin/viviendas con el diseño de "Residencial Los Pinos · Elige tu lote".
// Todos los datos (viviendas, estados, precios, modelos, residentes) vienen de la BD.
const HouseMap3D = lazy(() => import("./HouseMap3D"));

type StatusFilter = "DISPONIBLE" | "OCUPADA" | "INACTIVA";
const STATUS: Record<StatusFilter, { texto: string; css: string }> = {
  DISPONIBLE: { texto: "Disponible", css: "--avail" },
  OCUPADA: { texto: "Ocupada", css: "--res" },
  INACTIVA: { texto: "Inactiva", css: "--sold" },
};
const statusOf = (h: { activo: boolean; estado: "DISPONIBLE" | "OCUPADA" }): StatusFilter => (!h.activo ? "INACTIVA" : h.estado);

export const money = (value: number | null) =>
  value == null ? "Sin precio" : `Q${value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const WORDS = ["Cero", "Un", "Dos", "Tres", "Cuatro", "Cinco", "Seis", "Siete", "Ocho", "Nueve", "Diez"];
const countWord = (n: number) => WORDS[n] ?? String(n);

const ICONS: Record<string, string> = {
  terreno: '<path d="M4 4h16v16H4z"/><path d="M4 9h5V4"/>',
  casa: '<path d="M3 11l9-7 9 7v9H3z"/><path d="M9 20v-6h6v6"/>',
  cama: '<path d="M3 18v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7"/><path d="M3 14h18M7 9V6h4v3"/>',
  bano: '<path d="M4 12h16v3a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/><path d="M6 12V6a2 2 0 0 1 4 0"/>',
  niveles: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  personas: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15 15a5 5 0 0 1 6 5"/>',
};
const Icon = ({ name }: { name: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[name] }} />
);

class SceneBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

interface HouseExplorerProps {
  houses: HouseRecord[];
  summary: HouseSummary;
  selected: HouseRecord | null;
  detail: HouseDetail | null;
  detailLoading: boolean;
  detailError: string;
  feedback: string;
  busy: boolean;
  onSelect: (house: HouseRecord) => void;
  onClose: () => void;
  onRetryDetail: () => void;
  onEdit: (detail: HouseDetail) => void;
  onToggleActive: (detail: HouseDetail) => void;
  webglSupported?: boolean; // solo pruebas
}

export function HouseExplorer({
  houses, summary, selected, detail, detailLoading, detailError, feedback, busy,
  onSelect, onClose, onRetryDetail, onEdit, onToggleActive, webglSupported,
}: HouseExplorerProps) {
  const [filters, setFilters] = useState<Record<StatusFilter, boolean>>({ DISPONIBLE: true, OCUPADA: true, INACTIVA: true });
  const [modelFilter, setModelFilter] = useState("todos");
  const [view, setView] = useState<MapView>("3d");
  const [ambient, setAmbient] = useState<SceneAmbient>("dia");
  const [closeUp, setCloseUp] = useState<{ id: number; n: number } | null>(null);
  const [webgl] = useState(() => webglSupported ?? supportsWebGL());
  const [failure, setFailure] = useState("");
  const mapRef = useRef<HTMLElement>(null);

  const layout = useMemo(() => buildHouseMapLayout(houses), [houses]);
  const models = useMemo(() => {
    const map = new Map<string, HouseRecord[]>();
    houses.filter((h) => h.modelo).forEach((h) => map.set(h.modelo as string, [...(map.get(h.modelo as string) ?? []), h]));
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, "es"));
  }, [houses]);
  const prices = houses.map((h) => h.precio).filter((p): p is number => p != null);
  const counts: Record<StatusFilter, number> = { DISPONIBLE: summary.disponibles, OCUPADA: summary.ocupadas, INACTIVA: summary.inactivas };

  const isVisible = useCallback((h: HouseRecord) => filters[statusOf(h)] && (modelFilter === "todos" || h.modelo === modelFilter), [filters, modelFilter]);
  const isDimmed = useCallback((h: HouseRecord) => !isVisible(h), [isVisible]);
  const describe = useCallback((h: HouseRecord) => `Vivienda ${h.codigo}, ${h.modelo ?? "sin modelo"}, ${STATUS[statusOf(h)].texto.toLowerCase()}`, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && selected) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, onClose]);

  const house = detail && selected && detail.id_casa === selected.id_casa ? detail : null;
  const shown = house ?? selected;
  const status = shown ? statusOf(shown) : null;

  return (
    <div className="pinos">
      <section className="hero" ref={mapRef} aria-label="Mapa 3D del residencial">
        <div className="intro glass">
          <h1>Viviendas del residencial</h1>
          <p>
            <strong>{summary.disponibles} de {summary.total} viviendas</strong> siguen disponibles.
            {prices.length ? ` Casas desde ${money(Math.min(...prices))}.` : ""}
          </p>
          <div className="chips">
            {(Object.keys(STATUS) as StatusFilter[]).map((key) => (
              <button key={key} type="button" className="chip" aria-pressed={filters[key]}
                onClick={() => setFilters((current) => ({ ...current, [key]: !current[key] }))}>
                <span className="dot" style={{ background: `var(${STATUS[key].css})` }} />
                {STATUS[key].texto} <span className="count">{counts[key]}</span>
              </button>
            ))}
          </div>
          <div className="selects">
            <select aria-label="Filtrar por modelo" value={modelFilter} onChange={(e) => setModelFilter(e.target.value)}>
              <option value="todos">Todos los modelos</option>
              {models.map(([name]) => <option key={name} value={name}>Casa {name}</option>)}
            </select>
            <select aria-label="Ir a una vivienda" value={selected?.id_casa ?? ""}
              onChange={(e) => { const h = houses.find((x) => x.id_casa === Number(e.target.value)); if (h) onSelect(h); }}>
              <option value="">Buscar vivienda</option>
              {houses.map((h) => <option key={h.id_casa} value={h.id_casa}>Vivienda {h.codigo}</option>)}
            </select>
          </div>
        </div>

        <div className="scene">
          {webgl && !failure ? (
            <SceneBoundary onError={() => setFailure("No se pudo cargar el mapa 3D. Revisa tu conexión y recarga la página.")}>
              <Suspense fallback={<div className="fallback">Cargando mapa 3D…</div>}>
                <HouseMap3D layout={layout} selectedId={selected?.id_casa ?? null} isDimmed={isDimmed} describe={describe}
                  onSelect={onSelect} onFailure={setFailure} view={view} ambient={ambient} autoRotate closeUp={closeUp} flyOnSelect />
              </Suspense>
            </SceneBoundary>
          ) : (
            <div className="fallback" role="status">
              {failure || "El mapa 3D no pudo iniciar en este navegador. Prueba con Chrome, Edge o Safari actualizados. Usa \"Buscar vivienda\" para ver cada casa."}
            </div>
          )}
          {webgl && !failure ? (
            <div className="controls">
              <div className="seg glass" role="group" aria-label="Vista">
                <button type="button" aria-pressed={view === "3d"} onClick={() => setView("3d")}>3D</button>
                <button type="button" aria-pressed={view === "aerea"} onClick={() => setView("aerea")}>Aérea</button>
              </div>
              <div className="seg glass" role="group" aria-label="Iluminación">
                <button type="button" aria-pressed={ambient === "dia"} onClick={() => setAmbient("dia")}>Día</button>
                <button type="button" aria-pressed={ambient === "noche"} onClick={() => setAmbient("noche")}>Noche</button>
              </div>
            </div>
          ) : null}
          {webgl && !failure ? <div className="hint glass">Arrastra para girar y toca una casa</div> : null}

          <aside className={`panel glass${shown ? " open" : ""}`} aria-live="polite" aria-label="Detalle de la vivienda" aria-hidden={!shown}>
            {shown && status ? (
              <>
                <button type="button" className="close" aria-label="Cerrar detalle" onClick={onClose}>×</button>
                <p className="lot-ref">{shown.torre ? `Manzana ${shown.torre}, casa ${shown.numero}` : `Casa ${shown.numero}`}</p>
                <h2>Casa {shown.modelo ?? shown.codigo}</h2>
                <div className="status-row">
                  <span className="badge"><i style={{ background: `var(${STATUS[status].css})` }} />{STATUS[status].texto}</span>
                  <span>Vivienda {shown.codigo}</span>
                </div>
                <p className="price">{money(shown.precio)}</p>
                <p className="price-note">{contractLabels[shown.tipo_contractual||'PENDIENTE_CONFIGURACION']}</p>
                <p className="price-note">{shown.precio == null ? "Precio aún no registrado" : "Precio de lista con terreno incluido"}</p>
                <ul className="specs">
                  <li><Icon name="terreno" /><div><b>{shown.area_terreno != null ? `${shown.area_terreno} m²` : "—"}</b><span>Terreno</span></div></li>
                  <li><Icon name="casa" /><div><b>{shown.area_construccion != null ? `${shown.area_construccion} m²` : "—"}</b><span>Construcción</span></div></li>
                  <li><Icon name="cama" /><div><b>{shown.habitaciones ?? "—"}</b><span>Habitaciones</span></div></li>
                  <li><Icon name="bano" /><div><b>{shown.banos ?? "—"}</b><span>Baños</span></div></li>
                  <li><Icon name="niveles" /><div><b>{shown.niveles ?? "—"}</b><span>{shown.niveles === 1 ? "Nivel" : "Niveles"}</span></div></li>
                  <li><Icon name="personas" /><div><b>{shown.cantidad_inquilinos}</b><span>Inquilinos</span></div></li>
                </ul>
                {webgl && !failure ? (
                  <button type="button" className="btn ghost" onClick={() => setCloseUp((c) => ({ id: shown.id_casa, n: (c?.n ?? 0) + 1 }))}>Ver la casa de cerca</button>
                ) : null}

                {detailLoading ? <p className="msg" role="status">Cargando residente e inquilinos…</p> : null}
                {detailError ? (
                  <div role="alert" className="people">
                    <p>{detailError}</p>
                    <button type="button" className="btn ghost" style={{ marginTop: 10, marginBottom: 0 }} onClick={onRetryDetail}>Reintentar</button>
                  </div>
                ) : null}
                {house ? (
                  <>
                    <div className="people">
                      <h3>Residente</h3>
                      {house.residente ? (
                        <>
                          <p><strong>{house.residente.nombre}</strong></p>
                          <p className="muted">{house.residente.correo}</p>
                          <p className="muted">{house.residente.telefono || "Sin teléfono"}</p>
                        </>
                      ) : <p className="muted">Sin residente: la vivienda está disponible.</p>}
                    </div>
                    <div className="people">
                      <h3>Inquilinos ({house.inquilinos.length})</h3>
                      {house.inquilinos.length ? (
                        <ul>
                          {house.inquilinos.map((t) => (
                            <li key={t.id_usuario}><p><strong>{t.nombre}</strong></p><p className="muted">{t.correo} · {t.autorizado ? "Autorizado" : "Sin autorizar"}</p></li>
                          ))}
                        </ul>
                      ) : <p className="muted">Sin inquilinos asociados.</p>}
                    </div>
                    {feedback ? <p className="msg" role="status">{feedback}</p> : null}
                    <div className="actions">
                      <button type="button" className="btn" onClick={() => onEdit(house)} disabled={busy}>Editar vivienda</button>
                      {house.estado === "DISPONIBLE" && house.activo ? <Link className="btn ghost" to="/admin/usuarios">Asignar residente desde Usuarios</Link> : null}
                      <button type="button" className="btn ghost" onClick={() => onToggleActive(house)} disabled={busy || (house.activo && house.estado === "OCUPADA")}>
                        {house.activo ? "Desactivar vivienda" : "Activar vivienda"}
                      </button>
                    </div>
                    <p className="msg">
                      {house.activo && house.estado === "OCUPADA"
                        ? "Una vivienda ocupada no se puede desactivar. Las viviendas no se eliminan: conservan su historial."
                        : "Las viviendas no se eliminan: conservan su historial de cuotas, pagos y accesos."}
                    </p>
                  </>
                ) : null}
              </>
            ) : null}
          </aside>
        </div>
      </section>

      <section className="modelos" aria-label="Modelos de vivienda">
        <h2>{countWord(models.length)} {models.length === 1 ? "modelo" : "modelos"}, un mismo barrio</h2>
        <p>Modelos registrados en el residencial, con su precio más bajo y las viviendas que siguen disponibles.</p>
        {models.length ? (
          <div className="grid">
            {models.map(([name, list]) => {
              const sample = list[0];
              const free = list.filter((h) => h.activo && h.estado === "DISPONIBLE").length;
              const modelPrices = list.map((h) => h.precio).filter((p): p is number => p != null);
              return (
                <article key={name} className="modelo">
                  <h3>Casa {name}</h3>
                  <div className="meta">
                    {sample.area_construccion != null ? <span>{sample.area_construccion} m²</span> : null}
                    {sample.habitaciones != null ? <span>{sample.habitaciones} habitaciones</span> : null}
                    {sample.banos != null ? <span>{sample.banos} baños</span> : null}
                    {sample.niveles != null ? <span>{sample.niveles} {sample.niveles === 1 ? "nivel" : "niveles"}</span> : null}
                  </div>
                  <p className="desde">Desde<b>{money(modelPrices.length ? Math.min(...modelPrices) : null)}</b>{free} {free === 1 ? "vivienda disponible" : "viviendas disponibles"}</p>
                  <button type="button" className="btn" onClick={() => { setModelFilter(name); mapRef.current?.scrollIntoView?.({ behavior: "smooth" }); }}>
                    Ver estas viviendas en el mapa
                  </button>
                </article>
              );
            })}
          </div>
        ) : <p className="state">Aún no hay modelos registrados en las viviendas.</p>}
      </section>
    </div>
  );
}
