import { getPool } from '../server/db.ts';

async function test() {
  try {
    const pool = getPool();
    await pool.query('SELECT 1');
    console.log('Connected!');
  } catch (e) {
    console.error('Failed', e);
  }
}
test();
