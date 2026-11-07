-- 処方箋薬局のマスタ。records の kind は CHECK 制約で固定のため、作り直さずに別テーブルにする（患者・施設からは pharmacyId で参照）。
CREATE TABLE IF NOT EXISTS pharmacies(id TEXT PRIMARY KEY,data TEXT NOT NULL CHECK(json_valid(data)),version INTEGER NOT NULL DEFAULT 1);
