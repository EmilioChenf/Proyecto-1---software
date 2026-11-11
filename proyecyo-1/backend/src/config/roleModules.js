// Catálogo de módulos del panel de administración que se pueden asignar a un rol personalizado.
// Cada módulo agrupa las rutas de la API (api) y las pantallas del panel (paths) que abre.
// Una ruta que no pertenece a ningún módulo queda reservada al administrador principal
// (por ejemplo respaldos, restauraciones y la propia gestión de roles).
const ROLE_MODULES = [
  { id: "dashboard", label: "Panel principal e indicadores", readOnly: true, paths: ["/admin"], api: ["/admin/indicadores", "/admin/accesos", "/admin/amenidades/estadisticas"] },
  { id: "finanzas", label: "Finanzas y reporte financiero", paths: ["/admin/finanzas", "/admin/reportes-financieros"], api: ["/admin/finanzas", "/admin/mantenimiento-global", "/admin/facturacion-mensual", "/admin/configuracion-financiera", "/admin/recargos"] },
  { id: "pagos", label: "Pagos y cobros", paths: ["/admin/pagos"], api: ["/admin/pagos"] },
  { id: "reportes", label: "Reportes y exportaciones", paths: ["/admin/reportes"], api: ["/admin/reportes"] },
  { id: "usuarios", label: "Usuarios", paths: ["/admin/usuarios"], api: ["/usuarios", "/tipos-usuario"] },
  { id: "viviendas", label: "Viviendas y contratos", paths: ["/admin/viviendas"], api: ["/admin/viviendas", "/admin/solicitudes-arrendatarios", "/admin/importar"] },
  { id: "accesos", label: "Accesos, autorizados y proveedores", paths: ["/admin/accesos", "/admin/usuarios-autorizados", "/admin/proveedores"], api: ["/admin/accesos", "/admin/usuarios-autorizados", "/admin/proveedores"] },
  { id: "accesos_especiales", label: "Accesos especiales", paths: ["/admin/accesos-especiales"], api: ["/admin/accesos-especiales"] },
  { id: "amenidades", label: "Amenidades y reservas", paths: ["/admin/amenidades"], api: ["/admin/amenidades", "/admin/reservas"] },
  { id: "fallas", label: "Fallas y mantenimiento", paths: ["/admin/fallas"], api: ["/admin/tickets"] },
  { id: "comunicados", label: "Comunicados", paths: ["/admin/comunicados"], api: ["/admin/comunicados"] },
  { id: "comunidad", label: "Votaciones, documentos y directorio", paths: ["/admin/comunidad"], api: ["/admin/comunidad"] },
  { id: "recordatorios", label: "Recordatorios de pago", paths: ["/admin/recordatorios"], api: ["/admin/recordatorios"] },
  { id: "sanciones", label: "Sanciones", paths: ["/admin/sanciones"], api: ["/admin/sanciones", "/admin/sanciones-historial"] },
  { id: "configuracion", label: "Configuración del residencial", paths: ["/admin/configuracion"], api: ["/admin/configuracion"] },
  { id: "auditoria", label: "Auditoría", readOnly: true, paths: ["/admin/auditoria"], api: ["/admin/auditoria"] },
  { id: "solicitudes_demo", label: "Solicitudes de demo", paths: ["/admin/solicitudes-demo"], api: ["/admin/solicitudes-demo"] },
];

const BASE_ROLES = ["admin", "guardia", "residente", "inquilino"];
const LEVELS = ["VER", "EDITAR"];
const MODULE_IDS = new Set(ROLE_MODULES.map((module) => module.id));

function matchesPrefix(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** Módulos que cubren una ruta de la API. */
function modulesForApiPath(path) {
  return ROLE_MODULES.filter((module) => module.api.some((prefix) => matchesPrefix(path, prefix)));
}

/** ¿Los permisos ({modulo: nivel}) permiten este método sobre esta ruta? */
function permissionsAllow(permissions, method, path) {
  const reading = ["GET", "HEAD", "OPTIONS"].includes(String(method).toUpperCase());
  return modulesForApiPath(path).some((module) => {
    const level = permissions[module.id];
    if (!level) return false;
    if (reading) return true;
    return level === "EDITAR" && !module.readOnly;
  });
}

module.exports = { ROLE_MODULES, BASE_ROLES, LEVELS, MODULE_IDS, modulesForApiPath, permissionsAllow };
