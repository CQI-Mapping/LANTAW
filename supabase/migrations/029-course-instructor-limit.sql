-- 029-course-instructor-limit.sql
--
-- A subject can have at most 3 instructors — the co-teaching cap. The
-- trigger fires on every insert into the junction, so no client (UI,
-- crafted request, or console) can exceed it. Idempotent.

BEGIN;

CREATE OR REPLACE FUNCTION public.guard_course_instructor_count()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n
  FROM public.course_instructors
  WHERE course_id = NEW.course_id;
  IF n >= 3 THEN
    RAISE EXCEPTION 'A subject can have at most 3 instructors.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS course_instructors_max3 ON public.course_instructors;

CREATE TRIGGER course_instructors_max3
    BEFORE INSERT ON public.course_instructors
    FOR EACH ROW EXECUTE FUNCTION public.guard_course_instructor_count();

COMMIT;
