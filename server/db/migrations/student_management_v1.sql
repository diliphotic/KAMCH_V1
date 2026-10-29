-- ============================================================================
-- KAMCH ERP — Student Management Module Migration V1 (Additive & Non-Destructive)
-- Krishna Ayurvedic Medical College & Hospital
-- Preserves existing `students` primary key (`id`) and all Fees Management records.
--
-- Execution Note:
-- Run `npm run db:migrate` (invokes `tsx server/db/migrate.ts`), which loads `.env`
-- and executes both these `CREATE TABLE IF NOT EXISTS` statements and the
-- `INFORMATION_SCHEMA`-guarded `ALTER TABLE students ADD COLUMN` / index / FK
-- additions idempotently across MariaDB (XAMPP) and MySQL 8.0+, recording
-- version `student_management_v1` in `schema_migrations`.
-- ============================================================================

-- 1. Curriculum Schemes Configuration
CREATE TABLE IF NOT EXISTS `curriculum_schemes` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `code` VARCHAR(30) NOT NULL UNIQUE,
  `name` VARCHAR(150) NOT NULL,
  `course_name` VARCHAR(100) NOT NULL DEFAULT 'BAMS',
  `is_legacy_minimal` BOOLEAN NOT NULL DEFAULT FALSE,
  `professional_years_count` INT NOT NULL DEFAULT 3,
  `regular_pass_max_failed_for_provisional` INT NOT NULL DEFAULT 2,
  `allow_provisional_promotion` BOOLEAN NOT NULL DEFAULT TRUE,
  `passing_criteria_verified` BOOLEAN NOT NULL DEFAULT TRUE,
  `passing_rule_config` JSON NULL,
  `supplementary_cycle_months` INT NOT NULL DEFAULT 6,
  `default_internship_days` INT NOT NULL DEFAULT 365,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `notes` VARCHAR(500) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed initial college curriculum schemes idempotently
INSERT INTO `curriculum_schemes` (
  `code`, `name`, `course_name`, `is_legacy_minimal`, `professional_years_count`,
  `regular_pass_max_failed_for_provisional`, `allow_provisional_promotion`,
  `passing_criteria_verified`, `supplementary_cycle_months`, `default_internship_days`, `is_active`, `notes`
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
  `updated_at` = CURRENT_TIMESTAMP;

-- 2. Configurable Academic Batches / Cohorts
CREATE TABLE IF NOT EXISTS `academic_batches` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `code` VARCHAR(50) NOT NULL UNIQUE,
  `name` VARCHAR(120) NOT NULL,
  `admission_academic_year` VARCHAR(20) NOT NULL,
  `admission_year_start` INT NULL,
  `course_name` VARCHAR(100) NOT NULL DEFAULT 'BAMS',
  `scheme_id` INT NOT NULL,
  `current_cohort_stage` VARCHAR(80) NOT NULL,
  `current_professional_year` INT NULL,
  `junior_batch_id` INT NULL,
  `admission_status` ENUM('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CLOSED_LEGACY') NOT NULL DEFAULT 'IN_PROGRESS',
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `display_order` INT NOT NULL DEFAULT 0,
  `notes` VARCHAR(500) NULL,
  `created_by` INT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_batches_scheme` FOREIGN KEY (`scheme_id`) REFERENCES `curriculum_schemes` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_batches_junior` FOREIGN KEY (`junior_batch_id`) REFERENCES `academic_batches` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_batches_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX `idx_batches_scheme` (`scheme_id`),
  INDEX `idx_batches_active_order` (`is_active`, `display_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Server-Side Temporary Roll Number Sequence Table
CREATE TABLE IF NOT EXISTS `student_roll_sequences` (
  `admission_year` INT NOT NULL PRIMARY KEY,
  `last_seq` INT NOT NULL DEFAULT 0,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Append-Only Identifier Change & Verification History
CREATE TABLE IF NOT EXISTS `student_identifier_history` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `student_id` INT NOT NULL,
  `identifier_type` ENUM('TEMPORARY_ROLL_GENERATED', 'PERMANENT_UNIVERSITY_ENTERED', 'PERMANENT_UNIVERSITY_VERIFIED', 'IDENTIFIER_CORRECTION') NOT NULL,
  `previous_identifier` VARCHAR(50) NULL,
  `new_identifier` VARCHAR(50) NOT NULL,
  `verification_status` ENUM('PENDING_VERIFICATION', 'VERIFIED', 'HISTORICAL') NOT NULL,
  `reason` VARCHAR(255) NOT NULL,
  `actor_id` INT NULL,
  `verified_by` INT NULL,
  `verified_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_sih_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_sih_actor` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_sih_verifier` FOREIGN KEY (`verified_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX `idx_sih_student` (`student_id`),
  INDEX `idx_sih_prev_id` (`previous_identifier`),
  INDEX `idx_sih_new_id` (`new_identifier`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Student Documents Metadata Table (No File Uploads)
CREATE TABLE IF NOT EXISTS `student_documents` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `student_id` INT NOT NULL,
  `document_type` VARCHAR(80) NOT NULL,
  `document_label` VARCHAR(150) NULL,
  `reference_number` VARCHAR(100) NULL,
  `issue_date` DATE NULL,
  `received_status` ENUM('PENDING', 'RECEIVED', 'NOT_APPLICABLE', 'RETURNED_ORIGINAL') NOT NULL DEFAULT 'PENDING',
  `verification_status` ENUM('UNVERIFIED', 'VERIFIED', 'DISCREPANCY') NOT NULL DEFAULT 'UNVERIFIED',
  `verified_by` INT NULL,
  `verified_at` TIMESTAMP NULL,
  `remarks` VARCHAR(500) NULL,
  `updated_by` INT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_sdoc_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_sdoc_verifier` FOREIGN KEY (`verified_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_sdoc_updater` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX `idx_sdoc_student` (`student_id`),
  INDEX `idx_sdoc_type` (`document_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Append-Only Academic Progression Events Table (Marks Integration Boundary)
CREATE TABLE IF NOT EXISTS `student_progression_events` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `student_id` INT NOT NULL,
  `scheme_id` INT NULL,
  `event_type` ENUM('INITIAL_ENROLLMENT', 'PROPOSED_RESULT_OUTCOME', 'CONFIRMED_PROGRESSION', 'DOCUMENTED_OFFICE_CORRECTION', 'MANUAL_PLACEMENT_CHANGE', 'LEGACY_RS6_RECORD') NOT NULL,
  `exam_session_ref` VARCHAR(100) NULL,
  `exam_attempt_type` ENUM('REGULAR', 'SUPPLEMENTARY', 'NOT_APPLICABLE') NOT NULL DEFAULT 'REGULAR',
  `evaluated_professional_year` INT NULL,
  `previous_professional_year` INT NULL,
  `proposed_professional_year` INT NULL,
  `previous_placement_batch_id` INT NULL,
  `proposed_placement_batch_id` INT NULL,
  `previous_detention_stage` INT NOT NULL DEFAULT 0,
  `proposed_detention_stage` INT NOT NULL DEFAULT 0,
  `subjects_evaluated_count` INT NOT NULL DEFAULT 0,
  `subjects_passed` JSON NULL,
  `subjects_outstanding` JSON NULL,
  `placement_rule_applied` VARCHAR(120) NOT NULL,
  `proposed_status` VARCHAR(60) NOT NULL,
  `workflow_state` ENUM('PROPOSED', 'PENDING_OFFICE_REVIEW', 'CONFIRMED', 'SUPERSEDED') NOT NULL DEFAULT 'PROPOSED',
  `review_issue_explanation` TEXT NULL,
  `classroom_mapping` JSON NULL,
  `supplementary_cycle_note` VARCHAR(255) NULL,
  `max_duration_years_snapshot` INT NOT NULL DEFAULT 9,
  `exceeds_max_duration_flag` BOOLEAN NOT NULL DEFAULT FALSE,
  `entered_by` INT NULL,
  `confirmed_by` INT NULL,
  `confirmed_at` TIMESTAMP NULL,
  `effective_date` DATE NULL,
  `reason_or_remarks` TEXT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_spe_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_spe_scheme` FOREIGN KEY (`scheme_id`) REFERENCES `curriculum_schemes` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_spe_prev_batch` FOREIGN KEY (`previous_placement_batch_id`) REFERENCES `academic_batches` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_spe_prop_batch` FOREIGN KEY (`proposed_placement_batch_id`) REFERENCES `academic_batches` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_spe_entered_by` FOREIGN KEY (`entered_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_spe_confirmed_by` FOREIGN KEY (`confirmed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX `idx_spe_student` (`student_id`),
  INDEX `idx_spe_workflow` (`workflow_state`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Institutional Academic Settings & Principal-Authorized Setting History
CREATE TABLE IF NOT EXISTS `institutional_settings` (
  `setting_key` VARCHAR(80) NOT NULL PRIMARY KEY,
  `setting_value` VARCHAR(100) NOT NULL,
  `effective_date` DATE NOT NULL,
  `updated_by` INT NULL,
  `updated_reason` VARCHAR(500) NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_iset_updater` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `institutional_setting_history` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `setting_key` VARCHAR(80) NOT NULL,
  `previous_value` VARCHAR(100) NOT NULL,
  `new_value` VARCHAR(100) NOT NULL,
  `effective_date` DATE NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `authorized_by` INT NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_ish_authorizer` FOREIGN KEY (`authorized_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  INDEX `idx_ish_key` (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `institutional_settings` (`setting_key`, `setting_value`, `effective_date`, `updated_reason`)
VALUES ('MAX_COURSE_DURATION_YEARS', '9', '2021-09-01', 'Initial college-configured maximum course duration setting (9 years from admission).');

-- 8. Student Internships & Principal-Authorized Internship Extensions (Attendance Boundary)
CREATE TABLE IF NOT EXISTS `student_internships` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `student_id` INT NOT NULL UNIQUE,
  `start_date` DATE NULL,
  `base_required_days` INT NOT NULL DEFAULT 365,
  `approved_extension_days` INT NOT NULL DEFAULT 0,
  `adjusted_required_days` INT NOT NULL DEFAULT 365,
  `credited_days_completed` INT NOT NULL DEFAULT 0,
  `attendance_source` ENUM('PENDING_ATTENDANCE_MODULE', 'VERIFIED_BIOMETRIC_SYNC', 'VERIFIED_ATTENDANCE_LEDGER') NOT NULL DEFAULT 'PENDING_ATTENDANCE_MODULE',
  `attendance_reconciliation_status` ENUM('UNAVAILABLE_PENDING_INTEGRATION', 'RECONCILED', 'DISCREPANCY_REVIEW') NOT NULL DEFAULT 'UNAVAILABLE_PENDING_INTEGRATION',
  `last_attendance_sync_ref` VARCHAR(100) NULL,
  `expected_completion_date` DATE NULL,
  `internship_status` ENUM('NOT_STARTED', 'ELIGIBLE', 'IN_PROGRESS', 'EXTENDED', 'COMPLETED', 'ON_HOLD') NOT NULL DEFAULT 'ELIGIBLE',
  `completion_verified_by` INT NULL,
  `completion_verified_at` TIMESTAMP NULL,
  `actual_completion_date` DATE NULL,
  `completion_remarks` VARCHAR(500) NULL,
  `created_by` INT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_sint_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_sint_verifier` FOREIGN KEY (`completion_verified_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_sint_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `student_internship_extensions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `internship_id` INT NOT NULL,
  `student_id` INT NOT NULL,
  `additional_days` INT NOT NULL,
  `previous_required_total` INT NOT NULL,
  `new_required_total` INT NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `authorized_by` INT NOT NULL,
  `authorized_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_siext_internship` FOREIGN KEY (`internship_id`) REFERENCES `student_internships` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_siext_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_siext_authorizer` FOREIGN KEY (`authorized_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  INDEX `idx_siext_student` (`student_id`),
  INDEX `idx_siext_internship` (`internship_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
