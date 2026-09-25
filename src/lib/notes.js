/* ══════════════════════════════════════════════════════════════
   Catatan — model data & helper murni (tanpa React), bisa dites di Node.

   Satu catatan = dokumen mengalir berisi blok:
     text       paragraf bebas; boleh berisi @mention
     heading    judul bagian kecil (dipakai template)
     phase      blok fase event: sebelum · saat · sesudah
     image      gambar + nama (pegangan @mention) + keterangan
     checklist  daftar yang bisa dicoret

   @mention di dalam teks disimpan apa adanya sebagai teks biasa:
     @retest-2110        → gambar bernama "retest-2110" di catatan yang sama
     @t_msxdw151_bydsf   → trade dengan id itu
   Jadi notes.json tetap terbaca dengan editor teks.
   ══════════════════════════════════════════════════════════════ */

import { closedTrades, deriveTrade, effectiveDate, summarize } from './calc.js'
import { money, pct, shortDate } from './format.js'

export const NOTE_TYPES = [
  { key: 'free', label: 'Bebas', full: 'Catatan bebas', color: 'var(--color-neutral-500)',
    outline: ['— kosong —'], hint: 'Judul dan kursor. Yang muncul bila + Catatan ditekan tanpa memilih jenis.' },
  { key: 'lesson', label: 'Lesson', full: 'Lesson learned', color: 'var(--color-loss)',
    outline: ['Apa yang terjadi', 'Kenapa saya lakukan', 'Aturan untuk lain kali'],
    hint: 'Untuk loss maupun peluang yang terlewat — bedanya di tag, bukan di template.' },
  { key: 'event', label: 'Event', full: 'Event log', color: 'var(--color-accent)',
    outline: ['Nama & jam event', 'Blok fase ×3', 'Pelajaran'],
    hint: 'Satu-satunya template yang menyisipkan blok terstruktur sejak awal.' },
  { key: 'review', label: 'Review', full: 'Review', color: 'var(--color-neutral-500)',
    outline: ['Ringkasan periode', 'Yang berjalan baik', 'Yang diperbaiki', 'Fokus periode depan'],
    hint: 'Ringkasan 7 hari terakhir terisi otomatis: jumlah trade, R total, win rate.' },
  { key: 'idea', label: 'Ide', full: 'Ide & watchlist', color: 'var(--color-neutral-500)',
    outline: ['Checklist pair', 'Level yang diawasi'],
    hint: 'Satu-satunya template dengan checklist, karena isinya memang untuk dicoret.' },
]

export const typeOf = (key) => NOTE_TYPES.find((t) => t.key === key) || NOTE_TYPES[0]

/* ─────────────────────────── id & tanggal ─────────────────────────── */

export function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export function localISODate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Nomor minggu ISO-8601. */
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
}

/* ─────────────────────────── blok ─────────────────────────── */

export const textBlock = (text = '') => ({ id: uid('b'), kind: 'text', text })
export const headingBlock = (text = '') => ({ id: uid('b'), kind: 'heading', text })
export const phaseRow = (label = '', offset = '') => ({ id: uid('r'), label, offset, text: '' })
export const phaseBlock = () => ({
  id: uid('b'), kind: 'phase', event: '', time: '',
  rows: [phaseRow('Sebelum', '−45m'), phaseRow('Saat', ''), phaseRow('Sesudah', '+2j')],
})
export const checkItem = (text = '') => ({ id: uid('c'), text, done: false })
export const checklistBlock = () => ({ id: uid('b'), kind: 'checklist', items: [checkItem()] })
export const imageBlock = (image) => ({ id: uid('b'), kind: 'image', image, name: '', caption: '' })

export function templateBlocks(type) {
  const t = textBlock
  const h = headingBlock
  switch (type) {
    case 'lesson':
      return [h('Apa yang terjadi'), t(), h('Kenapa saya lakukan'), t(), h('Aturan untuk lain kali'), t()]
    case 'event':
      return [t(), phaseBlock(), h('Pelajaran'), t()]
    case 'review':
      return [h('Ringkasan periode'), t(), h('Yang berjalan baik'), t(), h('Yang diperbaiki'), t(), h('Fokus periode depan'), t()]
    case 'idea':
      return [h('Checklist pair'), checklistBlock(), h('Level yang diawasi'), t()]
    default:
      return [t()]
  }
}

/**
 * Catatan baru dari template. Template hanya titik awal: setelah dibuat,
 * semua blok bisa diubah/dihapus dan jenis bisa diganti tanpa kehilangan isi.
 */
export function blankNote(type = 'free', { trades = [], now = new Date() } = {}) {
  const iso = now.toISOString()
  const note = {
    id: uid('n'),
    type: typeOf(type).key,
    title: '',
    tags: [],
    date: localISODate(now),
    createdAt: iso,
    updatedAt: iso,
    tradeIds: [],
    blocks: templateBlocks(type),
  }
  if (note.type === 'review') {
    const r = reviewSummary(trades, now)
    note.title = r.title
    note.blocks[1].text = r.text
    note.tradeIds = r.tradeIds
  }
  return note
}

/** Ringkasan periode untuk template Review — diambil dari angka Statistik. */
export function reviewSummary(trades, now = new Date(), days = 7) {
  const end = localISODate(now)
  const startD = new Date(now)
  startD.setDate(startD.getDate() - (days - 1))
  const start = localISODate(startD)
  const inRange = closedTrades(trades).filter((t) => {
    const d = effectiveDate(t)
    return d >= start && d <= end
  })
  const s = summarize(inRange)
  const totalR = inRange.reduce((acc, t) => acc + (deriveTrade(t).actualR ?? 0), 0)
  const rShort = `${totalR < 0 ? '−' : totalR > 0 ? '+' : ''}${Math.abs(totalR).toFixed(1)}R`
  const range = `${shortDate(start)} – ${shortDate(end)}`
  const text = s.total
    ? `${range}: ${s.total} trade ditutup · total ${rShort} · win rate ${pct(s.winRate)} · net ${money(s.netPnl)}.`
    : `${range}: belum ada trade yang ditutup.`
  return {
    title: `Minggu ${isoWeek(now)} — ${s.total} trade${s.total ? `, ${rShort}` : ''}`,
    text,
    tradeIds: inRange.map((t) => t.id),
  }
}

/* ─────────────────────────── nama gambar ─────────────────────────── */

/** "Retest 21:10" → "retest-2110". Nama inilah yang dipakai di @mention. */
export function slugifyName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
}

export const imageBlocks = (note) => (note?.blocks || []).filter((b) => b.kind === 'image')

/** Pastikan nama gambar unik di dalam satu catatan: retest, retest-2, retest-3… */
export function uniqueImageName(note, name, exceptBlockId) {
  if (!name) return ''
  const taken = new Set(
    imageBlocks(note).filter((b) => b.id !== exceptBlockId && b.name).map((b) => b.name.toLowerCase())
  )
  if (!taken.has(name.toLowerCase())) return name
  let i = 2
  while (taken.has(`${name}-${i}`.toLowerCase())) i++
  return `${name}-${i}`
}

/* ─────────────────────────── @mention ─────────────────────────── */

// "@" harus di awal atau setelah karakter non-kata (bukan email seperti a@b.c).
const MENTION_RE = /(^|[^A-Za-z0-9_@])@([A-Za-z0-9][A-Za-z0-9._-]*)/g
const cleanHandle = (raw) => raw.replace(/[._-]+$/, '')

/** Semua string yang boleh berisi mention: paragraf & isi blok fase. */
export function* mentionTexts(note) {
  for (const b of note?.blocks || []) {
    if (b.kind === 'text') yield b.text || ''
    else if (b.kind === 'phase') for (const r of b.rows || []) yield r.text || ''
  }
}

/** Semua handle yang diketik di catatan, tanpa peduli bisa di-resolve atau tidak. */
export function mentionedHandles(note) {
  const out = []
  for (const text of mentionTexts(note)) {
    for (const m of text.matchAll(MENTION_RE)) {
      const h = cleanHandle(m[2])
      if (h) out.push(h)
    }
  }
  return out
}

/**
 * Pecah teks jadi potongan teks biasa & mention. `resolve(handle)` mengembalikan
 * target atau null — handle yang tidak dikenal tetap tampil sebagai teks biasa.
 * `start` adalah posisi di teks mentah, dipakai untuk memetakan klik ke posisi kursor.
 */
export function tokenize(text, resolve) {
  const out = []
  let last = 0
  for (const m of String(text || '').matchAll(MENTION_RE)) {
    const handle = cleanHandle(m[2])
    if (!handle) continue
    const target = resolve(handle)
    if (!target) continue
    const at = m.index + m[1].length
    if (at > last) out.push({ type: 'text', text: text.slice(last, at), start: last })
    const raw = '@' + handle
    out.push({ type: 'mention', handle, raw, start: at, target })
    last = at + raw.length
  }
  if (last < String(text || '').length) out.push({ type: 'text', text: text.slice(last), start: last })
  return out
}

/** Resolver untuk satu catatan: trade dulu (id unik), lalu gambar di catatan itu. */
export function makeResolver(note, tradesById) {
  const images = new Map()
  imageBlocks(note).forEach((b, i) => {
    if (b.name) images.set(b.name.toLowerCase(), { kind: 'image', name: b.name, blockId: b.id, index: i + 1, image: b.image, caption: b.caption })
  })
  return (handle) => {
    const trade = tradesById?.get(handle)
    if (trade) return { kind: 'trade', trade }
    return images.get(handle.toLowerCase()) || null
  }
}

/** Berapa kali sebuah gambar dirujuk di catatannya sendiri. */
export function countMentions(note, name) {
  if (!name) return 0
  const key = name.toLowerCase()
  return mentionedHandles(note).filter((h) => h.toLowerCase() === key).length
}

function replaceHandle(text, from, to) {
  const key = from.toLowerCase()
  return String(text || '').replace(MENTION_RE, (all, pre, raw) => {
    const h = cleanHandle(raw)
    if (h.toLowerCase() !== key) return all
    return `${pre}@${to}${raw.slice(h.length)}`
  })
}

/** Ganti nama gambar → semua rujukan @lama ikut berubah, supaya tidak ada yang patah. */
export function renameMentions(note, from, to) {
  if (!from || !to || from === to) return note
  return {
    ...note,
    blocks: note.blocks.map((b) => {
      if (b.kind === 'text') return { ...b, text: replaceHandle(b.text, from, to) }
      if (b.kind === 'phase') return { ...b, rows: b.rows.map((r) => ({ ...r, text: replaceHandle(r.text, from, to) })) }
      return b
    }),
  }
}

/**
 * Trade tertaut = yang ditautkan manual + yang disebut lewat @mention.
 * Hanya id yang masih ada di jurnal bila `tradesById` diberikan.
 */
export function linkedTradeIds(note, tradesById) {
  const ids = new Set(note?.tradeIds || [])
  for (const h of mentionedHandles(note)) if (/^t_/.test(h)) ids.add(h)
  const list = [...ids]
  return tradesById ? list.filter((id) => tradesById.has(id)) : list
}

export function mentionedTradeIds(note) {
  return new Set(mentionedHandles(note).filter((h) => /^t_/.test(h)))
}

/* ─────────────────────────── daftar & pencarian ─────────────────────────── */

export function tradeLabel(t, { tag = true } = {}) {
  if (!t) return ''
  const arrow = t.direction === 'short' ? '▼' : '▲'
  const first = tag && t.tags?.[0] ? ` · ${t.tags[0]}` : ''
  return `${t.pair || '—'} ${arrow}${t.timeframe ? ` ${t.timeframe}` : ''}${first}`
}

/** Satu baris cuplikan: paragraf pertama yang berisi, mention diganti label yang terbaca. */
export function noteSnippet(note, tradesById) {
  for (const text of mentionTexts(note)) {
    const clean = text.replace(MENTION_RE, (all, pre, raw) => {
      const h = cleanHandle(raw)
      const t = tradesById?.get(h)
      return `${pre}${t ? `${t.pair}` : h}${raw.slice(h.length)}`
    }).replace(/\s+/g, ' ').trim()
    if (clean) return clean.slice(0, 160)
  }
  for (const b of note?.blocks || []) {
    if (b.kind === 'checklist') {
      const first = b.items.find((i) => i.text.trim())
      if (first) return first.text.trim().slice(0, 160)
    }
  }
  return ''
}

function haystack(note) {
  const parts = [note.title, ...(note.tags || []), typeOf(note.type).label]
  for (const b of note.blocks || []) {
    if (b.kind === 'text' || b.kind === 'heading') parts.push(b.text)
    else if (b.kind === 'phase') { parts.push(b.event, b.time); for (const r of b.rows) parts.push(r.label, r.text) }
    else if (b.kind === 'image') parts.push(b.name, b.caption)
    else if (b.kind === 'checklist') for (const i of b.items) parts.push(i.text)
  }
  return parts.filter(Boolean).join('\n').toLowerCase()
}

/** Cari di judul, tag, isi, dan nama gambar — jadi "retest-2110" ketemu tanpa ingat catatannya. */
export function noteMatches(note, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return true
  const hay = haystack(note)
  return q.split(/\s+/).every((w) => hay.includes(w.replace(/^[#@]/, '')))
}

const byNewest = (a, b) =>
  (b.date || '').localeCompare(a.date || '') || String(b.createdAt || '').localeCompare(String(a.createdAt || ''))

/* ─────────────────────────── pin & urutan manual ───────────────────────────
   Dua field opsional di notes.json, keduanya angka "peringkat" (besar = atas):
     pinnedAt / pinOrder  catatan disematkan. pinOrder awal = waktu pin, jadi
                          yang paling terakhir disematkan otomatis di paling atas.
     order                urutan manual catatan biasa (tidak disematkan).
   Tanpa `order`, peringkat diturunkan dari tanggal + jam dibuat — urutan lama
   (terbaru di atas) tetap sama sampai pengguna menyeret sesuatu.
   Menyeret hanya menulis satu angka: titik tengah antara dua tetangganya. */

export const isPinned = (n) => !!n?.pinnedAt

const DAY = 86400000

/** Peringkat catatan biasa. */
export function noteRank(n) {
  if (Number.isFinite(n.order)) return n.order
  const created = Date.parse(n.createdAt || '') || 0
  const day = Date.parse(`${n.date || ''}T00:00:00Z`)
  if (!Number.isFinite(day)) return created
  return day + (((created % DAY) + DAY) % DAY)
}

/** Peringkat di antara catatan yang disematkan. */
export function pinRank(n) {
  if (Number.isFinite(n.pinOrder)) return n.pinOrder
  return Date.parse(n.pinnedAt || '') || 0
}

const byRank = (rank) => (a, b) =>
  rank(b) - rank(a) || String(b.createdAt || '').localeCompare(String(a.createdAt || ''))

/** Sematkan / lepas. Melepas mengembalikan catatan ke posisi lamanya di daftar biasa. */
export function togglePin(note, notes = [], now = new Date()) {
  if (isPinned(note)) {
    const { pinnedAt, pinOrder, ...rest } = note
    return rest
  }
  // Selalu di atas semua yang sudah disematkan, walau urutannya pernah diseret.
  const top = Math.max(now.getTime(), ...notes.filter(isPinned).map((n) => pinRank(n) + 1))
  return { ...note, pinnedAt: now.toISOString(), pinOrder: top }
}

/**
 * Peringkat baru untuk catatan yang diseret ke `index` di `list` (urutan tampil,
 * atas → bawah, TANPA catatan yang diseret). Mengembalikan angka, atau null bila
 * tidak ada perubahan. `rank` = noteRank atau pinRank.
 */
export function rankAt(list, index, rank) {
  const above = index > 0 ? rank(list[index - 1]) : null
  const below = index < list.length ? rank(list[index]) : null
  if (above == null && below == null) return null
  if (above == null) return below + 60000
  if (below == null) return above - 60000
  return (above + below) / 2
}

/**
 * Pindahkan `dragId` ke posisi sebelum/sesudah `targetId` di dalam satu zona
 * (daftar yang disematkan, atau daftar biasa — urutan lengkap, bukan yang tersaring).
 * Mengembalikan daftar patch [{ id, field, value }] — biasanya satu — atau [] bila
 * tidak ada yang berubah. Catatan tidak bisa pindah zona: target di luar zona ditolak.
 */
export function moveWithin(zoneList, dragId, targetId, place, { pinned = false } = {}) {
  const rank = pinned ? pinRank : noteRank
  const field = pinned ? 'pinOrder' : 'order'
  const from = zoneList.findIndex((n) => n.id === dragId)
  if (from === -1 || dragId === targetId) return []
  if (!zoneList.some((n) => n.id === targetId)) return []
  const rest = zoneList.filter((n) => n.id !== dragId)
  const t = rest.findIndex((n) => n.id === targetId)
  const index = place === 'after' ? t + 1 : t
  // Tidak bergeser → tidak menulis apa pun.
  const orderBefore = zoneList.map((n) => n.id)
  const orderAfter = [...rest.slice(0, index).map((n) => n.id), dragId, ...rest.slice(index).map((n) => n.id)]
  if (orderBefore.join() === orderAfter.join()) return []
  const value = rankAt(rest, index, rank)
  const above = index > 0 ? rank(rest[index - 1]) : null
  const below = index < rest.length ? rank(rest[index]) : null
  const fits = value != null && (above == null || value < above) && (below == null || value > below)
  if (fits) return [{ id: dragId, field, value }]
  // Celah habis (diseret puluhan kali ke titik yang sama) atau dua tetangga
  // berperingkat sama → beri ulang peringkat seluruh zona dengan jarak rata.
  const top = Math.max(...zoneList.map(rank))
  return orderAfter.map((id, i) => ({ id, field, value: top - i * 60000 }))
}

/**
 * Susunan daftar: yang disematkan di atas, lalu satu daftar datar catatan biasa.
 * Tidak dikelompokkan per bulan — tanggal tetap tampil di tiap baris.
 */
export function arrangeNotes(notes) {
  const pinned = notes.filter(isPinned).sort(byRank(pinRank))
  const others = notes.filter((n) => !isPinned(n)).sort(byRank(noteRank))
  return { pinned, others }
}

export const sortNotes = (notes) => [...notes].sort(byNewest)

/** tradeId → catatan yang menautkannya (dua arah: dipakai di detail trade). */
export function notesByTrade(notes) {
  const map = new Map()
  for (const n of sortNotes(notes)) {
    for (const id of linkedTradeIds(n)) {
      if (!map.has(id)) map.set(id, [])
      map.get(id).push(n)
    }
  }
  return map
}

/** 'YYYY-MM-DD' → catatan pada hari itu (dipakai titik aksen di Kalender). */
export function notesByDate(notes) {
  const map = new Map()
  for (const n of notes) {
    if (!n.date) continue
    if (!map.has(n.date)) map.set(n.date, [])
    map.get(n.date).push(n)
  }
  return map
}

/** Id gambar yang dipakai semua catatan — agar prune tidak menghapusnya. */
export function noteImageIds(notes) {
  const ids = []
  for (const n of notes || []) for (const b of imageBlocks(n)) if (b.image?.id) ids.push(b.image.id)
  return ids
}
