-- Chạy file này trong Supabase Dashboard → SQL Editor

-- Tạo bảng episodes lưu metadata
CREATE TABLE IF NOT EXISTS episodes (
  id            BIGSERIAL PRIMARY KEY,
  filename      TEXT UNIQUE NOT NULL,
  title         TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  tags          TEXT[] NOT NULL DEFAULT '{}',
  thumbnail_url TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Index để lookup nhanh theo filename
CREATE INDEX IF NOT EXISTS idx_episodes_filename ON episodes(filename);

-- Auto-update updated_at khi có thay đổi
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_episodes_updated_at
  BEFORE UPDATE ON episodes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Cho phép public đọc (không cần auth)
ALTER TABLE episodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON episodes FOR SELECT USING (true);
CREATE POLICY "Service write" ON episodes FOR ALL USING (true);
