CREATE TABLE content_documents (
  path TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision > 0),
  draft_json TEXT NOT NULL CHECK (json_valid(draft_json)),
  published_json TEXT CHECK (published_json IS NULL OR json_valid(published_json)),
  previous_json TEXT CHECK (previous_json IS NULL OR json_valid(previous_json)),
  published_revision INTEGER,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  published_at TEXT
);
