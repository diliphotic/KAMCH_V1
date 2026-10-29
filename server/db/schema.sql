-- ============================================================================
-- KAMCH ERP — Krishna Ayurvedic Medical College & Hospital
-- Module 1: Authentication & User Management — Core Database Schema
-- Character Set: utf8mb4, Engine: InnoDB
-- ============================================================================

-- 1. Roles Table
CREATE TABLE IF NOT EXISTS `roles` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `code` VARCHAR(50) NOT NULL UNIQUE,
  `name` VARCHAR(100) NOT NULL,
  `description` VARCHAR(255) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Departments Table
CREATE TABLE IF NOT EXISTS `departments` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `code` VARCHAR(50) NOT NULL UNIQUE,
  `name` VARCHAR(150) NOT NULL,
  `description` VARCHAR(255) NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_departments_code` (`code`),
  INDEX `idx_departments_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Teachers Table (Institutional Faculty Records)
CREATE TABLE IF NOT EXISTS `teachers` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `employee_code` VARCHAR(50) NOT NULL UNIQUE,
  `full_name` VARCHAR(150) NOT NULL,
  `designation` VARCHAR(100) NOT NULL,
  `department_id` INT NOT NULL,
  `qualification` VARCHAR(150) NULL,
  `contact_phone` VARCHAR(25) NULL,
  `contact_email` VARCHAR(100) NULL,
  `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_by` INT NULL DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_teachers_department` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  INDEX `idx_teachers_department` (`department_id`),
  INDEX `idx_teachers_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Users Table
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `username` VARCHAR(50) NOT NULL UNIQUE,
  `email` VARCHAR(100) NOT NULL UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `role_id` INT NOT NULL,
  `full_name` VARCHAR(150) NOT NULL,
  `must_change_password` BOOLEAN NOT NULL DEFAULT TRUE,
  `failed_attempts` INT NOT NULL DEFAULT 0,
  `is_locked` BOOLEAN NOT NULL DEFAULT FALSE,
  `locked_at` TIMESTAMP NULL DEFAULT NULL,
  `is_suspended` BOOLEAN NOT NULL DEFAULT FALSE,
  `suspended_at` TIMESTAMP NULL DEFAULT NULL,
  `created_by` INT NULL DEFAULT NULL,
  `teacher_id` INT NULL DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_users_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_users_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  INDEX `idx_users_role` (`role_id`),
  INDEX `idx_users_teacher` (`teacher_id`),
  INDEX `idx_users_status` (`is_locked`, `is_suspended`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Sessions Table (Stateful Session Management for LAN & Inactivity Tracking)
CREATE TABLE IF NOT EXISTS `sessions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `token_hash` VARCHAR(64) NOT NULL UNIQUE,
  `ip_address` VARCHAR(45) NULL,
  `user_agent` VARCHAR(255) NULL,
  `last_activity_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` TIMESTAMP NULL DEFAULT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  INDEX `idx_sessions_user_active` (`user_id`, `is_active`),
  INDEX `idx_sessions_last_activity` (`last_activity_at`),
  INDEX `idx_sessions_token_hash` (`token_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Account Creation Requests Table (Delegated Accounts Pending Super Admin Approval)
CREATE TABLE IF NOT EXISTS `account_requests` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `requested_by` INT NOT NULL,
  `username` VARCHAR(50) NOT NULL,
  `email` VARCHAR(100) NOT NULL,
  `full_name` VARCHAR(150) NOT NULL,
  `role_id` INT NOT NULL,
  `department` VARCHAR(100) NULL,
  `teacher_id` INT NULL DEFAULT NULL,
  `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  `reviewed_by` INT NULL DEFAULT NULL,
  `reviewed_at` TIMESTAMP NULL DEFAULT NULL,
  `rejection_reason` VARCHAR(255) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_accreq_requester` FOREIGN KEY (`requested_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_accreq_reviewer` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_accreq_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_accreq_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX `idx_requests_status` (`status`),
  INDEX `idx_requests_requested_by` (`requested_by`),
  INDEX `idx_requests_teacher` (`teacher_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Audit Logs Table (Immutable Security & Account Actions, 1-Year Retention)
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `actor_id` INT NULL,
  `action` VARCHAR(100) NOT NULL,
  `target_type` VARCHAR(50) NULL,
  `target_id` VARCHAR(50) NULL,
  `ip_address` VARCHAR(45) NULL,
  `details` JSON NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_audit_actor` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX `idx_audit_actor` (`actor_id`),
  INDEX `idx_audit_action` (`action`),
  INDEX `idx_audit_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed Standard Institutional Roles (Idempotent)
INSERT INTO `roles` (`code`, `name`, `description`) VALUES
  ('SUPER_ADMIN', 'Super Administrator', 'Institutional super administrative control and security management'),
  ('PRINCIPAL', 'Principal', 'Executive institutional governance, faculty supervision, and audit review'),
  ('SECRETARY', 'Secretary', 'Trust and institutional administrative utilities and records'),
  ('HOD', 'Head of Department', 'Academic and clinical department leadership and postings'),
  ('FACULTY', 'Faculty Member', 'Teaching, clinical instruction, and marks entry'),
  ('STAFF', 'Administrative Staff', 'Office administration and departmental operations'),
  ('OFFICE', 'Office & Accounts Staff', 'Student fee management, payment collection, and receipt request submission'),
  ('STUDENT', 'Student', 'Student academic portal and examination record view')
ON DUPLICATE KEY UPDATE 
  `name` = VALUES(`name`), 
  `description` = VALUES(`description`);

-- ============================================================================
-- MOD-OFFICE-FEES: Fees Management Schema
-- ============================================================================

-- 6. Minimal Student Reference Table (Strictly for associating fee assessments and payments)
CREATE TABLE IF NOT EXISTS `students` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `student_id_number` VARCHAR(50) NOT NULL UNIQUE,
  `full_name` VARCHAR(150) NOT NULL,
  `admission_category` ENUM('GOVERNMENT', 'MANAGEMENT_PRIVATE', 'NRI') NOT NULL,
  `admission_year` INT NOT NULL,
  `current_year_of_study` INT NOT NULL DEFAULT 1,
  `is_kea_eligible` BOOLEAN NOT NULL DEFAULT FALSE,
  `kea_acknowledgement_no` VARCHAR(50) NULL,
  `contact_phone` VARCHAR(25) NULL,
  `contact_email` VARCHAR(100) NULL,
  `status` ENUM('ACTIVE', 'PASSED_OUT', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_students_category` (`admission_category`),
  INDEX `idx_students_year` (`current_year_of_study`),
  INDEX `idx_students_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Annual Fee Structures Table (Configurable per Category and Academic Year)
CREATE TABLE IF NOT EXISTS `fee_structures` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `academic_year` VARCHAR(20) NOT NULL,
  `admission_category` ENUM('GOVERNMENT', 'MANAGEMENT_PRIVATE', 'NRI') NOT NULL,
  `year_of_study` INT NOT NULL DEFAULT 1,
  `college_fee` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `development_fee` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `mess_fee` DECIMAL(12, 2) NOT NULL DEFAULT 30000.00,
  `hostel_fee` DECIMAL(12, 2) NOT NULL DEFAULT 30000.00,
  `total_annual_fee` DECIMAL(12, 2) NOT NULL,
  `description` VARCHAR(255) NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_fee_structure` (`academic_year`, `admission_category`, `year_of_study`),
  INDEX `idx_fee_structure_academic_year` (`academic_year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed Approved Annual Fee Structures for Academic Year 2026-2027 (Section 4 Initial Values)
INSERT INTO `fee_structures` (`academic_year`, `admission_category`, `year_of_study`, `college_fee`, `development_fee`, `mess_fee`, `hostel_fee`, `total_annual_fee`, `description`, `is_active`) VALUES
  ('2026-2027', 'GOVERNMENT', 1, 75750.00, 50000.00, 30000.00, 30000.00, 125750.00, 'Government Seat Base: College ₹75,750 + Dev ₹50,000 (Optional: Mess ₹30,000, Hostel ₹30,000)', TRUE),
  ('2026-2027', 'MANAGEMENT_PRIVATE', 1, 400000.00, 0.00, 30000.00, 30000.00, 400000.00, 'Private Seat Base: Combined College & Dev ₹4,00,000 (Optional: Mess ₹30,000, Hostel ₹30,000)', TRUE),
  ('2026-2027', 'NRI', 1, 600000.00, 0.00, 30000.00, 30000.00, 600000.00, 'NRI Seat Base: Combined College & Dev ₹6,00,000 (Optional: Mess ₹30,000, Hostel ₹30,000)', TRUE)
ON DUPLICATE KEY UPDATE
  `college_fee` = VALUES(`college_fee`),
  `development_fee` = VALUES(`development_fee`),
  `mess_fee` = VALUES(`mess_fee`),
  `hostel_fee` = VALUES(`hostel_fee`),
  `total_annual_fee` = VALUES(`total_annual_fee`),
  `description` = VALUES(`description`),
  `is_active` = VALUES(`is_active`);

-- 8. Service Enrollments Table (Independent Mess & Hostel Lifecycle Tracking)
CREATE TABLE IF NOT EXISTS `service_enrollments` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `student_id` INT NOT NULL,
  `service_type` ENUM('MESS', 'HOSTEL') NOT NULL,
  `start_date` DATE NOT NULL,
  `end_date` DATE NULL,
  `annual_fee` DECIMAL(12, 2) NOT NULL DEFAULT 30000.00,
  `status` ENUM('ACTIVE', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
  `created_by` INT NOT NULL,
  `notes` VARCHAR(255) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_se_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_se_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  INDEX `idx_se_student` (`student_id`),
  INDEX `idx_se_status` (`service_type`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. Student Fee Assessments Table (Historical, Immutable Assessment Records)
CREATE TABLE IF NOT EXISTS `student_fee_assessments` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `student_id` INT NOT NULL,
  `academic_year` VARCHAR(20) NOT NULL,
  `year_of_study` INT NOT NULL DEFAULT 1,
  `admission_category` ENUM('GOVERNMENT', 'MANAGEMENT_PRIVATE', 'NRI') NOT NULL,
  `is_kea_exception_applied` BOOLEAN NOT NULL DEFAULT FALSE,
  `kea_exception_reason` VARCHAR(255) NULL,
  `assessed_college_fee` DECIMAL(12, 2) NOT NULL,
  `assessed_development_fee` DECIMAL(12, 2) NOT NULL,
  `assessed_mess_fee` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `assessed_hostel_fee` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `total_assessed_fee` DECIMAL(12, 2) NOT NULL,
  `concession_total` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `revised_payable` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `notes` VARCHAR(255) NULL,
  `assessed_by` INT NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_sfa_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_sfa_assessor` FOREIGN KEY (`assessed_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  UNIQUE KEY `uq_student_academic_year` (`student_id`, `academic_year`),
  INDEX `idx_sfa_student` (`student_id`),
  INDEX `idx_sfa_academic_year` (`academic_year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. Fee Concessions Table (Fixed/Percentage Reductions, Non-Negative Cap, Super Admin/Principal only)
CREATE TABLE IF NOT EXISTS `fee_concessions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `student_id` INT NOT NULL,
  `assessment_id` INT NOT NULL,
  `fee_component` VARCHAR(50) NOT NULL DEFAULT 'ALL',
  `concession_type` ENUM('FIXED', 'PERCENTAGE') NOT NULL,
  `value` DECIMAL(12, 2) NOT NULL,
  `calculated_reduction` DECIMAL(12, 2) NOT NULL,
  `reason` VARCHAR(255) NOT NULL,
  `authorized_by` INT NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_fc_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_fc_assessment` FOREIGN KEY (`assessment_id`) REFERENCES `student_fee_assessments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_fc_authorizer` FOREIGN KEY (`authorized_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  INDEX `idx_fc_student` (`student_id`),
  INDEX `idx_fc_assessment` (`assessment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. Fee Payments Table (Destination, UTR, Passbook Verification, Exact Decimal)
CREATE TABLE IF NOT EXISTS `fee_payments` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `assessment_id` INT NOT NULL,
  `student_id` INT NOT NULL,
  `payment_reference` VARCHAR(64) NOT NULL UNIQUE,
  `amount` DECIMAL(12, 2) NOT NULL,
  `destination` ENUM('COLLEGE_ACCOUNT', 'SECRETARY_DEV_ACCOUNT') NOT NULL DEFAULT 'COLLEGE_ACCOUNT',
  `payment_method` ENUM('CASH', 'BANK_TRANSFER', 'ONLINE_DEV') NOT NULL DEFAULT 'CASH',
  `bank_transaction_ref` VARCHAR(100) NULL,
  `student_tx_ref` VARCHAR(100) NULL,
  `passbook_tx_ref` VARCHAR(100) NULL,
  `bank_name` VARCHAR(100) NULL,
  `payment_date` DATE NOT NULL,
  `recorded_by` INT NOT NULL,
  `notes` VARCHAR(255) NULL,
  `status` ENUM('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED', 'REVERSED') NOT NULL DEFAULT 'VERIFIED',
  `verified_by` INT NULL,
  `verified_at` TIMESTAMP NULL,
  `rejection_reason` VARCHAR(255) NULL,
  `reversal_reason` VARCHAR(255) NULL,
  `reversed_by` INT NULL,
  `reversed_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_fp_assessment` FOREIGN KEY (`assessment_id`) REFERENCES `student_fee_assessments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_fp_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_fp_recorder` FOREIGN KEY (`recorded_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_fp_reverser` FOREIGN KEY (`reversed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX `idx_fp_student` (`student_id`),
  INDEX `idx_fp_assessment` (`assessment_id`),
  INDEX `idx_fp_status` (`status`),
  INDEX `idx_fp_date` (`payment_date`),
  INDEX `idx_fp_destination` (`destination`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 12. Fee Receipts Table (Provisional Acknowledgement vs Final Receipt vs Secretary Receipt)
CREATE TABLE IF NOT EXISTS `fee_receipts` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `payment_id` INT NOT NULL UNIQUE,
  `student_id` INT NOT NULL,
  `receipt_number` VARCHAR(50) NOT NULL UNIQUE,
  `receipt_type` ENUM('PROVISIONAL_ACKNOWLEDGEMENT', 'FINAL_COLLEGE_RECEIPT', 'SECRETARY_DEV_RECEIPT') NOT NULL DEFAULT 'FINAL_COLLEGE_RECEIPT',
  `destination` ENUM('COLLEGE_ACCOUNT', 'SECRETARY_DEV_ACCOUNT') NOT NULL DEFAULT 'COLLEGE_ACCOUNT',
  `amount` DECIMAL(12, 2) NOT NULL,
  `requested_by` INT NOT NULL,
  `status` ENUM('PENDING_APPROVAL', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'APPROVED',
  `reviewed_by` INT NULL,
  `reviewed_at` TIMESTAMP NULL,
  `rejection_reason` VARCHAR(255) NULL,
  `issued_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_fr_payment` FOREIGN KEY (`payment_id`) REFERENCES `fee_payments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_fr_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_fr_requester` FOREIGN KEY (`requested_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_fr_reviewer` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX `idx_fr_status` (`status`),
  INDEX `idx_fr_number` (`receipt_number`),
  INDEX `idx_fr_type` (`receipt_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `leave_applications` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `teacher_id` INT NOT NULL,
  `start_date` DATE NOT NULL,
  `end_date` DATE NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  `submitted_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `decided_by` INT NULL DEFAULT NULL,
  `decided_at` TIMESTAMP NULL DEFAULT NULL,
  `decision_remarks` VARCHAR(255) NULL,
  CONSTRAINT `fk_leave_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_leave_decider` FOREIGN KEY (`decided_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX `idx_leave_teacher` (`teacher_id`),
  INDEX `idx_leave_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 13. Notifications Table
CREATE TABLE IF NOT EXISTS `notifications` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `message` TEXT NOT NULL,
  `type` VARCHAR(50) NOT NULL,
  `related_id` INT NULL,
  `is_read` BOOLEAN NOT NULL DEFAULT FALSE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_notif_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  INDEX `idx_notif_user` (`user_id`),
  INDEX `idx_notif_unread` (`user_id`, `is_read`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 14. Monthly Attendance Reports
CREATE TABLE IF NOT EXISTS `monthly_attendance` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `teacher_id` INT NOT NULL,
  `year` INT NOT NULL,
  `month` INT NOT NULL,
  `total_working_days` INT NOT NULL DEFAULT 26,
  `days_present` INT NOT NULL,
  `attendance_percentage` DECIMAL(5,2) NOT NULL,
  `status` ENUM('PENDING', 'FINALIZED') NOT NULL DEFAULT 'PENDING',
  `finalized_by` INT NULL,
  `finalized_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_ma_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_ma_finalizer` FOREIGN KEY (`finalized_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  UNIQUE KEY `uq_teacher_month_year` (`teacher_id`, `year`, `month`),
  INDEX `idx_ma_teacher` (`teacher_id`),
  INDEX `idx_ma_status` (`status`)
-- 15. Institutional Holidays Table
CREATE TABLE IF NOT EXISTS `institutional_holidays` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `holiday_date` DATE NOT NULL UNIQUE,
  `holiday_name` VARCHAR(150) NOT NULL,
  `description` VARCHAR(255) NULL,
  `created_by` INT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_holidays_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX `idx_holidays_date` (`holiday_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
