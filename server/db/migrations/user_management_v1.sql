-- ============================================================================
-- KAMCH ERP — User Management & Department Integration Migration V1 (Additive Migration)
-- Krishna Ayurvedic Medical College & Hospital
-- ============================================================================

-- 1. Create Departments table for institutional academic and clinical departments
CREATE TABLE IF NOT EXISTS `departments` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `code` VARCHAR(50) NOT NULL UNIQUE,
  `name` VARCHAR(150) NOT NULL,
  `description` VARCHAR(255) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_departments_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Ensure DEPARTMENT and LIBRARY roles exist in roles table
INSERT INTO `roles` (`code`, `name`, `description`) VALUES
  ('DEPARTMENT', 'Department Account', 'Shared institutional department account for marks and department records'),
  ('LIBRARY', 'Library Staff', 'Library administration and circulation management')
ON DUPLICATE KEY UPDATE 
  `name` = VALUES(`name`), 
  `description` = VALUES(`description`);

-- 3. Add is_deactivated, deactivated_at, and department_id columns to users table safely
ALTER TABLE `users`
  ADD COLUMN IF NOT EXISTS `is_deactivated` BOOLEAN NOT NULL DEFAULT FALSE AFTER `suspended_at`,
  ADD COLUMN IF NOT EXISTS `deactivated_at` TIMESTAMP NULL DEFAULT NULL AFTER `is_deactivated`,
  ADD COLUMN IF NOT EXISTS `department_id` INT NULL DEFAULT NULL AFTER `role_id`;

-- 4. Add index for composite user status checks
ALTER TABLE `users`
  ADD INDEX IF NOT EXISTS `idx_users_all_status` (`is_locked`, `is_suspended`, `is_deactivated`);

