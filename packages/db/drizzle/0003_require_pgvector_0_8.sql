-- Vector search sets `hnsw.iterative_scan`, which only exists from pgvector 0.8; on an
-- older version every search would fail at runtime, so stop the deploy here instead.
-- No `ALTER EXTENSION ... UPDATE`: Supabase's pgaudit rejects it inside a transaction
-- ("pgaudit stack is not empty"), and migrations run in one. Upgrade from the dashboard.
DO $$
DECLARE
  installed text := (SELECT extversion FROM pg_extension WHERE extname = 'vector');
BEGIN
  IF string_to_array(installed, '.')::int[] < ARRAY[0, 8] THEN
    RAISE EXCEPTION 'pgvector >= 0.8 is required (hnsw.iterative_scan), found %', installed;
  END IF;
END
$$;
