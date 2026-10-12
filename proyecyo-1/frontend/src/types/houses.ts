// Estado calculado SOLO por el backend (housesService.HOUSE_STATUS_SQL):
// OCUPADA si la vivienda tiene residente, DISPONIBLE si no.
export type HouseStatus = "DISPONIBLE" | "OCUPADA";
export type HouseSelectionRole = "residente" | "inquilino" | 'contrato';

export interface HouseRecord {
  id_casa: number;
  numero: string;
  torre: string | null;
  codigo: string;
  estado: HouseStatus;
  activo: boolean;
  precio: number | null;
  area_terreno: number | null;
  area_construccion: number | null;
  habitaciones: number | null;
  banos: number | null;
  niveles: number | null;
  modelo: string | null;
  mapa_fila: number | null;
  mapa_columna: number | null;
  creado_en: string | null;
  residente: { id_usuario: number; nombre: string } | null;
  cantidad_inquilinos: number;
  tipo_contractual?:import('./propertyContracts').ContractType|'PENDIENTE_CONFIGURACION';
  version_contractual?:number;
  // Solo presentes cuando se pide ?seleccion= (informativo; el backend revalida al guardar).
  elegible?: boolean;
  motivo?: string | null;
}

export interface HouseSummary {
  total: number;
  disponibles: number;
  ocupadas: number;
  inactivas: number;
}

export interface HouseList {
  resumen: HouseSummary;
  viviendas: HouseRecord[];
}

export interface HousePerson {
  id_usuario: number;
  nombre: string;
  correo: string;
  telefono: string | null;
}

export interface HouseDetail extends Omit<HouseRecord, "residente"> {
  residente: HousePerson | null;
  inquilinos: Array<HousePerson & { autorizado: boolean }>;
  tiene_historial_financiero: boolean;
}

export interface HouseFormValues {
  numero: string;
  torre: string;
  precio: string;
  area_terreno: string;
  area_construccion: string;
  habitaciones: string;
  banos: string;
  niveles: string;
  modelo: string;
  mapa_fila: string;
  mapa_columna: string;
}
