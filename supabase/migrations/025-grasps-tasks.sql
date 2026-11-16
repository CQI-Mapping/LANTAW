-- 025 — GRASPS performance tasks
--
-- The Generate GRASPS page (faculty) saves each performance task it builds:
-- one row per document, carrying the six GRASPS components as plain text
-- (Goal, Role, Audience, Situation, Product/Performance, Standards).
--
-- Private to their owner, exactly like the TOS blueprints (tos_exams): the
-- policy below scopes every read and write to auth.uid(), so a faculty member
-- never sees a colleague's task and the page never filters by user itself.
--
-- The identifying columns mirror tos_exams on purpose — program (code),
-- course (title), task type (task_type, the grading period the task is for),
-- semester and school year — with the same UNIQUE guard: one task per
-- header. The owner defaults to auth.uid() so an insert that omits user_id
-- still lands on the right row (same reasoning as tos_exams).

CREATE TABLE IF NOT EXISTS public.grasps_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    task_type TEXT NOT NULL DEFAULT 'Prelim',
    -- Recomposed from semester + school_year on every write, kept so anything
    -- still reading it (an older export, a card) keeps working.
    term TEXT NOT NULL,
    semester TEXT,
    school_year TEXT,
    -- The six GRASPS components. Each is optional in storage — a task may be
    -- filed half-written — and the page decides what counts as saveable.
    goal TEXT,
    role TEXT,
    audience TEXT,
    situation TEXT,
    product TEXT,
    standards TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, code, task_type, semester, school_year)
);

CREATE INDEX IF NOT EXISTS grasps_tasks_user_idx ON public.grasps_tasks (user_id);

ALTER TABLE public.grasps_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own grasps_tasks" ON public.grasps_tasks;
CREATE POLICY "Users manage own grasps_tasks" ON public.grasps_tasks FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
