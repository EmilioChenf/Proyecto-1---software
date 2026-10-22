const { requestPasswordReset, resetPassword } = require("../services/passwordResetService");
const { changeOwnPassword } = require("../services/passwordChangeService");
const { getRequestMetadata } = require("../services/auditService");

async function forgotPassword(req, res, next) {
  try {
    const result = await requestPasswordReset(req.body?.email);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function changeForgottenPassword(req, res, next) {
  try {
    const result = await resetPassword(req.body || {}, getRequestMetadata(req));
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

// HU-C01: el usuario cambia su propia contrasena. Solo con una sesion Bearer real;
// el id sale siempre de la sesion validada, nunca del cuerpo de la peticion.
async function changePassword(req, res, next) {
  try {
    if (!req.authSessionId) {
      const error = new Error("Sesion invalida.");
      error.status = 401;
      error.code = "SESSION_REQUIRED";
      throw error;
    }
    const result = await changeOwnPassword(req.authUser.id, req.body || {}, getRequestMetadata(req));
    res.set("Cache-Control", "no-store").status(200).json(result);
  } catch (error) {
    // Solo una contrasena actual incorrecta cuenta como intento para el rate limit.
    if (error.status === 400 && error.code !== "CURRENT_PASSWORD_INVALID") res.locals.rateLimitNotCounted = true;
    next(error);
  }
}

module.exports = { changeForgottenPassword, changePassword, forgotPassword };
