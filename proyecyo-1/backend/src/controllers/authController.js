const { loginUser, getCurrentSession } = require("../services/authService");
const { revokeSession } = require("../services/activeSessionsService");
const { getAuthenticatedSession } = require("../middlewares/requireRoles");
const { getRequestMetadata, recordAudit } = require("../services/auditService");
const { decorateSessionUser } = require("../services/customRolesService");

async function login(req, res, next) {
  try {
    const response = await loginUser(req.body || {}, {
      userAgent: req.header("user-agent"),
      ipAddress: req.ip || req.socket?.remoteAddress,
    });
    res.status(200).json(await decorateSessionUser(response));
  } catch (error) {
    next(error);
  }
}

async function session(req, res, next) {
  try {
    const authenticated = await getAuthenticatedSession(req);
    const current = await getCurrentSession(authenticated?.userId, authenticated?.token);
    res.status(200).json(await decorateSessionUser(current));
  } catch (error) {
    next(error);
  }
}

async function logout(req, res, next) {
  try {
    const authenticated = await getAuthenticatedSession(req);
    if (!authenticated?.sessionId) {
      const error = new Error("Sesion invalida.");
      error.status = 401;
      throw error;
    }
    await revokeSession(authenticated.userId, authenticated.sessionId);
    await recordAudit({
      userId: authenticated.userId,
      action: "SESSION_REVOKED",
      entity: "SESION_ACTIVA",
      entityId: authenticated.sessionId,
      newData: { actual: true, cerrada: true },
      metadata: getRequestMetadata(req),
    });
    res.status(200).json({ message: "Sesión cerrada." });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  login,
  logout,
  session,
};
