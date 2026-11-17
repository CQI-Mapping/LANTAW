-- 031-course-description-history.sql
--
-- The subject's Course description is editable by its faculty (030), and
-- every save now writes a course.description_updated audit entry. This
-- widens the faculty activity_logs policy (027) so those entries join
-- the subject's Modification history — same assignment check, one more
-- action allowed through. Idempotent. Run AFTER 027 (re-running 027
-- alone would restore the narrower policy).

BEGIN;

DROP POLICY IF EXISTS "Faculty read CLO history for their assigned subjects"
    ON public.activity_logs;

CREATE POLICY "Faculty read CLO history for their assigned subjects"
    ON public.activity_logs FOR SELECT
    USING (
        public.current_user_role() = 'user'
        AND (
            action LIKE 'clo.%'
            OR action = 'course.description_updated'
        )
        AND public.faculty_teaches_course(auth.uid(), COALESCE(details ->> 'course', ''))
    );

COMMIT;
