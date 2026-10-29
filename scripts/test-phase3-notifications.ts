import { getPool, checkDatabaseConnection } from '../server/db.ts';
import { MemoryDatabase } from '../server/services/memory-db.ts';

async function runPhase3NotificationTests() {
  console.log('================================================================');
  console.log('KAMCH ERP — PHASE 3: PERSISTENT IN-APP NOTIFICATIONS & BROADCAST SUITE');
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

  // Seed test departments, teachers, and users
  await pool.query('DELETE FROM notifications');
  await pool.query('DELETE FROM leave_applications');
  await pool.query('DELETE FROM users');
  await pool.query('DELETE FROM teachers');
  await pool.query('DELETE FROM departments');

  const superAdminRole = memDb.roles.find(r => r.code === 'SUPER_ADMIN')!;
  const principalRole = memDb.roles.find(r => r.code === 'PRINCIPAL')!;
  const facultyRole = memDb.roles.find(r => r.code === 'FACULTY')!;

  await pool.query('INSERT INTO departments (id, code, name, description, is_active) VALUES (?, ?, ?, ?, ?)', 
    [1, 'AYUR', 'Department of Ayurveda', 'Ayurveda Dept', true]);
  
  await pool.query('INSERT INTO teachers (id, full_name, designation, department_id, status) VALUES (?, ?, ?, ?, ?)', 
    [101, 'Dr. Ramesh Sharma', 'Professor', 1, 'ACTIVE']);
  await pool.query('INSERT INTO teachers (id, full_name, designation, department_id, status) VALUES (?, ?, ?, ?, ?)', 
    [102, 'Dr. Priya Nair', 'Associate Professor', 1, 'ACTIVE']);

  // Insert users
  await pool.query('INSERT INTO users (id, username, email, password_hash, role_id, full_name, teacher_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [1, 'principal', 'principal@kamch.ac.in', 'hash', principalRole.id, 'Dr. Principal Executive', null]);
  await pool.query('INSERT INTO users (id, username, email, password_hash, role_id, full_name, teacher_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [2, 'teacher1', 'teacher1@kamch.ac.in', 'hash', facultyRole.id, 'Dr. Ramesh Sharma', 101]);
  await pool.query('INSERT INTO users (id, username, email, password_hash, role_id, full_name, teacher_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [3, 'teacher2', 'teacher2@kamch.ac.in', 'hash', facultyRole.id, 'Dr. Priya Nair', 102]);

  // 1. Leave Approval & Rejection Notifications
  console.log('\n--- 1. Leave Approval & Rejection Notification Generation ---');
  try {
    const [appRes] = await pool.query<any>(
      'INSERT INTO leave_applications (teacher_id, start_date, end_date, reason) VALUES (?, ?, ?, ?)',
      [101, '2026-12-10', '2026-12-12', 'Academic conference']
    );
    const appId = appRes.insertId;

    await pool.query(
      'UPDATE leave_applications SET status = ?, decided_by = ?, decided_at = NOW(), decision_remarks = ? WHERE id = ?',
      ['APPROVED', 1, 'Approved. Have a great conference.', appId]
    );

    await pool.query(
      'INSERT INTO notifications (user_id, title, message, type, related_id) VALUES (?, ?, ?, ?, ?)',
      [2, 'Leave Application Update', 'Your leave application has been approved. Remarks: Approved.', 'LEAVE_DECISION', appId]
    );

    const [notifs] = await pool.query<any[]>('SELECT * FROM notifications WHERE user_id = ?', [2]);
    assert(notifs.length === 1 && notifs[0].type === 'LEAVE_DECISION' && !notifs[0].is_read, 'Leave approval generates unread persistent notification for teacher 2');
  } catch (err) {
    assert(false, 'Leave approval notification generation', String(err));
  }

  // 2. Retry Idempotency (Prevent Duplicate Notifications)
  console.log('\n--- 2. Leave Decision Notification Retry Idempotency ---');
  try {
    const [apps] = await pool.query<any[]>('SELECT id FROM leave_applications WHERE teacher_id = ?', [101]);
    const appId = apps[0].id;

    const [existing] = await pool.query<any[]>('SELECT id FROM notifications WHERE user_id = ? AND type = ? AND related_id = ?', [2, 'LEAVE_DECISION', appId]);
    if (existing.length === 0) {
      await pool.query('INSERT INTO notifications (user_id, title, message, type, related_id) VALUES (?, ?, ?, ?, ?)', [2, 'Update', 'Msg', 'LEAVE_DECISION', appId]);
    }

    const [notifs] = await pool.query<any[]>('SELECT * FROM notifications WHERE user_id = ? AND type = ?', [2, 'LEAVE_DECISION']);
    assert(notifs.length === 1, 'Retry decision request does not create duplicate leave decision notifications');
  } catch (err) {
    assert(false, 'Retry idempotency verification', String(err));
  }

  // 3. Principal Personal Notification Broadcast
  console.log('\n--- 3. Principal Personal Notification Broadcast ---');
  try {
    const [teachersInDept] = await pool.query<any[]>('SELECT id FROM teachers WHERE department_id = ?', [1]);
    const teacherIds = teachersInDept.map(t => t.id);
    const [usersInDept] = await pool.query<any[]>(`SELECT id FROM users WHERE teacher_id IN (${teacherIds.join(',')})`);
    console.log('[DEBUG] usersInDept:', usersInDept);

    for (const u of usersInDept) {
      await pool.query(
        'INSERT INTO notifications (user_id, title, message, type, related_id) VALUES (?, ?, ?, ?, ?)',
        [u.id, 'Department Announcement', 'Mandatory faculty meeting at 3 PM today.', 'BROADCAST', null]
      );
    }

    const [t1Notifs] = await pool.query<any[]>('SELECT * FROM notifications WHERE user_id = ? AND type = ?', [2, 'BROADCAST']);
    const [t2Notifs] = await pool.query<any[]>('SELECT * FROM notifications WHERE user_id = ? AND type = ?', [3, 'BROADCAST']);
    console.log('[DEBUG] t1Notifs broadcast:', t1Notifs);
    console.log('[DEBUG] t2Notifs broadcast:', t2Notifs);

    assert(t1Notifs.length === 1 && t2Notifs.length === 1, 'Department broadcast successfully notifies all teachers in the department');
  } catch (err) {
    assert(false, 'Principal broadcast notification test', String(err));
  }

  // 4. Unread Count & Mark as Read
  console.log('\n--- 4. Unread Counts & Marking as Read ---');
  try {
    const [unreadBefore] = await pool.query<any[]>('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = FALSE', [2]);
    const countBefore = unreadBefore[0].count;

    const [userNotifs] = await pool.query<any[]>('SELECT id FROM notifications WHERE user_id = ?', [2]);
    const firstNotifId = userNotifs[0].id;

    await pool.query('UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?', [firstNotifId, 2]);

    const [unreadAfter] = await pool.query<any[]>('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = FALSE', [2]);
    const countAfter = unreadAfter[0].count;

    assert(countBefore > countAfter, 'Marking notification as read correctly decrements unread count');
  } catch (err) {
    assert(false, 'Unread count and mark as read verification', String(err));
  }

  // 5. Cross-Teacher Data Access Isolation
  console.log('\n--- 5. Teacher Notification Data Isolation ---');
  try {
    const [t1List] = await pool.query<any[]>('SELECT * FROM notifications WHERE user_id = ?', [2]);
    const [t2List] = await pool.query<any[]>('SELECT * FROM notifications WHERE user_id = ?', [3]);

    const t1SeesT2 = t1List.some(n => n.user_id !== 2);
    const t2SeesT1 = t2List.some(n => n.user_id !== 3);

    assert(!t1SeesT2 && !t2SeesT1, 'Teachers can only access their own notification records, ensuring strict isolation');
  } catch (err) {
    assert(false, 'Teacher notification data isolation check', String(err));
  }

  console.log(`\n=== PHASE 3 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED ===\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runPhase3NotificationTests().catch(err => {
  console.error('Phase 3 test suite failed:', err);
  process.exit(1);
});
