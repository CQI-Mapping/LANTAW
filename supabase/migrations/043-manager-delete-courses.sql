-- 043-manager-delete-courses.sql
--
-- Managers may permanently delete a course in the program assigned to
-- them (the plan view's per-row and bulk Remove actions). Admins keep
-- their unrestricted delete policy; faculty cannot delete courses.
-- Idempotent.

BEGIN;

DROP POLICY IF EXISTS "Managers can delete their program courses" ON public.courses;
CREATE POLICY "Managers can delete their program courses" ON public.courses FOR DELETE
    USING (
        public.current_user_role() = 'manager'
        AND program_id = (SELECT p.program_id FROM public.profiles p WHERE p.id = auth.uid())
    );

COMMIT;
