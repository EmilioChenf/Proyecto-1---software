const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const { env } = require("./config/env");
const { mountRecurrenteWebhook } = require("./middlewares/recurrenteRawBody");
const { createWebhookHandler } = require("./controllers/recurrenteWebhookController");
const { logger, sanitizeText } = require("./utils/safeLogger");
const authRoutes = require("./routes/authRoutes");
const activeSessionsRoutes = require("./routes/activeSessionsRoutes");
const auditRoutes = require("./routes/auditRoutes");
const usersRoutes = require("./routes/usersRoutes");
const housesRoutes = require("./routes/housesRoutes");
const userTypesRoutes = require("./routes/userTypesRoutes");
const visitsRoutes = require("./routes/visitsRoutes");
const amenitiesReservationsRoutes = require("./routes/amenitiesReservationsRoutes");
const adminAccessesRoutes = require("./routes/adminAccessesRoutes");
const notificationsRoutes = require("./routes/notificationsRoutes");
const tenantProvidersRoutes = require("./routes/tenantProvidersRoutes");
const adminProvidersRoutes = require("./routes/adminProvidersRoutes");
const announcementsRoutes = require("./routes/announcementsRoutes");
const specialAccessesRoutes = require("./routes/specialAccessesRoutes");
const sprintStoriesRoutes = require("./routes/sprintStoriesRoutes");
const adminPaymentsRoutes = require("./routes/adminPaymentsRoutes");
const adminAuthorizedUsersRoutes = require("./routes/adminAuthorizedUsersRoutes");
const restoresRoutes = require("./routes/restoresRoutes");
const adminSanctionsRoutes = require("./routes/adminSanctionsRoutes");
const configurationRoutes = require("./routes/configurationRoutes");
const financialRulesRoutes = require("./routes/financialRulesRoutes");
const sanctionHistoryRoutes = require("./routes/sanctionHistoryRoutes");
const residentMonthlySummaryRoutes = require("./routes/residentMonthlySummaryRoutes");
const reportExportRoutes = require("./routes/reportExportRoutes");
const automaticBackupsRoutes = require("./routes/automaticBackupsRoutes");
const demoRequestsRoutes = require("./routes/demoRequestsRoutes");
const adminRemindersRoutes = require("./routes/adminRemindersRoutes");
const residentFinancialDetailRoutes = require("./routes/residentFinancialDetailRoutes");
const residentAccountRoutes = require("./routes/residentAccountRoutes");
const tenantAccountRoutes = require("./routes/tenantAccountRoutes");
const paymentReceiptRoutes = require("./routes/paymentReceiptRoutes");
const { recurrenteCheckoutRoutes } = require("./routes/recurrenteCheckoutRoutes");
const { adminRecurrenteReconciliationRoutes } = require("./routes/adminRecurrenteReconciliationRoutes");
const { adminRecurrenteRefundRoutes } = require("./routes/adminRecurrenteRefundRoutes");

const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Demasiados intentos de inicio de sesion. Intenta de nuevo mas tarde." },
});

const passwordResetRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Demasiadas solicitudes de recuperacion. Intenta de nuevo mas tarde." },
});

function createApp({ recurrenteWebhookHandler, recurrenteCheckoutService, recurrenteReconciliationService, recurrenteRefundService } = {}) {
  const app = express();

  app.use(helmet());

  app.use(
    cors({
      origin: env.FRONTEND_ORIGIN,
      credentials: true,
    }),
  );

  mountRecurrenteWebhook(app, recurrenteWebhookHandler || createWebhookHandler());
  app.use(express.json({ limit: "5mb" }));

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use("/login", loginRateLimiter);
  app.use("/auth/password/forgot", passwordResetRateLimiter);
  app.use(authRoutes);
  app.use(activeSessionsRoutes);
  app.use(auditRoutes);
  app.use(usersRoutes);
  app.use(housesRoutes);
  app.use(require('./routes/propertyContractsRoutes'));
  app.use(userTypesRoutes);
  app.use(visitsRoutes);
  app.use(amenitiesReservationsRoutes);
  app.use(adminAccessesRoutes);
  app.use(notificationsRoutes);
  app.use(tenantProvidersRoutes);
  app.use(adminProvidersRoutes);
  app.use(announcementsRoutes);
  app.use(specialAccessesRoutes);
  app.use(sprintStoriesRoutes);
  app.use(adminPaymentsRoutes);
  app.use(adminAuthorizedUsersRoutes);
  app.use(restoresRoutes);
  app.use(adminSanctionsRoutes);
  app.use(configurationRoutes);
  app.use(financialRulesRoutes);
  app.use(sanctionHistoryRoutes);
  app.use(residentMonthlySummaryRoutes);
  app.use(reportExportRoutes);
  app.use(automaticBackupsRoutes);
  app.use(demoRequestsRoutes);
  app.use(adminRemindersRoutes);
  app.use(residentFinancialDetailRoutes);
  app.use(residentAccountRoutes);
  app.use(tenantAccountRoutes);
  app.use(paymentReceiptRoutes);
  app.use(recurrenteCheckoutRoutes(recurrenteCheckoutService));
  app.use(adminRecurrenteReconciliationRoutes(recurrenteReconciliationService));
  app.use(adminRecurrenteRefundRoutes(recurrenteRefundService));

  app.use((error, _req, res, _next) => {
    const status = error.status || 500;

    let message;
    if (status === 413) {
      message = "La imagen seleccionada es demasiado grande. Prueba con una foto mas ligera.";
    } else if (status >= 500) {
      // No exponer detalles internos (mensajes de MySQL, rutas, stack) al cliente.
      message = "Error interno del servidor";
    } else {
      message = sanitizeText(error.message || "Solicitud invalida");
    }

    if (status >= 500) {
      logger.error("Error de solicitud.", error);
    }

    res.status(status).json({
      message,
      ...(status < 500 && error.code ? { code: sanitizeText(error.code) } : {}),
    });
  });

  return app;
}

module.exports = { createApp };
