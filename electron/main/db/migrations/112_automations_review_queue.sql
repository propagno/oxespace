-- OXE-446: Automations (5-field cron + CI/PR/CLI events) with isolated worktrees and unified Review Queue.
-- Additive migration preserving 100% of existing schedules, schedule_runs, and schedule_settings rows.

ALTER TABLE schedules ADD COLUMN trigger_kind TEXT NOT NULL DEFAULT 'time' CHECK (trigger_kind IN ('time', 'cron', 'event'));
ALTER TABLE schedules ADD COLUMN event_config_json TEXT;
ALTER TABLE schedules ADD COLUMN timeout_ms INTEGER NOT NULL DEFAULT 1200000 CHECK (timeout_ms >= 1000);

CREATE TABLE schedule_runs_new (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  due_at INTEGER NOT NULL,
  at INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (
    outcome IN (
      'started',
      'queued',
      'running',
      'waiting_approval',
      'needs_review',
      'approved',
      'merged',
      'discarded',
      'failed',
      'timed_out',
      'missed',
      'skipped-busy',
      'skipped-limit'
    )
  ),
  thread_id TEXT,
  detail TEXT,
  worktree_path TEXT,
  branch_name TEXT,
  base_sha TEXT,
  finished_at INTEGER,
  summary_md TEXT,
  files_changed INTEGER NOT NULL DEFAULT 0,
  additions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  pr_url TEXT,
  error_code TEXT,
  event_key TEXT,
  token_usage_json TEXT,
  review_status TEXT CHECK (review_status IS NULL OR review_status IN ('pending', 'approved', 'merged', 'discarded'))
);

INSERT INTO schedule_runs_new (id, schedule_id, due_at, at, outcome, thread_id, detail)
  SELECT id, schedule_id, due_at, at, outcome, thread_id, detail FROM schedule_runs;

DROP TABLE schedule_runs;
ALTER TABLE schedule_runs_new RENAME TO schedule_runs;

CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule ON schedule_runs(schedule_id, at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_runs_event_dedup ON schedule_runs(schedule_id, event_key) WHERE event_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_schedule_runs_review ON schedule_runs(review_status, at DESC);

ALTER TABLE schedule_settings ADD COLUMN max_concurrent INTEGER NOT NULL DEFAULT 2 CHECK (max_concurrent >= 1 AND max_concurrent <= 10);

PRAGMA user_version = 112;
