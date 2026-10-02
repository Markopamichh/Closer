-- Agents run on OpenAI now and their model comes from a closed list (AGENT_MODELS in
-- @closer/shared). Move any other value to the default so no agent fails at runtime.
-- No CHECK constraint on purpose: the list lives in one place, the shared schema.
-- The column default comes from the Drizzle schema, in the next migration.
UPDATE agents
SET model = 'gpt-5-nano'
WHERE model NOT IN ('gpt-5-nano', 'gpt-6-luna', 'gpt-5.6-luna', 'gpt-5-mini');
