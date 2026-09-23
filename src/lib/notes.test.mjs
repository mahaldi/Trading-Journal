/**
 * Uji helper Catatan: mention, ganti nama gambar, tautan trade, template.
 * Jalankan dengan:  node src/lib/notes.test.mjs
 */
import assert from 'node:assert/strict'
import {
  blankNote, tokenize, makeResolver, renameMentions, countMentions, linkedTradeIds,
  slugifyName, uniqueImageName, groupByMonth, noteMatches, noteSnippet, notesByTrade,
  reviewSummary, isoWeek, textBlock, imageBlock, noteImageIds,
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
test('dikelompokkan per bulan, terbaru dulu', () => {
  const a = { ...blankNote(), date: '2026-07-28' }
  const b = { ...blankNote(), date: '2026-08-14' }
  const g = groupByMonth([a, b])
  assert.deepEqual(g.map((x) => x.label), ['Agustus 2026', 'Juli 2026'])
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

console.log(`\n${passed} tes lulus\n`)
