-- 030-course-description-faculty.sql
--
-- The faculty member handling a subject can edit that subject's catalog
-- DESCRIPTION (the one shown under the Subject Code picker and printed on
-- the syllabus). Everything else on the course record stays the manager's
-- — the helper updates only the description column, and only when the
-- caller is faculty assigned to that subject. Idempotent.

BEGIN;

CREATE OR REPLACE FUNCTION public.update_assigned_course_description(p_course_id uuid, p_description text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.current_user_role() <> 'user' THEN
    RAISE EXCEPTION 'Only faculty use this helper.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.course_instructors ci
    WHERE ci.course_id = p_course_id AND ci.faculty_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'This subject is not assigned to you.';
  END IF;
  UPDATE public.courses
  SET description = COALESCE(p_description, ''),
      updated_at = now()
  WHERE id = p_course_id;
END;
$$;

COMMIT;
