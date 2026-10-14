const { pool } = require('./mysql');

// Several aggregates must observe the same accounting state during concurrent payments/refunds.
async function readSnapshot(read) {
  const connection = await pool.getConnection();
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    const result = await read(async (sql, params = []) => (await connection.execute(sql, params))[0]);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}
module.exports = { readSnapshot };
