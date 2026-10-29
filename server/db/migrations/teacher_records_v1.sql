-- ============================================================================
-- KAMCH ERP — Teacher Records Additive Migration V1 (`teacher_records_v1`)
-- Safe, non-destructive schema extension for existing institutional faculty data
--
-- IMPORTANT:
-- 1. Recommended execution is via `npm run db:migrate`, which checks column and
--    index existence dynamically through INFORMATION_SCHEMA for both MySQL 8.0+
--    and MariaDB (XAMPP) before applying each statement.
-- 2. Preserves all existing `teachers`, `departments`, `students`, `fee_*`,
--    `users`, `sessions`, and `audit_logs` records without resetting or deleting data.
-- 3. Keeps `teacher_code` (NCISM) and `registration_number` (State/Central Council)
--    strictly separate, and relaxes `employee_code` to NULLABLE so HR payroll codes
--    are never fabricated when absent in source documents.
-- 4. Does NOT create or link any `users` login accounts.
-- ============================================================================

-- 1. Relax `employee_code` to NULLABLE while preserving its existing UNIQUE index
--    (InnoDB allows multiple NULL values while enforcing uniqueness on non-null HR codes)
ALTER TABLE `teachers`
  MODIFY COLUMN `employee_code` VARCHAR(50) NULL DEFAULT NULL,
  MODIFY COLUMN `qualification` VARCHAR(255) NULL DEFAULT NULL;

-- 2. Add separate NCISM teacher code, professional registration number, service dates,
--    verbatim source experience, previous institute, profile photo URL, and verification flags
ALTER TABLE `teachers`
  ADD COLUMN `teacher_code` VARCHAR(50) NULL DEFAULT NULL AFTER `employee_code`,
  ADD COLUMN `teacher_code_status` ENUM('VERIFIED', 'APPLIED', 'NOT_PROVIDED', 'REQUIRES_VERIFICATION') NOT NULL DEFAULT 'NOT_PROVIDED' AFTER `teacher_code`,
  ADD COLUMN `registration_number` VARCHAR(80) NULL DEFAULT NULL AFTER `teacher_code_status`,
  ADD COLUMN `date_of_birth` DATE NULL DEFAULT NULL AFTER `qualification`,
  ADD COLUMN `joining_date_service` DATE NULL DEFAULT NULL AFTER `date_of_birth`,
  ADD COLUMN `joining_date_institute` DATE NULL DEFAULT NULL AFTER `joining_date_service`,
  ADD COLUMN `reported_experience` VARCHAR(80) NULL DEFAULT NULL AFTER `joining_date_institute`,
  ADD COLUMN `previous_institute` VARCHAR(255) NULL DEFAULT NULL AFTER `reported_experience`,
  ADD COLUMN `profile_photo_url` VARCHAR(500) NULL DEFAULT NULL AFTER `contact_email`,
  ADD COLUMN `data_verification_required` BOOLEAN NOT NULL DEFAULT FALSE AFTER `status`,
  ADD COLUMN `verification_notes` TEXT NULL AFTER `data_verification_required`,
  ADD COLUMN `raw_source_snapshot` JSON NULL AFTER `verification_notes`;

-- 3. Add non-destructive lookup & uniqueness indexes
ALTER TABLE `teachers`
  ADD UNIQUE INDEX `uq_teachers_teacher_code` (`teacher_code`),
  ADD INDEX `idx_teachers_reg_no` (`registration_number`),
  ADD INDEX `idx_teachers_verification` (`data_verification_required`);

-- 4. Record applied migration version
INSERT IGNORE INTO `schema_migrations` (`version`) VALUES ('teacher_records_v1');
