-- 039-manager-activity-program-scope.sql
--
-- A manager's Activity Logs cover the faculty of their own program only.
-- The log stores the actor's email, so visibility resolves the actor's
-- current profile a nd matches its program assignment to the manager's.
-- Admins keep the whole log; faculty keep their own CLO history.
-- Idempotent.

BEGIN;

DROP POLICY IF EXISTS "Scoped activity log visibility" ON public.activity_logs;
CREATE POLICY "Scoped activity log visibility" ON public.activity_logs FOR SELECT
    USING (
        public.current_user_role() = 'admin'
        OR (
            public.current_user_role() = 'manager'
            AND user_email IS NOT NULL
            AND user_email IN (
                SELECT p.email
                FROM public.profiles p
                WHERE p.role = 'user'
                  AND p.program_id = (
                      SELECT m.program_id FROM public.profiles m WHERE m.id = auth.uid()
                  )
            )
        )
    );

COMMIT;
