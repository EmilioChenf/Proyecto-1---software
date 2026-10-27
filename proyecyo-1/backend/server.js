const { createApp } = require("./src/app");
const { env } = require("./src/config/env");
const { applyRecurrentePreparation, applyRecurrenteCheckoutMigration, applyRecurrenteConfirmationMigration, applyRecurrenteAttemptsMigration, applyRecurrenteRefundsMigration, applyRecurrenteIntentHistoryMigration, applyRecurrenteReviewPrecisionMigration, applyFinancialNotificationsMigration } = require("./src/database/recurrenteMigration");
const { logger } = require("./src/utils/safeLogger");
const {
  ensureVisitQrSchema,
  ensureQrValidationAttemptsSchema,
  ensureAccessGuardAuditSchema,
  ensureAmenityReservationsSchema,
  ensureNotificationsSchema,
  ensureActiveSessionsSchema,
  ensurePasswordResetSchema,
  ensureAuditSchema,
  ensureTenantProvidersSchema,
  ensureAnnouncementsSchema,
  ensureSpecialAccessSchema,
  ensureSprintUserStoriesSchema,
  ensureRestoreHistorySchema,
  ensureFinancialRulesSchema,
  ensureSanctionsSchema,
  ensureConfigurationSchema,
  ensureAutomaticBackupsSchema,
  ensureRemindersSchema,
  ensureSimulatedPaymentsSchema,
  ensureDemoRequestsSchema,
  ensureHousesSchema,
  ensureAccessHistoryPreservationSchema,
  ensureReservationAuditSchema,
  pool,
  query,
} = require("./src/database/mysql");
const { startScheduler } = require("./src/services/automaticBackupsService");
const { startReminderScheduler } = require("./src/services/adminRemindersService");

const DB_READY_RETRIES = 30;
const DB_READY_DELAY_MS = 2000;

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForDatabase() {
  for (let attempt = 1; attempt <= DB_READY_RETRIES; attempt += 1) {
    try {
      await query("SELECT 1");
      return;
    } catch (error) {
      const isLastAttempt = attempt === DB_READY_RETRIES;

      if (isLastAttempt) {
        throw error;
      }

      console.log(
        `Base de datos no disponible todavia (${attempt}/${DB_READY_RETRIES}). Reintentando...`,
      );
      await delay(DB_READY_DELAY_MS);
    }
  }
}

async function startServer() {
  await waitForDatabase();
  await ensureVisitQrSchema();
  await ensureQrValidationAttemptsSchema();
  await ensureAccessGuardAuditSchema();
  await ensureAmenityReservationsSchema();
  await ensureNotificationsSchema();
  await ensureActiveSessionsSchema();
  await ensurePasswordResetSchema();
  await ensureAuditSchema();
  await ensureTenantProvidersSchema();
  await ensureAnnouncementsSchema();
  await ensureSpecialAccessSchema();
  await ensureSprintUserStoriesSchema();
  await ensureRestoreHistorySchema();
  await ensureFinancialRulesSchema();
  await ensureSanctionsSchema();
  await ensureConfigurationSchema();
  await ensureAutomaticBackupsSchema();
  await ensureRemindersSchema();
  await ensureSimulatedPaymentsSchema();
  await ensureHousesSchema();
  await ensureAccessHistoryPreservationSchema();
  await ensureReservationAuditSchema();
  const migrationConnection = await pool.getConnection();
  try { await applyRecurrentePreparation(migrationConnection); await applyRecurrenteCheckoutMigration(migrationConnection); await applyRecurrenteConfirmationMigration(migrationConnection); await applyRecurrenteAttemptsMigration(migrationConnection); await applyRecurrenteRefundsMigration(migrationConnection); await applyRecurrenteIntentHistoryMigration(migrationConnection); await applyRecurrenteReviewPrecisionMigration(migrationConnection); await applyFinancialNotificationsMigration(migrationConnection); }
  finally { migrationConnection.release(); }
  const contractMigrationConnection = await pool.getConnection();
  try { await require('./src/database/propertyContractMigration').applyPropertyContractMigration(contractMigrationConnection); }
  finally { contractMigrationConnection.release(); }
  await ensureDemoRequestsSchema();
  startScheduler();
  startReminderScheduler();

  const app = createApp();

  app.listen(env.PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${env.PORT}`);
  });
}

startServer().catch((error) => {
  logger.error("No fue posible iniciar el servidor.", error);
  process.exit(1);
});
