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
  console.warn('⚠️  Thiếu SUPABASE_URL hoặc SUPABASE_KEY — kiểm tra biến môi trường');
}

// ─── Supabase client ──────────────────────────────────────────────────────────
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

// Đảm bảo bảng episodes tồn tại (chạy 1 lần khi start)
async function ensureTable() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  // Thử query — nếu bảng chưa có sẽ báo lỗi nhưng không crash app
  const { error } = await supabase.from('episodes').select('id').limit(1);
  if (error && error.code === '42P01') {
    console.warn('⚠️  Bảng episodes chưa tồn tại — hãy chạy migration SQL trong Supabase');
  }
}
ensureTable();

// ─── Routes: Public ───────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Lấy danh sách tracks + metadata
app.get('/api/tracks', async (req, res) => {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.json({ tracks: [], warning: 'Supabase chưa được cấu hình' });
  }
  try {
    // Lấy file list từ Storage
    const { data: files, error: storageErr } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .list('', { limit: 500, sortBy: { column: 'created_at', order: 'desc' } });
    if (storageErr) throw storageErr;

    // Lấy metadata từ DB
    const { data: episodes } = await supabase
      .from('episodes')
      .select('*');
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
      // 1. Upload audio
      const audioFilename = makeFilename(audioFile.originalname);
      const { error: audioErr } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(audioFilename, audioFile.buffer, { contentType: audioFile.mimetype, upsert: false });
      if (audioErr) throw audioErr;

      // 2. Upload thumbnail nếu có
      let thumbnailUrl = '';
      if (thumbFile) {
        const thumbFilename = 'thumbs/' + makeFilename(thumbFile.originalname);
        const { error: thumbErr } = await supabase.storage
          .from(SUPABASE_BUCKET)
          .upload(thumbFilename, thumbFile.buffer, { contentType: thumbFile.mimetype, upsert: false });
        if (!thumbErr) {
          const { data: thumbUrl } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(thumbFilename);
          thumbnailUrl = thumbUrl.publicUrl;
        }
      }

      // 3. Lưu metadata vào DB
      const title       = req.body.title?.trim() || audioFile.originalname.replace(/\.[^.]+$/, '');
      const description = req.body.description?.trim() || '';
      const tagsRaw     = req.body.tags?.trim() || '';
      const tags        = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

      await supabase.from('episodes').insert({
        filename:      audioFilename,
        title,
        description,
        tags,
        thumbnail_url: thumbnailUrl,
      });

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
      ? tags.split(',').map(t => t.trim()).filter(Boolean)
      : (tags || []);
    const { error } = await supabase.from('episodes')
      .upsert({ filename, title, description, tags: tagsArr }, { onConflict: 'filename' });
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Xóa track + metadata
app.delete('/admin/tracks/:filename', requireAuth, async (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
  try {
    await supabase.storage.from(SUPABASE_BUCKET).remove([filename]);
    await supabase.from('episodes').delete().eq('filename', filename);
    res.json({ success: true });
  } catch (e) {
    console.error('Delete error:', e.message);
    res.status(500).json({ error: 'Xóa thất bại: ' + e.message });
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
