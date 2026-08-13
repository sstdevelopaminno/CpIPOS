-- Keep the private app schema hidden from browser roles while allowing the
-- server-side Supabase service client to execute trigger/helper functions.
grant usage on schema app to service_role;
