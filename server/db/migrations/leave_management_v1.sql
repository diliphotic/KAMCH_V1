-- ============================================================================
-- KAMCH ERP — Leave Management Migration V1
-- ============================================================================

INSERT IGNORE INTO `schema_migrations` (`version`) VALUES ('leave_management_v1');

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
