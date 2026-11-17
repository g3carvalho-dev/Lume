CREATE TABLE watch_progress (
  user_id TEXT NOT NULL,
  material_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  video_key TEXT NOT NULL,
  duration_seconds REAL NOT NULL,
  covered_seconds REAL NOT NULL,
  playing_seconds REAL NOT NULL,
  stream_id TEXT NOT NULL,
  last_state TEXT NOT NULL,
  saw_pending INTEGER NOT NULL DEFAULT 0,
  session_id TEXT,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  PRIMARY KEY (user_id,material_id,unit_id,video_key),
  FOREIGN KEY (user_id,material_id) REFERENCES materials(user_id,id) ON DELETE CASCADE
);
