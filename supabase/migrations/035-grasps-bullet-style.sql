-- 035-grasps-bullet-style.sql
--
-- The bullet library choice a GRASPS task carries: which glyph its bullet
-- lists print with in the Word export - disc, circle, square, diamond,
-- arrow, check - or none, list lines printed as plain text. One setting
-- per task; NULL reads as the default disc. Idempotent.

BEGIN;

ALTER TABLE public.grasps_tasks
    ADD COLUMN IF NOT EXISTS bullet_style TEXT;

COMMIT;
