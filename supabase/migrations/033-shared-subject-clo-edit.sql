-- 033-shared-subject-clo-edit.sql
--
-- Co-teaching edits: on a subject they instruct, a faculty member can
-- UPDATE any course learning outcome on it — their own rows and the
-- co-instructors' — so a shared subject's set is maintained together.
-- Every change lands in the Modification history with the actor's
-- identity (the audit trail stamps the caller server-side).
--
-- The assignment gate holds on both sides: the PROPOSED row must sit on
-- a subject the writer teaches (WITH CHECK), so nobody moves a CLO to a
-- subject outside their assignment — own or shared. DELETION stays
-- ownership-bound ("Faculty delete their own...", 026): only the row's
-- owner (or an admin) removes it. Idempotent.

BEGIN;

DROP POLICY IF EXISTS "Faculty edit own CLOs on assigned subjects"
    ON public.admin_course_learning_outcomes;

CREATE POLICY "Faculty edit their shared subjects' outcomes"
    ON public.admin_course_learning_outcomes FOR UPDATE
    USING (
        public.current_user_role() = 'user'
        AND (
            owner_id = auth.uid()
            OR public.faculty_teaches_course(auth.uid(), course)
        )
    )
    WITH CHECK (
        public.current_user_role() = 'user'
        AND public.faculty_teaches_course(auth.uid(), course)
    );

COMMIT;
