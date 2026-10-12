-- スタッフ画面から発行した端末証明書。失効していない証明書の fingerprint がアクセス許可リストになる。
CREATE TABLE IF NOT EXISTS device_certificates(id TEXT PRIMARY KEY,staff_id TEXT NOT NULL,name TEXT NOT NULL,fingerprint TEXT NOT NULL UNIQUE,cf_id TEXT,expires TEXT NOT NULL,issued_at TEXT NOT NULL,revoked_at TEXT,FOREIGN KEY(staff_id) REFERENCES records(id));
CREATE INDEX IF NOT EXISTS device_certificates_staff ON device_certificates(staff_id,revoked_at);
