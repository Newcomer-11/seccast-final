-- ═══════════════════════════════════════════════════════════
-- SEC//CAST — Supabase Migration
-- Chạy trong: Supabase Dashboard → SQL Editor → Run All
-- ═══════════════════════════════════════════════════════════

-- ── Bảng episodes (metadata podcast) ─────────────────────
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
CREATE INDEX IF NOT EXISTS idx_episodes_filename ON episodes(filename);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_episodes_updated_at ON episodes;
CREATE TRIGGER trg_episodes_updated_at
  BEFORE UPDATE ON episodes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Bảng visitor_logs (log thiết bị) ─────────────────────
CREATE TABLE IF NOT EXISTS visitor_logs (
  id           BIGSERIAL PRIMARY KEY,
  ip           TEXT NOT NULL DEFAULT '',
  user_agent   TEXT NOT NULL DEFAULT '',
  os           TEXT NOT NULL DEFAULT '',
  os_version   TEXT NOT NULL DEFAULT '',
  browser      TEXT NOT NULL DEFAULT '',
  device_type  TEXT NOT NULL DEFAULT 'desktop',
  path         TEXT NOT NULL DEFAULT '/',
  visited_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_visitor_logs_visited_at ON visitor_logs(visited_at DESC);
CREATE INDEX IF NOT EXISTS idx_visitor_logs_ip         ON visitor_logs(ip);

-- ── Row Level Security ────────────────────────────────────
ALTER TABLE episodes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor_logs ENABLE ROW LEVEL SECURITY;

-- Public chỉ được đọc episodes
DROP POLICY IF EXISTS "Public read episodes"     ON episodes;
DROP POLICY IF EXISTS "Service write episodes"   ON episodes;
DROP POLICY IF EXISTS "Service all visitor_logs" ON visitor_logs;

CREATE POLICY "Public read episodes"     ON episodes     FOR SELECT USING (true);
CREATE POLICY "Service write episodes"   ON episodes     FOR ALL    USING (true);
CREATE POLICY "Service all visitor_logs" ON visitor_logs FOR ALL    USING (true);
