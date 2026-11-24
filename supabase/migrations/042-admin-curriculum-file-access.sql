-- 042-admin-curriculum-file-access.sql
--
-- Admins monitor the checklist files managers uploaded: they may read
-- and delete any object in the private curriculum bucket, while the
-- uploader policy continues to govern managers and faculty.
-- Idempotent.

BEGIN;

DROP POLICY IF EXISTS "Admins manage all curriculum files" ON storage.objects;
CREATE POLICY "Admins manage all curriculum files" ON storage.objects FOR ALL
    TO authenticated
    USING (
        bucket_id = 'curriculum-files'
        AND public.current_user_role() = 'admin'
    )
    WITH CHECK (
        bucket_id = 'curriculum-files'
        AND public.current_user_role() = 'admin'
    );

COMMIT;
