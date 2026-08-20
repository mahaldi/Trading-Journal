/* ══════════════════════════════════════════════════════════════
   Server jurnal — satu-satunya bagian yang menyentuh disk.

   Semua data hidup sebagai file biasa di folder ./data:
     data/trades.json        seluruh trade, JSON rapi (bisa dibuka & diedit)
     data/images/<id>.png    tiap screenshot sebagai file gambar tersendiri

   Tidak ada database, tidak ada localStorage. Salin folder data/ =
   backup lengkap; buka trades.json dengan editor teks = lihat semuanya.
   ══════════════════════════════════════════════════════════════ */

import express from 'express'
import multer from 'multer'
import sharp from 'sharp'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data')
const IMAGES_DIR = path.join(DATA_DIR, 'images')
const TRADES_FILE = path.join(DATA_DIR, 'trades.json')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
const PORT = Number(process.env.PORT) || 5174

const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'])
const EXT_BY_TYPE = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
  'image/gif': '.gif', 'image/avif': '.avif',
}

/* ── kompresi ──
   Screenshot chart datang sebagai PNG retina: lossless, dan boros. WebP q82
   memangkasnya sekitar 77% tanpa perbedaan yang terlihat pada teks harga
   maupun garis grid — diukur langsung dari screenshot TradingView.
   Set WEBP_QUALITY=100 untuk lossless, atau COMPRESS=off untuk mematikan. */
const COMPRESS = process.env.COMPRESS !== 'off'
const WEBP_QUALITY = Number(process.env.WEBP_QUALITY) || 82
// GIF dilewati: bisa animasi, dan mengubahnya jadi WebP diam akan merusaknya.
const COMPRESSIBLE = new Set(['image/png', 'image/jpeg', 'image/avif'])

/**
 * Ubah gambar ke WebP bila menguntungkan.
 * Mengembalikan { buffer, type, ext, width, height, originalSize }.
 * Bila kompresi gagal atau justru membesar, berkas asli dipakai apa adanya —
 * menyimpan screenshot lebih penting daripada menghemat byte.
 */
async function compressImage(buffer, mimetype) {
  const original = { buffer, type: mimetype, ext: EXT_BY_TYPE[mimetype] || '.png', originalSize: buffer.length }
  let meta = {}
  try {
    meta = await sharp(buffer).metadata()
  } catch {
    return original
  }
  original.width = meta.width
  original.height = meta.height

  if (!COMPRESS || !COMPRESSIBLE.has(mimetype)) return original

  try {
    const out = await sharp(buffer)
      .webp({ quality: WEBP_QUALITY, effort: 4 })
      .toBuffer()
    if (out.length >= buffer.length) return original // sudah efisien, jangan diperbesar
    return {
      buffer: out, type: 'image/webp', ext: '.webp',
      width: meta.width, height: meta.height, originalSize: buffer.length,
    }
  } catch (err) {
    console.warn('[server] kompresi dilewati:', err.message)
    return original
  }
}

/* ─────────────────────────── util file ─────────────────────────── */

async function ensureDirs() {
  await fs.mkdir(IMAGES_DIR, { recursive: true })
  if (!fsSync.existsSync(TRADES_FILE)) {
    await writeJSONAtomic(TRADES_FILE, [])
    console.log('  dibuat:', path.relative(ROOT, TRADES_FILE))
  }
  if (!fsSync.existsSync(SETTINGS_FILE)) {
    await writeJSONAtomic(SETTINGS_FILE, { startingBalance: 10000 })
  }
}

/**
 * Tulis lewat file sementara lalu rename. Rename bersifat atomik di
 * filesystem, jadi trades.json tidak pernah tertinggal separuh tertulis
 * kalau proses mati di tengah penyimpanan.
 */
async function writeJSONAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await fs.rename(tmp, file)
}

async function readJSON(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`[server] gagal membaca ${path.basename(file)}:`, err.message)
    return fallback
  }
}

/** Cegah path traversal: hanya nama file polos yang diterima. */
function safeImageName(name) {
  const base = path.basename(String(name || ''))
  return /^[A-Za-z0-9._-]+$/.test(base) && base !== '.' && base !== '..' ? base : null
}

/* ─────────────────────────── app ─────────────────────────── */

const app = express()
// trades.json hanya berisi teks + metadata gambar (bukan gambarnya), tapi
// jurnal bertahun-tahun dengan banyak screenshot per trade tetap bisa
// menembus batas bawaan 100kb — 50mb memberi ruang puluhan ribu trade.
app.use(express.json({ limit: '50mb' }))

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB per screenshot
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES.has(file.mimetype)) cb(null, true)
    else cb(new Error(`Tipe file tidak didukung: ${file.mimetype}`))
  },
})

/* ── trades ── */

app.get('/api/trades', async (_req, res) => {
  const trades = await readJSON(TRADES_FILE, [])
  res.json(Array.isArray(trades) ? trades : [])
})

app.put('/api/trades', async (req, res) => {
  if (!Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Body harus berupa array trade' })
  }
  try {
    await writeJSONAtomic(TRADES_FILE, req.body)
    res.json({ ok: true, count: req.body.length, file: path.relative(ROOT, TRADES_FILE) })
  } catch (err) {
    console.error('[server] gagal menyimpan trades:', err)
    res.status(500).json({ error: err.message })
  }
})

/* ── settings ── */

app.get('/api/settings', async (_req, res) => {
  res.json(await readJSON(SETTINGS_FILE, { startingBalance: 10000 }))
})

app.put('/api/settings', async (req, res) => {
  try {
    await writeJSONAtomic(SETTINGS_FILE, req.body || {})
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/* ── images ── */

app.post('/api/images', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Tidak ada file yang diunggah' })
  try {
    const img = await compressImage(req.file.buffer, req.file.mimetype)
    const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}${img.ext}`
    await fs.writeFile(path.join(IMAGES_DIR, id), img.buffer)

    const saved = img.originalSize - img.buffer.length
    if (saved > 0) {
      console.log(
        `  ${id}  ${kb(img.originalSize)} → ${kb(img.buffer.length)}` +
        `  (hemat ${Math.round((saved / img.originalSize) * 100)}%)`
      )
    }

    res.json({
      id,
      // Nama asli dipertahankan agar tetap dikenali pengguna, dengan
      // akhiran disesuaikan ke format yang benar-benar tersimpan.
      name: renameExt(req.file.originalname || id, img.ext),
      size: img.buffer.length,
      originalSize: img.originalSize,
      width: img.width,
      height: img.height,
      type: img.type,
      url: `/api/images/${id}`,
    })
  } catch (err) {
    console.error('[server] gagal menyimpan gambar:', err)
    res.status(500).json({ error: err.message })
  }
})

const kb = (b) => `${Math.round(b / 1024)} KB`

function renameExt(name, ext) {
  const base = name.replace(/\.[A-Za-z0-9]+$/, '')
  return base + ext
}

app.get('/api/images/:id', (req, res) => {
  const name = safeImageName(req.params.id)
  if (!name) return res.status(400).end()
  const file = path.join(IMAGES_DIR, name)
  if (!fsSync.existsSync(file)) return res.status(404).end()
  res.sendFile(file)
})

app.delete('/api/images/:id', async (req, res) => {
  const name = safeImageName(req.params.id)
  if (!name) return res.status(400).end()
  try {
    await fs.unlink(path.join(IMAGES_DIR, name))
  } catch (err) {
    if (err.code !== 'ENOENT') return res.status(500).json({ error: err.message })
  }
  res.json({ ok: true })
})

/** Buang gambar yatim — tidak lagi dirujuk trade manapun. */
app.post('/api/images/prune', async (_req, res) => {
  try {
    const trades = await readJSON(TRADES_FILE, [])
    const used = new Set()
    for (const t of trades) {
      for (const slot of ['setup', 'result']) {
        // Tiap grup kini berisi banyak gambar; data lama menyimpan satu
        // objek saja, jadi kedua bentuk diterima.
        const v = t.shots?.[slot]
        const list = Array.isArray(v) ? v : v ? [v] : []
        for (const shot of list) if (shot?.id) used.add(shot.id)
      }
    }
    const files = await fs.readdir(IMAGES_DIR)
    const orphans = files.filter((f) => !used.has(f) && !f.endsWith('.tmp'))
    for (const f of orphans) await fs.unlink(path.join(IMAGES_DIR, f))
    res.json({ removed: orphans.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/* ── status: dipakai UI untuk menampilkan lokasi file sebenarnya ── */

app.get('/api/status', async (_req, res) => {
  const trades = await readJSON(TRADES_FILE, [])
  let imageCount = 0
  let imageBytes = 0
  try {
    const files = await fs.readdir(IMAGES_DIR)
    imageCount = files.length
    for (const f of files) {
      const st = await fs.stat(path.join(IMAGES_DIR, f))
      imageBytes += st.size
    }
  } catch {}
  res.json({
    dataDir: DATA_DIR,
    tradesFile: TRADES_FILE,
    imagesDir: IMAGES_DIR,
    tradeCount: Array.isArray(trades) ? trades.length : 0,
    imageCount,
    imageBytes,
    compress: COMPRESS,
    webpQuality: WEBP_QUALITY,
  })
})

/* ── build produksi disajikan langsung oleh server ini ── */

const DIST = path.join(ROOT, 'dist')
if (fsSync.existsSync(DIST)) {
  app.use(express.static(DIST))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next()
    res.sendFile(path.join(DIST, 'index.html'))
  })
}

/* ── penanganan galat terakhir (mis. file terlalu besar) ── */

app.use((err, _req, res, _next) => {
  console.error('[server]', err.message)
  res.status(err.status || 500).json({ error: err.message })
})

await ensureDirs()
app.listen(PORT, () => {
  console.log(`\n  Server jurnal siap di http://localhost:${PORT}`)
  console.log(`  Data  : ${path.relative(ROOT, TRADES_FILE)}`)
  console.log(`  Gambar: ${path.relative(ROOT, IMAGES_DIR)}/`)
  console.log(`  Kompresi: ${COMPRESS ? `WebP q${WEBP_QUALITY}` : 'mati'}\n`)
})
