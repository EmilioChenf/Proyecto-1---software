const path = require("path");
const dotenv = require("dotenv");
const { loadRecurrenteConfig, KEYS } = require("./recurrente");

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

function getNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getSessionSecret() {
  const value = String(process.env.SESSION_SECRET || "").trim();
  if (value) return value;
  if ((process.env.NODE_ENV || "development") === "production") {
    throw new Error("SESSION_SECRET es obligatorio en produccion.");
  }
  return "nexus-local-development-secret-change-me";
}

// Saltos de proxy confiables para req.ip (rate limiting por cliente real detras de
// un proxy). Solo enteros: "true" confiaria en cualquier X-Forwarded-For falsificado.
function getTrustProxy(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : false;
}

const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  TRUST_PROXY: getTrustProxy(process.env.TRUST_PROXY),
  PORT: getNumber(process.env.PORT, 3000),
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  DB_HOST: process.env.DB_HOST || "localhost",
  DB_PORT: getNumber(process.env.DB_PORT, 3306),
  DB_USER: process.env.DB_USER || "root",
  DB_PASSWORD: process.env.DB_PASSWORD || "",
  DB_NAME: process.env.DB_NAME || "nexus_residencial",
  DB_CONNECTION_LIMIT: getNumber(process.env.DB_CONNECTION_LIMIT, 10),
  USE_BCRYPT: process.env.USE_BCRYPT === "true",
  SESSION_SECRET: getSessionSecret(),
  PASSWORD_RESET_TTL_MINUTES: getNumber(process.env.PASSWORD_RESET_TTL_MINUTES, 30),
  EMAIL_API_URL: process.env.EMAIL_API_URL || "",
  EMAIL_API_KEY: process.env.EMAIL_API_KEY || "",
  EMAIL_FROM: process.env.EMAIL_FROM || "no-reply@nexusresidencial.local",
};

const recurrente = loadRecurrenteConfig();
for (const key of KEYS) Object.defineProperty(env, key, { value: recurrente[key], enumerable: false });
module.exports = { env };
