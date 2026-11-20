-- 040-grasps-scoring-interpretation.sql
--
-- The faculty's editable Scoring Interpretation rows: the form's five
-- default bands are a starting point, not a fixture. Stored as JSONB,
-- like the analytic rubric. NULL reads as the college defaults.
-- Idempotent.

BEGIN;

ALTER TABLE public.grasps_tasks
    ADD COLUMN IF NOT EXISTS scoring_interpretation JSONB;

COMMIT;
