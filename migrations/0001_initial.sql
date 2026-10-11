CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0, initialized INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO meta(id) VALUES(1);
CREATE TABLE IF NOT EXISTS records (
 kind TEXT NOT NULL CHECK(kind IN ('staff','patients','facilities','appointments','series')),
 id TEXT PRIMARY KEY, lookup TEXT, data TEXT NOT NULL CHECK(json_valid(data)), version INTEGER NOT NULL DEFAULT 1,
 starts_at TEXT, patient_id TEXT, series_id TEXT, occurrence_date TEXT, cancelled INTEGER NOT NULL DEFAULT 0,
 UNIQUE(kind,lookup)
);
CREATE INDEX IF NOT EXISTS records_kind ON records(kind);
CREATE INDEX IF NOT EXISTS appointments_period ON records(kind,cancelled,starts_at);
CREATE INDEX IF NOT EXISTS appointments_patient ON records(kind,patient_id,cancelled,starts_at);
CREATE INDEX IF NOT EXISTS appointments_series ON records(kind,series_id,occurrence_date);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,staff_id TEXT NOT NULL,csrf TEXT NOT NULL,expires INTEGER NOT NULL,FOREIGN KEY(staff_id) REFERENCES records(id));
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS guards(id TEXT PRIMARY KEY,ok INTEGER NOT NULL CHECK(ok=1));
CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,action TEXT NOT NULL,entity_id TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS audit_time ON audit(created_at);
CREATE TABLE IF NOT EXISTS imports(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,kind TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,next_chunk INTEGER NOT NULL DEFAULT 0,expires INTEGER NOT NULL);
