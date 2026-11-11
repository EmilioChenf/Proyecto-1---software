const { verifySessionTokenDetails } = require('../services/sessionTokenService');
const { assertActiveSession } = require('../services/activeSessionsService');
const { getCurrentSession } = require('../services/authService');
async function requireAdminSession(req, _res, next) {
  try {
    const token = String(req.header('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
    const details = verifySessionTokenDetails(token);
    if (!details) throw Object.assign(new Error('Inicia sesión para consultar conciliación.'), { status: 401 });
    await assertActiveSession(details.sub, details.sid);
    const user = await getCurrentSession(details.sub);
    if (user.role !== 'admin' && !(await require('./requireRoles').customRoleAllowed(user.role, ['admin'], req))) throw Object.assign(new Error('Acceso restringido a administradores.'), { status: 403 });
    req.authUser = { id: user.id, role: user.role }; req.authSessionId = details.sid; next();
  } catch (e) { next(e); }
}
module.exports = { requireAdminSession };
