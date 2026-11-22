-- 041-curriculum-uploads.sql
--
-- Managers may keep the checklist PDF they imported and delete it later.
-- The file bytes live in a private Storage bucket under the uploader's id;
-- this table records the file, its program/curriculum and who uploaded it.
-- Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS public.curriculum_uploads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    program_id UUID NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
    curriculum_id UUID REFERENCES public.resources(id) ON DELETE SET NULL,
    uploaded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.curriculum_uploads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage curriculum uploads" ON public.curriculum_uploads;
CREATE POLICY "Admins manage curriculum uploads" ON public.curriculum_uploads FOR ALL
    USING (public.current_user_role() = 'admin')
    WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "Managers read their program uploads" ON public.curriculum_uploads;
CREATE POLICY "Managers read their program uploads" ON public.curriculum_uploads FOR SELECT
    USING (
        public.current_user_role() IN ('manager', 'user')
        AND (
            program_id = (SELECT p.program_id FROM public.profiles p WHERE p.id = auth.uid())
            OR uploaded_by = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users add their own uploads" ON public.curriculum_uploads;
CREATE POLICY "Users add their own uploads" ON public.curriculum_uploads FOR INSERT
    WITH CHECK (
        uploaded_by = auth.uid()
        AND program_id = (SELECT p.program_id FROM public.profiles p WHERE p.id = auth.uid())
    );

DROP POLICY IF EXISTS "Users delete their own uploads" ON public.curriculum_uploads;
CREATE POLICY "Users delete their own uploads" ON public.curriculum_uploads FOR DELETE
    USING (uploaded_by = auth.uid());

-- Private bucket; objects are addressed as <uploader uid>/<program id>/<file>.
INSERT INTO storage.buckets (id, name, public)
VALUES ('curriculum-files', 'curriculum-files', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Uploaders manage their curriculum files" ON storage.objects;
CREATE POLICY "Uploaders manage their curriculum files" ON storage.objects FOR ALL
    TO authenticated
    USING (
        bucket_id = 'curriculum-files'
        AND (storage.foldername(name))[1] = auth.uid()::text
    )
    WITH CHECK (
        bucket_id = 'curriculum-files'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

COMMIT;
