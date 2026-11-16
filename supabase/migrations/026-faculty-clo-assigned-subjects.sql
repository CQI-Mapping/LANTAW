-- 026-faculty-clo-assigned-subjects.sql
--
-- Faculty may only write CLOs for subjects the manager assigned to them
-- (courses.instructor_id). Ownership still applies; admins keep full
-- control. Run in the Supabase SQL Editor — idempotent (safe to re-run).
--
-- The subject-match check lives in one SECURITY DEFINER function so the
-- policies below only touch NEW/OLD at the top level — the pattern every
-- Postgres build parses cleanly. (The first draft inlined NEW.course into
-- the EXISTS subquery, which some builds reject with
-- 'missing FROM-clause entry for table "new"'.)
--
-- The CLO's course column is the subject CODE as text, so the match
-- normalizes both sides (uppercase, spaces stripped) — "IT 21", "it21"
-- and "IT21" meet on one value, the same leniency the UI reads with.

BEGIN;

CREATE OR REPLACE FUNCTION public.faculty_teaches_course(p_uid uuid, p_course text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.courses c
    WHERE c.instructor_id = p_uid
      AND upper(regexp_replace(c.code, '\s', '', 'g'))
        = upper(regexp_replace(COALESCE(p_course, ''), '\s', '', 'g'))
  );
$$;

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
                AND public.faculty_teaches_course(auth.uid(), NEW.course)
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
                AND public.faculty_teaches_course(auth.uid(), OLD.course)
            )
        )
    )
    WITH CHECK (
        owner_id = auth.uid()
        AND (
            public.current_user_role() = 'admin'
            OR (
                public.current_user_role() = 'user'
                AND public.faculty_teaches_course(auth.uid(), NEW.course)
            )
        )
    );

COMMIT;
