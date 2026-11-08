-- ============================================================
-- 022: Security hardening — MFA for privileged writes, closed
--      schema creation, archived-account write lockout
--
-- Run in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- PRECONDITION (before running, in order):
--   1. BOTH administrator accounts — and any Program Head (manager)
--      intending those screens — enroll TOTP (auth.mfa.enroll factor).
--   2. Each of them signs out and back in WITH the second factor, so the
--      session the guard will judge is an aal2 session.
--   Until then the guard below refuses every privileged write it sees —
--   enroll first, run second.
--
-- WHY (live review, 2026-11)
--   * A password was the only admin signal. A leaked admin password —
--     the fielded screenshots show exactly how credential hygiene
--     degrades — reached every curriculum write. This project already
--     supports TOTP; nothing ever enforced it.
--   * Schema creation stayed open: any anon or authenticated token could
--     still CREATE objects inside `public`.
--   * An archived account (008) cannot sign in again, but a session
--     minted before the archive kept writing until it expired.
--
-- WHAT IT CHANGES
--   A · MFA/AAL2 enforcement
--       public.has_mfa_session() reads the session's authenticator-
--       assurance level straight from the JWT (aal2 = second factor
--       verified in this session). A BEFORE-write trigger on the
--       privileged surfaces refuses INSERT/UPDATE/DELETE from an
--       admin-or-manager session below aal2:
--         error: 'MFA required for privileged changes'
--         hint:  'Enroll TOTP in your account settings, sign out and
--                 back in with the second factor, then retry.'
--       Faculty (role 'user') writes are untouched — the escalation
--       boundary is the staff roles, because that is what MFA is asked
--       to protect. System contexts (Edge Functions via service_role,
--       SECURITY DEFINER functions, dashboard SQL) bypass the guard —
--       the same carve-out migration 013's column guard established.
--
--       EMERGENCY OFF-SWITCH — never let MFA strand the team. Any single
--       line below re-opens writes immediately (the helper above keeps
--       compiling and can stay):
--           DROP TRIGGER guard_privileged_write ON public.<one table>;
--       or in one sweep for every guarded table:
--           DO $$ DECLARE t text; BEGIN
--             FOREACH t IN ARRAY ARRAY['profiles','programs','courses']
--             LOOP
--               EXECUTE format('DROP TRIGGER IF EXISTS
--                 guard_privileged_write ON public.%I', t);
--             END LOOP; END $$;
--   B · Hardened defaults
--       * a DO block that fails the migration LOUDLY (naming the table)
--         if any table in `public` has RLS off — 69 policies start this
--         file, and the next table someone adds must not ship naked
--       * REVOKE CREATE ON SCHEMA public FROM anon, authenticated — the
--         schema stops being a workshop for every signed-in token
--   C · Archived-account write lockout
--       public.lockout_archived_user() trigger on the user-writable
--       data tables: whatever a profile's own session may still hold,
--       status='archived' performs ZERO writes. 008 blocks sign-in;
--       this blocks already-issued tokens — no window between archiving
--       and the session dying. Restores stay an admin channel (the
--       caller's own status is judged, not the target row's).
--
-- BEHAVIOR CHANGES TO EXPECT
--   * Admin/manager curriculum edits require an MFA session: after
--     enrolling, sign out and back in with the second factor.
--   * A non-MFA admin session gets the friendly refusal above instead
--     of a silent write.
--   * An archived account writes nothing anywhere.
-- ============================================================

-- ---------- A · The aal2 reader ----------
CREATE OR REPLACE FUNCTION public.has_mfa_session()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    -- auth.jwt() is supplied by the platform for every request; comparing
    -- the assurance level as a string keeps this a plain scan of the JWT.
    SELECT coalesce(nullif(auth.jwt() ->> 'aal', '') = 'aal2', false);
$$;

-- ---------- A · The privileged-write guard ----------
CREATE OR REPLACE FUNCTION public.guard_privileged_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_caller public.user_role;
BEGIN
    -- System contexts (Edge Functions via service_role, SECURITY DEFINER
    -- functions, SQL run directly in the dashboard) bypass the guard —
    -- they are the channels admins and the system itself use.
    IF current_user NOT IN ('authenticated', 'anon') THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    -- The caller's own role is readable under the existing SELECT policy
    -- (same fetch style as 013's column guard). An unknown caller reads
    -- as plain faculty — never a staff role.
    SELECT role INTO v_caller FROM public.profiles WHERE id = auth.uid();
    IF v_caller IS NULL THEN
        v_caller := 'user';
    END IF;

    IF v_caller IN ('admin', 'manager') AND NOT public.has_mfa_session() THEN
        RAISE EXCEPTION 'MFA required for privileged changes'
            USING ERRCODE = '42501',
                  HINT = 'Enroll TOTP in your account settings, sign out and back in with the second factor, then retry.';
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

-- ---------- A · Guard the privileged surfaces ----------
-- Programs and courses, the outcome/CLO pools and per-course catalogs,
-- SG / CMO / PEO reference tables, PO feedback, the mapping matrix and
-- assessment datasets, the TOS triple, and CQI actions.
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
        EXECUTE format(
            'CREATE TRIGGER guard_privileged_write
             BEFORE INSERT OR UPDATE OR DELETE ON public.%I
             FOR EACH ROW EXECUTE FUNCTION public.guard_privileged_write()',
            t);
    END LOOP;
END $$;

-- ---------- B · No naked tables ----------
-- Every table in public must carry RLS. This NAMES the offender and
-- aborts the migration, so a missing policy file can never roll out.
DO $$
DECLARE
    missing text;
BEGIN
    SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
      INTO missing
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND NOT c.relrowsecurity;
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'RLS is OFF for tables in schema public: %', missing;
    END IF;
END $$;

-- ---------- B · The schema stops being open for creation ----------
REVOKE CREATE ON SCHEMA public FROM anon;
REVOKE CREATE ON SCHEMA public FROM authenticated;

-- ---------- C · Archived accounts write nothing ----------
CREATE OR REPLACE FUNCTION public.lockout_archived_user()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_status text;
BEGIN
    IF current_user NOT IN ('authenticated', 'anon') THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    -- The CALLER's status is judged, never the row's: an admin restoring
    -- the archived row itself is an active account and passes.
    SELECT status INTO v_status FROM public.profiles WHERE id = auth.uid();
    IF v_status = 'archived' THEN
        RAISE EXCEPTION 'This account is archived — ask an administrator to restore it before writing.'
            USING ERRCODE = '42501';
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

-- The user-writable data surfaces: the same list the MFA guard covers,
-- plus resources (profile pictures). The activity log is written through
-- a SECURITY DEFINER RPC, which bypasses by design.
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
        'cqi_actions',
        'resources'
    ]
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS lockout_archived_user ON public.%I', t);
        EXECUTE format(
            'CREATE TRIGGER lockout_archived_user
             BEFORE INSERT OR UPDATE OR DELETE ON public.%I
             FOR EACH ROW EXECUTE FUNCTION public.lockout_archived_user()',
            t);
    END LOOP;
END $$;
