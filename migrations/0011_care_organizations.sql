CREATE TABLE IF NOT EXISTS nursing_stations (
  id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)), version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS care_support_offices (
  id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)), version INTEGER NOT NULL DEFAULT 1
);
