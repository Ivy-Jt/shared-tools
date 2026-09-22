CREATE TABLE IF NOT EXISTS trip_states (
  trip_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trip_history (
  trip_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (trip_id, revision)
);
CREATE TRIGGER IF NOT EXISTS keep_trip_history AFTER UPDATE ON trip_states
BEGIN
  INSERT INTO trip_history VALUES (OLD.trip_id, OLD.revision, OLD.state_json, OLD.updated_at);
  DELETE FROM trip_history WHERE trip_id = NEW.trip_id AND revision < NEW.revision - 30;
END;
INSERT OR IGNORE INTO trip_states VALUES (
  '2026-maldives-bangkok', 0,
  '{"checks":{},"packingStates":{},"notes":{},"budgets":{}}',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);
