import '../env.ts';
import path from 'path';
import { fileURLToPath } from 'url';
import { PoolConnection } from 'mysql2/promise';
import { envDiagnostics } from '../env.ts';
import { checkDatabaseConnection, getPool } from '../db.ts';

async function tableExists(connection: PoolConnection, tableName: string): Promise<boolean> {
  const [rows] = await connection.query<any[]>(
    `SELECT COUNT(*) AS cnt
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );
  return Number(rows?.[0]?.cnt || 0) > 0;
}

async function columnExists(connection: PoolConnection, tableName: string, columnName: string): Promise<boolean> {
  const [rows] = await connection.query<any[]>(
    `SELECT COUNT(*) AS cnt
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  return Number(rows?.[0]?.cnt || 0) > 0;
}

async function indexExists(connection: PoolConnection, tableName: string, indexName: string): Promise<boolean> {
  const [rows] = await connection.query<any[]>(
    `SELECT COUNT(*) AS cnt
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [tableName, indexName]
  );
  return Number(rows?.[0]?.cnt || 0) > 0;
}

async function constraintExists(connection: PoolConnection, tableName: string, constraintName: string): Promise<boolean> {
  const [rows] = await connection.query<any[]>(
    `SELECT COUNT(*) AS cnt
     FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
    [tableName, constraintName]
  );
  return Number(rows?.[0]?.cnt || 0) > 0;
}

async function isMigrationApplied(connection: PoolConnection, version: string): Promise<boolean> {
  const [rows] = await connection.query<any[]>(
    'SELECT version FROM schema_migrations WHERE version = ? LIMIT 1',
    [version]
  );
  return Boolean(rows && rows.length > 0);
}

async function markMigrationApplied(connection: PoolConnection, version: string): Promise<void> {
  await connection.query(
    'INSERT IGNORE INTO schema_migrations (version) VALUES (?)',
    [version]
  );
}

/**
 * Safe, non-destructive, idempotent additive migration runner compatible with both
 * MariaDB (XAMPP) and MySQL 8.0+. Preserves all existing tables, users, students,
 * payments, receipts, sessions, and audit records.
 */
export async function runAdditiveMigrations(connection: PoolConnection): Promise<void> {
  // 1. Ensure schema_migrations tracking table exists
  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`schema_migrations\` (
      \`version\` VARCHAR(100) NOT NULL PRIMARY KEY,
      \`applied_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 2. Fees v2 additive columns check (safe for both fresh and existing databases)
  if (!(await isMigrationApplied(connection, 'fees_v2_additive'))) {
    if (!(await columnExists(connection, 'students', 'mess_enrolled'))) {
      await connection.query(
        'ALTER TABLE `students` ADD COLUMN `mess_enrolled` BOOLEAN NOT NULL DEFAULT FALSE AFTER `kea_acknowledgement_no`'
      );
    }
    if (!(await columnExists(connection, 'students', 'hostel_enrolled'))) {
      await connection.query(
        'ALTER TABLE `students` ADD COLUMN `hostel_enrolled` BOOLEAN NOT NULL DEFAULT FALSE AFTER `mess_enrolled`'
      );
    }
    await markMigrationApplied(connection, 'fees_v2_additive');
  }

  // 3. User Management v2 additive schema & constraints
  if (!(await isMigrationApplied(connection, 'user_management_v2'))) {
    // 3a. Departments table (empty initially; created by Super Admin)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`departments\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`code\` VARCHAR(50) NOT NULL UNIQUE,
        \`name\` VARCHAR(150) NOT NULL,
        \`description\` VARCHAR(255) NULL,
        \`is_active\` BOOLEAN NOT NULL DEFAULT TRUE,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX \`idx_departments_code\` (\`code\`),
        INDEX \`idx_departments_active\` (\`is_active\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 3b. Ensure canonical roles exist without overwriting or removing existing roles
    await connection.query(`
      INSERT INTO \`roles\` (\`code\`, \`name\`, \`description\`) VALUES
        ('DEPARTMENT', 'Department Account', 'Shared institutional department account for marks and department records'),
        ('LIBRARY', 'Library Staff', 'Library administration and circulation management')
      ON DUPLICATE KEY UPDATE
        \`name\` = VALUES(\`name\`),
        \`description\` = VALUES(\`description\`)
    `);

    // 3c. Users table additive columns
    if (!(await columnExists(connection, 'users', 'department_id'))) {
      await connection.query(
        'ALTER TABLE `users` ADD COLUMN `department_id` INT NULL DEFAULT NULL AFTER `role_id`'
      );
    }
    if (!(await columnExists(connection, 'users', 'is_deactivated'))) {
      await connection.query(
        'ALTER TABLE `users` ADD COLUMN `is_deactivated` BOOLEAN NOT NULL DEFAULT FALSE AFTER `suspended_at`'
      );
    }
    if (!(await columnExists(connection, 'users', 'deactivated_at'))) {
      await connection.query(
        'ALTER TABLE `users` ADD COLUMN `deactivated_at` TIMESTAMP NULL DEFAULT NULL AFTER `is_deactivated`'
      );
    }
    if (!(await columnExists(connection, 'users', 'suspension_reason'))) {
      await connection.query(
        'ALTER TABLE `users` ADD COLUMN `suspension_reason` VARCHAR(255) NULL DEFAULT NULL AFTER `suspended_at`'
      );
    }
    if (!(await columnExists(connection, 'users', 'deactivation_reason'))) {
      await connection.query(
        'ALTER TABLE `users` ADD COLUMN `deactivation_reason` VARCHAR(255) NULL DEFAULT NULL AFTER `deactivated_at`'
      );
    }

    // 3d. Make users.email nullable while preserving existing UNIQUE index on non-null emails
    await connection.query(
      'ALTER TABLE `users` MODIFY COLUMN `email` VARCHAR(100) NULL DEFAULT NULL'
    );

    // 3e. Users status & department indexes + foreign key
    if (!(await indexExists(connection, 'users', 'idx_users_all_status'))) {
      await connection.query(
        'ALTER TABLE `users` ADD INDEX `idx_users_all_status` (`is_locked`, `is_suspended`, `is_deactivated`)'
      );
    }
    if (!(await indexExists(connection, 'users', 'idx_users_department'))) {
      await connection.query(
        'ALTER TABLE `users` ADD INDEX `idx_users_department` (`department_id`)'
      );
    }
    if (!(await constraintExists(connection, 'users', 'fk_users_department'))) {
      // Nullify any orphaned department_id before adding FK so existing rows never fail migration
      await connection.query(`
        UPDATE \`users\` u
        LEFT JOIN \`departments\` d ON u.department_id = d.id
        SET u.department_id = NULL
        WHERE u.department_id IS NOT NULL AND d.id IS NULL
      `);
      await connection.query(`
        ALTER TABLE \`users\`
        ADD CONSTRAINT \`fk_users_department\`
        FOREIGN KEY (\`department_id\`) REFERENCES \`departments\` (\`id\`)
        ON DELETE RESTRICT ON UPDATE CASCADE
      `);
    }

    // 3f. Teachers institutional records table (non-login records)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`teachers\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`employee_code\` VARCHAR(50) NOT NULL UNIQUE,
        \`full_name\` VARCHAR(150) NOT NULL,
        \`designation\` VARCHAR(100) NOT NULL,
        \`department_id\` INT NOT NULL,
        \`qualification\` VARCHAR(150) NULL,
        \`contact_phone\` VARCHAR(25) NULL,
        \`contact_email\` VARCHAR(100) NULL,
        \`status\` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
        \`created_by\` INT NULL DEFAULT NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_teachers_department\` FOREIGN KEY (\`department_id\`) REFERENCES \`departments\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT \`fk_teachers_creator\` FOREIGN KEY (\`created_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE,
        INDEX \`idx_teachers_department\` (\`department_id\`),
        INDEX \`idx_teachers_status\` (\`status\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await markMigrationApplied(connection, 'user_management_v2');
  }

  // 4. Student Management v1 additive schema, configurable schemes/batches, and settings
  if (!(await isMigrationApplied(connection, 'student_management_v1'))) {
    // 4a. Curriculum Schemes table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`curriculum_schemes\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`code\` VARCHAR(30) NOT NULL UNIQUE,
        \`name\` VARCHAR(150) NOT NULL,
        \`course_name\` VARCHAR(100) NOT NULL DEFAULT 'BAMS',
        \`is_legacy_minimal\` BOOLEAN NOT NULL DEFAULT FALSE,
        \`professional_years_count\` INT NOT NULL DEFAULT 3,
        \`regular_pass_max_failed_for_provisional\` INT NOT NULL DEFAULT 2,
        \`allow_provisional_promotion\` BOOLEAN NOT NULL DEFAULT TRUE,
        \`passing_criteria_verified\` BOOLEAN NOT NULL DEFAULT TRUE,
        \`passing_rule_config\` JSON NULL,
        \`supplementary_cycle_months\` INT NOT NULL DEFAULT 6,
        \`default_internship_days\` INT NOT NULL DEFAULT 365,
        \`is_active\` BOOLEAN NOT NULL DEFAULT TRUE,
        \`notes\` VARCHAR(500) NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.query(`
      INSERT INTO \`curriculum_schemes\` (
        \`code\`, \`name\`, \`course_name\`, \`is_legacy_minimal\`, \`professional_years_count\`,
        \`regular_pass_max_failed_for_provisional\`, \`allow_provisional_promotion\`,
        \`passing_criteria_verified\`, \`supplementary_cycle_months\`, \`default_internship_days\`, \`is_active\`, \`notes\`
      ) VALUES
        (
          'RS6',
          'RS6 Legacy Curriculum (Pre-2021–22)',
          'BAMS',
          TRUE,
          4,
          0,
          FALSE,
          FALSE,
          6,
          365,
          TRUE,
          'Legacy minimal record scheme for batches admitted prior to 2021–22. Newer 3-professional-year progression rules are not auto-applied.'
        ),
        (
          'RS7',
          'RS7 / NCISM Curriculum (2021–22 Onwards)',
          'BAMS',
          FALSE,
          3,
          2,
          TRUE,
          TRUE,
          6,
          365,
          TRUE,
          'Three-professional-year BAMS curriculum scheme (2021–22 onwards) with subject-level progression, odd-batch/split-term detention routing, and 365 credited-day internship.'
        )
      ON DUPLICATE KEY UPDATE
        \`updated_at\` = CURRENT_TIMESTAMP
    `);

    // 4b. Academic Batches table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`academic_batches\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`code\` VARCHAR(50) NOT NULL UNIQUE,
        \`name\` VARCHAR(120) NOT NULL,
        \`admission_academic_year\` VARCHAR(20) NOT NULL,
        \`admission_year_start\` INT NULL,
        \`course_name\` VARCHAR(100) NOT NULL DEFAULT 'BAMS',
        \`scheme_id\` INT NOT NULL,
        \`current_cohort_stage\` VARCHAR(80) NOT NULL,
        \`current_professional_year\` INT NULL,
        \`junior_batch_id\` INT NULL,
        \`admission_status\` ENUM('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CLOSED_LEGACY') NOT NULL DEFAULT 'IN_PROGRESS',
        \`is_active\` BOOLEAN NOT NULL DEFAULT TRUE,
        \`display_order\` INT NOT NULL DEFAULT 0,
        \`notes\` VARCHAR(500) NULL,
        \`created_by\` INT NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_batches_scheme\` FOREIGN KEY (\`scheme_id\`) REFERENCES \`curriculum_schemes\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT \`fk_batches_junior\` FOREIGN KEY (\`junior_batch_id\`) REFERENCES \`academic_batches\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT \`fk_batches_creator\` FOREIGN KEY (\`created_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE,
        INDEX \`idx_batches_scheme\` (\`scheme_id\`),
        INDEX \`idx_batches_active_order\` (\`is_active\`, \`display_order\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Seed initial college-supplied batches without overwriting or duplicating existing records
    const [schemeRows] = await connection.query<any[]>(
      'SELECT id, code FROM curriculum_schemes WHERE code IN (?, ?)',
      ['RS6', 'RS7']
    );
    const rs6Id = schemeRows.find((r: any) => r.code === 'RS6')?.id;
    const rs7Id = schemeRows.find((r: any) => r.code === 'RS7')?.id;

    if (rs6Id && rs7Id) {
      await connection.query(
        `INSERT IGNORE INTO \`academic_batches\`
          (\`code\`, \`name\`, \`admission_academic_year\`, \`admission_year_start\`, \`course_name\`, \`scheme_id\`, \`current_cohort_stage\`, \`current_professional_year\`, \`admission_status\`, \`is_active\`, \`display_order\`, \`notes\`)
         VALUES
          ('RS6_LEGACY', 'RS6 (Legacy Pre-2021–22)', 'Pre-2021-22', 2020, 'BAMS', ?, 'LEGACY_COHORT', NULL, 'CLOSED_LEGACY', TRUE, 10, 'Legacy batches admitted before 2021–22; minimal historical records.'),
          ('MRUTYUNJAYA', 'Mrutyunjaya', '2021-2022', 2021, 'BAMS', ?, 'INTERNSHIP', NULL, 'COMPLETED', TRUE, 20, 'RS7 2021–22 cohort; currently in internship.'),
          ('AGASTYA', 'Agastya', '2022-2023', 2022, 'BAMS', ?, 'PROF_YEAR_3_SENIOR', 3, 'COMPLETED', TRUE, 30, '3rd Professional Year (Seniors).'),
          ('DAKSHA', 'Daksha', '2023-2024', 2023, 'BAMS', ?, 'PROF_YEAR_3_JUNIOR', 3, 'COMPLETED', TRUE, 40, '3rd Professional Year (Juniors).'),
          ('AGNIVESH', 'Agnivesh', '2024-2025', 2024, 'BAMS', ?, 'PROF_YEAR_2', 2, 'COMPLETED', TRUE, 50, '2nd Professional Year.'),
          ('VEDANG', 'Vedang', '2025-2026', 2025, 'BAMS', ?, 'PROF_YEAR_1', 1, 'IN_PROGRESS', TRUE, 60, '1st Professional Year once admissions are complete.'),
          ('NEW_INTAKE_PENDING', 'New Intake (Batch Name Not Assigned)', '2026-2027', 2026, 'BAMS', ?, 'ADMISSION_IN_PROGRESS', 1, 'IN_PROGRESS', FALSE, 70, 'Admission in progress; batch name not yet assigned and not activated prematurely.')`,
        [rs6Id, rs7Id, rs7Id, rs7Id, rs7Id, rs7Id, rs7Id]
      );

      // Link junior cohort chain only where junior_batch_id is currently NULL
      const [batchRows] = await connection.query<any[]>(
        'SELECT id, code, junior_batch_id FROM academic_batches'
      );
      const batchIdByCode = new Map<string, { id: number; junior_batch_id: number | null }>();
      for (const b of batchRows) {
        batchIdByCode.set(b.code, { id: b.id, junior_batch_id: b.junior_batch_id });
      }
      const links: Array<[string, string]> = [
        ['MRUTYUNJAYA', 'AGASTYA'],
        ['AGASTYA', 'DAKSHA'],
        ['DAKSHA', 'AGNIVESH'],
        ['AGNIVESH', 'VEDANG'],
        ['VEDANG', 'NEW_INTAKE_PENDING'],
      ];
      for (const [seniorCode, juniorCode] of links) {
        const senior = batchIdByCode.get(seniorCode);
        const junior = batchIdByCode.get(juniorCode);
        if (senior && junior && !senior.junior_batch_id) {
          await connection.query(
            'UPDATE academic_batches SET junior_batch_id = ? WHERE id = ? AND junior_batch_id IS NULL',
            [junior.id, senior.id]
          );
        }
      }
    }

    // 4c. Server-side roll sequence table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`student_roll_sequences\` (
        \`admission_year\` INT NOT NULL PRIMARY KEY,
        \`last_seq\` INT NOT NULL DEFAULT 0,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 4d. Additive columns on existing `students` table (preserving PK `id` and all Fees relationships)
    const studentAdditiveColumns: Array<[string, string]> = [
      ['temporary_roll_number', 'VARCHAR(50) NULL DEFAULT NULL'],
      ['permanent_university_number', 'VARCHAR(50) NULL DEFAULT NULL'],
      ['university_reg_status', "ENUM('NOT_ENTERED', 'PENDING_VERIFICATION', 'VERIFIED') NOT NULL DEFAULT 'NOT_ENTERED'"],
      ['university_reg_verified_by', 'INT NULL DEFAULT NULL'],
      ['university_reg_verified_at', 'TIMESTAMP NULL DEFAULT NULL'],
      ['scheme_id', 'INT NULL DEFAULT NULL'],
      ['original_batch_id', 'INT NULL DEFAULT NULL'],
      ['current_placement_batch_id', 'INT NULL DEFAULT NULL'],
      ['detention_stage', 'INT NOT NULL DEFAULT 0'],
      ['progression_status', "VARCHAR(60) NOT NULL DEFAULT 'REGULAR_ACTIVE'"],
      ['classroom_mapping', 'JSON NULL'],
      ['outstanding_backlogs_count', 'INT NOT NULL DEFAULT 0'],
      ['supplementary_due_cycle', 'VARCHAR(50) NULL DEFAULT NULL'],
      ['rs6_internship_completed', 'BOOLEAN NULL DEFAULT NULL'],
      ['rs6_academic_summary', 'TEXT NULL'],
      ['university_recorded_name', 'VARCHAR(150) NULL DEFAULT NULL'],
      ['date_of_birth', 'DATE NULL DEFAULT NULL'],
      ['gender', "ENUM('MALE', 'FEMALE', 'OTHER', 'NOT_SPECIFIED') NULL DEFAULT NULL"],
      ['nationality', "VARCHAR(60) NULL DEFAULT 'Indian'"],
      ['current_address', 'TEXT NULL'],
      ['permanent_address', 'TEXT NULL'],
      ['state', 'VARCHAR(80) NULL DEFAULT NULL'],
      ['district', 'VARCHAR(80) NULL DEFAULT NULL'],
      ['city_town', 'VARCHAR(80) NULL DEFAULT NULL'],
      ['pin_code', 'VARCHAR(15) NULL DEFAULT NULL'],
      ['profile_remarks', 'TEXT NULL'],
      ['father_name', 'VARCHAR(150) NULL DEFAULT NULL'],
      ['father_phone', 'VARCHAR(25) NULL DEFAULT NULL'],
      ['mother_name', 'VARCHAR(150) NULL DEFAULT NULL'],
      ['mother_phone', 'VARCHAR(25) NULL DEFAULT NULL'],
      ['guardian_name', 'VARCHAR(150) NULL DEFAULT NULL'],
      ['guardian_relationship', 'VARCHAR(60) NULL DEFAULT NULL'],
      ['guardian_phone', 'VARCHAR(25) NULL DEFAULT NULL'],
      ['emergency_contact_name', 'VARCHAR(150) NULL DEFAULT NULL'],
      ['emergency_contact_relationship', 'VARCHAR(60) NULL DEFAULT NULL'],
      ['emergency_contact_phone', 'VARCHAR(25) NULL DEFAULT NULL'],
      ['parent_guardian_address', 'TEXT NULL'],
      ['admission_academic_year', 'VARCHAR(20) NULL DEFAULT NULL'],
      ['admission_date', 'DATE NULL DEFAULT NULL'],
      ['seat_category', 'VARCHAR(50) NULL DEFAULT NULL'],
      ['reservation_details', 'VARCHAR(255) NULL DEFAULT NULL'],
      ['neet_roll_number', 'VARCHAR(50) NULL DEFAULT NULL'],
      ['neet_score', 'VARCHAR(30) NULL DEFAULT NULL'],
      ['application_identifier', 'VARCHAR(80) NULL DEFAULT NULL'],
      ['qualifying_exam', 'VARCHAR(100) NULL DEFAULT NULL'],
      ['qualifying_board', 'VARCHAR(120) NULL DEFAULT NULL'],
      ['qualifying_year', 'INT NULL DEFAULT NULL'],
      ['qualifying_marks_percentage', 'VARCHAR(40) NULL DEFAULT NULL'],
      ['admission_order_ref', 'VARCHAR(100) NULL DEFAULT NULL'],
      ['admission_status', "ENUM('APPLIED', 'PROVISIONAL', 'CONFIRMED', 'CANCELLED') NOT NULL DEFAULT 'PROVISIONAL'"],
      ['confirmation_date', 'DATE NULL DEFAULT NULL'],
      ['admission_remarks', 'TEXT NULL'],
      ['administrative_status', "ENUM('ADMISSION_PENDING', 'ACTIVE', 'DISCONTINUED', 'CANCELLED', 'COMPLETED') NOT NULL DEFAULT 'ACTIVE'"],
      ['administrative_status_reason', 'VARCHAR(255) NULL DEFAULT NULL'],
      ['course_duration_flag', 'BOOLEAN NOT NULL DEFAULT FALSE'],
    ];

    for (const [colName, colDef] of studentAdditiveColumns) {
      if (!(await columnExists(connection, 'students', colName))) {
        await connection.query(`ALTER TABLE \`students\` ADD COLUMN \`${colName}\` ${colDef}`);
      }
    }

    // Backfill temporary_roll_number for any pre-existing student rows without erasing existing IDs
    await connection.query(`
      UPDATE \`students\`
      SET \`temporary_roll_number\` = \`student_id_number\`
      WHERE \`temporary_roll_number\` IS NULL AND \`university_reg_status\` = 'NOT_ENTERED'
    `);

    // Add indexes & foreign keys on students
    const studentIndexes: Array<[string, string]> = [
      ['uq_students_temp_roll', 'UNIQUE INDEX `uq_students_temp_roll` (`temporary_roll_number`)'],
      ['uq_students_perm_univ', 'UNIQUE INDEX `uq_students_perm_univ` (`permanent_university_number`)'],
      ['idx_students_orig_batch', 'INDEX `idx_students_orig_batch` (`original_batch_id`)'],
      ['idx_students_curr_batch', 'INDEX `idx_students_curr_batch` (`current_placement_batch_id`)'],
      ['idx_students_admin_status', 'INDEX `idx_students_admin_status` (`administrative_status`)'],
      ['idx_students_prog_status', 'INDEX `idx_students_prog_status` (`progression_status`)'],
    ];
    for (const [idxName, idxDef] of studentIndexes) {
      if (!(await indexExists(connection, 'students', idxName))) {
        await connection.query(`ALTER TABLE \`students\` ADD ${idxDef}`);
      }
    }

    if (!(await constraintExists(connection, 'students', 'fk_students_scheme'))) {
      await connection.query(`
        ALTER TABLE \`students\`
        ADD CONSTRAINT \`fk_students_scheme\` FOREIGN KEY (\`scheme_id\`) REFERENCES \`curriculum_schemes\` (\`id\`)
        ON DELETE RESTRICT ON UPDATE CASCADE
      `);
    }
    if (!(await constraintExists(connection, 'students', 'fk_students_orig_batch'))) {
      await connection.query(`
        ALTER TABLE \`students\`
        ADD CONSTRAINT \`fk_students_orig_batch\` FOREIGN KEY (\`original_batch_id\`) REFERENCES \`academic_batches\` (\`id\`)
        ON DELETE RESTRICT ON UPDATE CASCADE
      `);
    }
    if (!(await constraintExists(connection, 'students', 'fk_students_curr_batch'))) {
      await connection.query(`
        ALTER TABLE \`students\`
        ADD CONSTRAINT \`fk_students_curr_batch\` FOREIGN KEY (\`current_placement_batch_id\`) REFERENCES \`academic_batches\` (\`id\`)
        ON DELETE RESTRICT ON UPDATE CASCADE
      `);
    }
    if (!(await constraintExists(connection, 'students', 'fk_students_univ_verifier'))) {
      await connection.query(`
        ALTER TABLE \`students\`
        ADD CONSTRAINT \`fk_students_univ_verifier\` FOREIGN KEY (\`university_reg_verified_by\`) REFERENCES \`users\` (\`id\`)
        ON DELETE SET NULL ON UPDATE CASCADE
      `);
    }

    // 4e. Supporting Student Management tables
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`student_identifier_history\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`student_id\` INT NOT NULL,
        \`identifier_type\` ENUM('TEMPORARY_ROLL_GENERATED', 'PERMANENT_UNIVERSITY_ENTERED', 'PERMANENT_UNIVERSITY_VERIFIED', 'IDENTIFIER_CORRECTION') NOT NULL,
        \`previous_identifier\` VARCHAR(50) NULL,
        \`new_identifier\` VARCHAR(50) NOT NULL,
        \`verification_status\` ENUM('PENDING_VERIFICATION', 'VERIFIED', 'HISTORICAL') NOT NULL,
        \`reason\` VARCHAR(255) NOT NULL,
        \`actor_id\` INT NULL,
        \`verified_by\` INT NULL,
        \`verified_at\` TIMESTAMP NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_sih_student\` FOREIGN KEY (\`student_id\`) REFERENCES \`students\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT \`fk_sih_actor\` FOREIGN KEY (\`actor_id\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT \`fk_sih_verifier\` FOREIGN KEY (\`verified_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE,
        INDEX \`idx_sih_student\` (\`student_id\`),
        INDEX \`idx_sih_prev_id\` (\`previous_identifier\`),
        INDEX \`idx_sih_new_id\` (\`new_identifier\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`student_documents\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`student_id\` INT NOT NULL,
        \`document_type\` VARCHAR(80) NOT NULL,
        \`document_label\` VARCHAR(150) NULL,
        \`reference_number\` VARCHAR(100) NULL,
        \`issue_date\` DATE NULL,
        \`received_status\` ENUM('PENDING', 'RECEIVED', 'NOT_APPLICABLE', 'RETURNED_ORIGINAL') NOT NULL DEFAULT 'PENDING',
        \`verification_status\` ENUM('UNVERIFIED', 'VERIFIED', 'DISCREPANCY') NOT NULL DEFAULT 'UNVERIFIED',
        \`verified_by\` INT NULL,
        \`verified_at\` TIMESTAMP NULL,
        \`remarks\` VARCHAR(500) NULL,
        \`updated_by\` INT NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_sdoc_student\` FOREIGN KEY (\`student_id\`) REFERENCES \`students\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT \`fk_sdoc_verifier\` FOREIGN KEY (\`verified_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT \`fk_sdoc_updater\` FOREIGN KEY (\`updated_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE,
        INDEX \`idx_sdoc_student\` (\`student_id\`),
        INDEX \`idx_sdoc_type\` (\`document_type\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`student_progression_events\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`student_id\` INT NOT NULL,
        \`scheme_id\` INT NULL,
        \`event_type\` ENUM('INITIAL_ENROLLMENT', 'PROPOSED_RESULT_OUTCOME', 'CONFIRMED_PROGRESSION', 'DOCUMENTED_OFFICE_CORRECTION', 'MANUAL_PLACEMENT_CHANGE', 'LEGACY_RS6_RECORD') NOT NULL,
        \`exam_session_ref\` VARCHAR(100) NULL,
        \`exam_attempt_type\` ENUM('REGULAR', 'SUPPLEMENTARY', 'NOT_APPLICABLE') NOT NULL DEFAULT 'REGULAR',
        \`evaluated_professional_year\` INT NULL,
        \`previous_professional_year\` INT NULL,
        \`proposed_professional_year\` INT NULL,
        \`previous_placement_batch_id\` INT NULL,
        \`proposed_placement_batch_id\` INT NULL,
        \`previous_detention_stage\` INT NOT NULL DEFAULT 0,
        \`proposed_detention_stage\` INT NOT NULL DEFAULT 0,
        \`subjects_evaluated_count\` INT NOT NULL DEFAULT 0,
        \`subjects_passed\` JSON NULL,
        \`subjects_outstanding\` JSON NULL,
        \`placement_rule_applied\` VARCHAR(120) NOT NULL,
        \`proposed_status\` VARCHAR(60) NOT NULL,
        \`workflow_state\` ENUM('PROPOSED', 'PENDING_OFFICE_REVIEW', 'CONFIRMED', 'SUPERSEDED') NOT NULL DEFAULT 'PROPOSED',
        \`review_issue_explanation\` TEXT NULL,
        \`classroom_mapping\` JSON NULL,
        \`supplementary_cycle_note\` VARCHAR(255) NULL,
        \`max_duration_years_snapshot\` INT NOT NULL DEFAULT 9,
        \`exceeds_max_duration_flag\` BOOLEAN NOT NULL DEFAULT FALSE,
        \`entered_by\` INT NULL,
        \`confirmed_by\` INT NULL,
        \`confirmed_at\` TIMESTAMP NULL,
        \`effective_date\` DATE NULL,
        \`reason_or_remarks\` TEXT NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_spe_student\` FOREIGN KEY (\`student_id\`) REFERENCES \`students\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT \`fk_spe_scheme\` FOREIGN KEY (\`scheme_id\`) REFERENCES \`curriculum_schemes\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT \`fk_spe_prev_batch\` FOREIGN KEY (\`previous_placement_batch_id\`) REFERENCES \`academic_batches\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT \`fk_spe_prop_batch\` FOREIGN KEY (\`proposed_placement_batch_id\`) REFERENCES \`academic_batches\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT \`fk_spe_entered_by\` FOREIGN KEY (\`entered_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT \`fk_spe_confirmed_by\` FOREIGN KEY (\`confirmed_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE,
        INDEX \`idx_spe_student\` (\`student_id\`),
        INDEX \`idx_spe_workflow\` (\`workflow_state\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`institutional_settings\` (
        \`setting_key\` VARCHAR(80) NOT NULL PRIMARY KEY,
        \`setting_value\` VARCHAR(100) NOT NULL,
        \`effective_date\` DATE NOT NULL,
        \`updated_by\` INT NULL,
        \`updated_reason\` VARCHAR(500) NULL,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_iset_updater\` FOREIGN KEY (\`updated_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`institutional_setting_history\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`setting_key\` VARCHAR(80) NOT NULL,
        \`previous_value\` VARCHAR(100) NOT NULL,
        \`new_value\` VARCHAR(100) NOT NULL,
        \`effective_date\` DATE NOT NULL,
        \`reason\` VARCHAR(500) NOT NULL,
        \`authorized_by\` INT NOT NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_ish_authorizer\` FOREIGN KEY (\`authorized_by\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        INDEX \`idx_ish_key\` (\`setting_key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.query(`
      INSERT IGNORE INTO \`institutional_settings\` (\`setting_key\`, \`setting_value\`, \`effective_date\`, \`updated_reason\`)
      VALUES ('MAX_COURSE_DURATION_YEARS', '9', '2021-09-01', 'Initial college-configured maximum course duration setting (9 years from admission).')
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`student_internships\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`student_id\` INT NOT NULL UNIQUE,
        \`start_date\` DATE NULL,
        \`base_required_days\` INT NOT NULL DEFAULT 365,
        \`approved_extension_days\` INT NOT NULL DEFAULT 0,
        \`adjusted_required_days\` INT NOT NULL DEFAULT 365,
        \`credited_days_completed\` INT NOT NULL DEFAULT 0,
        \`attendance_source\` ENUM('PENDING_ATTENDANCE_MODULE', 'VERIFIED_BIOMETRIC_SYNC', 'VERIFIED_ATTENDANCE_LEDGER') NOT NULL DEFAULT 'PENDING_ATTENDANCE_MODULE',
        \`attendance_reconciliation_status\` ENUM('UNAVAILABLE_PENDING_INTEGRATION', 'RECONCILED', 'DISCREPANCY_REVIEW') NOT NULL DEFAULT 'UNAVAILABLE_PENDING_INTEGRATION',
        \`last_attendance_sync_ref\` VARCHAR(100) NULL,
        \`expected_completion_date\` DATE NULL,
        \`internship_status\` ENUM('NOT_STARTED', 'ELIGIBLE', 'IN_PROGRESS', 'EXTENDED', 'COMPLETED', 'ON_HOLD') NOT NULL DEFAULT 'ELIGIBLE',
        \`completion_verified_by\` INT NULL,
        \`completion_verified_at\` TIMESTAMP NULL,
        \`actual_completion_date\` DATE NULL,
        \`completion_remarks\` VARCHAR(500) NULL,
        \`created_by\` INT NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_sint_student\` FOREIGN KEY (\`student_id\`) REFERENCES \`students\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT \`fk_sint_verifier\` FOREIGN KEY (\`completion_verified_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT \`fk_sint_creator\` FOREIGN KEY (\`created_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`student_internship_extensions\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`internship_id\` INT NOT NULL,
        \`student_id\` INT NOT NULL,
        \`additional_days\` INT NOT NULL,
        \`previous_required_total\` INT NOT NULL,
        \`new_required_total\` INT NOT NULL,
        \`reason\` VARCHAR(500) NOT NULL,
        \`authorized_by\` INT NOT NULL,
        \`authorized_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_siext_internship\` FOREIGN KEY (\`internship_id\`) REFERENCES \`student_internships\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT \`fk_siext_student\` FOREIGN KEY (\`student_id\`) REFERENCES \`students\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT \`fk_siext_authorizer\` FOREIGN KEY (\`authorized_by\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        INDEX \`idx_siext_student\` (\`student_id\`),
        INDEX \`idx_siext_internship\` (\`internship_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await markMigrationApplied(connection, 'student_management_v1');
  }

  // 5. Internal Assessment Foundation v1 additive schema & seed data
  if (!(await isMigrationApplied(connection, 'internal_assessment_v1'))) {
    // 5a. Subjects table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`subjects\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`code\` VARCHAR(50) NOT NULL UNIQUE,
        \`name\` VARCHAR(150) NOT NULL,
        \`professional_year\` INT NOT NULL DEFAULT 1,
        \`department_id\` INT NULL,
        \`max_marks_theory\` DECIMAL(6,2) NULL,
        \`max_marks_practical\` DECIMAL(6,2) NULL,
        \`ia_maximum\` DECIMAL(6,2) NOT NULL DEFAULT 15.00,
        \`is_ia_enabled\` BOOLEAN NOT NULL DEFAULT TRUE,
        \`ia_calculation_rule\` VARCHAR(50) NULL DEFAULT 'STANDARD_PAT_TERM',
        \`notes\` VARCHAR(255) NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_subjects_department\` FOREIGN KEY (\`department_id\`) REFERENCES \`departments\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE,
        INDEX \`idx_subjects_prof_year\` (\`professional_year\`),
        INDEX \`idx_subjects_ia_enabled\` (\`is_ia_enabled\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 5b. Assessments table (Predefined PAT 1-9 and Term Test 1 & 2)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`assessments\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`code\` VARCHAR(50) NOT NULL UNIQUE,
        \`name\` VARCHAR(100) NOT NULL,
        \`assessment_type\` ENUM('PAT', 'TERM_TEST', 'UNIVERSITY_EXAM') NOT NULL,
        \`term_number\` INT NOT NULL DEFAULT 1,
        \`max_marks_theory\` DECIMAL(6,2) NOT NULL DEFAULT 15.00,
        \`max_marks_practical\` DECIMAL(6,2) NOT NULL DEFAULT 0.00,
        \`is_active\` BOOLEAN NOT NULL DEFAULT TRUE,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX \`idx_assessments_type\` (\`assessment_type\`),
        INDEX \`idx_assessments_term\` (\`term_number\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 5c. Subject Assessment Configuration table (applicability, availability, dates)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`subject_assessment_config\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`subject_id\` INT NOT NULL,
        \`assessment_id\` INT NOT NULL,
        \`is_applicable\` BOOLEAN NOT NULL DEFAULT TRUE,
        \`is_available_for_entry\` BOOLEAN NOT NULL DEFAULT FALSE,
        \`available_from_date\` DATE NULL,
        \`available_to_date\` DATE NULL,
        \`updated_by\` INT NULL,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_sac_subject\` FOREIGN KEY (\`subject_id\`) REFERENCES \`subjects\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT \`fk_sac_assessment\` FOREIGN KEY (\`assessment_id\`) REFERENCES \`assessments\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT \`fk_sac_updater\` FOREIGN KEY (\`updated_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE,
        UNIQUE KEY \`uq_subject_assessment\` (\`subject_id\`, \`assessment_id\`),
        INDEX \`idx_sac_available\` (\`is_available_for_entry\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 5d. Seed Predefined Assessments (PAT 1-9, Term Test 1, Term Test 2)
    await connection.query(`
      INSERT IGNORE INTO \`assessments\` (\`code\`, \`name\`, \`assessment_type\`, \`term_number\`, \`max_marks_theory\`, \`max_marks_practical\`) VALUES
        ('PAT_1', 'Periodic Assessment Test 1', 'PAT', 1, 15.00, 0.00),
        ('PAT_2', 'Periodic Assessment Test 2', 'PAT', 1, 15.00, 0.00),
        ('PAT_3', 'Periodic Assessment Test 3', 'PAT', 1, 15.00, 0.00),
        ('PAT_4', 'Periodic Assessment Test 4', 'PAT', 2, 15.00, 0.00),
        ('PAT_5', 'Periodic Assessment Test 5', 'PAT', 2, 15.00, 0.00),
        ('PAT_6', 'Periodic Assessment Test 6', 'PAT', 2, 15.00, 0.00),
        ('PAT_7', 'Periodic Assessment Test 7', 'PAT', 3, 15.00, 0.00),
        ('PAT_8', 'Periodic Assessment Test 8', 'PAT', 3, 15.00, 0.00),
        ('PAT_9', 'Periodic Assessment Test 9', 'PAT', 3, 15.00, 0.00),
        ('TERM_TEST_1', 'Term Test 1', 'TERM_TEST', 1, 100.00, 100.00),
        ('TERM_TEST_2', 'Term Test 2', 'TERM_TEST', 2, 100.00, 100.00)
      ON DUPLICATE KEY UPDATE \`name\` = VALUES(\`name\`)
    `);

    // 5e. Seed Verified Subjects
    await connection.query(`
      INSERT IGNORE INTO \`subjects\` (\`code\`, \`name\`, \`professional_year\`, \`ia_maximum\`, \`is_ia_enabled\`, \`ia_calculation_rule\`, \`notes\`) VALUES
        ('SAMHITA_1', 'Samhita Adhyayana-1', 1, 15.00, TRUE, 'STANDARD_PAT_TERM', 'Verified 15-mark IA maximum'),
        ('SAMHITA_2', 'Samhita Adhyayana-2', 2, 15.00, TRUE, 'STANDARD_PAT_TERM', 'Verified 15-mark IA maximum'),
        ('SAMHITA_3', 'Samhita Adhyayana-3', 3, 15.00, TRUE, 'STANDARD_PAT_TERM', 'Verified 15-mark IA maximum'),
        ('KAYACHIKITSA', 'Kayachikitsa', 3, 30.00, TRUE, 'STANDARD_PAT_TERM', 'Confirmed 30-mark subject'),
        ('PANCHAKARMA', 'Panchakarma', 3, 30.00, TRUE, 'STANDARD_PAT_TERM', 'Confirmed 30-mark subject'),
        ('SHALYA_TANTRA', 'Shalya Tantra', 3, 30.00, TRUE, 'STANDARD_PAT_TERM', 'Confirmed 30-mark subject'),
        ('PRASUTI_TANTRA', 'Prasuti Tantra evam Stree Roga', 3, 30.00, TRUE, 'STANDARD_PAT_TERM', 'Confirmed 30-mark subject'),
        ('SHALAKYA_TANTRA', 'Shalakya Tantra', 3, 30.00, TRUE, 'STANDARD_PAT_TERM', 'Confirmed 30-mark subject'),
        ('KAUMARABHRITYA', 'Kaumarabhritya', 3, 30.00, TRUE, 'STANDARD_PAT_TERM', 'Confirmed 30-mark subject'),
        ('RESEARCH_METHODOLOGY', 'Research Methodology and Medical Statistics', 3, 0.00, FALSE, 'NO_IA', 'No IA calculation required'),
        ('ATYAIKACHIKITSA', 'Atyaikachikitsa', 3, 0.00, FALSE, 'SUBJECT_ONLY', 'Subject record only, no invented assessment structure')
      ON DUPLICATE KEY UPDATE \`name\` = VALUES(\`name\`), \`ia_maximum\` = VALUES(\`ia_maximum\`), \`is_ia_enabled\` = VALUES(\`is_ia_enabled\`)
    `);

    // 5f. Auto-configure subject_assessment_config for applicable subjects and assessments
    await connection.query(`
      INSERT INTO \`subject_assessment_config\` (\`subject_id\`, \`assessment_id\`, \`is_applicable\`, \`is_available_for_entry\`)
      SELECT s.id, a.id, 
        CASE WHEN s.is_ia_enabled = TRUE THEN TRUE ELSE FALSE END,
        FALSE
      FROM \`subjects\` s
      CROSS JOIN \`assessments\` a
      WHERE s.is_ia_enabled = TRUE
      ON DUPLICATE KEY UPDATE \`is_applicable\` = VALUES(\`is_applicable\`)
    `);

    await markMigrationApplied(connection, 'internal_assessment_v1');
  }

  // 6. Internal Assessment Marks Entry v1 additive schema
  if (!(await isMigrationApplied(connection, 'internal_assessment_marks_v1'))) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`student_assessment_marks\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`student_id\` INT NOT NULL,
        \`subject_id\` INT NOT NULL,
        \`assessment_id\` INT NOT NULL,
        \`batch_id\` INT NOT NULL,
        \`outcome\` ENUM('MARKS_ENTERED', 'ABSENT', 'NOT_APPEARED', 'EXEMPTED') NOT NULL DEFAULT 'MARKS_ENTERED',
        \`theory_marks\` DECIMAL(6,2) NULL,
        \`practical_marks\` DECIMAL(6,2) NULL,
        \`is_draft\` BOOLEAN NOT NULL DEFAULT TRUE,
        \`saved_by\` INT NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_sam_student\` FOREIGN KEY (\`student_id\`) REFERENCES \`students\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT \`fk_sam_subject\` FOREIGN KEY (\`subject_id\`) REFERENCES \`subjects\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT \`fk_sam_assessment\` FOREIGN KEY (\`assessment_id\`) REFERENCES \`assessments\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT \`fk_sam_batch\` FOREIGN KEY (\`batch_id\`) REFERENCES \`academic_batches\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT \`fk_sam_saver\` FOREIGN KEY (\`saved_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE,
        UNIQUE KEY \`uq_student_assessment_entry\` (\`student_id\`, \`subject_id\`, \`assessment_id\`),
        INDEX \`idx_sam_batch_subject\` (\`batch_id\`, \`subject_id\`),
        INDEX \`idx_sam_assessment\` (\`assessment_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await markMigrationApplied(connection, 'internal_assessment_marks_v1');
  }

  // 7. Internal Assessment Submissions v1 additive schema
  if (!(await isMigrationApplied(connection, 'internal_assessment_submissions_v1'))) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`assessment_submissions\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`batch_id\` INT NOT NULL,
        \`subject_id\` INT NOT NULL,
        \`assessment_id\` INT NOT NULL,
        \`department_id\` INT NULL,
        \`submitted_by\` INT NOT NULL,
        \`submitted_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`status\` ENUM('SUBMITTED') NOT NULL DEFAULT 'SUBMITTED',
        CONSTRAINT \`fk_sub_batch\` FOREIGN KEY (\`batch_id\`) REFERENCES \`academic_batches\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT \`fk_sub_subject\` FOREIGN KEY (\`subject_id\`) REFERENCES \`subjects\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT \`fk_sub_assessment\` FOREIGN KEY (\`assessment_id\`) REFERENCES \`assessments\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT \`fk_sub_dept\` FOREIGN KEY (\`department_id\`) REFERENCES \`departments\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT \`fk_sub_submitter\` FOREIGN KEY (\`submitted_by\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        UNIQUE KEY \`uq_assessment_submission\` (\`batch_id\`, \`subject_id\`, \`assessment_id\`),
        INDEX \`idx_sub_dept\` (\`department_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await markMigrationApplied(connection, 'internal_assessment_submissions_v1');
  }

  // 8. Internal Assessment Automatic Calculation v1 additive schema (Step 2D)
  if (!(await isMigrationApplied(connection, 'internal_assessment_calculations_v1'))) {
    // 8a. Additive verification & PAT mapping columns on `subjects`
    if (!(await columnExists(connection, 'subjects', 'ia_formula_verified'))) {
      await connection.query(
        'ALTER TABLE `subjects` ADD COLUMN `ia_formula_verified` BOOLEAN NOT NULL DEFAULT FALSE AFTER `ia_calculation_rule`'
      );
    }
    if (!(await columnExists(connection, 'subjects', 'pat_mapping_verified'))) {
      await connection.query(
        'ALTER TABLE `subjects` ADD COLUMN `pat_mapping_verified` BOOLEAN NOT NULL DEFAULT FALSE AFTER `ia_formula_verified`'
      );
    }
    if (!(await columnExists(connection, 'subjects', 'pat_mapping_config'))) {
      await connection.query(
        'ALTER TABLE `subjects` ADD COLUMN `pat_mapping_config` JSON NULL DEFAULT NULL AFTER `pat_mapping_verified`'
      );
    }

    // Mark only the 9 confirmed subjects as formula-verified; keep pat_mapping_verified FALSE until explicitly configured
    await connection.query(`
      UPDATE \`subjects\`
      SET \`ia_formula_verified\` = TRUE
      WHERE \`code\` IN (
        'SAMHITA_1', 'SAMHITA_2', 'SAMHITA_3',
        'KAYACHIKITSA', 'PANCHAKARMA', 'SHALYA_TANTRA',
        'PRASUTI_TANTRA', 'SHALAKYA_TANTRA', 'KAUMARABHRITYA'
      )
    `);

    await connection.query(`
      UPDATE \`subjects\`
      SET \`is_ia_enabled\` = FALSE, \`ia_formula_verified\` = FALSE, \`pat_mapping_verified\` = FALSE, \`pat_mapping_config\` = NULL
      WHERE \`code\` IN ('RESEARCH_METHODOLOGY', 'ATYAIKACHIKITSA')
    `);

    // 8b. Separate Term-Test Converted Marks table (preserves raw marks in student_assessment_marks untouched)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`student_term_test_conversions\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`student_id\` INT NOT NULL,
        \`batch_id\` INT NOT NULL,
        \`subject_id\` INT NOT NULL,
        \`assessment_id\` INT NOT NULL,
        \`term_number\` INT NOT NULL,
        \`outcome\` ENUM('MARKS_ENTERED', 'ABSENT', 'NOT_APPEARED', 'EXEMPTED') NOT NULL,
        \`raw_theory_marks\` DECIMAL(6,2) NULL,
        \`raw_practical_marks\` DECIMAL(6,2) NULL,
        \`combined_raw_marks\` DECIMAL(6,2) NULL,
        \`conversion_maximum\` DECIMAL(6,2) NOT NULL,
        \`converted_marks\` DECIMAL(6,2) NULL,
        \`conversion_status\` ENUM('CONVERTED', 'PENDING_OUTCOME_RULE') NOT NULL DEFAULT 'CONVERTED',
        \`status_reason\` VARCHAR(255) NULL,
        \`calculated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_sttc_student\` FOREIGN KEY (\`student_id\`) REFERENCES \`students\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT \`fk_sttc_batch\` FOREIGN KEY (\`batch_id\`) REFERENCES \`academic_batches\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT \`fk_sttc_subject\` FOREIGN KEY (\`subject_id\`) REFERENCES \`subjects\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT \`fk_sttc_assessment\` FOREIGN KEY (\`assessment_id\`) REFERENCES \`assessments\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        UNIQUE KEY \`uq_sttc_entry\` (\`student_id\`, \`subject_id\`, \`assessment_id\`),
        INDEX \`idx_sttc_batch_subject\` (\`batch_id\`, \`subject_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 8c. Separate Automatic IA Calculation Results table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`student_ia_calculations\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`student_id\` INT NOT NULL,
        \`batch_id\` INT NOT NULL,
        \`subject_id\` INT NOT NULL,
        \`scheme_code\` VARCHAR(30) NULL,
        \`ia_maximum\` DECIMAL(6,2) NULL,
        \`term1_a\` DECIMAL(6,2) NULL,
        \`term1_b\` DECIMAL(6,2) NULL,
        \`term1_c\` DECIMAL(6,2) NULL,
        \`term1_d\` DECIMAL(6,2) NULL,
        \`term1_e\` DECIMAL(6,2) NULL,
        \`term1_f\` DECIMAL(6,2) NULL,
        \`term1_h\` DECIMAL(6,2) NULL,
        \`term2_a\` DECIMAL(6,2) NULL,
        \`term2_b\` DECIMAL(6,2) NULL,
        \`term2_c\` DECIMAL(6,2) NULL,
        \`term2_d\` DECIMAL(6,2) NULL,
        \`term2_e\` DECIMAL(6,2) NULL,
        \`term2_f\` DECIMAL(6,2) NULL,
        \`term2_h\` DECIMAL(6,2) NULL,
        \`term3_a\` DECIMAL(6,2) NULL,
        \`term3_b\` DECIMAL(6,2) NULL,
        \`term3_c\` DECIMAL(6,2) NULL,
        \`term3_d\` DECIMAL(6,2) NULL,
        \`term3_e\` DECIMAL(6,2) NULL,
        \`term3_h\` DECIMAL(6,2) NULL,
        \`final_automatic_ia\` DECIMAL(6,2) NULL,
        \`source_assessments\` JSON NULL,
        \`calculation_status\` ENUM('CALCULATED', 'PENDING', 'NOT_APPLICABLE') NOT NULL DEFAULT 'PENDING',
        \`status_reason\` VARCHAR(500) NULL,
        \`calculated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_siac_student\` FOREIGN KEY (\`student_id\`) REFERENCES \`students\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT \`fk_siac_batch\` FOREIGN KEY (\`batch_id\`) REFERENCES \`academic_batches\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT \`fk_siac_subject\` FOREIGN KEY (\`subject_id\`) REFERENCES \`subjects\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        UNIQUE KEY \`uq_student_ia_calc\` (\`student_id\`, \`batch_id\`, \`subject_id\`),
        INDEX \`idx_siac_batch_subject\` (\`batch_id\`, \`subject_id\`),
        INDEX \`idx_siac_status\` (\`calculation_status\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await markMigrationApplied(connection, 'internal_assessment_calculations_v1');
  }

  // ---------------------------------------------------------------------------
  // Migration: internal_assessment_approvals_v1 (Step 2E — Office Review & Final IA Approval)
  // Stores approved/adjusted Final IA marks separately from automatic calculations,
  // preserves chronological approval/adjustment history, and tracks recalculation review flags.
  // ---------------------------------------------------------------------------
  if (!(await isMigrationApplied(connection, 'internal_assessment_approvals_v1'))) {
    console.log(
      '[KAMCH ERP Migration] Applying internal_assessment_approvals_v1 (Office IA Review, Final Approval & Adjustment History)...'
    );

    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`student_final_ia_approvals\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`student_id\` INT NOT NULL,
        \`batch_id\` INT NOT NULL,
        \`subject_id\` INT NOT NULL,
        \`ia_maximum\` DECIMAL(6,2) NOT NULL,
        \`automatic_ia_at_approval\` DECIMAL(6,2) NOT NULL,
        \`approved_final_ia\` DECIMAL(6,2) NOT NULL,
        \`approval_type\` ENUM('APPROVED_AS_CALCULATED', 'MANUAL_ADJUSTMENT') NOT NULL DEFAULT 'APPROVED_AS_CALCULATED',
        \`final_status\` ENUM('APPROVED', 'ADJUSTED_APPROVED', 'REQUIRES_REVIEW') NOT NULL DEFAULT 'APPROVED',
        \`requires_office_review\` BOOLEAN NOT NULL DEFAULT FALSE,
        \`review_flag_reason\` VARCHAR(500) NULL,
        \`reason_category\` VARCHAR(80) NULL,
        \`explanation\` TEXT NULL,
        \`approved_by\` INT NOT NULL,
        \`approved_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_sfia_student\` FOREIGN KEY (\`student_id\`) REFERENCES \`students\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT \`fk_sfia_batch\` FOREIGN KEY (\`batch_id\`) REFERENCES \`academic_batches\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT \`fk_sfia_subject\` FOREIGN KEY (\`subject_id\`) REFERENCES \`subjects\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT \`fk_sfia_user\` FOREIGN KEY (\`approved_by\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        UNIQUE KEY \`uq_student_final_ia_approval\` (\`student_id\`, \`batch_id\`, \`subject_id\`),
        INDEX \`idx_sfia_batch_subject\` (\`batch_id\`, \`subject_id\`),
        INDEX \`idx_sfia_review_flag\` (\`requires_office_review\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`student_final_ia_history\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`student_id\` INT NOT NULL,
        \`batch_id\` INT NOT NULL,
        \`subject_id\` INT NOT NULL,
        \`action_type\` ENUM('APPROVED_AS_CALCULATED', 'MANUAL_ADJUSTMENT', 'FLAGGED_FOR_REVIEW_ON_RECALC') NOT NULL,
        \`previous_final_ia\` DECIMAL(6,2) NULL,
        \`new_final_ia\` DECIMAL(6,2) NOT NULL,
        \`automatic_ia_value\` DECIMAL(6,2) NULL,
        \`reason_category\` VARCHAR(80) NULL,
        \`explanation\` TEXT NULL,
        \`actor_id\` INT NULL,
        \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_sfiah_student\` FOREIGN KEY (\`student_id\`) REFERENCES \`students\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT \`fk_sfiah_batch\` FOREIGN KEY (\`batch_id\`) REFERENCES \`academic_batches\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT \`fk_sfiah_subject\` FOREIGN KEY (\`subject_id\`) REFERENCES \`subjects\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT \`fk_sfiah_actor\` FOREIGN KEY (\`actor_id\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE,
        INDEX \`idx_sfiah_student_batch_subject\` (\`student_id\`, \`batch_id\`, \`subject_id\`),
        INDEX \`idx_sfiah_batch_subject\` (\`batch_id\`, \`subject_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await markMigrationApplied(connection, 'internal_assessment_approvals_v1');
  }

  // ---------------------------------------------------------------------------
  // Migration: university_exams_v1 (University Exam & Result Management Schema)
  // Creates university_subjects and student_university_exam_attempts tables,
  // completely separate from internal assessment tables.
  // ---------------------------------------------------------------------------
  if (!(await isMigrationApplied(connection, 'university_exams_v1'))) {
    console.log(
      '[KAMCH ERP Migration] Applying university_exams_v1 (University Examination & Result Management)...'
    );

    // 1. University Subjects table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`university_subjects\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`code\` VARCHAR(50) NOT NULL UNIQUE,
        \`name\` VARCHAR(150) NOT NULL,
        \`professional_year\` INT NOT NULL DEFAULT 1,
        \`scheme_id\` INT NOT NULL,
        \`max_marks\` DECIMAL(6,2) NOT NULL DEFAULT 100.00,
        \`is_active\` BOOLEAN NOT NULL DEFAULT TRUE,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_univ_subj_scheme\` FOREIGN KEY (\`scheme_id\`) REFERENCES \`curriculum_schemes\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        INDEX \`idx_univ_subj_prof_year\` (\`professional_year\`),
        INDEX \`idx_univ_subj_scheme\` (\`scheme_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Seed standard RS7 university subjects for Professional Years 1, 2, and 3
    const [rs7SchemeRows] = await connection.query<any[]>(
      'SELECT id FROM curriculum_schemes WHERE code = ? LIMIT 1',
      ['RS7']
    );
    if (rs7SchemeRows && rs7SchemeRows.length > 0) {
      const rs7Id = rs7SchemeRows[0].id;
      await connection.query(
        `INSERT IGNORE INTO \`university_subjects\` (\`code\`, \`name\`, \`professional_year\`, \`scheme_id\`, \`max_marks\`) VALUES
          ('UNIV_SAMHITA_1', 'Samhita Adhyayana-1 (University)', 1, ?, 100.00),
          ('UNIV_SAMHITA_2', 'Samhita Adhyayana-2 (University)', 2, ?, 100.00),
          ('UNIV_SAMHITA_3', 'Samhita Adhyayana-3 (University)', 3, ?, 100.00),
          ('UNIV_KAYACHIKITSA', 'Kayachikitsa (University)', 3, ?, 200.00),
          ('UNIV_PANCHAKARMA', 'Panchakarma (University)', 3, ?, 100.00),
          ('UNIV_SHALYA', 'Shalya Tantra (University)', 3, ?, 100.00),
          ('UNIV_PRASUTI', 'Prasuti Tantra evam Stree Roga (University)', 3, ?, 100.00),
          ('UNIV_SHALAKYA', 'Shalakya Tantra (University)', 3, ?, 100.00),
          ('UNIV_KAUMARABHRITYA', 'Kaumarabhritya (University)', 3, ?, 100.00)`,
        [rs7Id, rs7Id, rs7Id, rs7Id, rs7Id, rs7Id, rs7Id, rs7Id, rs7Id]
      );
    }

    // 2. Student University Exam Attempts table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`student_university_exam_attempts\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`student_id\` INT NOT NULL,
        \`subject_id\` INT NOT NULL,
        \`exam_session_ref\` VARCHAR(100) NOT NULL,
        \`attempt_type\` ENUM('REGULAR', 'SUPPLEMENTARY') NOT NULL DEFAULT 'REGULAR',
        \`result_status\` ENUM('PASS', 'FAIL', 'PENDING', 'WITHHELD') NOT NULL DEFAULT 'PENDING',
        \`marks_obtained\` DECIMAL(6,2) NULL,
        \`failed_subjects_json\` JSON NULL,
        \`office_decision\` ENUM('PROMOTED', 'DETAINED', 'PENDING') NOT NULL DEFAULT 'PENDING',
        \`recorded_by\` INT NULL,
        \`recorded_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT \`fk_suea_student\` FOREIGN KEY (\`student_id\`) REFERENCES \`students\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT \`fk_suea_subject\` FOREIGN KEY (\`subject_id\`) REFERENCES \`university_subjects\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT \`fk_suea_recorder\` FOREIGN KEY (\`recorded_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE,
        UNIQUE KEY \`uq_student_subject_session_attempt\` (\`student_id\`, \`subject_id\`, \`exam_session_ref\`, \`attempt_type\`),
        INDEX \`idx_suea_status\` (\`result_status\`),
        INDEX \`idx_suea_attempt\` (\`attempt_type\`),
        INDEX \`idx_suea_session\` (\`exam_session_ref\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await markMigrationApplied(connection, 'university_exams_v1');
  }

  // ---------------------------------------------------------------------------
  // 8. Step 2F: Report Branding Settings in institutional_settings
  // ---------------------------------------------------------------------------
  if (!(await isMigrationApplied(connection, 'internal_assessment_reports_v1'))) {
    if (await tableExists(connection, 'institutional_settings')) {
      await connection.query(
        'ALTER TABLE `institutional_settings` MODIFY COLUMN `setting_value` VARCHAR(500) NOT NULL'
      );

      await connection.query(`
        INSERT IGNORE INTO \`institutional_settings\` (\`setting_key\`, \`setting_value\`, \`effective_date\`, \`updated_reason\`)
        VALUES
          ('REPORT_COLLEGE_NAME', 'Krishna Ayurvedic Medical College & Hospital', '2021-09-01', 'Default college name for official IA and assessment reports.'),
          ('REPORT_SUBTITLE', 'Internal Assessment & Examination Cell', '2021-09-01', 'Default subtitle for official IA and assessment reports.'),
          ('REPORT_LOGO_URL', '/assets/kamch-logo.png', '2021-09-01', 'Default logo path for official IA and assessment reports.')
      `);
    }

    await markMigrationApplied(connection, 'internal_assessment_reports_v1');
  }

  // ---------------------------------------------------------------------------
  // 9. University Exams Result Finalization & Promotion Preview (Stage 4)
  // ---------------------------------------------------------------------------
  if (!(await isMigrationApplied(connection, 'university_exams_finalization_v1'))) {
    if (await tableExists(connection, 'student_university_exam_attempts')) {
      if (!(await columnExists(connection, 'student_university_exam_attempts', 'is_finalized'))) {
        await connection.query(
          'ALTER TABLE `student_university_exam_attempts` ADD COLUMN `is_finalized` BOOLEAN NOT NULL DEFAULT FALSE AFTER `office_decision`'
        );
      }
      if (!(await columnExists(connection, 'student_university_exam_attempts', 'finalized_by'))) {
        await connection.query(
          'ALTER TABLE `student_university_exam_attempts` ADD COLUMN `finalized_by` INT NULL AFTER `is_finalized`'
        );
        try {
          await connection.query(
            'ALTER TABLE `student_university_exam_attempts` ADD CONSTRAINT `fk_suea_finalizer` FOREIGN KEY (`finalized_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE'
          );
        } catch {
          // Silently ignore if constraint already present
        }
      }
      if (!(await columnExists(connection, 'student_university_exam_attempts', 'finalized_at'))) {
        await connection.query(
          'ALTER TABLE `student_university_exam_attempts` ADD COLUMN `finalized_at` TIMESTAMP NULL AFTER `finalized_by`'
        );
      }
      if (!(await columnExists(connection, 'student_university_exam_attempts', 'finalization_remarks'))) {
        await connection.query(
          'ALTER TABLE `student_university_exam_attempts` ADD COLUMN `finalization_remarks` VARCHAR(500) NULL AFTER `finalized_at`'
        );
      }
    }

    await markMigrationApplied(connection, 'university_exams_finalization_v1');
  }

  // ---------------------------------------------------------------------------
  // 10. Library Management Module (v1)
  // ---------------------------------------------------------------------------
  if (!(await isMigrationApplied(connection, 'library_management_v1'))) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`library_books\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`accession_number\` VARCHAR(50) NOT NULL UNIQUE,
        \`accession_date\` DATE NULL DEFAULT NULL,
        \`title\` VARCHAR(255) NOT NULL,
        \`authors\` VARCHAR(255) NULL DEFAULT NULL,
        \`edition_year\` VARCHAR(100) NULL DEFAULT NULL,
        \`publisher_place\` VARCHAR(255) NULL DEFAULT NULL,
        \`isbn\` VARCHAR(50) NULL DEFAULT NULL,
        \`pages\` VARCHAR(50) NULL DEFAULT NULL,
        \`binding\` VARCHAR(50) NULL DEFAULT NULL,
        \`source\` VARCHAR(100) NULL DEFAULT NULL,
        \`bill_number_date\` VARCHAR(100) NULL DEFAULT NULL,
        \`price\` DECIMAL(10, 2) NULL DEFAULT NULL,
        \`status\` ENUM('AVAILABLE', 'ISSUED', 'LOST', 'DAMAGED', 'WITHDRAWN') NOT NULL DEFAULT 'AVAILABLE',
        \`remarks\` TEXT NULL DEFAULT NULL,
        \`created_by\` INT NULL DEFAULT NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX \`idx_lb_status\` (\`status\`),
        INDEX \`idx_lb_title\` (\`title\`),
        INDEX \`idx_lb_authors\` (\`authors\`),
        INDEX \`idx_lb_isbn\` (\`isbn\`),
        INDEX \`idx_lb_acc_num\` (\`accession_number\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`library_settings\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`borrower_type\` ENUM('STUDENT', 'TEACHER') NOT NULL UNIQUE,
        \`max_active_books\` INT NOT NULL DEFAULT 2,
        \`loan_period_days\` INT NOT NULL DEFAULT 14,
        \`fine_amount_per_day\` DECIMAL(8, 2) NOT NULL DEFAULT 2.00,
        \`grace_period_days\` INT NOT NULL DEFAULT 1,
        \`max_fine_amount\` DECIMAL(8, 2) NULL DEFAULT 500.00,
        \`updated_by\` INT NULL DEFAULT NULL,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.query(`
      INSERT INTO \`library_settings\` (\`borrower_type\`, \`max_active_books\`, \`loan_period_days\`, \`fine_amount_per_day\`, \`grace_period_days\`, \`max_fine_amount\`)
      VALUES
        ('STUDENT', 2, 14, 2.00, 1, 500.00),
        ('TEACHER', 5, 30, 2.00, 1, 1000.00)
      ON DUPLICATE KEY UPDATE
        \`max_active_books\` = VALUES(\`max_active_books\`),
        \`loan_period_days\` = VALUES(\`loan_period_days\`)
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`library_loans\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`book_id\` INT NOT NULL,
        \`accession_number\` VARCHAR(50) NOT NULL,
        \`borrower_type\` ENUM('STUDENT', 'TEACHER') NOT NULL,
        \`student_id\` INT NULL DEFAULT NULL,
        \`teacher_id\` INT NULL DEFAULT NULL,
        \`borrower_name\` VARCHAR(150) NOT NULL,
        \`borrower_identifier\` VARCHAR(100) NOT NULL,
        \`borrower_details\` VARCHAR(255) NULL DEFAULT NULL,
        \`issue_date\` DATETIME NOT NULL,
        \`due_date\` DATE NOT NULL,
        \`return_date\` DATETIME NULL DEFAULT NULL,
        \`status\` ENUM('ACTIVE', 'RETURNED', 'OVERDUE') NOT NULL DEFAULT 'ACTIVE',
        \`issued_by\` INT NOT NULL,
        \`returned_by\` INT NULL DEFAULT NULL,
        \`is_initial_entry\` BOOLEAN NOT NULL DEFAULT FALSE,
        \`remarks\` TEXT NULL DEFAULT NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX \`idx_ll_status\` (\`status\`),
        INDEX \`idx_ll_acc_num\` (\`accession_number\`),
        INDEX \`idx_ll_student\` (\`student_id\`),
        INDEX \`idx_ll_teacher\` (\`teacher_id\`),
        INDEX \`idx_ll_due_date\` (\`due_date\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`library_fines\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`loan_id\` INT NOT NULL UNIQUE,
        \`overdue_days\` INT NOT NULL DEFAULT 0,
        \`assessed_fine\` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        \`waived_amount\` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        \`paid_amount\` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        \`outstanding_balance\` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        \`waiver_reason\` VARCHAR(255) NULL DEFAULT NULL,
        \`waived_by\` INT NULL DEFAULT NULL,
        \`waived_at\` TIMESTAMP NULL DEFAULT NULL,
        \`status\` ENUM('PENDING', 'PARTIALLY_PAID', 'PAID', 'WAIVED') NOT NULL DEFAULT 'PENDING',
        \`calculation_details\` JSON NULL DEFAULT NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX \`idx_lf_status\` (\`status\`),
        INDEX \`idx_lf_balance\` (\`outstanding_balance\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`library_fine_payments\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`fine_id\` INT NOT NULL,
        \`payment_type\` ENUM('PAYMENT', 'WAIVER') NOT NULL,
        \`amount\` DECIMAL(10, 2) NOT NULL,
        \`payment_method\` VARCHAR(50) NOT NULL DEFAULT 'CASH',
        \`receipt_reference\` VARCHAR(100) NULL DEFAULT NULL,
        \`reason\` VARCHAR(255) NULL DEFAULT NULL,
        \`recorded_by\` INT NOT NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX \`idx_lfp_fine\` (\`fine_id\`),
        INDEX \`idx_lfp_type\` (\`payment_type\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await markMigrationApplied(connection, 'library_management_v1');
  }

  // 10. Library Module v2 additive barcode_id column & backfill
  if (!(await isMigrationApplied(connection, 'library_v2_barcodes'))) {
    if (await tableExists(connection, 'library_books')) {
      if (!(await columnExists(connection, 'library_books', 'barcode_id'))) {
        await connection.query(
          'ALTER TABLE `library_books` ADD COLUMN `barcode_id` VARCHAR(64) NULL AFTER `accession_number`'
        );
      }
      if (!(await indexExists(connection, 'library_books', 'uq_lib_books_barcode_id'))) {
        await connection.query(
          'ALTER TABLE `library_books` ADD UNIQUE INDEX `uq_lib_books_barcode_id` (`barcode_id`)'
        );
      }
      // Safely backfill deterministic barcode_id for existing numeric accession numbers
      await connection.query(`
        UPDATE \`library_books\`
        SET \`barcode_id\` = CONCAT('KAMCH-L-', LPAD(\`accession_number\`, 5, '0'))
        WHERE \`barcode_id\` IS NULL AND \`accession_number\` REGEXP '^[0-9]+$'
      `);
    }
    await markMigrationApplied(connection, 'library_v2_barcodes');
  }

  // 11. Teacher Accounts v1 additive teacher_id column & unique constraint on users
  if (!(await isMigrationApplied(connection, 'teacher_accounts_v1'))) {
    if (await tableExists(connection, 'users')) {
      if (!(await columnExists(connection, 'users', 'teacher_id'))) {
        await connection.query(
          'ALTER TABLE `users` ADD COLUMN `teacher_id` INT NULL DEFAULT NULL AFTER `department_id`'
        );
      }
      if (!(await indexExists(connection, 'users', 'uq_users_teacher_id'))) {
        await connection.query(
          'ALTER TABLE `users` ADD UNIQUE INDEX `uq_users_teacher_id` (`teacher_id`)'
        );
      }
      if (!(await constraintExists(connection, 'users', 'fk_users_teacher'))) {
        try {
          await connection.query(`
            ALTER TABLE \`users\`
            ADD CONSTRAINT \`fk_users_teacher\`
            FOREIGN KEY (\`teacher_id\`) REFERENCES \`teachers\` (\`id\`)
            ON DELETE SET NULL ON UPDATE CASCADE
          `);
        } catch {
          // Silently ignore if constraint already exists or referenced table is in standalone mode
        }
      }
    }
    await markMigrationApplied(connection, 'teacher_accounts_v1');
  }

  // 12. Leave Applications Module (v1)
  if (!(await isMigrationApplied(connection, 'leave_applications_v1'))) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`leave_applications\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`teacher_id\` INT NOT NULL,
        \`start_date\` DATE NOT NULL,
        \`end_date\` DATE NOT NULL,
        \`reason\` VARCHAR(500) NOT NULL,
        \`status\` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
        \`submitted_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`decided_by\` INT NULL DEFAULT NULL,
        \`decided_at\` TIMESTAMP NULL DEFAULT NULL,
        \`decision_remarks\` VARCHAR(255) NULL,
        INDEX \`idx_leave_teacher\` (\`teacher_id\`),
        INDEX \`idx_leave_status\` (\`status\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    if (!(await constraintExists(connection, 'leave_applications', 'fk_leave_teacher'))) {
      try {
        await connection.query(`
          ALTER TABLE \`leave_applications\`
          ADD CONSTRAINT \`fk_leave_teacher\`
          FOREIGN KEY (\`teacher_id\`) REFERENCES \`teachers\` (\`id\`)
          ON DELETE RESTRICT ON UPDATE CASCADE
        `);
      } catch {
        // Silently ignore if constraint already present
      }
    }

    if (!(await constraintExists(connection, 'leave_applications', 'fk_leave_decider'))) {
      try {
        await connection.query(`
          ALTER TABLE \`leave_applications\`
          ADD CONSTRAINT \`fk_leave_decider\`
          FOREIGN KEY (\`decided_by\`) REFERENCES \`users\` (\`id\`)
          ON DELETE SET NULL ON UPDATE CASCADE
        `);
      } catch {
        // Silently ignore if constraint already present
      }
    }

    await markMigrationApplied(connection, 'leave_applications_v1');
  }

  // 13. Persistent In-App Notifications Module (v1)
  if (!(await isMigrationApplied(connection, 'notifications_v1'))) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`notifications\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`user_id\` INT NOT NULL,
        \`title\` VARCHAR(255) NOT NULL,
        \`message\` TEXT NOT NULL,
        \`type\` VARCHAR(50) NOT NULL,
        \`related_id\` INT NULL DEFAULT NULL,
        \`is_read\` BOOLEAN NOT NULL DEFAULT FALSE,
        \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX \`idx_notif_user\` (\`user_id\`),
        INDEX \`idx_notif_unread\` (\`user_id\`, \`is_read\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    if (!(await constraintExists(connection, 'notifications', 'fk_notif_user'))) {
      try {
        await connection.query(`
          ALTER TABLE \`notifications\`
          ADD CONSTRAINT \`fk_notif_user\`
          FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`)
          ON DELETE CASCADE ON UPDATE CASCADE
        `);
      } catch {
        // Silently ignore if constraint already present
      }
    }

    await markMigrationApplied(connection, 'notifications_v1');
  }

  // 14. Monthly Teacher Attendance Reports Module (v1)
  if (!(await isMigrationApplied(connection, 'monthly_attendance_v1'))) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`monthly_attendance\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`teacher_id\` INT NOT NULL,
        \`year\` INT NOT NULL,
        \`month\` INT NOT NULL,
        \`total_working_days\` INT NOT NULL DEFAULT 26,
        \`days_present\` INT NOT NULL,
        \`attendance_percentage\` DECIMAL(5,2) NOT NULL,
        \`status\` ENUM('PENDING', 'FINALIZED') NOT NULL DEFAULT 'PENDING',
        \`finalized_by\` INT NULL DEFAULT NULL,
        \`finalized_at\` TIMESTAMP NULL DEFAULT NULL,
        \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY \`uq_teacher_month_year\` (\`teacher_id\`, \`year\`, \`month\`),
        INDEX \`idx_ma_teacher\` (\`teacher_id\`),
        INDEX \`idx_ma_status\` (\`status\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    if (!(await constraintExists(connection, 'monthly_attendance', 'fk_ma_teacher'))) {
      try {
        await connection.query(`
          ALTER TABLE \`monthly_attendance\`
          ADD CONSTRAINT \`fk_ma_teacher\`
          FOREIGN KEY (\`teacher_id\`) REFERENCES \`teachers\` (\`id\`)
          ON DELETE RESTRICT ON UPDATE CASCADE
        `);
      } catch {
        // Silently ignore if constraint already present
      }
    }

    if (!(await constraintExists(connection, 'monthly_attendance', 'fk_ma_finalizer'))) {
      try {
        await connection.query(`
          ALTER TABLE \`monthly_attendance\`
          ADD CONSTRAINT \`fk_ma_finalizer\`
          FOREIGN KEY (\`finalized_by\`) REFERENCES \`users\` (\`id\`)
          ON DELETE SET NULL ON UPDATE CASCADE
        `);
      } catch {
        // Silently ignore if constraint already present
      }
    }

    await markMigrationApplied(connection, 'monthly_attendance_v1');
  }

  // 15. Institutional Holidays Module (v1)
  if (!(await isMigrationApplied(connection, 'institutional_holidays_v1'))) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`institutional_holidays\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`holiday_date\` DATE NOT NULL UNIQUE,
        \`holiday_name\` VARCHAR(150) NOT NULL,
        \`description\` VARCHAR(255) NULL,
        \`created_by\` INT NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX \`idx_holidays_date\` (\`holiday_date\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    if (!(await constraintExists(connection, 'institutional_holidays', 'fk_holidays_creator'))) {
      try {
        await connection.query(`
          ALTER TABLE \`institutional_holidays\`
          ADD CONSTRAINT \`fk_holidays_creator\`
          FOREIGN KEY (\`created_by\`) REFERENCES \`users\` (\`id\`)
          ON DELETE SET NULL ON UPDATE CASCADE
        `);
      } catch {
        // Silently ignore
      }
    }

    await markMigrationApplied(connection, 'institutional_holidays_v1');
  }

  // 16. Leave Application Settings (v1)
  if (!(await isMigrationApplied(connection, 'leave_settings_v1'))) {
    if (await tableExists(connection, 'institutional_settings')) {
      await connection.query(`
        INSERT IGNORE INTO \`institutional_settings\` (\`setting_key\`, \`setting_value\`, \`effective_date\`, \`updated_reason\`)
        VALUES ('LEAVE_MAX_ADVANCE_DAYS', '20', '2026-10-28', 'Default maximum advance leave application window in calendar days.')
      `);
    }
    await markMigrationApplied(connection, 'leave_settings_v1');
  }
}


export interface MigrationRunResult {
  success: boolean;
  message: string;
  appliedVersions?: string[];
  newlyAppliedVersions?: string[];
}

/**
 * Standalone CLI migration runner invoked by `npm run db:migrate`.
 * Ensures `.env` is loaded before opening the MySQL connection, verifies live MySQL
 * reachability, checks prerequisite core tables (`roles`, `users`, `students`), and
 * runs safe, non-destructive additive migrations.
 */
export async function executeDatabaseMigrations(options?: {
  closePoolOnExit?: boolean;
}): Promise<MigrationRunResult> {
  console.log('[KAMCH ERP Migration] Starting safe additive database migration...');
  console.log(
    `[KAMCH ERP Migration] Environment file: ${envDiagnostics.envPath} (exists: ${envDiagnostics.envExists})`
  );

  // 1. Verify live MySQL reachability (never silently run CLI migrations against in-memory fallback)
  const health = await checkDatabaseConnection();
  if (!health.connected) {
    const errorMsg =
      `Database is not reachable (${health.code || 'UNKNOWN'}` +
      `${health.diagnosticNote ? ` — ${health.diagnosticNote}` : ''}). ` +
      `Ensure XAMPP MySQL service is running and DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, and DB_NAME in .env are correct.`;
    console.error(`[KAMCH ERP Migration] Migration Aborted: ${errorMsg}`);
    return { success: false, message: errorMsg };
  }

  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    // 2. Verify prerequisite core tables exist on the target database
    const requiredCoreTables = ['roles', 'users', 'students'];
    const missingCoreTables: string[] = [];
    for (const tbl of requiredCoreTables) {
      if (!(await tableExists(connection, tbl))) {
        missingCoreTables.push(tbl);
      }
    }

    if (missingCoreTables.length > 0) {
      const missingMsg =
        `Prerequisite core table(s) missing in target database (${missingCoreTables.join(', ')}). ` +
        `If this is an uninitialized database, run "npm run db:init" first to create core tables and apply migrations.`;
      console.error(`[KAMCH ERP Migration] Migration Aborted: ${missingMsg}`);
      return { success: false, message: missingMsg };
    }

    // 3. Record already-applied migration versions before running
    const previouslyApplied = new Set<string>();
    if (await tableExists(connection, 'schema_migrations')) {
      const [prevRows] = await connection.query<any[]>('SELECT version FROM schema_migrations');
      for (const row of prevRows || []) {
        if (row?.version) {
          previouslyApplied.add(String(row.version));
        }
      }
    }

    // 4. Execute safe, idempotent additive migrations
    await runAdditiveMigrations(connection);

    // 5. Report applied migration versions clearly
    const [finalRows] = await connection.query<any[]>(
      'SELECT version, applied_at FROM schema_migrations ORDER BY applied_at ASC, version ASC'
    );
    const appliedVersions = (finalRows || []).map((r: any) => String(r.version));
    const newlyAppliedVersions = appliedVersions.filter((v) => !previouslyApplied.has(v));

    if (newlyAppliedVersions.length > 0) {
      console.log(
        `[KAMCH ERP Migration] Newly applied migration version(s): ${newlyAppliedVersions.join(', ')}`
      );
    } else {
      console.log('[KAMCH ERP Migration] All tracked additive migrations are already up to date.');
    }
    console.log(
      `[KAMCH ERP Migration] Recorded schema_migrations versions: [${appliedVersions.join(', ')}]`
    );
    console.log('[KAMCH ERP Migration] Safe additive database migration completed successfully.');

    return {
      success: true,
      message: 'Safe additive database migration completed successfully.',
      appliedVersions,
      newlyAppliedVersions,
    };
  } catch (err) {
    const error = err as {
      code?: string;
      errno?: number;
      sqlState?: string;
      sqlMessage?: string;
      message?: string;
    };
    const detail = error.sqlMessage || error.message || 'Unknown SQL migration error';
    const codeInfo = error.code
      ? ` [${error.code}${error.errno !== undefined ? ` / errno ${error.errno}` : ''}]`
      : '';
    const fullMsg = `Migration SQL failed${codeInfo}: ${detail}`;
    console.error(`[KAMCH ERP Migration] ${fullMsg}`);
    return { success: false, message: fullMsg };
  } finally {
    connection.release();
    if (options?.closePoolOnExit && typeof (pool as unknown as { end?: () => Promise<void> }).end === 'function') {
      await pool.end().catch(() => {});
    }
  }
}

// Allow direct CLI execution via `npm run db:migrate` (`tsx server/db/migrate.ts`) across Windows and Linux
const __filename = fileURLToPath(import.meta.url);
const isDirectCliRun =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]).toLowerCase() === path.resolve(__filename).toLowerCase();

if (isDirectCliRun) {
  executeDatabaseMigrations({ closePoolOnExit: true })
    .then((result) => {
      if (!result.success) {
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('[KAMCH ERP Migration] Fatal migration error:', err);
      process.exit(1);
    });
}
