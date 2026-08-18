-- Windows hosts already carry the correct built-in shell set (001/002/031), so
-- 046 has nothing to change here. This variant exists so the schema version
-- advances in lockstep with 046_shell_profiles_posix.sql — the migration runner
-- in db/index.ts picks one of the two by platform, and both must land on 46.
PRAGMA user_version = 46;
