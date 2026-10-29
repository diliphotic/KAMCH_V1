-- ============================================================================
-- KAMCH ERP — Module: Library Management Schema (v1)
-- Character Set: utf8mb4, Engine: InnoDB
-- ============================================================================

-- 1. Library Books (Catalogue of physical copies identified by accession numbers)
CREATE TABLE IF NOT EXISTS `library_books` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `accession_number` VARCHAR(50) NOT NULL UNIQUE,
  `accession_date` DATE NULL DEFAULT NULL,
  `title` VARCHAR(255) NOT NULL,
  `authors` VARCHAR(255) NULL DEFAULT NULL,
  `edition_year` VARCHAR(100) NULL DEFAULT NULL,
  `publisher_place` VARCHAR(255) NULL DEFAULT NULL,
  `isbn` VARCHAR(50) NULL DEFAULT NULL,
  `pages` VARCHAR(50) NULL DEFAULT NULL,
  `binding` VARCHAR(50) NULL DEFAULT NULL,
  `source` VARCHAR(100) NULL DEFAULT NULL,
  `bill_number_date` VARCHAR(100) NULL DEFAULT NULL,
  `price` DECIMAL(10, 2) NULL DEFAULT NULL,
  `status` ENUM('AVAILABLE', 'ISSUED', 'LOST', 'DAMAGED', 'WITHDRAWN') NOT NULL DEFAULT 'AVAILABLE',
  `remarks` TEXT NULL DEFAULT NULL,
  `created_by` INT NULL DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_lb_status` (`status`),
  INDEX `idx_lb_title` (`title`),
  INDEX `idx_lb_authors` (`authors`),
  INDEX `idx_lb_isbn` (`isbn`),
  INDEX `idx_lb_acc_num` (`accession_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Library Borrowing and Fine Settings
CREATE TABLE IF NOT EXISTS `library_settings` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `borrower_type` ENUM('STUDENT', 'TEACHER') NOT NULL UNIQUE,
  `max_active_books` INT NOT NULL DEFAULT 2,
  `loan_period_days` INT NOT NULL DEFAULT 14,
  `fine_amount_per_day` DECIMAL(8, 2) NOT NULL DEFAULT 2.00,
  `grace_period_days` INT NOT NULL DEFAULT 1,
  `max_fine_amount` DECIMAL(8, 2) NULL DEFAULT 500.00,
  `updated_by` INT NULL DEFAULT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed default borrowing settings
INSERT INTO `library_settings` (`borrower_type`, `max_active_books`, `loan_period_days`, `fine_amount_per_day`, `grace_period_days`, `max_fine_amount`)
VALUES
  ('STUDENT', 2, 14, 2.00, 1, 500.00),
  ('TEACHER', 5, 30, 2.00, 1, 1000.00)
ON DUPLICATE KEY UPDATE
  `max_active_books` = VALUES(`max_active_books`),
  `loan_period_days` = VALUES(`loan_period_days`);

-- 3. Library Circulation Loans
CREATE TABLE IF NOT EXISTS `library_loans` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `book_id` INT NOT NULL,
  `accession_number` VARCHAR(50) NOT NULL,
  `borrower_type` ENUM('STUDENT', 'TEACHER') NOT NULL,
  `student_id` INT NULL DEFAULT NULL,
  `teacher_id` INT NULL DEFAULT NULL,
  `borrower_name` VARCHAR(150) NOT NULL,
  `borrower_identifier` VARCHAR(100) NOT NULL,
  `borrower_details` VARCHAR(255) NULL DEFAULT NULL,
  `issue_date` DATETIME NOT NULL,
  `due_date` DATE NOT NULL,
  `return_date` DATETIME NULL DEFAULT NULL,
  `status` ENUM('ACTIVE', 'RETURNED', 'OVERDUE') NOT NULL DEFAULT 'ACTIVE',
  `issued_by` INT NOT NULL,
  `returned_by` INT NULL DEFAULT NULL,
  `is_initial_entry` BOOLEAN NOT NULL DEFAULT FALSE,
  `remarks` TEXT NULL DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_ll_book` FOREIGN KEY (`book_id`) REFERENCES `library_books` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_ll_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_ll_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_ll_issuer` FOREIGN KEY (`issued_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_ll_returner` FOREIGN KEY (`returned_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX `idx_ll_status` (`status`),
  INDEX `idx_ll_acc_num` (`accession_number`),
  INDEX `idx_ll_student` (`student_id`),
  INDEX `idx_ll_teacher` (`teacher_id`),
  INDEX `idx_ll_due_date` (`due_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Library Fines (Assessed on overdue return)
CREATE TABLE IF NOT EXISTS `library_fines` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `loan_id` INT NOT NULL UNIQUE,
  `overdue_days` INT NOT NULL DEFAULT 0,
  `assessed_fine` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  `waived_amount` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  `paid_amount` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  `outstanding_balance` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  `waiver_reason` VARCHAR(255) NULL DEFAULT NULL,
  `waived_by` INT NULL DEFAULT NULL,
  `waived_at` TIMESTAMP NULL DEFAULT NULL,
  `status` ENUM('PENDING', 'PARTIALLY_PAID', 'PAID', 'WAIVED') NOT NULL DEFAULT 'PENDING',
  `calculation_details` JSON NULL DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_lf_loan` FOREIGN KEY (`loan_id`) REFERENCES `library_loans` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_lf_waiver` FOREIGN KEY (`waived_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX `idx_lf_status` (`status`),
  INDEX `idx_lf_balance` (`outstanding_balance`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Library Fine Payments & Waivers (Audit & payment history)
CREATE TABLE IF NOT EXISTS `library_fine_payments` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `fine_id` INT NOT NULL,
  `payment_type` ENUM('PAYMENT', 'WAIVER') NOT NULL,
  `amount` DECIMAL(10, 2) NOT NULL,
  `payment_method` VARCHAR(50) NOT NULL DEFAULT 'CASH',
  `receipt_reference` VARCHAR(100) NULL DEFAULT NULL,
  `reason` VARCHAR(255) NULL DEFAULT NULL,
  `recorded_by` INT NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_lfp_fine` FOREIGN KEY (`fine_id`) REFERENCES `library_fines` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_lfp_recorder` FOREIGN KEY (`recorded_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  INDEX `idx_lfp_fine` (`fine_id`),
  INDEX `idx_lfp_type` (`payment_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
