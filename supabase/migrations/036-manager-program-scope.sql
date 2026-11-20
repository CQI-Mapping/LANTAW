-- 036-manager-program-scope.sql
--
-- A manager assigned to a program sees only that program and cannot
-- create or edit programs — the catalog stays the admin's. Faculty
-- and admins keep reading the full list so their own pages work.
-- Idempotent.

BEGIN;

DROP POLICY IF EXISTS "Authenticated users can read programs" ON public.programs;
CREATE POLICY "Managers read only their assigned program" ON public.programs FOR SELECT
    USING (
        public.current_user_role() IN ('admin', 'user')
        OR (
            public.current_user_role() = 'manager'
            AND id = (SELECT p.program_id FROM public.profiles p WHERE p.id = auth.uid())
        )
    );

DROP POLICY IF EXISTS "Managers and admins can create programs" ON public.programs;
CREATE POLICY "Admins can create programs" ON public.programs FOR INSERT
    WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "Managers and admins can update programs" ON public.programs;
CREATE POLICY "Admins can update programs" ON public.programs FOR UPDATE
    USING (public.current_user_role() = 'admin')
    WITH CHECK (public.current_user_role() = 'admin');

COMMIT;
