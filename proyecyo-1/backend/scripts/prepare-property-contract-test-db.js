// Explicit, disposable localhost fixture only. Never reads .env or production settings.
const mysql = require('mysql2/promise');
const { isolatedConfig,configureTestEnvironment } = require('../test/integration/support/isolatedMysql');
async function main() {
  const config=isolatedConfig();
  if (![21479,21480].includes(config.port) || !/^nexus_phase0_test_20261011_[a-f0-9]{8}$/.test(config.database)) throw new Error('Se requiere el servidor temporal exclusivo de contratos.');
  const admin=await mysql.createConnection({...config,database:undefined});
  try { await admin.query(`CREATE DATABASE \`${config.database}\``); } finally { await admin.end(); }
  configureTestEnvironment();
  await require('../test/integration/support/initializeTestSchema').initializeTestSchema();
  const db=require('../src/database/mysql');
  try {
    for (const [name,ensure] of Object.entries(db)) if(name.startsWith('ensure')) await ensure();
    const c=await db.pool.getConnection();
    try {
      const migrations=require('../src/database/recurrenteMigration');
      for (const name of ['applyRecurrentePreparation','applyRecurrenteCheckoutMigration','applyRecurrenteConfirmationMigration','applyRecurrenteAttemptsMigration','applyRecurrenteRefundsMigration','applyRecurrenteIntentHistoryMigration','applyRecurrenteReviewPrecisionMigration','applyFinancialNotificationsMigration']) await migrations[name](c);
      await require('../src/database/propertyContractMigration').applyPropertyContractMigration(c);
      await require('../test/integration/support/receiptEvidenceFixture').seedReceiptEvidence(c);
    } finally {c.release();}
    console.log(JSON.stringify({database:config.database,port:config.port,localDisposableOnly:true}));
  } finally {await db.pool.end();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
