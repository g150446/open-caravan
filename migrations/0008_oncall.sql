-- オンコール当番（勤務予定表の印）。当番の待機そのものは労働時間に入れない。
CREATE TABLE IF NOT EXISTS oncall_duties(staff_id TEXT NOT NULL,day TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(staff_id,day),FOREIGN KEY(staff_id) REFERENCES records(id));
CREATE INDEX IF NOT EXISTS oncall_duties_day ON oncall_duties(day);
-- オンコール中の対応（電話・出動）の報告。開始〜終了の1件で、労働時間に入れる。行は消さず、直すときは取り消して足す。
CREATE TABLE IF NOT EXISTS oncall_entries(id TEXT PRIMARY KEY,staff_id TEXT NOT NULL,work_date TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('CALL','DISPATCH')),start_at TEXT NOT NULL,end_at TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',source TEXT NOT NULL CHECK(source IN ('manual','slack')),created_by TEXT NOT NULL,created_at TEXT NOT NULL,voided_at TEXT,voided_by TEXT,void_reason TEXT,FOREIGN KEY(staff_id) REFERENCES records(id));
CREATE INDEX IF NOT EXISTS oncall_entries_staff_day ON oncall_entries(staff_id,work_date);
-- 打刻の変更の申請が直す打刻。承認すると元の打刻を取り消し済みにして、申請の打刻を足す。
CREATE TABLE IF NOT EXISTS punch_request_replaces(request_id TEXT PRIMARY KEY,punch_id TEXT NOT NULL,FOREIGN KEY(request_id) REFERENCES punch_requests(id));
CREATE INDEX IF NOT EXISTS punch_request_replaces_punch ON punch_request_replaces(punch_id);
