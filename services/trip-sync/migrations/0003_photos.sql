CREATE TABLE IF NOT EXISTS trip_photos (
  trip_id TEXT NOT NULL,
  id TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  day TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (trip_id, id)
);
