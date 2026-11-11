const { env } = require("../config/env");
const { getCurrentSession } = require("../services/authService");
const { assertActiveSession } = require("../services/activeSessionsService");
const { verifySessionTokenDetails } = require("../services/sessionTokenService");
const { BASE_ROLES, permissionsAllow } = require("../config/roleModules");

/**
 * Un rol personalizado entra a rutas de administrador solo si alguno de sus módulos
 * cubre la ruta con el nivel necesario (Ver para consultar, Editar para cambiar).
 * Las rutas abiertas a cualquier usuario autenticado (sesión, cambio de contraseña) siempre se permiten.
 */
async function customRoleAllowed(role, allowedRoles, req) {
  if (BASE_ROLES.includes(role) || !allowedRoles.includes("admin")) return false;
  const { getPermissionsForRoleName } = require("../services/customRolesService");
  const custom = await getPermissionsForRoleName(role);
  if (!custom) return false;
  if (BASE_ROLES.every((base) => allowedRoles.includes(base))) return true;
  const path = String(req.baseUrl || "") + String(req.path || "");
  return permissionsAllow(custom.permisos, req.method, path);
}

function unauthorized(message = "Sesion invalida.", status = 401) {
  const error = new Error(message);
  error.status = status;
  if (status === 401) error.code = "SESSION_REQUIRED";
  return error;
}

async function getAuthenticatedSession(req) {
  const authorization = String(req.header("authorization") || "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const tokenDetails = verifySessionTokenDetails(match?.[1]);
  if (tokenDetails) {
    await assertActiveSession(tokenDetails.sub, tokenDetails.sid);
    return { userId: tokenDetails.sub, sessionId: tokenDetails.sid, token: match[1] };
  }

  // La suite historica usa cabeceras simuladas. Nunca se aceptan fuera de tests.
  if (env.NODE_ENV === "test" || process.env.NODE_TEST_CONTEXT) {
    const testUserId = Number(req.header("x-user-id"));
    return Number.isInteger(testUserId) && testUserId > 0
      ? { userId: testUserId, sessionId: null, token: null }
      : null;
  }
  return null;
}

function requireRoles(allowedRoles, message = "Acceso restringido.") {
  return async function authorize(req, _res, next) {
    try {
      const authenticated = await getAuthenticatedSession(req);
      if (!authenticated) throw unauthorized();
      const userId = authenticated.userId;

      let current;
      if ((env.NODE_ENV === "test" || process.env.NODE_TEST_CONTEXT) && !req.header("authorization")) {
        current = { id: userId, role: String(req.header("x-user-role") || "").trim().toLowerCase() };
      } else {
        current = await getCurrentSession(userId);
      }

      if (!allowedRoles.includes(current.role) && !(await customRoleAllowed(current.role, allowedRoles, req))) {
        throw unauthorized(current.role && !BASE_ROLES.includes(current.role) ? "Tu rol no tiene permiso para esta sección." : message, 403);
      }
      req.authUser = { id: current.id, role: current.role };
      req.authSessionId = authenticated.sessionId;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { getAuthenticatedSession, requireRoles, customRoleAllowed };
