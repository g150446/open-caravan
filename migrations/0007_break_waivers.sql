-- 「休憩を取れなかった」の申告。この日は、休憩の打刻がなくても自動で休憩を差し引かない。取り消しても行は残す。
CREATE TABLE IF NOT EXISTS break_waivers(staff_id TEXT NOT NULL,work_date TEXT NOT NULL,reason TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL,revoked_at TEXT,revoked_by TEXT,PRIMARY KEY(staff_id,work_date),FOREIGN KEY(staff_id) REFERENCES records(id));
