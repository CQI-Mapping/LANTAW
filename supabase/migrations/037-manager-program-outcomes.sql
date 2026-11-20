-- 037-manager-program-outcomes.sql
--
-- Manager-authored program outcomes belong to the program of the manager
-- who wrote them. A manager reads, creates and edits only their own
-- program's outcomes; admin-authored (global) rows keep NULL and stay
-- the admin's. Idempotent.

BEGIN;

ALTER TABLE public.admin_program_outcomes
    ADD COLUMN IF NOT EXISTS program_id UUID REFERENCES public.programs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS admin_program_outcomes_program_idx
    ON public.admin_program_outcomes (program_id);

DROP POLICY IF EXISTS "Authenticated users can read admin_program_outcomes" ON public.admin_program_outcomes;
CREATE POLICY "Managers read only their program outcomes" ON public.admin_program_outcomes FOR SELECT
    USING (
        public.current_user_role() IN ('admin', 'user')
        OR (
            public.current_user_role() = 'manager'
            AND program_id = (SELECT p.program_id FROM public.profiles p WHERE p.id = auth.uid())
        )
    );

DROP POLICY IF EXISTS "Managers and admins can create admin_program_outcomes" ON public.admin_program_outcomes;
CREATE POLICY "Admins create any outcome, managers only for their program" ON public.admin_program_outcomes FOR INSERT
    WITH CHECK (
        public.current_user_role() = 'admin'
        OR (
            public.current_user_role() = 'manager'
            AND program_id = (SELECT p.program_id FROM public.profiles p WHERE p.id = auth.uid())
        )
    );

DROP POLICY IF EXISTS "Managers and admins can update admin_program_outcomes" ON public.admin_program_outcomes;
CREATE POLICY "Admins update any outcome, managers only their program's" ON public.admin_program_outcomes FOR UPDATE
    USING (
        public.current_user_role() = 'admin'
        OR (
            public.current_user_role() = 'manager'
            AND program_id = (SELECT p.program_id FROM public.profiles p WHERE p.id = auth.uid())
        )
    )
    WITH CHECK (
        public.current_user_role() = 'admin'
        OR (
            public.current_user_role() = 'manager'
            AND program_id = (SELECT p.program_id FROM public.profiles p WHERE p.id = auth.uid())
        )
    );

COMMIT;
