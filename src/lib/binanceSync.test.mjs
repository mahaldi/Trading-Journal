/**
 * Uji sync Order History Binance. Jalankan dengan:  node src/lib/binanceSync.test.mjs
 *
 * Semua data di sini sintetis — file ekspor asli memuat nama, email, dan
 * alamat pemilik akun, jadi tidak pernah dijadikan fixture di repo.
 */
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { readXlsxRows } from './xlsx.js'
import {
  round7, comparePrice, sameAmount, parseOrderHistory, buildPositions, planSync,
  applySync, summarizeRows, periodMetrics, resolveReview, reviewCandidates,
} from './binanceSync.js'

let passed = 0
const tests = []
const test = (name, fn) => tests.push([name, fn])
const section = (title) => tests.push([title, null])
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`)

/* ── pembuat .xlsx kecil (zip + deflate) untuk menguji pembaca ── */

function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}

function zip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, 'utf8')
    const comp = zlib.deflateRawSync(raw)
    const nameBuf = Buffer.from(name)
    // Seperti ekspor Binance: ukuran di local header 0, data descriptor sesudahnya.
    const loc = Buffer.alloc(30)
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(8, 6)
    loc.writeUInt16LE(8, 8); loc.writeUInt16LE(nameBuf.length, 26)
    const desc = Buffer.alloc(16)
    desc.writeUInt32LE(0x08074b50, 0); desc.writeUInt32LE(crc32(raw), 4)
    desc.writeUInt32LE(comp.length, 8); desc.writeUInt32LE(raw.length, 12)
    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6)
    cen.writeUInt16LE(8, 8); cen.writeUInt16LE(8, 10); cen.writeUInt32LE(crc32(raw), 16)
    cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(raw.length, 24)
    cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(offset, 42)
    locals.push(loc, nameBuf, comp, desc)
    centrals.push(cen, nameBuf)
    offset += loc.length + nameBuf.length + comp.length + desc.length
  }
  const cenBuf = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(cenBuf.length, 12); end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...locals, cenBuf, end]))
}

const COLS = 'CDEFGHIJKLMNOPQ'
function sheetXml(rows) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${
    rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => v === '' ? `<c r="${COLS[j]}${i + 1}"></c>` :
      `<c r="${COLS[j]}${i + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`).join('')}</row>`).join('')
  }</sheetData></worksheet>`
}

function xlsx(rows) {
  return zip({
    'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Sheet0" r:id="rId3" sheetId="1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId3" Target="worksheets/sheet1.xml" Type="x"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheetXml(rows),
    'xl/sharedStrings.xml': '<sst count="0"/>',
  })
}

const HEADER = ['Uid', 'Time', 'Order No', 'Symbol', 'Type', 'Side', 'Price', 'Average Price', 'Amount',
  'Executed Amount', 'Executed Quote Amount', 'Stop Price', 'Status', 'Update Time']
const TOP = [
  [],
  ['', '', '', '', '', '', '', '', '', '', '', '', 'www.binance.com'],
  ['Futures Order History'],
  [],
  ['Name', 'Contoh Pemilik', '', 'Email', 'contoh@example.com', '', 'Address', 'Jalan Contoh 1'],
  ['User ID', '100', '', 'Period(UTC+7)', '2026-08-25 to 2026-09-25'],
  [], [], [],
]
// [time, no, symbol, type, side, price, avg, amount, executed, status, update]
const o = (time, no, symbol, type, side, price, avg, amount, executed, status, update = time) =>
  ['100', time, no, symbol, type, side, price, avg, amount, executed, '0', '0', status, update]

// Skenario desain F2
const ORDERS = [
  o('2026-09-22 10:00:00', '9001', 'SOLUSDT', 'MARKET', 'SELL', '0', '142.37', '3.6', '3.6', 'FILLED'),
  o('2026-09-22 14:00:00', '9002', 'SOLUSDT', 'LIMIT', 'BUY', '139.8367', '139.8367', '3.6', '3.6', 'FILLED'),
  o('2026-09-19 09:00:00', '9003', 'ARBUSDT', 'LIMIT', 'BUY', '0.4187', '0.4187', '620', '620', 'FILLED', '2026-09-19 09:30:00'),
  o('2026-09-19 12:00:00', '9004', 'ARBUSDT', 'MARKET', 'SELL', '0', '0.4132', '620', '620', 'FILLED'),
  o('2026-09-16 21:00:00', '9005', '1000PEPEUSDT', 'LIMIT', 'BUY', '0.0044213', '0.0044213', '53009', '53009', 'FILLED'),
  o('2026-09-17 08:00:00', '9006', '1000PEPEUSDT', 'MARKET', 'SELL', '0', '0.0046733', '53009', '53009', 'FILLED'),
  o('2026-09-09 10:00:00', '9007', 'KAVAUSDT', 'MARKET', 'SELL', '0', '0.04655', '6535.2', '6535.2', 'FILLED'),
  o('2026-09-09 11:00:00', '9008', 'KAVAUSDT', 'MARKET', 'BUY', '0', '0.04525327', '6535.2', '6535.2', 'FILLED'),
  o('2026-09-03 10:00:00', '9009', 'TAOUSDT', 'MARKET', 'BUY', '0', '226.62334898', '1.917', '1.917', 'FILLED'),
  o('2026-09-03 18:00:00', '9010', 'TAOUSDT', 'MARKET', 'SELL', '0', '220.91', '1.917', '1.917', 'FILLED'),
  o('2026-08-26 15:30:17', '8389765912047', 'AKEUSDT', 'MARKET', 'BUY', '0', '0.00837223', '24000', '24000', 'FILLED'),
  o('2026-08-26 18:40:58', '8389765912048', 'AKEUSDT', 'MARKET', 'SELL', '0', '0.008128', '24000', '24000', 'FILLED'),
  o('2026-09-23 12:00:00', '9011', 'NEARUSDT', 'LIMIT', 'BUY', '2.418', '', '50', '0', 'CANCELED', '2026-09-23 20:00:00'),
  o('2026-08-26 10:00:00', '9012', 'SYRUPUSDT', 'MARKET', 'BUY', '0', '0.3847', '1300', '1300', 'FILLED'),
  o('2026-08-25 14:00:00', '9013', 'AIXBTUSDT', 'MARKET', 'SELL', '0', '0.02157914', '11765', '11765', 'FILLED'),
  o('2026-09-10 10:00:00', '9014', 'APTUSDT', 'LIMIT', 'BUY', '0.654', '', '1234.7', '0', 'CANCELED'),
]

const tr = (x) => ({
  status: 'closed', timeframe: 'H1', fees: 0.1, sizeMode: 'unit', tags: ['Breakout'], emotion: 'Calm',
  notes: 'catatan manual', shots: { setup: [], result: [] }, history: [], ...x,
})
const JOURNAL = [
  tr({ id: 'ake', pair: 'AKEUSDT', direction: 'long', date: '2026-08-26', closeDate: '2026-08-26', entry: 0.0083722, exit: 0.008128, size: 24000, sl: 0.0081 }),
  tr({ id: 'kava', pair: 'KAVAUSDT', direction: 'short', date: '2026-09-09', closeDate: '2026-09-09', entry: 0.04655, exit: 0.045253, size: 6535.2, sl: 0.0475 }),
  tr({ id: 'tao', pair: 'TAOUSDT', direction: 'long', date: '2026-09-03', closeDate: '2026-09-03', entry: 226.62334, exit: 220.91, size: 1.917, sl: 220.91 }),
  tr({ id: 'pepe', status: 'open', pair: '1000PEPEUSDT', direction: 'long', date: '2026-09-16', closeDate: null, entry: 0.0044213, exit: null, size: 53009, sl: 0.0042, tp: 0.0048 }),
  tr({ id: 'near', status: 'pending', pair: 'NEARUSDT', direction: 'long', date: '2026-09-23', closeDate: null, entry: 2.418, exit: null, size: 50, fees: 0, sl: 2.3 }),
  tr({ id: 'aix', status: 'open', pair: 'AIXBTUSDT', direction: 'long', date: '2026-08-24', closeDate: null, entry: 0.0211, exit: null, size: 11765, sl: 0.02025, fees: 0.1 }),
  tr({ id: 'btc', pair: 'BTCUSDT', direction: 'long', date: '2026-09-01', closeDate: '2026-09-02', entry: 62719, exit: 66440, size: 0.013, sl: 61191 }),
]

const rows = [...TOP, HEADER, ...ORDERS]
const NOW = '2026-09-25T00:00:00.000Z'

section('\nround7 & aturan harga')

test('dibulatkan half-up 7 desimal tanpa galat float', () => {
  assert.equal(round7('0.74950595'), 0.749506)
  assert.equal(round7('226.62334898'), 226.623349)
  assert.equal(round7('0.00837223'), 0.0083722)
  assert.equal(round7('0.99999999'), 1)
  assert.equal(round7(0.045253), 0.045253)
  assert.equal(round7('1,234.5'), 1234.5)
  assert.equal(round7(''), null)
})

test('aturan 3: sama, presisi, atau berbeda', () => {
  assert.equal(comparePrice(0.0083722, '0.00837223'), 'same')
  assert.equal(comparePrice(0.045253, '0.04525327'), 'precision')
  assert.equal(comparePrice(100, 100.04), 'precision')
  assert.equal(comparePrice(100, 100.06), null)
})

test('aturan 2: amount sama persis', () => {
  assert.ok(sameAmount(6535.2, '6535.2'))
  assert.ok(!sameAmount(24000, 24001))
})

section('\nmembaca file')

test('xlsx (zip + data descriptor) terbaca per sel', async () => {
  const r = await readXlsxRows(xlsx(rows))
  // Kolom mengikuti huruf sel: tabel Binance mulai di kolom C.
  assert.equal(r[2][2], 'Futures Order History')
  assert.deepEqual(r[9].slice(2, 6), ['Uid', 'Time', 'Order No', 'Symbol'])
  assert.equal(r[10][9], '142.37')
})

test('periode & jumlah order terbaca; data pribadi tidak ikut', async () => {
  const p = parseOrderHistory(await readXlsxRows(xlsx(rows)))
  assert.ok(p.ok)
  assert.deepEqual(p.period, { from: '2026-08-25', to: '2026-09-25', tz: 'UTC+7', offset: '+07:00' })
  assert.deepEqual(p.counts, { total: 16, filled: 14, canceled: 2, other: 0 })
  const json = JSON.stringify(p)
  assert.ok(!json.includes('Contoh Pemilik') && !json.includes('example.com') && !json.includes('Jalan'))
})

test('file lain (spot / trade history) ditolak', () => {
  const spot = [['Spot Trade History'], ['Date(UTC)', 'Pair', 'Side', 'Price', 'Executed', 'Amount', 'Fee'], ['2026-09-01', 'BTCUSDT', 'BUY', '1', '1', '1', '0']]
  assert.deepEqual(parseOrderHistory(spot), { ok: false, reason: 'not-futures' })
  assert.equal(parseOrderHistory([['Futures Order History'], ['foo', 'bar']]).ok, false)
})

section('\npemasangan order')

test('order pembuka + penutup jadi satu posisi, arah dari order pertama', () => {
  const p = parseOrderHistory(rows)
  const ps = buildPositions(p.orders, [], p.period)
  const sol = ps.find((x) => x.symbol === 'SOLUSDT')
  assert.equal(sol.direction, 'short')
  assert.ok(sol.closed)
  assert.equal(sol.entry, 142.37)
  assert.equal(sol.exit, 139.8367)
  assert.equal(sol.entryDate, '2026-09-22')
  assert.deepEqual(sol.orderNos, ['9001', '9002'])
})

test('scale-in & scale-out: harga rata-rata tertimbang', () => {
  const orders = parseOrderHistory([...TOP, HEADER,
    o('2026-09-01 10:00:00', '1', 'XUSDT', 'MARKET', 'BUY', '0', '10', '1', '1', 'FILLED'),
    o('2026-09-01 11:00:00', '2', 'XUSDT', 'MARKET', 'BUY', '0', '13', '2', '2', 'FILLED'),
    o('2026-09-01 12:00:00', '3', 'XUSDT', 'MARKET', 'SELL', '0', '14', '1.5', '1.5', 'FILLED'),
    o('2026-09-01 13:00:00', '4', 'XUSDT', 'MARKET', 'SELL', '0', '16', '1.5', '1.5', 'FILLED'),
  ]).orders
  const [p] = buildPositions(orders)
  assert.equal(p.entry, 12)
  assert.equal(p.exit, 15)
  assert.equal(p.openQty, 3)
  assert.ok(p.closed)
})

test('arah berbalik dalam satu order: ditutup, sisanya membuka posisi baru', () => {
  const orders = parseOrderHistory([...TOP, HEADER,
    o('2026-09-01 10:00:00', '1', 'XUSDT', 'MARKET', 'BUY', '0', '10', '1', '1', 'FILLED'),
    o('2026-09-01 11:00:00', '2', 'XUSDT', 'MARKET', 'SELL', '0', '11', '3', '3', 'FILLED'),
  ]).orders
  const ps = buildPositions(orders)
  assert.equal(ps.length, 2)
  assert.ok(ps[0].closed)
  assert.equal(ps[1].direction, 'short')
  assert.equal(ps[1].openQty, 2)
  assert.ok(ps[1].flipped)
})

section('\nrencana sync (F2)')

const parsed = parseOrderHistory(rows)
const plan = planSync(JOURNAL, parsed, { now: NOW })
const byPair = (pair) => plan.changes.find((c) => (c.after || c.before).pair === pair)

test('trade baru dari file: fee 0, SL kosong, bertanda Binance', () => {
  const sol = byPair('SOLUSDT')
  assert.equal(sol.kind, 'new')
  const t = sol.after
  assert.equal(t.status, 'closed')
  assert.equal(t.direction, 'short')
  assert.equal(t.fees, 0)
  assert.equal(t.sl, null)
  assert.equal(t.source, 'binance')
  assert.equal(t.date, '2026-09-22')
  assert.deepEqual(t.binanceOrders, ['9001', '9002'])
  assert.equal(byPair('ARBUSDT').kind, 'new')
})

test('posisi berjalan di jurnal → ditutup: Berjalan → Selesai + exit', () => {
  const c = byPair('1000PEPEUSDT')
  assert.equal(c.kind, 'update')
  assert.deepEqual(c.diffs.map((d) => d.field), ['status', 'exit'])
  assert.equal(c.after.status, 'closed')
  assert.equal(c.after.exit, 0.0046733)
  assert.equal(c.after.closeDate, '2026-09-17')
  // isian manual tetap
  assert.equal(c.after.sl, 0.0042)
  assert.equal(c.after.tp, 0.0048)
  assert.equal(c.after.fees, 0.1)
  assert.deepEqual(c.after.tags, ['Breakout'])
  assert.equal(c.after.notes, 'catatan manual')
})

test('presisi 7 desimal: exit KAVA & entry TAO dirapikan', () => {
  const kava = byPair('KAVAUSDT')
  assert.equal(kava.kind, 'precision')
  assert.deepEqual(kava.diffs, [{ field: 'exit', from: 0.045253, to: 0.0452533, precision: true }])
  const tao = byPair('TAOUSDT')
  assert.equal(tao.kind, 'precision')
  assert.deepEqual(tao.diffs, [{ field: 'entry', from: 226.62334, to: 226.623349, precision: true }])
})

test('contoh F3: AKEUSDT cocok, tidak diduplikasi', () => {
  assert.ok(!byPair('AKEUSDT'))
  const s = plan.same.find((x) => x.trade.id === 'ake')
  assert.ok(s)
  assert.deepEqual(s.after.binanceOrders, ['8389765912047', '8389765912048'])
})

test('limit CANCELED menghapus open order yang cocok', () => {
  const c = byPair('NEARUSDT')
  assert.equal(c.kind, 'delete')
  assert.equal(c.before.id, 'near')
})

test('order batal lain hanya informasi', () => {
  assert.deepEqual(plan.ignored.map((i) => i.order.symbol), ['APTUSDT'])
})

test('posisi yang dibuka sebelum periode ditutup oleh order di file', () => {
  const c = byPair('AIXBTUSDT')
  assert.equal(c.kind, 'update')
  assert.equal(c.after.status, 'closed')
  assert.equal(c.after.exit, 0.0215791)
  assert.equal(c.after.closeDate, '2026-08-25')
  assert.equal(c.after.fees, 0.1)
})

test('order tanpa pasangan & tanpa trade di jurnal → perlu ditinjau', () => {
  assert.deepEqual(plan.review.map((r) => r.symbol), ['SYRUPUSDT'])
  const r = plan.review[0]
  assert.equal(r.side, 'BUY')
  assert.equal(r.qty, 1300)
})

test('trade jurnal di luar file tidak disentuh', () => {
  const after = applySync(JOURNAL, plan, plan.changes, { now: NOW })
  assert.deepEqual(after.find((t) => t.id === 'btc'), JOURNAL.find((t) => t.id === 'btc'))
})

test('urutan baris: baru → diperbarui → presisi → hapus', () => {
  assert.deepEqual(plan.changes.map((c) => c.kind),
    ['new', 'new', 'update', 'update', 'precision', 'precision', 'delete'])
  assert.equal(summarizeRows(plan.changes), '2 baru · 2 diperbarui · 2 dirapikan · 1 open order dihapus')
})

section('\nmenerapkan (F5/F6)')

test('hanya baris yang dicentang yang diterapkan', () => {
  const only = plan.changes.filter((c) => c.kind === 'new')
  const after = applySync(JOURNAL, plan, only, { now: NOW, linkSame: false })
  assert.equal(after.length, JOURNAL.length + 2)
  assert.equal(after.find((t) => t.id === 'pepe').status, 'open')
  assert.ok(after.find((t) => t.id === 'near'))
})

test('setelah diterapkan: sync ulang file yang sama tidak menghasilkan perubahan', () => {
  const after = applySync(JOURNAL, plan, plan.changes, { now: NOW })
  const again = planSync(after, parsed, { now: NOW })
  assert.deepEqual(again.changes, [])
  assert.equal(again.review.length, 1) // SYRUP masih menunggu keputusan
  assert.ok(again.same.every((s) => s.after.binanceOrders?.length))
})

test('histori trade mencatat asal perubahan', () => {
  const after = applySync(JOURNAL, plan, plan.changes, { now: NOW })
  const sol = after.find((t) => t.pair === 'SOLUSDT')
  assert.equal(sol.history.at(-1).label, 'diimpor dari Binance')
  assert.equal(after.find((t) => t.id === 'kava').history.at(-1).label, 'sync Binance · presisi 7 desimal')
})

test('metrik periode file sebelum → sesudah', () => {
  const before = periodMetrics(JOURNAL, plan.period)
  const after = periodMetrics(applySync(JOURNAL, plan, plan.changes, { now: NOW }), plan.period)
  assert.equal(before.total, 4)   // AKE, KAVA, TAO, BTC — semua di dalam periode
  assert.equal(after.total, before.total + 4) // 2 baru + PEPE & AIXBT ditutup
  assert.equal(after.withoutSl, 2) // SOL & ARB perlu dilengkapi
})

section('\nperlu ditinjau')

test('"Catat sebagai posisi berjalan" membuat trade berjalan baru', () => {
  const r = resolveReview(plan.review[0], { type: 'running' }, JOURNAL, plan)
  assert.equal(r.kind, 'new')
  assert.equal(r.after.status, 'open')
  assert.equal(r.after.direction, 'long')
  assert.equal(r.after.size, 1300)
})

test('"Cocokkan dengan trade…" menutup trade lawan arah', () => {
  const journal = [...JOURNAL, tr({ id: 'syr', status: 'open', pair: 'SYRUPUSDT', direction: 'short', date: '2026-08-20', entry: 0.4, size: 1300, sl: 0.42 })]
  const p2 = planSync(journal, parsed, { now: NOW })
  // trade dibuka 20 Agu (sebelum periode) → langsung cocok lewat seed, tidak perlu ditinjau
  assert.equal(p2.review.length, 0)
  assert.equal(p2.changes.find((c) => c.before?.id === 'syr').after.status, 'closed')

  const journal2 = [...JOURNAL, tr({ id: 'syr', status: 'open', pair: 'SYRUPUSDT', direction: 'short', date: '2026-08-26', entry: 0.4, size: 1300, sl: 0.42 })]
  const p3 = planSync(journal2, parsed, { now: NOW })
  const item = p3.review[0]
  assert.deepEqual(reviewCandidates(item, journal2, p3).map((t) => t.id), ['syr'])
  const r = resolveReview(item, { type: 'match', tradeId: 'syr' }, journal2, p3)
  assert.equal(r.kind, 'update')
  assert.equal(r.after.status, 'closed')
  assert.equal(r.after.exit, 0.3847)
})

section('\nopen order terisi (B5)')

test('limit FILLED mengubah open order menjadi Berjalan dengan harga fill', () => {
  const journal = [tr({ id: 'eth', status: 'pending', pair: 'ETHUSDT', direction: 'long', date: '2026-09-20', entry: 3120, size: 0.5, fees: 0, sl: 3070 })]
  const p = parseOrderHistory([...TOP, HEADER,
    o('2026-09-20 10:00:00', '77', 'ETHUSDT', 'LIMIT', 'BUY', '3120', '3119.98', '0.5', '0.5', 'FILLED', '2026-09-21 02:00:00')])
  const pl = planSync(journal, p, { now: NOW })
  const c = pl.changes[0]
  assert.equal(c.kind, 'update')
  assert.equal(c.after.status, 'open')
  assert.equal(c.after.entry, 3119.98)
  assert.equal(c.after.date, '2026-09-21')
  assert.equal(c.after.sl, 3070)
  assert.equal(c.after.filledAt, '2026-09-20T19:00:00.000Z')
})

test('Order No yang tersimpan cocok langsung walau harga jurnal diubah', () => {
  const journal = [tr({ id: 'k', pair: 'KAVAUSDT', direction: 'short', date: '2026-09-09', closeDate: '2026-09-09', entry: 0.05, exit: 0.045, size: 6535.2, binanceOrders: ['9007', '9008'] })]
  const pl = planSync(journal, parsed, { now: NOW })
  assert.ok(!pl.changes.some((c) => c.kind === 'new' && c.after.pair === 'KAVAUSDT'))
  const c = pl.changes.find((x) => x.before?.id === 'k')
  assert.equal(c.kind, 'update') // exit 0.045 → 0.0452533 di luar toleransi
})

for (const [name, fn] of tests) {
  if (!fn) { console.log(name); continue }
  try {
    await fn()
    passed++
    console.log('  ✓', name)
  } catch (err) {
    console.error('  ✗', name, '\n   ', err.message)
    process.exitCode = 1
  }
}
console.log(`\n${passed} tes lulus${process.exitCode ? ', ada yang gagal' : ''}\n`)
