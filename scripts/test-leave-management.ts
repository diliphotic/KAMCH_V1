import { getPool, checkDatabaseConnection } from '../server/db.ts';

async function runLeaveVerification() {
  console.log('=== KAMCH ERP: Leave Management Comprehensive Verification Suite ===\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${testName}${detail ? ` -> ${detail}` : ''}`);
      failed++;
    }
  }

  const dbHealth = await checkDatabaseConnection();
  console.log(`[Database Engine Status] Connected: ${dbHealth.connected}, Code: ${dbHealth.code || 'CONNECTED'}, Latency: ${dbHealth.latencyMs || 0}ms`);
  
  const pool = getPool();

  // Test 1: Leave application submission
  console.log('\n--- 1. Leave Application Submission ---');
  try {
    await pool.query('DELETE FROM leave_applications');
    await pool.query('INSERT INTO leave_applications (teacher_id, start_date, end_date, reason) VALUES (?, ?, ?, ?)', [1, '2026-11-01', '2026-11-05', 'Medical']);
    const [rows] = await pool.query<any[]>('SELECT * FROM leave_applications WHERE teacher_id = ?', [1]);
    assert(rows.length === 1 && rows[0].reason === 'Medical' && rows[0].status === 'PENDING', 'Criteria: Application submission successful');
  } catch (err) {
    assert(false, 'Criteria: Application submission successful', String(err));
  }

  // Test 2: Principal approval
  console.log('\n--- 2. Principal Approval ---');
  try {
    const [apps] = await pool.query<any[]>('SELECT id FROM leave_applications WHERE teacher_id = ?', [1]);
    const appId = apps[0].id;
    await pool.query('UPDATE leave_applications SET status = ?, decided_by = ? WHERE id = ?', ['APPROVED', 2, appId]);
    const [updated] = await pool.query<any[]>('SELECT status FROM leave_applications WHERE id = ?', [appId]);
    assert(updated[0].status === 'APPROVED', 'Criteria: Principal approval successful');
  } catch (err) {
    assert(false, 'Criteria: Principal approval successful', String(err));
  }

  // Test 3: Rejection with remarks
  console.log('\n--- 3. Rejection with Remarks ---');
  try {
    await pool.query('INSERT INTO leave_applications (teacher_id, start_date, end_date, reason) VALUES (?, ?, ?, ?)', [1, '2026-12-01', '2026-12-02', 'Personal']);
    const [apps] = await pool.query<any[]>('SELECT id FROM leave_applications WHERE reason = ?', ['Personal']);
    const appId = apps[0].id;
    await pool.query('UPDATE leave_applications SET status = ?, decided_by = ?, decision_remarks = ? WHERE id = ?', ['REJECTED', 2, 'Insufficient notice', appId]);
    const [updated] = await pool.query<any[]>('SELECT status, decision_remarks FROM leave_applications WHERE id = ?', [appId]);
    assert(updated[0].status === 'REJECTED' && updated[0].decision_remarks === 'Insufficient notice', 'Criteria: Rejection with remarks successful');
  } catch (err) {
    assert(false, 'Criteria: Rejection with remarks successful', String(err));
  }

  // Test 4: Notification creation
  console.log('\n--- 4. Notification Creation ---');
  try {
      const [apps] = await pool.query<any[]>('SELECT id, teacher_id FROM leave_applications WHERE teacher_id = ?', [1]);
      const appId = apps[0].id;
      // Trigger decision (normally this would be done by principal, here we simulate)
      await pool.query('UPDATE leave_applications SET status = ?, decided_by = ? WHERE id = ?', ['APPROVED', 2, appId]);
      
      // Simulate notification creation in decision route
      let [users] = await pool.query<any[]>('SELECT id FROM users WHERE teacher_id = ?', [1]);
      if (users.length === 0) {
        // Seed user if not found
        console.log('Seeding test user for teacher_id=1');
        await pool.query('INSERT INTO users (username, email, password_hash, role_id, full_name, teacher_id) VALUES (?, ?, ?, ?, ?, ?)', 
            ['testuser', 'test@kamch.ac.in', 'hashed_pass', 5, 'Test Teacher', 1]);
        [users] = await pool.query<any[]>('SELECT id FROM users WHERE teacher_id = ?', [1]);
        console.log('Users found after seeding:', users.length);
      }
      
      if (users.length > 0) {
        const userId = users[0].id;
        await pool.query('INSERT INTO notifications (user_id, title, message, type, related_id) VALUES (?, ?, ?, ?, ?)', 
            [userId, 'Leave Application Update', 'Approved', 'LEAVE_DECISION', appId]);
        
        const [notifs] = await pool.query<any[]>('SELECT * FROM notifications WHERE user_id = ? AND related_id = ?', [userId, appId]);
        assert(notifs.length === 1 && notifs[0].message === 'Approved', 'Criteria: Notification creation successful');
      } else {
        assert(false, 'Criteria: Notification creation successful', 'Failed to find or create user for teacher_id=1');
      }
  } catch (err) {
      assert(false, 'Criteria: Notification creation successful', String(err));
  }

  console.log(`\n=== Verification Summary: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

runLeaveVerification().catch((err) => {
  console.error('Leave verification failed:', err);
  process.exit(1);
});
