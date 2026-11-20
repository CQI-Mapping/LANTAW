-- 038-manager-global-outcome-read.sql
--
-- 037 scoped a manager's outcomes to their program's rows, but the
-- admin-authored Program Outcomes are global (program_id NULL) and
-- every program's syllabus needs them. Managers may READ those shared
-- rows as well as their own program's; they still may only CREATE and
-- UPDATE rows stamped with their own program. Idempotent.

BEGIN;

DROP POLICY IF EXISTS "Managers read only their program outcomes" ON public.admin_program_outcomes;

CREATE POLICY "Managers read their program and global outcomes" ON public.admin_program_outcomes FOR SELECT
    USING (
        public.current_user_role() IN ('admin', 'user')
        OR (
            public.current_user_role() = 'manager'
            AND (
                program_id = (SELECT p.program_id FROM public.profiles p WHERE p.id = auth.uid())
                OR program_id IS NULL
            )
        )
    );

COMMIT;
