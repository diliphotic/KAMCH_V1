-- ============================================================================
-- KAMCH ERP — Fees Management Module Migration V2 (Additive Migration)
-- Krishna Ayurvedic Medical College & Hospital
-- ============================================================================

-- 1. Ensure fee_structures has mess_fee, hostel_fee, and is_active columns
ALTER TABLE `fee_structures`
  ADD COLUMN IF NOT EXISTS `mess_fee` DECIMAL(12, 2) NOT NULL DEFAULT 30000.00 AFTER `development_fee`,
  ADD COLUMN IF NOT EXISTS `hostel_fee` DECIMAL(12, 2) NOT NULL DEFAULT 30000.00 AFTER `mess_fee`,
  ADD COLUMN IF NOT EXISTS `is_active` BOOLEAN NOT NULL DEFAULT TRUE AFTER `description`;

-- 2. Update initial approved fee structures for 2026-2027 per Section 4 specifications
-- Government Quota: College Fee ₹75,750, Development Fee ₹50,000, Total ₹1,25,750, Mess ₹30,000, Hostel ₹30,000
INSERT INTO `fee_structures` (`academic_year`, `admission_category`, `year_of_study`, `college_fee`, `development_fee`, `mess_fee`, `hostel_fee`, `total_annual_fee`, `description`, `is_active`)
VALUES
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

-- 3. Ensure students table has service enrollment tracking flags
ALTER TABLE `students`
  ADD COLUMN IF NOT EXISTS `mess_enrolled` BOOLEAN NOT NULL DEFAULT FALSE AFTER `kea_acknowledgement_no`,
  ADD COLUMN IF NOT EXISTS `hostel_enrolled` BOOLEAN NOT NULL DEFAULT FALSE AFTER `mess_enrolled`;

-- 4. Create Service Enrollments table for independent Mess & Hostel lifecycle tracking
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

-- 5. Ensure student_fee_assessments has service charges, concessions, and revised payable columns
ALTER TABLE `student_fee_assessments`
  ADD COLUMN IF NOT EXISTS `assessed_mess_fee` DECIMAL(12, 2) NOT NULL DEFAULT 0.00 AFTER `assessed_development_fee`,
  ADD COLUMN IF NOT EXISTS `assessed_hostel_fee` DECIMAL(12, 2) NOT NULL DEFAULT 0.00 AFTER `assessed_mess_fee`,
  ADD COLUMN IF NOT EXISTS `concession_total` DECIMAL(12, 2) NOT NULL DEFAULT 0.00 AFTER `total_assessed_fee`,
  ADD COLUMN IF NOT EXISTS `revised_payable` DECIMAL(12, 2) NOT NULL DEFAULT 0.00 AFTER `concession_total`,
  ADD COLUMN IF NOT EXISTS `notes` VARCHAR(255) NULL AFTER `revised_payable`;

-- 6. Create Fee Concessions table for authorized discounts (Super Admin & Principal only)
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

-- 7. Add columns to fee_payments for destination, UTR tracking, and passbook verification
ALTER TABLE `fee_payments`
  ADD COLUMN IF NOT EXISTS `destination` ENUM('COLLEGE_ACCOUNT', 'SECRETARY_DEV_ACCOUNT') NOT NULL DEFAULT 'COLLEGE_ACCOUNT' AFTER `amount`,
  ADD COLUMN IF NOT EXISTS `student_tx_ref` VARCHAR(100) NULL AFTER `bank_transaction_ref`,
  ADD COLUMN IF NOT EXISTS `passbook_tx_ref` VARCHAR(100) NULL AFTER `student_tx_ref`,
  ADD COLUMN IF NOT EXISTS `verified_by` INT NULL AFTER `status`,
  ADD COLUMN IF NOT EXISTS `verified_at` TIMESTAMP NULL AFTER `verified_by`,
  ADD COLUMN IF NOT EXISTS `rejection_reason` VARCHAR(255) NULL AFTER `verified_at`,
  MODIFY COLUMN `payment_method` ENUM('CASH', 'BANK_TRANSFER', 'ONLINE_DEV') NOT NULL DEFAULT 'CASH',
  MODIFY COLUMN `status` ENUM('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED', 'REVERSED') NOT NULL DEFAULT 'VERIFIED';

-- 8. Add columns to fee_receipts for provisional vs final and secretary receipts
ALTER TABLE `fee_receipts`
  ADD COLUMN IF NOT EXISTS `student_id` INT NULL AFTER `payment_id`,
  ADD COLUMN IF NOT EXISTS `receipt_type` ENUM('PROVISIONAL_ACKNOWLEDGEMENT', 'FINAL_COLLEGE_RECEIPT', 'SECRETARY_DEV_RECEIPT') NOT NULL DEFAULT 'FINAL_COLLEGE_RECEIPT' AFTER `receipt_number`,
  ADD COLUMN IF NOT EXISTS `destination` ENUM('COLLEGE_ACCOUNT', 'SECRETARY_DEV_ACCOUNT') NOT NULL DEFAULT 'COLLEGE_ACCOUNT' AFTER `receipt_type`,
  ADD COLUMN IF NOT EXISTS `amount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00 AFTER `destination`,
  ADD COLUMN IF NOT EXISTS `issued_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER `rejection_reason`;
