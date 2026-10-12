const path = require('node:path');
const { migrationStatements } = require('./recurrenteMigration');

const PROPERTY_CONTRACT_MIGRATION_PATH = path.resolve(__dirname, '../../sql/migrations/009_property_contract_billing.sql');
const PROPERTY_AUDIT_FIXES_MIGRATION_PATH = path.resolve(__dirname, '../../sql/migrations/010_property_contract_audit_fixes.sql');
async function applyPropertyContractMigration(connection) {
  const [[lock]] = await connection.execute("SELECT GET_LOCK('nexus_property_contract_billing',30) acquired");
  if (Number(lock.acquired) !== 1) throw new Error('No se pudo bloquear la migración contractual.');
  try {
    for (const statement of migrationStatements(PROPERTY_CONTRACT_MIGRATION_PATH)) await connection.query(statement);
    for (const statement of migrationStatements(PROPERTY_AUDIT_FIXES_MIGRATION_PATH)) await connection.query(statement);
    await connection.beginTransaction();
    try { await require('../services/contractActivationService').protectLegacyScheduledTransfers(connection); await connection.commit(); }
    catch(error) { await connection.rollback(); throw error; }
  } finally { await connection.execute("SELECT RELEASE_LOCK('nexus_property_contract_billing')"); }
}
module.exports = { applyPropertyContractMigration, PROPERTY_CONTRACT_MIGRATION_PATH, PROPERTY_AUDIT_FIXES_MIGRATION_PATH };
