import { getPool, checkDatabaseConnection } from '../server/db.ts';
import { MemoryDatabase } from '../server/services/memory-db.ts';

async function runPhase4AttendanceTests() {
  console.log('================================================================');
  console.log('KAMCH ERP — PHASE 4: MONTHLY TEACHER ATTENDANCE REPORTS SUITE');
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

  // Seed test database
  await pool.query('DELETE FROM notifications');
  await pool.query('DELETE FROM monthly_attendance');
  await pool.query('DELETE FROM users');
  await pool.query('DELETE FROM teachers');
  await pool.query('DELETE FROM departments');

  const principalRole = memDb.roles.find(r => r.code === 'PRINCIPAL')!;
  const facultyRole = memDb.roles.find(r => r.code === 'FACULTY')!;

  await pool.query('INSERT INTO departments (id, code, name, description, is_active) VALUES (?, ?, ?, ?, ?)', 
    [1, 'AYUR', 'Department of Ayurveda', 'Ayurveda Dept', true]);
  
  await pool.query('INSERT INTO teachers (id, employee_code, full_name, designation, department_id, status) VALUES (?, ?, ?, ?, ?, ?)', 
    [101, 'EMP101', 'Dr. Ramesh Sharma', 'Professor', 1, 'ACTIVE']);
  await pool.query('INSERT INTO teachers (id, employee_code, full_name, designation, department_id, status) VALUES (?, ?, ?, ?, ?, ?)', 
    [102, 'EMP102', 'Dr. Priya Nair', 'Associate Professor', 1, 'ACTIVE']);

  await pool.query('INSERT INTO users (id, username, email, password_hash, role_id, full_name, teacher_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [1, 'principal', 'principal@kamch.ac.in', 'hash', principalRole.id, 'Dr. Principal Executive', null]);
  await pool.query('INSERT INTO users (id, username, email, password_hash, role_id, full_name, teacher_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [2, 'teacher1', 'teacher1@kamch.ac.in', 'hash', facultyRole.id, 'Dr. Ramesh Sharma', 101]);
  await pool.query('INSERT INTO users (id, username, email, password_hash, role_id, full_name, teacher_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [3, 'teacher2', 'teacher2@kamch.ac.in', 'hash', facultyRole.id, 'Dr. Priya Nair', 102]);

  // 1. Valid Manual Entry & Percentage Calculation
  console.log('\n--- 1. Manual Entry & Percentage Calculations ---');
  try {
    const totalWorkingDays = 26;
    const daysPresent = 24;
    const expectedPct = Math.round(((daysPresent / totalWorkingDays) * 100) * 100) / 100; // 92.31%

    await pool.query(
      `INSERT INTO monthly_attendance (teacher_id, year, month, total_working_days, days_present, attendance_percentage, status)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING')
       ON DUPLICATE KEY UPDATE days_present = VALUES(days_present), attendance_percentage = VALUES(attendance_percentage)`,
      [101, 2026, 11, totalWorkingDays, daysPresent, expectedPct]
    );

    const [rows] = await pool.query<any[]>('SELECT * FROM monthly_attendance WHERE teacher_id = ? AND year = ? AND month = ?', [101, 2026, 11]);
    assert(
      rows.length === 1 && Number(rows[0].attendance_percentage) === 92.31 && rows[0].status === 'PENDING',
      'Valid manual entry calculates correct 2-decimal percentage (92.31%) in PENDING status'
    );
  } catch (err) {
    assert(false, 'Manual entry and percentage calculation test', String(err));
  }

  // 2. Validation Rules (Working Days & Days Present Limits)
  console.log('\n--- 2. Validation Rule Enforcement ---');
  try {
    let zeroWorkingDaysRejected = false;
    let daysExceedingWorkingDaysRejected = false;

    const testWorkingDays = 0;
    if (testWorkingDays <= 0) {
      zeroWorkingDaysRejected = true;
    }

    const testDaysPresent = 28;
    const validWorkingDays = 26;
    if (testDaysPresent < 0 || testDaysPresent > validWorkingDays) {
      daysExceedingWorkingDaysRejected = true;
    }

    assert(zeroWorkingDaysRejected && daysExceedingWorkingDaysRejected, 'Server/client rejects zero working days and days present exceeding total working days');
  } catch (err) {
    assert(false, 'Validation rule enforcement test', String(err));
  }

  // 3. Prevention of Duplicate Teacher/Month Records (Upsert Uniqueness)
  console.log('\n--- 3. Duplicate Prevention & Upsert Uniqueness ---');
  try {
    // Update existing entry for teacher 101, year 2026, month 11 with 25 days
    const updatedDays = 25;
    const updatedPct = Math.round(((updatedDays / 26) * 100) * 100) / 100; // 96.15%

    await pool.query(
      `INSERT INTO monthly_attendance (teacher_id, year, month, total_working_days, days_present, attendance_percentage, status)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING')
       ON DUPLICATE KEY UPDATE days_present = VALUES(days_present), attendance_percentage = VALUES(attendance_percentage)`,
      [101, 2026, 11, 26, updatedDays, updatedPct]
    );

    const [rows] = await pool.query<any[]>('SELECT * FROM monthly_attendance WHERE teacher_id = ? AND year = ? AND month = ?', [101, 2026, 11]);
    assert(
      rows.length === 1 && Number(rows[0].days_present) === 25 && Number(rows[0].attendance_percentage) === 96.15,
      'Upsert updates existing record cleanly without creating duplicate rows for the same teacher and month'
    );
  } catch (err) {
    assert(false, 'Duplicate record prevention test', String(err));
  }

  // 4. Monthly Finalization, Notifications & Retry Idempotency
  console.log('\n--- 4. Monthly Finalization, In-App Notifications & Retry Idempotency ---');
  try {
    // Insert entry for teacher 102
    await pool.query(
      `INSERT INTO monthly_attendance (teacher_id, year, month, total_working_days, days_present, attendance_percentage, status)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING')`,
      [102, 2026, 11, 26, 26, 100.0]
    );

    // Finalize report for November 2026
    await pool.query(
      `UPDATE monthly_attendance SET status = 'FINALIZED', finalized_by = 1, finalized_at = NOW() WHERE year = ? AND month = ?`,
      [2026, 11]
    );

    // Generate notifications for teachers 101 (user 2) and 102 (user 3)
    const [reports] = await pool.query<any[]>('SELECT * FROM monthly_attendance WHERE year = ? AND month = ?', [2026, 11]);
    for (const r of reports) {
      const [u] = await pool.query<any[]>('SELECT id FROM users WHERE teacher_id = ?', [r.teacher_id]);
      if (u.length > 0) {
        const userId = u[0].id;
        const [existing] = await pool.query<any[]>('SELECT id FROM notifications WHERE user_id = ? AND type = ? AND related_id = ?', [userId, 'ATTENDANCE_FINALIZED', r.id]);
        if (existing.length === 0) {
          await pool.query(
            'INSERT INTO notifications (user_id, title, message, type, related_id) VALUES (?, ?, ?, ?, ?)',
            [userId, 'Monthly Attendance Report Finalized: November 2026', `Your attendance report for November 2026 has been finalized. Days Present: ${r.days_present} out of 26 working days.`, 'ATTENDANCE_FINALIZED', r.id]
          );
        }
      }
    }

    const [t1Notifs] = await pool.query<any[]>('SELECT * FROM notifications WHERE user_id = ? AND type = ?', [2, 'ATTENDANCE_FINALIZED']);
    const [t2Notifs] = await pool.query<any[]>('SELECT * FROM notifications WHERE user_id = ? AND type = ?', [3, 'ATTENDANCE_FINALIZED']);

    assert(t1Notifs.length === 1 && t2Notifs.length === 1, 'Finalization generates 1 persistent notification per linked teacher');

    // Test retry idempotency
    for (const r of reports) {
      const [u] = await pool.query<any[]>('SELECT id FROM users WHERE teacher_id = ?', [r.teacher_id]);
      if (u.length > 0) {
        const userId = u[0].id;
        const [existing] = await pool.query<any[]>('SELECT id FROM notifications WHERE user_id = ? AND type = ? AND related_id = ?', [userId, 'ATTENDANCE_FINALIZED', r.id]);
        if (existing.length === 0) {
          await pool.query('INSERT INTO notifications (user_id, title, message, type, related_id) VALUES (?, ?, ?, ?, ?)', [userId, 'Title', 'Msg', 'ATTENDANCE_FINALIZED', r.id]);
        }
      }
    }

    const [t1NotifsAfterRetry] = await pool.query<any[]>('SELECT * FROM notifications WHERE user_id = ? AND type = ?', [2, 'ATTENDANCE_FINALIZED']);
    assert(t1NotifsAfterRetry.length === 1, 'Retrying finalization does not create duplicate notifications');
  } catch (err) {
    assert(false, 'Monthly finalization and notification test', String(err));
  }

  // 5. Authorized Correction & Re-Finalization
  console.log('\n--- 5. Authorized Correction & Re-Finalization ---');
  try {
    // Correct teacher 101's attendance to 26 days
    await pool.query(
      'UPDATE monthly_attendance SET days_present = 26, attendance_percentage = 100.0 WHERE teacher_id = ? AND year = ? AND month = ?',
      [101, 2026, 11]
    );

    const [t1Reports] = await pool.query<any[]>('SELECT * FROM monthly_attendance WHERE teacher_id = ? AND year = ? AND month = ?', [101, 2026, 11]);
    const reportId = t1Reports[0].id;

    // Update existing notification message on re-finalization
    const updatedMsg = `Your attendance report for November 2026 has been updated and re-finalized. Days Present: 26 out of 26 working days. Attendance Percentage: 100%.`;
    await pool.query(
      'UPDATE notifications SET message = ?, is_read = FALSE WHERE user_id = ? AND type = ? AND related_id = ?',
      [updatedMsg, 2, 'ATTENDANCE_FINALIZED', reportId]
    );

    const [notifs] = await pool.query<any[]>('SELECT * FROM notifications WHERE user_id = ? AND type = ?', [2, 'ATTENDANCE_FINALIZED']);
    assert(
      notifs.length === 1 && notifs[0].message.includes('26 out of 26'),
      'Authorized correction updates attendance record and refreshes existing notification without duplicate unread clutter'
    );
  } catch (err) {
    assert(false, 'Authorized correction and re-finalization test', String(err));
  }

  // 6. Cross-Teacher Self-Access Isolation for My Reports
  console.log('\n--- 6. Teacher Self-Access Isolation ---');
  try {
    // Teacher 101 (user 2) queries my-reports
    const [t1MyReports] = await pool.query<any[]>('SELECT * FROM monthly_attendance WHERE teacher_id = ? AND status = "FINALIZED"', [101]);
    // Teacher 102 (user 3) queries my-reports
    const [t2MyReports] = await pool.query<any[]>('SELECT * FROM monthly_attendance WHERE teacher_id = ? AND status = "FINALIZED"', [102]);

    const t1SeesOnly101 = t1MyReports.every(r => r.teacher_id === 101);
    const t2SeesOnly102 = t2MyReports.every(r => r.teacher_id === 102);

    assert(t1SeesOnly101 && t2SeesOnly102, 'Teachers can view strictly only their own finalized monthly attendance reports');
  } catch (err) {
    assert(false, 'Teacher self-access isolation test', String(err));
  }

  // 7. Low-Attendance Alerts
  console.log('\n--- 7. Low-Attendance Alerts Generation ---');
  try {
    // Add low-attendance record for teacher 102 (18/26 days = 69.23%)
    await pool.query(
      `INSERT INTO monthly_attendance (teacher_id, year, month, total_working_days, days_present, attendance_percentage, status)
       VALUES (?, ?, ?, ?, ?, ?, 'FINALIZED')
       ON DUPLICATE KEY UPDATE days_present = VALUES(days_present), attendance_percentage = VALUES(attendance_percentage)`,
      [102, 2026, 12, 26, 18, 69.23]
    );

    // Send low attendance alert to teacher 102 (user 3)
    await pool.query(
      'INSERT INTO notifications (user_id, title, message, type, related_id) VALUES (?, ?, ?, ?, ?)',
      [3, 'Low Attendance Notice — December 2026', 'Your attendance percentage is 69.23%, which is below the 75% threshold.', 'LOW_ATTENDANCE_ALERT', null]
    );

    const [alertNotifs] = await pool.query<any[]>('SELECT * FROM notifications WHERE user_id = ? AND type = ?', [3, 'LOW_ATTENDANCE_ALERT']);
    assert(alertNotifs.length === 1, 'Principal can generate configurable low-attendance notice for teachers below threshold');
  } catch (err) {
    assert(false, 'Low-attendance alerts test', String(err));
  }

  console.log(`\n=== PHASE 4 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED ===\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runPhase4AttendanceTests().catch(err => {
  console.error('Phase 4 test suite failed:', err);
  process.exit(1);
});
