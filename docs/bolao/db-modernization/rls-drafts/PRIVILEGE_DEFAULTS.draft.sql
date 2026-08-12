-- NOT FOR PRODUCTION APPLY — generated design artefact.
-- GENERATED FILE — do not edit by hand. Source: scripts/db/privilege_model.mjs
-- Regenerate: node scripts/db/privilege_model.mjs --write
--
-- ALTER DEFAULT PRIVILEGES IS PER-CREATOR-ROLE. Objects created by a role whose defaults were
-- never altered keep inheriting the platform's blanket grant, and every test whose fixtures are
-- created by an altered role will pass while that is true.
--
-- postgres: the owner of every relation the 2026-08-11 probe reported
-- supabase_admin: the platform's bootstrap role; conventionally the one that sets the initial defaults  [UNCONFIRMED — SELECT defaclrole::regrole FROM pg_default_acl — never read in production]
-- supabase_migrations: may own objects applied through the CLI migration path  [UNCONFIRMED — same query]

-- ── creator role: postgres 
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA public REVOKE ALL ON TABLES FROM "anon", "authenticated", "service_role", PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA public REVOKE ALL ON SEQUENCES FROM "anon", "authenticated", "service_role", PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM "anon", "authenticated", "service_role", PUBLIC;

-- ── creator role: supabase_admin (UNCONFIRMED)
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA public REVOKE ALL ON TABLES FROM "anon", "authenticated", "service_role", PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA public REVOKE ALL ON SEQUENCES FROM "anon", "authenticated", "service_role", PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM "anon", "authenticated", "service_role", PUBLIC;

-- ── creator role: supabase_migrations (UNCONFIRMED)
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_migrations" IN SCHEMA public REVOKE ALL ON TABLES FROM "anon", "authenticated", "service_role", PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_migrations" IN SCHEMA public REVOKE ALL ON SEQUENCES FROM "anon", "authenticated", "service_role", PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_migrations" IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM "anon", "authenticated", "service_role", PUBLIC;

-- ── PUBLIC's built-in EXECUTE — schema-scoped revokes DO NOT remove it (KPLUS-F059).
-- Measured by NIGHT-28: the IN SCHEMA form above creates no pg_default_acl row and new
-- functions remain world-executable. The built-in is database-wide, so the revoke must be too.
-- SCOPE NOTE: these statements are NOT restricted to `public`. They cover every schema the
-- creator makes functions in. That is deliberate — PUBLIC should hold EXECUTE nowhere by
-- default — but it is a wider blast radius than the block above and is called out as such.
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;   -- creator UNCONFIRMED
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_migrations" REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;   -- creator UNCONFIRMED

-- Existing functions still need the explicit REVOKE in the forward SQL: altering a default
-- changes what the NEXT object inherits and never touches one that already exists.
