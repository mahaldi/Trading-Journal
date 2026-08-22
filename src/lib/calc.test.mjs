/**
 * Uji perhitungan inti. Jalankan dengan:  node src/lib/calc.test.mjs
 * Tanpa framework — cukup assert bawaan Node.
 */
import assert from 'node:assert/strict'
import { deriveTrade, summarize, equityCurve, groupPerformance, rDistribution, applyPartialExit, exitLegs } from './calc.js'
import { splitPair, baseUnitShort, searchPairs, buildPairIndex } from './pairs.js'

let passed = 0
const test = (name, fn) => {
  try {
    fn()
    passed++
    console.log('  ✓', name)
  } catch (err) {
    console.error('  ✗', name, '\n   ', err.message)
    process.exitCode = 1
  }
}
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`)

const base = {
  id: 'x', status: 'closed', date: '2026-08-19', closeDate: '2026-08-19',
  pair: 'BTCUSDT', direction: 'long', timeframe: 'H4', tags: [], shots: {},
}

console.log('\nderiveTrade')

test('long menang: PnL kotor, bersih, dan R', () => {
  const d = deriveTrade({ ...base, entry: 64210, exit: 65480, size: 0.25, fees: 8.2, sl: 63600, tp: 65900 })
  close(d.grossPnl, 317.5)          // (65480 − 64210) × 0.25
  close(d.netPnl, 309.3)            // dikurangi fees 8.20
  close(d.riskAmount, 152.5)        // |64210 − 63600| × 0.25
  close(d.plannedR, 1690 / 610)     // |TP − entry| / |entry − SL|
  close(d.actualR, 309.3 / 152.5)
  close(d.notional, 16052.5)
  assert.equal(d.outcome, 'win')
})

test('short untung saat harga turun', () => {
  const d = deriveTrade({ ...base, direction: 'short', entry: 100, exit: 90, size: 10, fees: 0, sl: 105, tp: 85 })
  close(d.grossPnl, 100)            // arah short membalik tanda
  close(d.netPnl, 100)
  close(d.riskAmount, 50)           // |100 − 105| × 10
  close(d.actualR, 2)
  close(d.plannedR, 3)              // |85 − 100| / |100 − 105|
  assert.equal(d.outcome, 'win')
})

test('short rugi saat harga naik', () => {
  const d = deriveTrade({ ...base, direction: 'short', entry: 100, exit: 110, size: 5, fees: 2 })
  close(d.netPnl, -52)
  assert.equal(d.outcome, 'loss')
})

test('PnL override menang atas nilai terhitung', () => {
  const d = deriveTrade({ ...base, entry: 100, exit: 110, size: 1, fees: 0, pnlOverride: 7.5 })
  close(d.netPnl, 7.5)
})

test('break-even terdeteksi sebagai BE, bukan menang', () => {
  const d = deriveTrade({ ...base, entry: 100, exit: 100, size: 1, fees: 0 })
  assert.equal(d.outcome, 'be')
})

test('tanpa SL: R tidak dihitung, PnL tetap ada', () => {
  const d = deriveTrade({ ...base, entry: 100, exit: 110, size: 1, fees: 0 })
  assert.equal(d.actualR, null)
  assert.equal(d.plannedR, null)
  close(d.netPnl, 10)
})

test('posisi berjalan: floating dari harga terakhir, exit diabaikan', () => {
  const d = deriveTrade({ ...base, status: 'open', entry: 100, exit: 200, size: 2, fees: 1, sl: 95, markPrice: 104 })
  assert.equal(d.netPnl, null)      // belum ada hasil sampai ditutup
  close(d.floatingPnl, 7)           // (104 − 100) × 2 − 1
  close(d.floatingR, 0.7)           // risiko = 5 × 2 = 10
})

test('deviasi = R aktual − R rencana', () => {
  const d = deriveTrade({ ...base, entry: 100, exit: 104, size: 1, fees: 0, sl: 98, tp: 106 })
  close(d.plannedR, 3)
  close(d.actualR, 2)
  close(d.deviationR, -1)
})

console.log('\nsummarize')

const set = [
  { ...base, id: 'a', date: '2026-08-01', closeDate: '2026-08-01', entry: 100, exit: 110, size: 1, fees: 0, sl: 95, tags: ['Breakout'] },   // +10, +2R
  { ...base, id: 'b', date: '2026-08-02', closeDate: '2026-08-02', entry: 100, exit: 95, size: 1, fees: 0, sl: 95, tags: ['Breakout'] },    // −5, −1R
  { ...base, id: 'c', date: '2026-08-03', closeDate: '2026-08-03', entry: 100, exit: 100, size: 1, fees: 0, sl: 95, tags: ['FOMO'] },       // 0, BE
  { ...base, id: 'd', status: 'open', date: '2026-08-04', entry: 100, size: 1, sl: 95 },                                                    // berjalan
]

test('posisi berjalan tidak masuk hitungan', () => {
  const s = summarize(set)
  assert.equal(s.total, 3)
  close(s.netPnl, 5)
})

test('win rate memakai total termasuk BE', () => {
  const s = summarize(set)
  assert.equal(s.wins, 1)
  assert.equal(s.losses, 1)
  assert.equal(s.be, 1)
  close(s.winRate, (1 / 3) * 100)
})

test('profit factor = total menang / |total kalah|', () => {
  close(summarize(set).profitFactor, 10 / 5)
})

test('expectancy = rata-rata R', () => {
  close(summarize(set).expectancy, (2 - 1 + 0) / 3)
})

test('max drawdown diukur dari puncak ekuitas', () => {
  const s = summarize(set)
  close(s.maxDD, -5)                // ekuitas 10 → 5
  close(s.maxDDPct, -50)
})

test('kurva ekuitas kumulatif dan berurutan', () => {
  const c = equityCurve(set)
  assert.deepEqual(c.map((p) => p.equity), [10, 5, 5])
  assert.deepEqual(c.map((p) => p.date), ['2026-08-01', '2026-08-02', '2026-08-03'])
})

test('hari aktif dan trade per hari', () => {
  const s = summarize(set)
  assert.equal(s.activeDays, 3)
  close(s.tradesPerDay, 1)
})

test('groupPerformance memecah trade multi-tag ke tiap tag', () => {
  const rows = groupPerformance(set, 'tags')
  const bo = rows.find((r) => r.key === 'Breakout')
  assert.equal(bo.count, 2)
  close(bo.netPnl, 5)
})

test('sebaran R menempatkan +2R dan −1R pada bucket benar', () => {
  const bins = rDistribution(set)
  assert.equal(bins.find((b) => b.lo === 2).count, 1)     // +2R
  assert.equal(bins.find((b) => b.lo === -1).count, 1)    // −1R
  assert.equal(bins.find((b) => b.lo === 0).count, 1)     // 0R (BE)
})

console.log('\npairs')

test('quote terpanjang menang: BTCUSDT bukan BTCUSD + T', () => {
  assert.deepEqual(splitPair('BTCUSDT'), { base: 'BTC', quote: 'USDT', kind: 'crypto' })
})

test('forex dikenali sebagai fx', () => {
  assert.equal(splitPair('EURUSD').kind, 'fx')
  assert.equal(splitPair('EURUSD').base, 'EUR')
})

test('logam memakai satuan oz', () => {
  assert.equal(splitPair('XAUUSD').kind, 'metal')
  assert.equal(baseUnitShort('XAUUSD'), 'oz')
})

test('indeks tidak dipecah', () => {
  assert.equal(splitPair('US100').kind, 'index')
  assert.equal(baseUnitShort('US100'), 'kontrak')
})

test('separator dinormalkan', () => {
  assert.equal(splitPair('btc/usdt').base, 'BTC')
  assert.equal(splitPair('EUR-USD').base, 'EUR')
})

test('pair dari riwayat muncul lebih dulu di autocomplete', () => {
  const idx = buildPairIndex([{ pair: 'ZZZUSDT' }, { pair: 'ZZZUSDT' }, { pair: 'EURUSD' }])
  assert.equal(idx[0].symbol, 'ZZZUSDT')
  assert.equal(idx[0].count, 2)
})

test('pencocokan awalan menang atas substring', () => {
  const idx = buildPairIndex([])
  const res = searchPairs(idx, 'ETH', 5)
  assert.ok(res[0].symbol.startsWith('ETH'), res[0].symbol)
})

test('konversi USD → unit memakai harga entry', () => {
  const entry = 64210
  const usd = 2500
  const size = usd / entry
  close(deriveTrade({ ...base, entry, exit: entry, size, fees: 0 }).notional, usd, 1e-9)
})


/* ══════════════════════════════════════════════════════════════
   Tutup sebagian posisi (B5)
   ══════════════════════════════════════════════════════════════ */

console.log('\ntutup sebagian')

const open80 = () => {
  const t = {
    ...base, status: 'open', closeDate: null, exit: null,
    entry: 64210, size: 0.25, fees: 0, sl: 63600, tp: 65900, markPrice: 65600,
  }
  return applyPartialExit(t, { size: 0.2, price: 65480, fees: 6.5, note: 'TP1', slAfter: 64210 },
    { now: '2026-08-12T14:20:00.000Z' })
}

test('trade lama tanpa exits tetap satu leg utuh', () => {
  const t = { ...base, entry: 64210, exit: 65480, size: 0.25, fees: 8.2, sl: 63600 }
  const legs = exitLegs(t)
  assert.equal(legs.length, 1)
  close(legs[0].size, 0.25)
  close(deriveTrade(t).netPnl, 309.3)   // identik dengan versi tanpa fitur ini
})

test('menutup 80%: R terkunci, sisa posisi tetap berjalan', () => {
  const d = deriveTrade(open80())
  assert.equal(open80().status, 'open')
  close(d.closedSize, 0.2)
  close(d.remainingSize, 0.05, 1e-9)
  close(d.closedPortion, 0.8, 1e-9)
  close(d.realizedPnl, 247.5)           // (65480 − 64210) × 0.20 − 6.50
  close(d.realizedR, 247.5 / 152.5)     // risiko awal tetap dasar R
  assert.equal(d.netPnl, null)          // belum masuk Net PnL sampai selesai
  assert.equal(d.isPartial, true)
})

test('floating hanya menghitung sisa posisi', () => {
  const d = deriveTrade(open80())
  close(d.floatingPnl, (65600 - 64210) * 0.05)
  close(d.floatingR, ((65600 - 64210) * 0.05) / 152.5)
})

test('SL sisa digeser ke BE membuat risiko tersisa nol', () => {
  const d = deriveTrade(open80())
  close(d.remainingRisk, 0)
})

test('menutup sisa: R aktual adalah rata-rata tertimbang, bukan exit terakhir', () => {
  const t = applyPartialExit(open80(), { size: 0.05, price: 65900, fees: 2.7 },
    { now: '2026-08-12T16:40:00.000Z' })
  const d = deriveTrade(t)
  assert.equal(t.status, 'closed')
  assert.equal(d.exitCount, 2)
  close(d.netPnl, 247.5 + (65900 - 64210) * 0.05 - 2.7)   // 329.30
  close(d.avgExit, (65480 * 0.2 + 65900 * 0.05) / 0.25)   // 65564
  close(d.totalFees, 9.2)
  close(d.actualR, 329.3 / 152.5)
  assert.equal(d.outcome, 'win')
})

test('scale-out tetap dihitung satu trade di statistik', () => {
  const t = applyPartialExit(open80(), { size: 0.05, price: 65900, fees: 2.7 })
  const s = summarize([t])
  assert.equal(s.total, 1)
  assert.equal(s.wins, 1)
  close(s.netPnl, 329.3)
})

test('exit sebagian tidak bisa melebihi sisa posisi', () => {
  const t = applyPartialExit(open80(), { size: 99, price: 66000, fees: 0 })
  assert.equal(t.status, 'closed')
  close(deriveTrade(t).closedSize, 0.25)
})

test('short: scale-out membalik tanda dengan benar', () => {
  let t = { ...base, status: 'open', closeDate: null, exit: null,
    direction: 'short', entry: 100, size: 10, fees: 0, sl: 105, tp: 85 }
  t = applyPartialExit(t, { size: 6, price: 94, fees: 1 })
  close(deriveTrade(t).realizedPnl, 35)      // (94 − 100) × 6 × −1 − 1
  t = applyPartialExit(t, { size: 4, price: 90, fees: 1 })
  close(deriveTrade(t).netPnl, 35 + 39)      // (90 − 100) × 4 × −1 − 1
  close(deriveTrade(t).actualR, 74 / 50)
})

test('pnlOverride tetap menang atas hasil scale-out', () => {
  let t = applyPartialExit(open80(), { size: 0.05, price: 65900, fees: 2.7 })
  t = { ...t, pnlOverride: 100 }
  close(deriveTrade(t).netPnl, 100)
})


console.log(`\n${passed} pengujian lolos.\n`)
