-- ============================================================
-- 023: MFA guard off-switch — lift privilege writes back to aal1
--
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- WHY
--   022 enforced TOTP (aal2 sessions) for every admin/manager write
--   BEFORE the team had enrolled any authenticator, so archive / role /
--   program / curriculum writes began refusing with
--   'MFA required for privileged changes' (HTTP 403). Until enrollment
--   happens, the guard must come OFF so the app is workable again.
--
-- WHAT IT CHANGES
--   * Drops ONLY the guard_privileged_write trigger from every surface
--     022 guarded — the MFA gate itself. Nothing else from 022 moves:
--     the no-naked-tables check, REVOKE CREATE ON SCHEMA public, and
--     the archived-account write lockout all stay in force.
--   * public.has_mfa_session() stays (harmless, used again by 022).
--
-- TO RESTORE THE GUARD
--   Enroll TOTP on both admins (and any manager), re-sign in with the
--   second factor, then re-run 022-security-hardening.sql — it rebuilds
--   the triggers idempotently. This file and 022 are a pair; 023 turns the
--   gate off, 022 re-arms it. Run order decides which state the
--   project is in.
-- ============================================================

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'profiles',
        'programs',
        'courses',
        'program_outcomes',
        'admin_program_outcomes',
        'course_learning_outcomes',
        'admin_course_learning_outcomes',
        'program_educational_objectives',
        'strategic_goals',
        'ched_memorandum_orders',
        'po_feedback',
        'clo_po_matrix',
        'assessments',
        'assessment_results',
        'tos_exams',
        'tos_sheets',
        'tos_topics',
        'cqi_actions'
    ]
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS guard_privileged_write ON public.%I', t);
    END LOOP;
END $$;
