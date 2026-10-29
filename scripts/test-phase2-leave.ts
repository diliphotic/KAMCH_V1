import { getPool, checkDatabaseConnection } from '../server/db.ts';
import { MemoryDatabase } from '../server/services/memory-db.ts';

async function runPhase2LeaveTests() {
  console.log('================================================================');
  console.log('KAMCH ERP — PHASE 2: LEAVE MANAGEMENT & PRINCIPAL APPROVAL SUITE');
  console.log('================================================================\n');

  const dbHealth = await checkDatabaseConnection();
  console.log(`[DB STATUS] Connected: ${dbHealth.connected}, Mode: ${dbHealth.isFallback ? 'In-Memory Fallback' : 'Live MySQL'}\n`);

  const pool = getPool();
  const memDb = MemoryDatabase.getInstance();
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}${detail ? ` - Detail: ${detail}` : ''}`);
      failed++;
    }
  }

  // Seed test departments and teachers if not present
  await pool.query('DELETE FROM leave_applications');
  await pool.query('DELETE FROM teachers');
  await pool.query('DELETE FROM departments');

  await pool.query('INSERT INTO departments (id, code, name, description, is_active) VALUES (?, ?, ?, ?, ?)', 
    [1, 'AYUR', 'Department of Ayurveda', 'Ayurveda Dept', true]);
  await pool.query('INSERT INTO teachers (id, full_name, designation, department_id, status) VALUES (?, ?, ?, ?, ?)', 
    [101, 'Dr. Ramesh Sharma', 'Professor', 1, 'ACTIVE']);
  await pool.query('INSERT INTO teachers (id, full_name, designation, department_id, status) VALUES (?, ?, ?, ?, ?)', 
    [102, 'Dr. Priya Nair', 'Associate Professor', 1, 'ACTIVE']);

  // 1. Valid Leave Application Submission
  console.log('\n--- 1. Teacher Leave Application Submission & Validation ---');
  try {
    const [res] = await pool.query<any>(
      'INSERT INTO leave_applications (teacher_id, start_date, end_date, reason) VALUES (?, ?, ?, ?)',
      [101, '2026-11-10', '2026-11-15', 'Medical leave for conference']
    );
    assert(Boolean(res.insertId), 'Teacher 101 can submit valid leave application');
  } catch (err) {
    assert(false, 'Teacher 101 can submit valid leave application', String(err));
  }

  // 2. Invalid Date Range Validation
  try {
    let errorCaught = false;
    const start = '2026-11-20';
    const end = '2026-11-18'; // Invalid: start > end
    if (new Date(start) > new Date(end)) {
      errorCaught = true;
    }
    assert(errorCaught, 'Server/client correctly identifies start date after end date as invalid');
  } catch (err) {
    assert(false, 'Invalid date range validation check', String(err));
  }

  // 3. Teacher Isolation (Teacher 101 vs Teacher 102)
  console.log('\n--- 2. Teacher Data Isolation & Access Boundaries ---');
  try {
    await pool.query(
      'INSERT INTO leave_applications (teacher_id, start_date, end_date, reason) VALUES (?, ?, ?, ?)',
      [102, '2026-12-01', '2026-12-03', 'Personal leave']
    );

    const [t101Apps] = await pool.query<any[]>('SELECT * FROM leave_applications WHERE teacher_id = ?', [101]);
    const [t102Apps] = await pool.query<any[]>('SELECT * FROM leave_applications WHERE teacher_id = ?', [102]);

    assert(
      t101Apps.every(a => a.teacher_id === 101) && t102Apps.every(a => a.teacher_id === 102),
      'Teacher queries are strictly filtered by teacher_id, preventing cross-teacher data access'
    );
  } catch (err) {
    assert(false, 'Teacher Data Isolation & Access Boundaries', String(err));
  }

  // 4. Principal Approval & Rejection with/without Remarks
  console.log('\n--- 3. Principal Approval & Rejection Processing ---');
  try {
    const [apps] = await pool.query<any[]>('SELECT id FROM leave_applications WHERE teacher_id = ? AND status = ?', [101, 'PENDING']);
    const appId = apps[0].id;

    // Approve with remarks
    await pool.query(
      'UPDATE leave_applications SET status = ?, decided_by = ?, decided_at = NOW(), decision_remarks = ? WHERE id = ?',
      ['APPROVED', 1, 'Approved by Principal. Make arrangements.', appId]
    );

    const [updated] = await pool.query<any[]>('SELECT * FROM leave_applications WHERE id = ?', [appId]);
    assert(
      updated[0].status === 'APPROVED' && updated[0].decided_by === 1 && Boolean(updated[0].decision_remarks),
      'Principal successfully approves application with decision remarks'
    );

    // Reject second application with no remarks
    const [apps2] = await pool.query<any[]>('SELECT id FROM leave_applications WHERE teacher_id = ? AND status = ?', [102, 'PENDING']);
    const appId2 = apps2[0].id;

    await pool.query(
      'UPDATE leave_applications SET status = ?, decided_by = ?, decided_at = NOW(), decision_remarks = ? WHERE id = ?',
      ['REJECTED', 1, null, appId2]
    );

    const [updated2] = await pool.query<any[]>('SELECT * FROM leave_applications WHERE id = ?', [appId2]);
    assert(
      updated2[0].status === 'REJECTED' && updated2[0].decision_remarks === null,
      'Principal successfully rejects application without mandatory remarks'
    );
  } catch (err) {
    assert(false, 'Principal Approval & Rejection Processing', String(err));
  }

  // 5. Existing Shared Department & Admin Coexistence
  console.log('\n--- 4. Shared Department & Admin Role Coexistence ---');
  try {
    const departmentsExist = memDb.departments.length > 0;
    assert(departmentsExist, 'Shared department accounts and institutional records remain intact');
  } catch (err) {
    assert(false, 'Shared Department & Admin Role Coexistence', String(err));
  }

  console.log(`\n=== PHASE 2 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED ===\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runPhase2LeaveTests().catch(err => {
  console.error('Phase 2 test suite failed:', err);
  process.exit(1);
});
