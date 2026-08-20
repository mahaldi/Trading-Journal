/* ══════════════════════════════════════════════════════════════
   Konversi screenshot lama (PNG/JPEG) ke WebP, sekali jalan.

     node scripts/compress-existing.js --dry-run   lihat dulu, tanpa mengubah
     node scripts/compress-existing.js             jalankan sungguhan

   Urutan kerjanya sengaja hati-hati:
     1. trades.json dicadangkan lebih dulu
     2. gambar asli DIPINDAH ke data/images-original-<tanggal>/, bukan dihapus
     3. rujukan di trades.json baru diperbarui setelah semua file baru ditulis

   Jadi kalau ada yang meleset, aslinya masih utuh dan bisa dikembalikan.
   ══════════════════════════════════════════════════════════════ */

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
const QUALITY = Number(process.env.WEBP_QUALITY) || 82

const DRY = process.argv.includes('--dry-run')
const kb = (b) => `${Math.round(b / 1024)} KB`
const mb = (b) => `${(b / 1048576).toFixed(2)} MB`

const toArr = (v) => (Array.isArray(v) ? v.filter(Boolean) : v ? [v] : [])

async function main() {
  if (!fsSync.existsSync(TRADES_FILE)) {
    console.error(`Tidak menemukan ${TRADES_FILE}`)
    process.exit(1)
  }

  const trades = JSON.parse(await fs.readFile(TRADES_FILE, 'utf8'))

  // Kumpulkan tiap gambar yang benar-benar dirujuk sebuah trade
  const refs = []
  for (const t of trades) {
    for (const slot of ['setup', 'result']) {
      toArr(t.shots?.[slot]).forEach((shot, i) => {
        if (shot?.id) refs.push({ trade: t, slot, i, shot })
      })
    }
  }

  const candidates = refs.filter((r) => /\.(png|jpe?g|avif)$/i.test(r.shot.id))

  console.log(`\n  ${refs.length} gambar dirujuk · ${candidates.length} bisa dikompres`)
  if (DRY) console.log('  MODE COBA — tidak ada file yang diubah\n')
  else console.log('')

  if (!candidates.length) {
    console.log('  Semua gambar sudah efisien. Tidak ada yang perlu dikerjakan.\n')
    return
  }

  // 1 · cadangkan trades.json
  const tag = new Date().toISOString().slice(0, 10)
  const backupFile = path.join(DATA_DIR, `trades.backup-${tag}.json`)
  const originalsDir = path.join(DATA_DIR, `images-original-${tag}`)
  if (!DRY) {
    await fs.copyFile(TRADES_FILE, backupFile)
    await fs.mkdir(originalsDir, { recursive: true })
    console.log(`  Cadangan: ${path.relative(ROOT, backupFile)}\n`)
  }

  let before = 0
  let after = 0
  let converted = 0
  let skipped = 0

  for (const ref of candidates) {
    const srcPath = path.join(IMAGES_DIR, ref.shot.id)
    if (!fsSync.existsSync(srcPath)) {
      console.log(`  ⚠ hilang, dilewati: ${ref.shot.id}`)
      skipped++
      continue
    }

    const buf = await fs.readFile(srcPath)
    let out
    let meta
    try {
      meta = await sharp(buf).metadata()
      out = await sharp(buf).webp({ quality: QUALITY, effort: 4 }).toBuffer()
    } catch (err) {
      console.log(`  ⚠ gagal dibaca, dilewati: ${ref.shot.id} (${err.message})`)
      skipped++
      continue
    }

    if (out.length >= buf.length) {
      console.log(`  = sudah efisien, dilewati: ${ref.shot.id}`)
      skipped++
      continue
    }

    const newId = ref.shot.id.replace(/\.[A-Za-z0-9]+$/, '') + '.webp'
    before += buf.length
    after += out.length
    converted++

    console.log(
      `  ${ref.shot.id.slice(0, 22).padEnd(24)} ${kb(buf.length).padStart(7)} → ${kb(out.length).padStart(6)}` +
      `  (hemat ${String(Math.round((1 - out.length / buf.length) * 100)).padStart(2)}%)`
    )

    if (DRY) continue

    // 2 · tulis yang baru, pindahkan yang asli
    await fs.writeFile(path.join(IMAGES_DIR, newId), out)
    await fs.rename(srcPath, path.join(originalsDir, ref.shot.id))

    // 3 · perbarui rujukan (objek shot diubah di tempat, ikut ke trades)
    ref.shot.id = newId
    ref.shot.name = (ref.shot.name || newId).replace(/\.[A-Za-z0-9]+$/, '') + '.webp'
    ref.shot.size = out.length
    ref.shot.type = 'image/webp'
    ref.shot.url = `/api/images/${newId}`
    if (meta?.width) { ref.shot.width = meta.width; ref.shot.height = meta.height }
  }

  if (!DRY && converted) {
    // Pastikan bentuk shots ikut ternormalkan ke array saat menyimpan
    for (const t of trades) {
      t.shots = { setup: toArr(t.shots?.setup), result: toArr(t.shots?.result) }
    }
    const tmp = `${TRADES_FILE}.tmp`
    await fs.writeFile(tmp, JSON.stringify(trades, null, 2), 'utf8')
    await fs.rename(tmp, TRADES_FILE)
  }

  console.log('')
  console.log(`  Dikonversi : ${converted}${skipped ? ` · dilewati ${skipped}` : ''}`)
  if (converted) {
    console.log(`  Sebelum    : ${mb(before)}`)
    console.log(`  Sesudah    : ${mb(after)}  (hemat ${Math.round((1 - after / before) * 100)}%)`)
  }
  if (DRY) {
    console.log('\n  Jalankan tanpa --dry-run untuk menerapkannya.\n')
  } else if (converted) {
    console.log(`\n  File asli disimpan di ${path.relative(ROOT, originalsDir)}/`)
    console.log('  Buka app dan periksa gambarnya. Kalau semua beres, folder itu boleh dihapus.\n')
  }
}

main().catch((err) => {
  console.error('\n  Gagal:', err.message, '\n')
  process.exit(1)
})
