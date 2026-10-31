CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('pdf', 'photo')),
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  complete INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS media_assets_digest ON media_assets(kind, sha256);
CREATE TABLE IF NOT EXISTS media_chunks (
  asset_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  part INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY(asset_id, part)
);
-- Staged files stay behind the owner API. PDFs have no public serving route.
