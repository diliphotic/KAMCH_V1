-- ============================================================================
-- KAMCH ERP — Teacher Account Linking Migration V1
-- Links individual user login accounts to institutional teacher records.
-- ============================================================================

-- 1. Migration tracking
INSERT IGNORE INTO `schema_migrations` (`version`) VALUES ('teacher_account_linking_v1');

-- 2. Add teacher_id to users
ALTER TABLE `users`
  ADD COLUMN `teacher_id` INT NULL DEFAULT NULL AFTER `department_id`,
  ADD CONSTRAINT `fk_users_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD UNIQUE INDEX `uq_users_teacher` (`teacher_id`);

-- 3. Add teacher_id to account_requests
ALTER TABLE `account_requests`
  ADD COLUMN `teacher_id` INT NULL DEFAULT NULL AFTER `department`,
  ADD CONSTRAINT `fk_accreq_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
