-- 027-faculty-clo-history.sql
--
-- A faculty member assigned to a subject can read that subject's CLO
-- modification history — including the actions of whoever handled the
-- subject before them. The trail lives in activity_logs (clo.* actions
-- whose details name the subject code); RLS previously showed faculty
-- nothing. Run in the Supabase SQL Editor — idempotent.
--
-- The details blob is written with the course code from migration 026's
-- era onward; older entries may lack it and simply stay invisible here.
-- The match goes through faculty_teaches_course() (026) so the policy
-- touches no nested row references.

BEGIN;

DROP POLICY IF EXISTS "Faculty read CLO history for their assigned subjects"
    ON public.activity_logs;

CREATE POLICY "Faculty read CLO history for their assigned subjects"
    ON public.activity_logs FOR SELECT
    USING (
        public.current_user_role() = 'user'
        AND action LIKE 'clo.%'
        AND public.faculty_teaches_course(auth.uid(), COALESCE(details ->> 'course', ''))
    );

COMMIT;
