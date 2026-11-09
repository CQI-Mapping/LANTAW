-- 024 — Archived outcomes get their Delete button back (archived-only)
--
-- Migration 018 pulled the delete button off the faculty archive and dropped
-- the owner DELETE policy: "archived outcomes are history — removing one
-- outright is an administrator's action only." The archive view now carries
-- the button again, scoped to rows already archived: deleting an ACTIVE
-- outcome stays impossible for faculty, the row must go through the archive
-- first — which is also where the button lives in the UI.
--
-- INSERT/UPDATE stay untouched (009). Admins keep full rights through the
-- FOR ALL policy from migration 009.

CREATE POLICY "Faculty delete their own archived course learning outcomes"
    ON public.admin_course_learning_outcomes FOR DELETE
    USING (owner_id = auth.uid() AND status = 'archived');
