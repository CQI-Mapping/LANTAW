-- 026-faculty-clo-assigned-subjects.sql
--
-- Faculty may only write CLOs for subjects the manager assigned to them
-- (courses.instructor_id). Ownership still applies; admins keep full
-- control. Run in the Supabase SQL Editor — idempotent (safe to re-run).
--
-- Lesson from two failed runs: RLS policy expressions reference the row's
-- columns BARE — there is no NEW/OLD tuple in a policy (that is a trigger
-- concept). 'NEW.course' parses as a table named "new", which is exactly
-- the 42P01 error the first drafts produced. In a USING clause a bare
-- column reads the existing row; in a WITH CHECK it reads the proposed
-- row — the semantics these policies need.
--
-- The CLO's course column is the subject CODE as text, so the match
-- normalizes both sides (uppercase, spaces stripped) — "IT 21", "it21"
-- and "IT21" meet on one value, the same leniency the UI reads with.
-- The check lives in one SECURITY DEFINER function so all three call
-- sites share a single definition.

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
                AND public.faculty_teaches_course(auth.uid(), course)
            )
        )
    );

-- UPDATE: the row being edited must belong to the writer and sit on an
-- assigned subject, and the new course must stay assigned too. USING sees
-- the existing row's course; WITH CHECK sees the proposed one.
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
                AND public.faculty_teaches_course(auth.uid(), course)
            )
        )
    )
    WITH CHECK (
        owner_id = auth.uid()
        AND (
            public.current_user_role() = 'admin'
            OR (
                public.current_user_role() = 'user'
                AND public.faculty_teaches_course(auth.uid(), course)
            )
        )
    );

COMMIT;
