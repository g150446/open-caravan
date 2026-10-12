-- 住所の位置（町丁目・字の代表点）の保存。ブラウザで住所データから求めた結果を、ほかの端末でも使い回す。
CREATE TABLE IF NOT EXISTS geocodes(address TEXT PRIMARY KEY,lat REAL NOT NULL,lng REAL NOT NULL,level INTEGER NOT NULL,updated_at TEXT NOT NULL);
