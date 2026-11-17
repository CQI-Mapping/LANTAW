-- 032-shared-subject-clo-visibility.sql
--
-- Co-teaching visibility: on a subject a faculty member instructs, they
-- read EVERY course learning outcome on it — their own set and the sets
-- the co-instructors inputted. Editing stays ownership-bound (026): the
-- others' rows are read-only for them. Replaces 027-era "Faculty see
-- only their own course learning outcomes". Idempotent.

BEGIN;

DROP POLICY IF EXISTS "Faculty see only their own course learning outcomes"
    ON public.admin_course_learning_outcomes;

CREATE POLICY "Faculty read their shared subjects' outcomes"
    ON public.admin_course_learning_outcomes FOR SELECT
    USING (
        public.current_user_role() = 'user'
        AND (
            owner_id = auth.uid()
            OR public.faculty_teaches_course(auth.uid(), course)
        )
    );

COMMIT;
