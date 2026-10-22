const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

const { verifySessionTokenDetails } = require("../services/sessionTokenService");

const WINDOW_MS = 15 * 60 * 1000;

// HU-C01: limites de los POST sensibles de autenticacion. Las cuentas son por IP,
// salvo el cambio de contrasena, que es por usuario autenticado para que un
// atacante con una sesion robada no pueda probar contrasenas desde varias IP.
const SECURITY_RATE_LIMITS = {
  login: { windowMs: WINDOW_MS, limit: 20, message: "Demasiados intentos de inicio de sesion. Intenta de nuevo mas tarde." },
  passwordForgot: { windowMs: WINDOW_MS, limit: 5, message: "Demasiadas solicitudes de recuperacion. Intenta de nuevo mas tarde." },
  passwordReset: { windowMs: WINDOW_MS, limit: 10, message: "Demasiados intentos de restablecer la contrasena. Intenta de nuevo mas tarde." },
  passwordChange: { windowMs: WINDOW_MS, limit: 5, message: "Demasiados intentos de cambio de contrasena. Intenta de nuevo mas tarde." },
};

function sessionUserKey(req) {
  const token = String(req.header("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  const details = verifySessionTokenDetails(token);
  return details ? `usuario:${details.sub}` : `ip:${ipKeyGenerator(req.ip || "")}`;
}

// Un error de formulario (confirmacion distinta, politica) no es un intento de adivinar
// credenciales: el controlador lo marca en res.locals y no consume el limite.
function countsTowardLimit(_req, res) {
  return res.locals.rateLimitNotCounted !== true;
}

function createLimiter({ windowMs, limit, message }, keyGenerator) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    requestWasSuccessful: (req, res) => !countsTowardLimit(req, res),
    ...(keyGenerator ? { keyGenerator } : {}),
    // Mismo formato de error que el resto de la API: { message, code }.
    handler: (_req, res) => {
      res.status(429).json({ message, code: "RATE_LIMITED" });
    },
  });
}

// Se crean por instancia de la app: cada app (y cada prueba) tiene su propio contador.
function createSecurityRateLimiters() {
  return {
    login: createLimiter(SECURITY_RATE_LIMITS.login),
    passwordForgot: createLimiter(SECURITY_RATE_LIMITS.passwordForgot),
    passwordReset: createLimiter(SECURITY_RATE_LIMITS.passwordReset),
    passwordChange: createLimiter(SECURITY_RATE_LIMITS.passwordChange, sessionUserKey),
  };
}

module.exports = { SECURITY_RATE_LIMITS, createSecurityRateLimiters };
