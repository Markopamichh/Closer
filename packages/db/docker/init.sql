-- Local development only. Creates the runtime role with a known password before
-- migrations run; 0000_setup.sql skips creation when the role already exists.
CREATE ROLE closer_app LOGIN PASSWORD 'closer_app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
