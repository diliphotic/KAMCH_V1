import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { MemoryDatabase } from '../server/services/memory-db.ts';
import {
  getPermittedModules,
  canAccessModule,
  getDefaultModuleForRole,
} from '../src/config/permissions.ts';
import {
  ASSIGNABLE_ACCOUNT_ROLES,
  NON_LOGIN_ROLES,
} from '../server/permissions.ts';

async function runTests() {
  console.log('====================================================');
  console.log('KAMCH ERP — USER MANAGEMENT UNIT & VISIBILITY SUITE');
  console.log('====================================================\n');

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

  // 1. Clean Startup Verification (No Demo Users, Students, Teachers, or Departments)
  console.log('--- 1. Clean Startup & No Demo Data Verification ---');
  assert(memDb.students.length === 0, 'No demo students seeded on initialization');
  assert(memDb.teachers.length === 0, 'No demo teachers seeded on initialization');
  assert(memDb.departments.length === 0, 'No demo departments seeded on initialization');
  assert(memDb.users.length === 0, 'No demo users or hardcoded passwords seeded without provisioning');

  // 2. Role Architecture & Assignable Account Boundaries
  console.log('\n--- 2. Role Mapping & Non-Login Role Boundaries ---');
  for (const code of ['SUPER_ADMIN', 'PRINCIPAL', 'SECRETARY', 'OFFICE', 'LIBRARY', 'DEPARTMENT']) {
    assert(
      Boolean(memDb.roles.find((r) => r.code === code)),
      `Canonical role '${code}' exists in roles table`
    );
  }
  assert(
    !ASSIGNABLE_ACCOUNT_ROLES.includes('SUPER_ADMIN'),
    'SUPER_ADMIN is excluded from ordinary assignable account roles'
  );
  assert(
    !ASSIGNABLE_ACCOUNT_ROLES.includes('STUDENT') && NON_LOGIN_ROLES.includes('STUDENT'),
    'STUDENT is strictly a non-login record role in this phase'
  );
  assert(
    ASSIGNABLE_ACCOUNT_ROLES.includes('FACULTY') && !NON_LOGIN_ROLES.includes('FACULTY'),
    'FACULTY is an assignable account role in Phase 1 for individual teacher accounts'
  );

  // 3. Centralized Navigation & Module Visibility Rules
  console.log('\n--- 3. Centralized Role-Based Navigation & Visibility ---');
  const superAdminMods = getPermittedModules('SUPER_ADMIN');
  assert(
    superAdminMods.includes('user_mgmt') &&
      superAdminMods.includes('fees_mgmt') &&
      superAdminMods.includes('student_records') &&
      superAdminMods.includes('teacher_records') &&
      superAdminMods.includes('dept_portal') &&
      superAdminMods.includes('library_mgmt'),
    'Super Admin has visibility to all institutional modules'
  );

  const principalMods = getPermittedModules('PRINCIPAL');
  assert(
    principalMods.includes('user_mgmt') && principalMods.includes('fees_mgmt'),
    'Principal sees permitted institutional modules'
  );

  const secretaryMods = getPermittedModules('SECRETARY');
  assert(
    secretaryMods.includes('user_mgmt') && secretaryMods.includes('fees_mgmt'),
    'Secretary sees permitted institutional modules'
  );

  assert(
    !canAccessModule('OFFICE', 'user_mgmt') &&
      !canAccessModule('OFFICE', 'library_mgmt') &&
      !canAccessModule('OFFICE', 'dept_portal') &&
      canAccessModule('OFFICE', 'fees_mgmt') &&
      canAccessModule('OFFICE', 'student_records') &&
      canAccessModule('OFFICE', 'teacher_records'),
    'Office members see Fees, Student Records, and Teacher Records ONLY (no User Mgmt, Library, or Dept)'
  );

  const libraryMods = getPermittedModules('LIBRARY');
  assert(
    libraryMods.length === 1 &&
      libraryMods[0] === 'library_mgmt' &&
      getDefaultModuleForRole('LIBRARY') === 'library_mgmt',
    'Library users see ONLY Library functionality'
  );

  const deptMods = getPermittedModules('DEPARTMENT');
  assert(
    deptMods.includes('dept_portal') &&
      deptMods.includes('teacher_records') &&
      deptMods.includes('marks_mgmt') &&
      !deptMods.includes('user_mgmt') &&
      !deptMods.includes('fees_mgmt') &&
      !deptMods.includes('library_mgmt') &&
      getDefaultModuleForRole('DEPARTMENT') === 'dept_portal',
    'Department accounts see Department Workspace, Teacher Records, and Marks Management'
  );

  // 4. Protected Super Admin One-Time Provisioning & Bcrypt Hashing
  console.log('\n--- 4. Protected Super Admin Provisioning & Bcrypt Hashing ---');
  const runtimeTestSecret = `TestInit_${crypto.randomBytes(8).toString('hex')}`;
  const seededAdmin = memDb.provisionInitialSuperAdmin({
    username: 'superadmin',
    email: 'admin@kamch.ac.in',
    password: runtimeTestSecret,
  });

  assert(Boolean(seededAdmin), 'Protected Super Admin provisioning creates initial account');
  assert(
    seededAdmin!.must_change_password === true,
    'Provisioned Super Admin requires first-login password change'
  );
  assert(
    seededAdmin!.password_hash.startsWith('$2') && seededAdmin!.password_hash !== runtimeTestSecret,
    'Password is stored strictly as bcrypt hash, never plain text'
  );
  assert(
    bcrypt.compareSync(runtimeTestSecret, seededAdmin!.password_hash),
    'Bcrypt hash verifies runtime password accurately'
  );

  const secondProvisionAttempt = memDb.provisionInitialSuperAdmin({
    username: 'secondadmin',
    password: `Another_${crypto.randomBytes(8).toString('hex')}`,
  });
  assert(
    secondProvisionAttempt?.id === seededAdmin!.id && memDb.users.length === 1,
    'Protected provisioning is idempotent and never creates duplicate Super Admin'
  );

  console.log('\n====================================================');
  console.log(`TOTAL UNIT TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal unit test error:', err);
  process.exit(1);
});
