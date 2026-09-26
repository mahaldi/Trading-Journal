/* ══════════════════════════════════════════════════════════════
   Pembaca .xlsx minimal — tanpa library, tanpa server.

   File .xlsx adalah arsip ZIP berisi XML. Yang dibutuhkan sync hanya
   sel-sel di lembar pertama, jadi cukup:
     1. baca central directory ZIP (ukuran file ada di sana, bukan di
        local header — ekspor Binance memakai data descriptor),
     2. inflate entri dengan DecompressionStream bawaan browser/Node,
     3. ambil nilai sel dari XML lembar kerja.

   File tidak pernah dikirim ke mana pun dan tidak disimpan.
   ══════════════════════════════════════════════════════════════ */

const SIG_EOCD = 0x06054b50
const SIG_CEN = 0x02014b50
const SIG_LOC = 0x04034b50

/** Daftar entri ZIP: { name, method, compSize, size, offset } */
function zipEntries(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  // EOCD ada di 22 byte terakhir (+ komentar opsional ≤ 64 KB).
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === SIG_EOCD) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('bukan arsip zip')
  const count = view.getUint16(eocd + 10, true)
  let p = view.getUint32(eocd + 16, true)
  const dec = new TextDecoder()
  const out = []
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== SIG_CEN) throw new Error('central directory rusak')
    const method = view.getUint16(p + 10, true)
    const compSize = view.getUint32(p + 20, true)
    const size = view.getUint32(p + 24, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const offset = view.getUint32(p + 42, true)
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen))
    out.push({ name, method, compSize, size, offset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function readEntry(buf, entry) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const p = entry.offset
  if (view.getUint32(p, true) !== SIG_LOC) throw new Error('local header rusak')
  const start = p + 30 + view.getUint16(p + 26, true) + view.getUint16(p + 28, true)
  const data = buf.subarray(start, start + entry.compSize)
  if (entry.method === 0) return data
  if (entry.method === 8) return inflateRaw(data)
  throw new Error(`metode kompresi ${entry.method} tidak didukung`)
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
function unescapeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e] ?? m
  })
}

/** Gabungkan semua <t>…</t> di dalam satu potongan XML (rich text dipecah jadi beberapa run). */
function textRuns(xml) {
  let s = ''
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g
  let m
  while ((m = re.exec(xml))) s += m[1]
  return unescapeXml(s)
}

/** 'C' → 2, 'AA' → 26 */
function colIndex(ref) {
  const letters = /^[A-Z]+/.exec(ref)?.[0] || 'A'
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/**
 * Baca lembar pertama sebuah .xlsx menjadi array baris; tiap baris adalah
 * array string yang diindeks per kolom (sel kosong = '').
 * Semua nilai dikembalikan sebagai teks apa adanya — angka tidak diubah ke
 * float supaya digit desimal harga tidak hilang.
 */
export async function readXlsxRows(input) {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input)
  const entries = zipEntries(buf)
  const byName = new Map(entries.map((e) => [e.name.replace(/^\/+/, ''), e]))
  const dec = new TextDecoder()
  const text = async (name) => (byName.has(name) ? dec.decode(await readEntry(buf, byName.get(name))) : null)

  // Lembar pertama menurut workbook.xml → rels; fallback ke sheet1.xml.
  let sheetPath = 'xl/worksheets/sheet1.xml'
  const wb = await text('xl/workbook.xml')
  const rels = await text('xl/_rels/workbook.xml.rels')
  if (wb && rels) {
    const rid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(wb)?.[1]
    if (rid) {
      const rel = new RegExp(`<Relationship\\b[^>]*\\bId="${rid}"[^>]*>`).exec(rels)?.[0]
      const target = rel && /\bTarget="([^"]+)"/.exec(rel)?.[1]
      if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
    }
  }
  const sheet = await text(sheetPath)
  if (!sheet) throw new Error('lembar kerja tidak ditemukan')

  const shared = []
  const sst = await text('xl/sharedStrings.xml')
  if (sst) {
    const re = /<si>([\s\S]*?)<\/si>/g
    let m
    while ((m = re.exec(sst))) shared.push(textRuns(m[1]))
  }

  const rows = []
  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g
  let rm
  while ((rm = rowRe.exec(sheet))) {
    const rNum = Number(/\br="(\d+)"/.exec(rm[1])?.[1]) || rows.length + 1
    const row = []
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
    let cm
    while ((cm = cellRe.exec(rm[2]))) {
      const attrs = cm[1]
      const body = cm[2] || ''
      const ref = /\br="([A-Z]+)\d*"/.exec(attrs)?.[1]
      const idx = ref ? colIndex(ref) : row.length
      const type = /\bt="(\w+)"/.exec(attrs)?.[1]
      let v = ''
      if (type === 'inlineStr') v = textRuns(body)
      else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
        if (raw != null) v = type === 's' ? shared[Number(raw)] ?? '' : unescapeXml(raw)
      }
      row[idx] = v
    }
    for (let i = 0; i < row.length; i++) if (row[i] == null) row[i] = ''
    rows[rNum - 1] = row
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = []
  return rows
}
