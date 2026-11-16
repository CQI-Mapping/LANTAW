-- 026-faculty-clo-assigned-subjects.sql
--
-- Faculty may only write CLOs for subjects the manager assigned to them
-- (courses.instructor_id). Ownership still applies; admins keep full
-- control. Run in the Supabase SQL Editor — idempotent (safe to re-run).
--
-- The CLO's course column is the subject CODE as text, so the match
-- normalizes both sides (uppercase, spaces stripped) — "IT 21", "it21"
-- and "IT21" meet on one value, the same leniency the UI reads with.

BEGIN;

-- INSERT: ownership stays, and the subject must be assigned to the writer
-- (admins keep their full control).
DROP POLICY IF EXISTS "Outcomes are created owned by their creator"
    ON public.admin_course_learning_outcomes;

CREATE POLICY "Faculty create CLOs for their assigned subjects"
    ON public.admin_course_learning_outcomes FOR INSERT
    WITH CHECK (
        owner_id = auth.uid()
        AND (
            public.current_user_role() = 'admin'
            OR (
                public.current_user_role() = 'user'
                AND EXISTS (
                    SELECT 1 FROM public.courses c
                    WHERE c.instructor_id = auth.uid()
                      AND upper(regexp_replace(c.code, '\s', '', 'g'))
                        = upper(regexp_replace(NEW.course, '\s', '', 'g'))
                )
            )
        )
    );

-- UPDATE: the row being edited must belong to the writer and sit on an
-- assigned subject, and the new course must stay assigned too.
DROP POLICY IF EXISTS "Faculty edit only their own course learning outcomes"
    ON public.admin_course_learning_outcomes;

CREATE POLICY "Faculty edit own CLOs on assigned subjects"
    ON public.admin_course_learning_outcomes FOR UPDATE
    USING (
        owner_id = auth.uid()
        AND (
            public.current_user_role() = 'admin'
            OR (
                public.current_user_role() = 'user'
                AND EXISTS (
                    SELECT 1 FROM public.courses c
                    WHERE c.instructor_id = auth.uid()
                      AND upper(regexp_replace(c.code, '\s', '', 'g'))
                        = upper(regexp_replace(OLD.course, '\s', '', 'g'))
                )
            )
        )
    )
    WITH CHECK (
        owner_id = auth.uid()
        AND (
            public.current_user_role() = 'admin'
            OR (
                public.current_user_role() = 'user'
                AND EXISTS (
                    SELECT 1 FROM public.courses c
                    WHERE c.instructor_id = auth.uid()
                      AND upper(regexp_replace(c.code, '\s', '', 'g'))
                        = upper(regexp_replace(NEW.course, '\s', '', 'g'))
                )
            )
        )
    );

COMMIT;
