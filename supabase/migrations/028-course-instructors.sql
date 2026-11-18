-- 028-course-instructors.sql
--
-- Co-teaching: a subject can be handled by SEVERAL faculty members. The
-- single courses.instructor_id column becomes a denormalized "primary
-- instructor" (existing readers keep working); the source of truth for
-- who handles a subject moves to the course_instructors junction.
--
-- Run in the Supabase SQL Editor — idempotent (safe to re-run).

BEGIN;

CREATE TABLE IF NOT EXISTS public.course_instructors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
    faculty_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (course_id, faculty_id)
);

ALTER TABLE public.course_instructors ENABLE ROW LEVEL SECURITY;

-- Any signed-in user can read the assignments (the instructor names show
-- on cards the same way the single column did).
CREATE POLICY "Authenticated users can read course_instructors" ON public.course_instructors FOR SELECT
    USING (auth.role() = 'authenticated');

-- Assignments are the manager's (and the admin's) act.
CREATE POLICY "Managers and admins manage course_instructors" ON public.course_instructors FOR ALL
    USING (public.current_user_role() IN ('admin', 'manager'))
    WITH CHECK (public.current_user_role() IN ('admin', 'manager'));

-- Seed: the standing single-instructor assignments become junction rows.
INSERT INTO public.course_instructors (course_id, faculty_id)
SELECT c.id, c.instructor_id
FROM public.courses c
WHERE c.instructor_id IS NOT NULL
ON CONFLICT (course_id, faculty_id) DO NOTHING;

-- The CLO gate re-reads the junction: a faculty member writes CLOs for a
-- subject when they are one of its instructors — so co-teachers on the
-- same subject can each write their own CLO set (the table's
-- UNIQUE(code, course, owner_id) keeps the sets side by side).
CREATE OR REPLACE FUNCTION public.faculty_teaches_course(p_uid uuid, p_course text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.course_instructors ci
    JOIN public.courses c ON c.id = ci.course_id
    WHERE ci.faculty_id = p_uid
      AND upper(regexp_replace(c.code, '\s', '', 'g'))
        = upper(regexp_replace(COALESCE(p_course, ''), '\s', '', 'g'))
  );
$$;

COMMIT;
