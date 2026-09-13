CREATE TABLE IF NOT EXISTS documentation_jobs (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS documentation_jobs_project ON documentation_jobs(project);
CREATE TABLE IF NOT EXISTS documentation_checkpoints (
  job_id TEXT NOT NULL REFERENCES documentation_jobs(id),
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY(job_id, revision)
);
CREATE TABLE IF NOT EXISTS documentation_operations (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES documentation_jobs(id),
  request_key TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  payload TEXT NOT NULL,
  UNIQUE(job_id, request_key)
);
PRAGMA user_version = 49;
