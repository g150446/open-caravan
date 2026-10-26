-- 勤怠の打刻。行は追加するだけで消さない。修正は取り消し（voided_*）と新しい行の追加で表し、元の打刻を残す。
CREATE TABLE IF NOT EXISTS punches(id TEXT PRIMARY KEY,staff_id TEXT NOT NULL,work_date TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('IN','OUT','BREAK_START','BREAK_END')),at TEXT NOT NULL,source TEXT NOT NULL CHECK(source IN ('punch','request','correction')),device TEXT,reason TEXT,created_by TEXT NOT NULL,created_at TEXT NOT NULL,voided_at TEXT,voided_by TEXT,void_reason TEXT,FOREIGN KEY(staff_id) REFERENCES records(id));
CREATE INDEX IF NOT EXISTS punches_staff_day ON punches(staff_id,work_date);
-- 打ち忘れなどの修正の申請。管理者が承認すると打刻を追加する。
CREATE TABLE IF NOT EXISTS punch_requests(id TEXT PRIMARY KEY,staff_id TEXT NOT NULL,work_date TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('IN','OUT','BREAK_START','BREAK_END')),at TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('PENDING','APPROVED','REJECTED')),created_at TEXT NOT NULL,decided_by TEXT,decided_at TEXT,decision_note TEXT,FOREIGN KEY(staff_id) REFERENCES records(id));
CREATE INDEX IF NOT EXISTS punch_requests_staff ON punch_requests(staff_id,work_date);
CREATE INDEX IF NOT EXISTS punch_requests_status ON punch_requests(status);
-- 勤務予定表。スタッフ×日に1行。
CREATE TABLE IF NOT EXISTS shifts(staff_id TEXT NOT NULL,day TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('WORK','OFF','LEGAL_OFF','PAID_LEAVE')),pattern TEXT,start TEXT,end TEXT,break_minutes INTEGER NOT NULL DEFAULT 0,note TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL,updated_by TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(staff_id,day),FOREIGN KEY(staff_id) REFERENCES records(id));
CREATE INDEX IF NOT EXISTS shifts_day ON shifts(day);
-- 勤務予定表の確定（1か月単位の変形労働時間制では、月が始まる前に確定する）。
CREATE TABLE IF NOT EXISTS shift_months(month TEXT PRIMARY KEY,confirmed_at TEXT NOT NULL,confirmed_by TEXT NOT NULL);
