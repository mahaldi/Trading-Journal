/**
 * Uji aturan tag dan migrasi bentuk screenshot.
 * Jalankan dengan:  node src/lib/tags.test.mjs
 */
import assert from 'node:assert/strict'
import { normalizeTag, similarTags, rankTags, buildTagStats } from './tags.js'
import { tagLibrary } from './calc.js'

let passed = 0
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✓', name) }
  catch (err) { console.error('  ✗', name, '\n   ', err.message); process.exitCode = 1 }
}

console.log('\nnormalizeTag')

test('spasi menjadi garis bawah, huruf awal kapital', () => {
  assert.equal(normalizeTag('liquidity sweep'), 'Liquidity_Sweep')
})
test('tanda # dibuang', () => {
  assert.equal(normalizeTag('#Breakout'), 'Breakout')
  assert.equal(normalizeTag('##rsi div'), 'Rsi_Div')
})
test('spasi berlebih dan garis bawah ganda dirapikan', () => {
  assert.equal(normalizeTag('  mean   rev  '), 'Mean_Rev')
  assert.equal(normalizeTag('a__b'), 'A_B')
  assert.equal(normalizeTag('_tepi_'), 'Tepi')
})
test('tanda baca dibuang, angka dipertahankan', () => {
  assert.equal(normalizeTag('break!out@2'), 'Breakout2')
})
test('huruf non-latin tetap diterima', () => {
  assert.equal(normalizeTag('støtte nivå'), 'Støtte_Nivå')
})
test('input kosong menghasilkan string kosong', () => {
  assert.equal(normalizeTag('   '), '')
  assert.equal(normalizeTag('###'), '')
  assert.equal(normalizeTag(null), '')
})

console.log('\nsimilarTags')

test('mendeteksi tag yang berbagi kata penyusun', () => {
  assert.deepEqual(similarTags('Liquidity_Sweep', ['Liquidity_Grab', 'Breakout']), ['Liquidity_Grab'])
})
test('mendeteksi salah ketik', () => {
  assert.deepEqual(similarTags('Breakot', ['Breakout', 'MeanRev']), ['Breakout'])
})
test('tag yang sama persis tidak dianggap mirip', () => {
  assert.deepEqual(similarTags('Breakout', ['Breakout']), [])
})
test('tag tidak berhubungan tidak dilaporkan', () => {
  assert.deepEqual(similarTags('Scalping', ['Breakout', 'NewsPlay']), [])
})

console.log('\nrankTags')

const stats = { Breakout: { count: 46 }, RSI_Div: { count: 31 }, MeanRev: { count: 5 } }

test('tanpa query: urut berdasarkan frekuensi', () => {
  assert.deepEqual(rankTags(['MeanRev', 'Breakout', 'RSI_Div'], stats, ''), ['Breakout', 'RSI_Div', 'MeanRev'])
})
test('prefix menang atas substring', () => {
  const out = rankTags(['Anti_Rsi', 'RSI_Div'], { Anti_Rsi: { count: 99 }, RSI_Div: { count: 1 } }, 'rsi')
  assert.equal(out[0], 'RSI_Div')
})
test('yang tidak cocok disaring habis', () => {
  assert.deepEqual(rankTags(['Breakout', 'MeanRev'], stats, 'zzz'), [])
})
test('query ternormalisasi, jadi "mean rev" cocok dengan Mean_Rev', () => {
  assert.deepEqual(rankTags(['Mean_Rev'], {}, 'mean rev'), ['Mean_Rev'])
})

console.log('\nbuildTagStats')

test('statistik membawa jumlah pemakaian dan net PnL', () => {
  const base = { direction: 'long', status: 'closed', timeframe: 'H4' }
  const trades = [
    { ...base, id: '1', date: '2026-08-01', closeDate: '2026-08-01', entry: 100, exit: 110, size: 1, fees: 0, sl: 95, tags: ['Breakout'] },
    { ...base, id: '2', date: '2026-08-02', closeDate: '2026-08-02', entry: 100, exit: 105, size: 1, fees: 0, sl: 95, tags: ['Breakout'] },
    { ...base, id: '3', date: '2026-08-03', closeDate: '2026-08-03', entry: 100, exit: 90, size: 1, fees: 0, sl: 95, tags: ['FOMO'] },
  ]
  const s = buildTagStats(tagLibrary(trades))
  assert.equal(s.Breakout.count, 2)
  assert.equal(s.Breakout.netPnl, 15)
  assert.equal(s.FOMO.netPnl, -10)
})

console.log(`\n${passed} pengujian lolos.\n`)
