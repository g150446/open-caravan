-- 事業所の設定（訪問ルートの出発・到着地など）。1行だけ持つ。
CREATE TABLE IF NOT EXISTS settings(id TEXT PRIMARY KEY CHECK(id='office'),data TEXT NOT NULL CHECK(json_valid(data)),version INTEGER NOT NULL);
