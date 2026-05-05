const express = require('express');
const multer  = require('multer');
const session = require('express-session');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Config ───────────────────────────────────────────────────────────────────
const ADMIN_PASSWORD  = process.env.ADMIN_PASSWORD  || 'admin123';
const SUPABASE_URL    = process.env.SUPABASE_URL    || '';
const SUPABASE_KEY    = process.env.SUPABASE_KEY    || '';
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'podcasts';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn('⚠️  Thiếu SUPABASE_URL hoặc SUPABASE_KEY');
}

// ─── Supabase ─────────────────────────────────────────────────────────────────
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_KEY || 'placeholder-key'
);

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'seccast-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// ─── Multer ───────────────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const audioOk = /audio\/(mpeg|mp4|ogg|wav|webm|flac|aac|x-m4a)|video\/mp4/.test(file.mimetype);
    const imgOk   = /image\/(jpeg|png|webp|gif)/.test(file.mimetype);
    (audioOk || imgOk) ? cb(null, true) : cb(new Error('Chỉ chấp nhận file audio hoặc ảnh!'));
  },
  limits: { fileSize: 50 * 1024 * 1024 }
});

const uploadFields = upload.fields([
  { name: 'audio', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 }
]);

// ─── Auth ─────────────────────────────────────────────────────────────────────
const requireAuth = (req, res, next) => {
  if (req.session.isAdmin) return next();
  res.redirect('/admin/login');
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeFilename(originalName) {
  const safe = originalName.replace(/[^a-zA-Z0-9._\-\u00C0-\u024F\u1E00-\u1EFF ]/g, '_');
  return `${Date.now()}_${safe}`;
}

// Parse User-Agent
function parseUA(ua) {
  if (!ua) return { os:'Unknown', os_version:'', browser:'Unknown', device_type:'desktop' };
  let os = 'Unknown', os_version = '', browser = 'Unknown', device_type = 'desktop';

  if (/Windows NT (\d+\.\d+)/.test(ua)) {
    const ver = {'10.0':'10/11','6.3':'8.1','6.2':'8','6.1':'7','6.0':'Vista','5.1':'XP'};
    os = 'Windows'; os_version = ver[RegExp.$1] || RegExp.$1;
  } else if (/Android ([\d.]+)/.test(ua)) {
    os = 'Android'; os_version = RegExp.$1; device_type = 'mobile';
  } else if (/iPhone OS ([\d_]+)/.test(ua)) {
    os = 'iOS'; os_version = RegExp.$1.replace(/_/g,'.'); device_type = 'mobile';
  } else if (/iPad.*OS ([\d_]+)/.test(ua)) {
    os = 'iPadOS'; os_version = RegExp.$1.replace(/_/g,'.'); device_type = 'tablet';
  } else if (/Mac OS X ([\d_.]+)/.test(ua)) {
    os = 'macOS'; os_version = RegExp.$1.replace(/_/g,'.');
  } else if (/CrOS/.test(ua)) {
    os = 'ChromeOS';
  } else if (/Linux/.test(ua)) {
    os = 'Linux';
  }

  if (/Edg\/([\d]+)/.test(ua))              browser = 'Edge '           + RegExp.$1;
  else if (/OPR\/([\d]+)/.test(ua))         browser = 'Opera '          + RegExp.$1;
  else if (/SamsungBrowser\/([\d]+)/.test(ua)) browser = 'Samsung '     + RegExp.$1;
  else if (/CriOS\/([\d]+)/.test(ua))       browser = 'Chrome iOS '     + RegExp.$1;
  else if (/FxiOS\/([\d]+)/.test(ua))       browser = 'Firefox iOS '    + RegExp.$1;
  else if (/Chrome\/([\d]+)/.test(ua))      browser = 'Chrome '         + RegExp.$1;
  else if (/Firefox\/([\d]+)/.test(ua))     browser = 'Firefox '        + RegExp.$1;
  else if (/Version\/([\d]+).*Safari/.test(ua)) browser = 'Safari '     + RegExp.$1;

  if (/Mobi|Android|iPhone|iPod/.test(ua) && device_type === 'desktop') device_type = 'mobile';

  return { os, os_version, browser, device_type };
}

function getRealIP(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// Ghi log visitor — fire-and-forget
async function logVisitor(req) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    const ua     = req.headers['user-agent'] || '';
    const parsed = parseUA(ua);
    const ip     = getRealIP(req);

    // Xóa log > 30 ngày (async, không chờ)
    supabase.from('visitor_logs')
      .delete()
      .lt('visited_at', new Date(Date.now() - 30*24*60*60*1000).toISOString())
      .then(() => {}).catch(() => {});

    await supabase.from('visitor_logs').insert({
      ip,
      user_agent:  ua.substring(0, 500),
      os:          parsed.os,
      os_version:  parsed.os_version,
      browser:     parsed.browser,
      device_type: parsed.device_type,
      path:        req.path,
    });
  } catch(e) {
    console.warn('logVisitor error:', e.message);
  }
}

async function ensureTable() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  const checks = ['episodes', 'visitor_logs'];
  for (const t of checks) {
    const { error } = await supabase.from(t).select('id').limit(1);
    if (error && error.code === '42P01')
      console.warn(`⚠️  Bảng ${t} chưa tồn tại — hãy chạy migration SQL`);
  }
}
ensureTable();

// ─── Routes: Public ───────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  logVisitor(req);
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/tracks', async (req, res) => {
  if (!SUPABASE_URL || !SUPABASE_KEY)
    return res.json({ tracks: [], warning: 'Supabase chưa được cấu hình' });
  try {
    const { data: files, error: storageErr } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .list('', { limit: 500, sortBy: { column: 'created_at', order: 'desc' } });
    if (storageErr) throw storageErr;

    const { data: episodes } = await supabase.from('episodes').select('*');
    const metaMap = {};
    (episodes || []).forEach(ep => { metaMap[ep.filename] = ep; });

    const tracks = (files || [])
      .filter(f => f.name && /\.(mp3|wav|ogg|flac|aac|m4a|webm)$/i.test(f.name))
      .map(f => {
        const { data: urlData } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(f.name);
        const meta = metaMap[f.name] || {};
        return {
          filename:    f.name,
          displayName: meta.title || f.name.replace(/^\d+_/, '').replace(/\.[^.]+$/, ''),
          description: meta.description || '',
          tags:        meta.tags || [],
          thumbnail:   meta.thumbnail_url || '',
          size:        f.metadata?.size || 0,
          uploadedAt:  f.created_at,
          url:         urlData.publicUrl
        };
      });

    res.json({ tracks });
  } catch (err) {
    console.error('List error:', err.message);
    res.status(500).json({ error: 'Không thể lấy danh sách: ' + err.message });
  }
});

// ─── Routes: Admin ────────────────────────────────────────────────────────────
app.get('/admin/login', (req, res) => {
  if (req.session.isAdmin) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Sai mật khẩu!' });
  }
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/admin', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Upload audio + thumbnail + metadata
app.post('/admin/upload', requireAuth, (req, res) => {
  uploadFields(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const audioFile = req.files?.audio?.[0];
    const thumbFile = req.files?.thumbnail?.[0];
    if (!audioFile) return res.status(400).json({ error: 'Không có file audio' });
    try {
      const audioFilename = makeFilename(audioFile.originalname);
      const { error: audioErr } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(audioFilename, audioFile.buffer, { contentType: audioFile.mimetype, upsert: false });
      if (audioErr) throw audioErr;

      let thumbnailUrl = '';
      if (thumbFile) {
        const thumbFilename = 'thumbs/' + makeFilename(thumbFile.originalname);
        const { error: thumbErr } = await supabase.storage
          .from(SUPABASE_BUCKET)
          .upload(thumbFilename, thumbFile.buffer, { contentType: thumbFile.mimetype, upsert: false });
        if (!thumbErr) {
          const { data: td } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(thumbFilename);
          thumbnailUrl = td.publicUrl;
        }
      }

      const title       = req.body.title?.trim() || audioFile.originalname.replace(/\.[^.]+$/, '');
      const description = req.body.description?.trim() || '';
      const tagsRaw     = req.body.tags?.trim() || '';
      const tags        = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

      await supabase.from('episodes').insert({ filename: audioFilename, title, description, tags, thumbnail_url: thumbnailUrl });
      res.json({ success: true, message: `Upload thành công: ${title}`, filename: audioFilename });
    } catch (e) {
      console.error('Upload error:', e.message);
      res.status(500).json({ error: 'Upload thất bại: ' + e.message });
    }
  });
});

// Cập nhật metadata
app.put('/admin/episodes/:filename', requireAuth, async (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
  const { title, description, tags } = req.body;
  try {
    const tagsArr = typeof tags === 'string'
      ? tags.split(',').map(t => t.trim()).filter(Boolean) : (tags || []);
    const { error } = await supabase.from('episodes')
      .upsert({ filename, title, description, tags: tagsArr }, { onConflict: 'filename' });
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Xóa track
app.delete('/admin/tracks/:filename', requireAuth, async (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
  try {
    await supabase.storage.from(SUPABASE_BUCKET).remove([filename]);
    await supabase.from('episodes').delete().eq('filename', filename);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Xóa thất bại: ' + e.message });
  }
});

// ─── Routes: Admin — Visitor Logs ─────────────────────────────────────────────
app.get('/admin/api/logs', requireAuth, async (req, res) => {
  try {
    const page  = parseInt(req.query.page  || '1');
    const limit = parseInt(req.query.limit || '50');
    const from  = (page - 1) * limit;

    const { data, error, count } = await supabase
      .from('visitor_logs')
      .select('*', { count: 'exact' })
      .order('visited_at', { ascending: false })
      .range(from, from + limit - 1);

    if (error) throw error;
    res.json({ logs: data || [], total: count || 0, page, limit });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/admin/api/logs/stats', requireAuth, async (req, res) => {
  try {
    const since30 = new Date(Date.now() - 30*24*60*60*1000).toISOString();
    const since7  = new Date(Date.now() -  7*24*60*60*1000).toISOString();
    const since1  = new Date(Date.now() -  1*24*60*60*1000).toISOString();

    const [total, week, today, osData, browserData, deviceData] = await Promise.all([
      supabase.from('visitor_logs').select('id', {count:'exact',head:true}).gte('visited_at', since30),
      supabase.from('visitor_logs').select('id', {count:'exact',head:true}).gte('visited_at', since7),
      supabase.from('visitor_logs').select('id', {count:'exact',head:true}).gte('visited_at', since1),
      supabase.from('visitor_logs').select('os').gte('visited_at', since30),
      supabase.from('visitor_logs').select('browser').gte('visited_at', since30),
      supabase.from('visitor_logs').select('device_type').gte('visited_at', since30),
    ]);

    // Tính phân phối
    function countBy(rows, key) {
      const map = {};
      (rows.data || []).forEach(r => { map[r[key]] = (map[r[key]] || 0) + 1; });
      return Object.entries(map).sort((a,b) => b[1]-a[1]).map(([k,v]) => ({ name:k, count:v }));
    }

    res.json({
      total:   total.count   || 0,
      week:    week.count    || 0,
      today:   today.count   || 0,
      os:      countBy(osData,     'os'),
      browser: countBy(browserData,'browser'),
      device:  countBy(deviceData, 'device_type'),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Xóa toàn bộ log (admin action)
app.delete('/admin/api/logs', requireAuth, async (req, res) => {
  try {
    await supabase.from('visitor_logs').delete().neq('id', 0);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎵 SEC//CAST running on port ${PORT}`);
  console.log(`🗄️  Supabase: ${SUPABASE_URL ? '✅ configured' : '❌ not configured'}`);
});
