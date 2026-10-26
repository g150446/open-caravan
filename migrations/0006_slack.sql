-- Slack の #出勤退勤 の読み取り位置。1チャンネル1行。
CREATE TABLE IF NOT EXISTS slack_state(channel TEXT PRIMARY KEY,last_ts TEXT NOT NULL,polled_at TEXT NOT NULL);
-- Slack の投稿を打刻にした結果。id（チャンネル:ts）が同じ投稿の二重取り込みを防ぐ。打刻にした行は punch_id を持つ。
CREATE TABLE IF NOT EXISTS slack_events(id TEXT PRIMARY KEY,slack_user TEXT NOT NULL,staff_id TEXT,punch_id TEXT,text TEXT NOT NULL,kind TEXT,status TEXT NOT NULL CHECK(status IN ('PUNCHED','REJECTED')),message TEXT,posted_at TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS slack_events_status ON slack_events(status,created_at);
