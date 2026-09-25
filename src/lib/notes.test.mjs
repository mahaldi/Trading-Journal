/**
 * Uji helper Catatan: mention, ganti nama gambar, tautan trade, template.
 * Jalankan dengan:  node src/lib/notes.test.mjs
 */
import assert from 'node:assert/strict'
import {
  blankNote, tokenize, makeResolver, renameMentions, countMentions, linkedTradeIds,
  slugifyName, uniqueImageName, noteMatches, noteSnippet, notesByTrade,
  reviewSummary, isoWeek, textBlock, imageBlock, noteImageIds,
  arrangeNotes, togglePin, moveWithin, isPinned,
} from './notes.js'

let passed = 0
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✓', name) }
  catch (err) { console.error('  ✗', name, '\n   ', err.message); process.exitCode = 1 }
}

const trade = {
  id: 't_abc_123', status: 'closed', date: '2026-08-14', closeDate: '2026-08-14',
  pair: 'BTCUSDT', direction: 'long', timeframe: 'H1', entry: 100, exit: 110, sl: 95, size: 1, tags: ['Retest'],
}
const tradesById = new Map([[trade.id, trade]])

function sampleNote() {
  const n = blankNote('free', { now: new Date('2026-08-14T14:00:00Z') })
  const img = { ...imageBlock({ id: 'x.webp' }), name: 'retest-2110' }
  n.blocks = [
    textBlock('Bandingkan @retest-2110 dengan @range. Entry @t_abc_123, email a@b.co'),
    img,
    textBlock('Lagi: @retest-2110.'),
  ]
  return n
}

console.log('\nslug & nama unik')
test('nama gambar dijadikan slug', () => {
  assert.equal(slugifyName('  Retest 21:10 '), 'retest-2110')
  assert.equal(slugifyName('Range pré CPI!!'), 'range-pre-cpi')
})
test('nama bentrok diberi akhiran', () => {
  const n = sampleNote()
  assert.equal(uniqueImageName(n, 'retest-2110'), 'retest-2110-2')
  assert.equal(uniqueImageName(n, 'retest-2110', n.blocks[1].id), 'retest-2110')
})

console.log('\nmention')
test('tokenize hanya mengenali handle yang ter-resolve', () => {
  const n = sampleNote()
  const segs = tokenize(n.blocks[0].text, makeResolver(n, tradesById))
  const m = segs.filter((s) => s.type === 'mention')
  assert.deepEqual(m.map((s) => s.handle), ['retest-2110', 't_abc_123'])
  assert.equal(m[1].target.kind, 'trade')
  // teks utuh bisa disusun ulang dari potongan
  assert.equal(segs.map((s) => (s.type === 'text' ? s.text : s.raw)).join(''), n.blocks[0].text)
})
test('titik di akhir kalimat bukan bagian dari handle', () => {
  const n = sampleNote()
  const segs = tokenize(n.blocks[2].text, makeResolver(n, tradesById))
  assert.equal(segs.find((s) => s.type === 'mention').handle, 'retest-2110')
})
test('countMentions menghitung semua rujukan gambar', () => {
  assert.equal(countMentions(sampleNote(), 'retest-2110'), 2)
})
test('ganti nama memperbarui semua rujukan', () => {
  const n = renameMentions(sampleNote(), 'retest-2110', 'retest-final')
  assert.match(n.blocks[0].text, /@retest-final dengan/)
  assert.equal(n.blocks[2].text, 'Lagi: @retest-final.')
})
test('trade tertaut = manual ∪ mention, hanya yang masih ada', () => {
  const n = { ...sampleNote(), tradeIds: ['t_gone'] }
  assert.deepEqual(linkedTradeIds(n, tradesById), ['t_abc_123'])
  assert.deepEqual(linkedTradeIds(n).sort(), ['t_abc_123', 't_gone'])
  assert.deepEqual(notesByTrade([n]).get('t_abc_123').map((x) => x.id), [n.id])
})
test('cuplikan mengganti id trade dengan pair', () => {
  assert.match(noteSnippet(sampleNote(), tradesById), /Entry BTCUSDT,/)
})

console.log('\ndaftar')
test('pencarian ikut mengindeks nama gambar', () => {
  assert.equal(noteMatches(sampleNote(), 'retest-2110'), true)
  assert.equal(noteMatches(sampleNote(), 'tidak-ada'), false)
})
test('daftar datar tanpa kelompok bulan, terbaru dulu', () => {
  const a = { ...blankNote(), date: '2026-07-28' }
  const b = { ...blankNote(), date: '2026-08-14' }
  const { others } = arrangeNotes([a, b])
  assert.deepEqual(others.map((n) => n.date), ['2026-08-14', '2026-07-28'])
})
test('id gambar catatan dikumpulkan untuk prune', () => {
  assert.deepEqual(noteImageIds([sampleNote()]), ['x.webp'])
})

console.log('\ntemplate')
test('event berisi blok fase tiga baris', () => {
  const n = blankNote('event')
  const phase = n.blocks.find((b) => b.kind === 'phase')
  assert.deepEqual(phase.rows.map((r) => r.label), ['Sebelum', 'Saat', 'Sesudah'])
})
test('review mengisi ringkasan dari trade periode itu', () => {
  const r = reviewSummary([trade], new Date(2026, 7, 16, 12))
  assert.deepEqual(r.tradeIds, ['t_abc_123'])
  assert.match(r.text, /1 trade ditutup · total \+2\.0R · win rate 100\.0%/)
  assert.equal(r.title, `Minggu ${isoWeek(new Date(2026, 7, 16))} — 1 trade, +2.0R`)
})
test('jenis tak dikenal jatuh ke catatan bebas', () => {
  assert.equal(blankNote('aneh').type, 'free')
})

console.log('\npin & urutan')
const note = (id, date, time = '10:00') => ({ ...blankNote(), id, date, createdAt: `${date}T${time}:00.000Z` })
const ids = (list) => list.map((n) => n.id)
// Terapkan patch dari moveWithin ke daftar.
const apply = (list, patches) => list.map((n) => {
  const p = patches.filter((x) => x.id === n.id)
  return p.reduce((acc, x) => ({ ...acc, [x.field]: x.value }), n)
})

test('tanpa pin & tanpa seret: urutan lama tetap (terbaru di atas)', () => {
  const list = [note('a', '2026-09-01'), note('b', '2026-09-20'), note('c', '2026-09-20', '15:00')]
  const { pinned, others } = arrangeNotes(list)
  assert.equal(pinned.length, 0)
  assert.deepEqual(ids(others), ['c', 'b', 'a'])
})

test('yang terakhir disematkan ada di paling atas', () => {
  let list = [note('a', '2026-09-01'), note('b', '2026-09-20'), note('c', '2026-08-05')]
  list = list.map((n) => (n.id === 'a' ? togglePin(n, list, new Date('2026-09-25T01:00:00Z')) : n))
  list = list.map((n) => (n.id === 'c' ? togglePin(n, list, new Date('2026-09-25T02:00:00Z')) : n))
  const { pinned, others } = arrangeNotes(list)
  assert.deepEqual(ids(pinned), ['c', 'a'])
  assert.deepEqual(ids(others), ['b'])   // yang disematkan keluar dari daftar biasa
})

test('pin baru tetap di atas walau urutan pin pernah diseret ke masa depan', () => {
  let list = [note('a', '2026-09-01'), note('b', '2026-09-02')]
  list = list.map((n) => (n.id === 'a' ? { ...togglePin(n, list), pinOrder: 9e15 } : n))
  list = list.map((n) => (n.id === 'b' ? togglePin(n, list) : n))
  assert.deepEqual(ids(arrangeNotes(list).pinned), ['b', 'a'])
})

test('lepas pin mengembalikan catatan ke posisi lamanya', () => {
  const a = note('a', '2026-09-10')
  const pinned = togglePin(a, [a])
  assert.equal(isPinned(pinned), true)
  const back = togglePin(pinned, [pinned])
  assert.equal(isPinned(back), false)
  assert.equal('pinOrder' in back, false)
  const { others } = arrangeNotes([note('b', '2026-09-20'), back, note('c', '2026-09-01')])
  assert.deepEqual(ids(others), ['b', 'a', 'c'])
})

test('seret di antara yang disematkan', () => {
  let list = ['a', 'b', 'c'].map((id, i) => togglePin(note(id, '2026-09-01'), [], new Date(Date.UTC(2026, 8, 25, i))))
  assert.deepEqual(ids(arrangeNotes(list).pinned), ['c', 'b', 'a'])
  const zone = arrangeNotes(list).pinned
  list = apply(list, moveWithin(zone, 'a', 'c', 'before', { pinned: true }))
  assert.deepEqual(ids(arrangeNotes(list).pinned), ['a', 'c', 'b'])
  const zone2 = arrangeNotes(list).pinned
  list = apply(list, moveWithin(zone2, 'a', 'b', 'after', { pinned: true }))
  assert.deepEqual(ids(arrangeNotes(list).pinned), ['c', 'b', 'a'])
})

test('seret catatan biasa, termasuk melewati bulan lain', () => {
  let list = [note('a', '2026-07-03'), note('b', '2026-08-12'), note('c', '2026-09-20')]
  const zone = arrangeNotes(list).others                           // c, b, a
  list = apply(list, moveWithin(zone, 'a', 'c', 'before'))
  assert.deepEqual(ids(arrangeNotes(list).others), ['a', 'c', 'b'])
})

test('catatan biasa tidak bisa diseret ke atas catatan yang disematkan', () => {
  const p = togglePin(note('p', '2026-09-01'), [])
  const list = [p, note('a', '2026-09-03'), note('x', '2026-08-03')]
  const { pinned, others } = arrangeNotes(list)
  assert.deepEqual(moveWithin(others, 'a', 'p', 'before'), [])
  assert.deepEqual(moveWithin(pinned, 'p', 'a', 'after', { pinned: true }), [])
})

test('diseret ke tempat yang sama tidak menulis apa pun', () => {
  const list = [note('a', '2026-09-03'), note('b', '2026-09-12')]
  const zone = arrangeNotes(list).others                           // b, a
  assert.deepEqual(moveWithin(zone, 'b', 'a', 'before'), [])
  assert.deepEqual(moveWithin(zone, 'a', 'b', 'after'), [])
})

test('celah habis → seluruh zona diberi peringkat ulang, urutan tetap benar', () => {
  let list = [note('a', '2026-09-03'), note('b', '2026-09-12'), note('c', '2026-09-20')]
  // Bolak-balik menyeret ke titik yang sama sampai angka tengahnya habis.
  for (let i = 0; i < 80; i++) {
    const zone = arrangeNotes(list).others
    const target = i % 2 ? 'b' : 'c'
    const drag = zone.find((n) => n.id !== target && n.id !== zone[zone.length - 1].id)?.id || 'a'
    list = apply(list, moveWithin(zone, drag, zone[zone.length - 1].id, 'before'))
    const shown = ids(arrangeNotes(list).others)
    assert.equal(new Set(shown).size, 3)
  }
  const zone = arrangeNotes(list).others
  const last = zone[zone.length - 1].id
  const first = zone[0].id
  list = apply(list, moveWithin(zone, first, last, 'before'))
  const after = ids(arrangeNotes(list).others)
  assert.equal(after[1], first)
  assert.equal(after[2], last)
})

console.log(`\n${passed} tes lulus\n`)
