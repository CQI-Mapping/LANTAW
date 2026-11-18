-- 034-grasps-rubric.sql
--
-- The analytic rubric that rides a GRASPS task: criteria rows with the
-- four performance levels (Excellent / Proficient / Developing / Beginning)
-- and each criterion's point value, stored as JSONB. The rows are freely
-- added and removed on screen, so a fixed child table buys nothing.
-- Idempotent.

BEGIN;

ALTER TABLE public.grasps_tasks
    ADD COLUMN IF NOT EXISTS rubric JSONB;

COMMIT;
