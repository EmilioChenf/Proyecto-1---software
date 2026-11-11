// Módulos del panel que un rol personalizado puede ver (espejo de backend/src/config/roleModules.js).
export type ModuleLevel = "VER" | "EDITAR";

export const ROLE_MODULE_PATHS: Record<string, string[]> = {
  dashboard: ["/admin", "/admin/indicadores"],
  finanzas: ["/admin/finanzas", "/admin/reportes-financieros"],
  pagos: ["/admin/pagos"],
  reportes: ["/admin/reportes"],
  usuarios: ["/admin/usuarios"],
  viviendas: ["/admin/viviendas", "/admin/importar"],
  accesos: ["/admin/accesos", "/admin/usuarios-autorizados", "/admin/proveedores"],
  accesos_especiales: ["/admin/accesos-especiales"],
  amenidades: ["/admin/amenidades"],
  fallas: ["/admin/fallas"],
  comunicados: ["/admin/comunicados"],
  comunidad: ["/admin/comunidad"],
  recordatorios: ["/admin/recordatorios"],
  sanciones: ["/admin/sanciones"],
  configuracion: ["/admin/configuracion"],
  auditoria: ["/admin/auditoria"],
  solicitudes_demo: ["/admin/solicitudes-demo"],
};

/** Apariencia de cada módulo en el editor de roles. */
export const ROLE_MODULE_META: Record<string, { emoji: string; hint: string }> = {
  dashboard: { emoji: "📊", hint: "Resumen del día e indicadores" },
  finanzas: { emoji: "💰", hint: "Ingresos, morosidad, cuotas y reporte financiero" },
  pagos: { emoji: "💳", hint: "Registrar y revisar pagos, reembolsos y conciliación" },
  reportes: { emoji: "📈", hint: "Reportes y exportaciones a Excel/PDF" },
  usuarios: { emoji: "👥", hint: "Alta de guardias, residentes e inquilinos" },
  viviendas: { emoji: "🏠", hint: "Mapa de casas, contratos e importación" },
  accesos: { emoji: "🚪", hint: "Bitácora de ingresos, autorizados y proveedores" },
  accesos_especiales: { emoji: "🛡️", hint: "Mudanzas, emergencias y accesos fuera de horario" },
  amenidades: { emoji: "🏊", hint: "Catálogo de amenidades y reservas" },
  fallas: { emoji: "🔧", hint: "Reportes de fallas con foto" },
  comunicados: { emoji: "📣", hint: "Avisos a la comunidad" },
  comunidad: { emoji: "🗳️", hint: "Votaciones, documentos y directorio" },
  recordatorios: { emoji: "⏰", hint: "Recordatorios de pago" },
  sanciones: { emoji: "⚠️", hint: "Multas y reglas de sanción" },
  configuracion: { emoji: "⚙️", hint: "Marca, horarios de visita y datos generales" },
  auditoria: { emoji: "🧾", hint: "Quién hizo qué y cuándo" },
  solicitudes_demo: { emoji: "✉️", hint: "Personas interesadas en el sistema" },
};

function matches(pathname: string, prefix: string, exact: boolean) {
  return pathname === prefix || (!exact && pathname.startsWith(`${prefix}/`));
}

/** ¿El usuario puede abrir esta pantalla del panel? Sin `permisos` es el administrador principal. */
export function canOpenAdminPath(permisos: Record<string, ModuleLevel> | undefined, pathname: string) {
  if (!permisos) return true;
  return Object.keys(permisos).some((module) => (ROLE_MODULE_PATHS[module] ?? []).some((prefix) => matches(pathname, prefix, prefix === "/admin")));
}

/** Primera pantalla disponible para un rol personalizado. */
export function firstAllowedAdminPath(permisos: Record<string, ModuleLevel> | undefined) {
  if (!permisos) return "/admin";
  if (permisos.dashboard) return "/admin";
  const first = Object.keys(ROLE_MODULE_PATHS).find((module) => permisos[module]);
  return first ? ROLE_MODULE_PATHS[first][0] : "/cuenta/sesiones";
}
