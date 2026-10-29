-- ============================================================================
-- KAMCH ERP — Teacher Accounts Additive Migration V1 (`teacher_accounts_v1`)
-- Safe, non-destructive schema extension for linking individual user accounts
-- to institutional faculty records in the teachers table.
--
-- IMPORTANT:
-- 1. Preserves all existing users, roles, departments, teachers, students,
--    fees, and sessions records without resetting or deleting data.
-- 2. Uses nullable teacher_id on users so all existing administrative and
--    shared department accounts remain completely unaffected.
-- 3. Enforces 1-to-1 mapping via unique index on non-null teacher_id.
-- ============================================================================

-- 1. Add teacher_id column to users table safely
ALTER TABLE `users`
  ADD COLUMN IF NOT EXISTS `teacher_id` INT NULL DEFAULT NULL AFTER `department_id`;

-- 2. Add non-destructive unique index and foreign key constraint
ALTER TABLE `users`
  ADD UNIQUE INDEX IF NOT EXISTS `uq_users_teacher_id` (`teacher_id`);

-- 3. Record applied migration version
INSERT IGNORE INTO `schema_migrations` (`version`) VALUES ('teacher_accounts_v1');
