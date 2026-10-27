-- 打刻を削除する申請（punch_request_replaces の打刻を、承認したら取り消し済みにするだけで、新しい打刻は足さない）。
CREATE TABLE IF NOT EXISTS punch_request_deletes(request_id TEXT PRIMARY KEY,FOREIGN KEY(request_id) REFERENCES punch_requests(id));
