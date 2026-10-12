// Called only by the migration suite for a UUID-owned disposable schema.
const {configureTestEnvironment}=require('../test/integration/support/isolatedMysql');
const {assertOwnedSuiteDatabase}=require('../test/integration/support/suiteIsolation');
configureTestEnvironment();assertOwnedSuiteDatabase();
async function main(){
  await require('../test/integration/support/initializeTestSchema').initializeTestSchema();
  const db=require('../src/database/mysql');
  try{
    for(const [name,ensure] of Object.entries(db))if(name.startsWith('ensure'))await ensure();
    const c=await db.pool.getConnection();
    try{const m=require('../src/database/recurrenteMigration');for(const name of ['applyRecurrentePreparation','applyRecurrenteCheckoutMigration','applyRecurrenteConfirmationMigration','applyRecurrenteAttemptsMigration','applyRecurrenteRefundsMigration','applyRecurrenteIntentHistoryMigration','applyRecurrenteReviewPrecisionMigration','applyFinancialNotificationsMigration'])await m[name](c);}finally{c.release();}
  }finally{await db.pool.end();}
}
main().catch(error=>{console.error(error.code||error.name);process.exitCode=1;});
