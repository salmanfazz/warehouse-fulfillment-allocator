-- Do not add BEGIN or COMMIT: the runner wraps each file in one transaction.

-- Migration 001 stopped new tables from being handed to Supabase's two public roles. This does the
-- same for sequences and functions created later in `public`.
--
-- Limits, so nobody is surprised:
--  * Supabase also sets default privileges owned by its own admin role. They only apply to objects
--    that role creates, which this app never does, and they cannot be changed from here.
--  * Postgres gives EXECUTE on every new function to the built-in PUBLIC role, and that cannot be
--    removed for one schema. A future function in `public` is therefore callable by these roles
--    unless it is revoked explicitly or created with REVOKE EXECUTE ... FROM PUBLIC. The app
--    defines no functions today.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
