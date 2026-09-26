/* ══════════════════════════════════════════════════════════════
   Sync Order History Binance (Futures) — "F · Sync Order History Binance"

   Alur:
     readXlsxRows(file) → parseOrderHistory(rows) → planSync(trades, parsed)
     → pengguna meninjau → applySync(trades, plan, pilihan)

   Semua fungsi di sini murni: tidak menyentuh disk, tidak menyimpan file.
   Tidak ada AI — hanya aturan pencocokan di bawah (F3):
     1. Pair dan arah sama.
     2. Amount sama persis.
     3. Harga sama setelah dibulatkan 7 desimal, toleransi ±0,05%.
     4. Tanggal sebagai pembeda terakhir.
   Setelah cocok, Order No disimpan di trade (`binanceOrders`), sehingga
   sync berikutnya langsung cocok lewat nomor itu.

   Isian manual tidak pernah ditimpa: SL, TP, tag, catatan, screenshot,
   leverage, timeframe, emosi, dan fee yang sudah diisi (F4).
   ══════════════════════════════════════════════════════════════ */

import { applyPartialExit, deriveTrade, effectiveDate, summarize } from './calc.js'

export const PRICE_DECIMALS = 7
export const PRICE_TOLERANCE = 0.0005 // ±0,05%
const EPS = 1e-9

/* ─────────────────────────── angka ─────────────────────────── */

/**
 * Bulatkan ke 7 desimal (half-up) lewat aritmetika string, supaya
 * 0.74950595 tidak berubah jadi 0.7495059 karena galat float.
 */
export function round7(v) {
  if (v == null || v === '') return null
  let s
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null
    s = v.toFixed(12)
  } else {
    s = String(v).trim().replace(/,/g, '')
    if (/e/i.test(s)) {
      const n = Number(s)
      if (!Number.isFinite(n)) return null
      s = n.toFixed(12)
    }
  }
  const neg = s.startsWith('-')
  if (neg || s.startsWith('+')) s = s.slice(1)
  let [int, frac = ''] = s.split('.')
  if (!/^\d*$/.test(int) || !/^\d*$/.test(frac) || (!int && !frac)) return null
  int = int || '0'
  frac = frac.padEnd(PRICE_DECIMALS + 1, '0')
  const digits = (int + frac.slice(0, PRICE_DECIMALS)).split('').map(Number)
  if (Number(frac[PRICE_DECIMALS]) >= 5) {
    let i = digits.length - 1
    while (i >= 0) {
      if (digits[i] === 9) { digits[i] = 0; i-- } else { digits[i]++; break }
    }
    if (i < 0) digits.unshift(1)
  }
  const all = digits.join('')
  const out = `${all.slice(0, all.length - PRICE_DECIMALS)}.${all.slice(-PRICE_DECIMALS)}`
  const n = Number(out)
  return neg && n !== 0 ? -n : n
}

const toNum = (v) => {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Bandingkan dua harga menurut aturan 3.
 * 'same'      — identik setelah dibulatkan 7 desimal
 * 'precision' — beda digit, tapi dalam toleransi ±0,05%
 * null        — harga berbeda
 */
export function comparePrice(a, b) {
  const ra = round7(a)
  const rb = round7(b)
  if (ra == null || rb == null) return null
  if (ra === rb) return 'same'
  const ref = Math.max(Math.abs(ra), Math.abs(rb))
  return ref > 0 && Math.abs(ra - rb) / ref <= PRICE_TOLERANCE ? 'precision' : null
}

/** Aturan 2: amount sama persis (hanya toleransi galat float). */
export function sameAmount(a, b) {
  const x = toNum(a)
  const y = toNum(b)
  if (x == null || y == null) return false
  return Math.abs(x - y) <= EPS * Math.max(1, Math.abs(x), Math.abs(y))
}

/* ─────────────────────────── membaca file ─────────────────────────── */

const REQUIRED = ['Order No', 'Symbol', 'Side', 'Average Price', 'Executed Amount', 'Status', 'Update Time']
const norm = (s) => String(s ?? '').trim().toLowerCase()

/** Nilai tanggal Excel (serial) atau teks → 'YYYY-MM-DD HH:mm:ss'. */
function toStamp(v) {
  const s = String(v ?? '').trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4].padStart(2, '0')}:${m[5]}:${m[6] || '00'}`
  if (/^\d+(\.\d+)?$/.test(s)) {
    const ms = Math.round((Number(s) - 25569) * 86400000)
    const d = new Date(ms)
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 19).replace('T', ' ')
  }
  return null
}

/**
 * Baca baris-baris sheet "Futures Order History".
 *
 * Hanya tabel order dan label periode yang dibaca. Nama, email, alamat, dan
 * User ID di bagian atas file tidak pernah diambil apalagi ditampilkan.
 *
 * → { ok: true, period: { from, to, tz, offset }, orders, counts }
 * → { ok: false, reason: 'not-futures' }
 */
export function parseOrderHistory(rows) {
  if (!Array.isArray(rows)) return { ok: false, reason: 'not-futures' }

  // Judul lain ("Spot Order History", "Trade History") ditolak walau kolomnya mirip.
  const titles = rows.flat().filter((c) => /history/i.test(String(c || '')) && String(c).length < 60)
  if (titles.length && !titles.some((c) => /^futures\s+order\s+history$/i.test(String(c).trim()))) {
    return { ok: false, reason: 'not-futures' }
  }

  const headerIdx = rows.findIndex((r) => {
    const cells = (r || []).map(norm)
    return REQUIRED.every((h) => cells.includes(norm(h)))
  })
  if (headerIdx < 0) return { ok: false, reason: 'not-futures' }

  const header = rows[headerIdx].map(norm)
  const col = (name) => header.indexOf(norm(name))
  const C = {
    no: col('Order No'), symbol: col('Symbol'), type: col('Type'), side: col('Side'),
    price: col('Price'), avg: col('Average Price'), amount: col('Amount'),
    executed: col('Executed Amount'), status: col('Status'), time: col('Time'),
    update: col('Update Time'),
  }

  // Periode: satu-satunya informasi dari bagian atas file yang dibaca.
  let tz = null
  let from = null
  let to = null
  for (const r of rows.slice(0, headerIdx)) {
    const i = (r || []).findIndex((c) => /^period\s*\(/i.test(String(c || '').trim()))
    if (i < 0) continue
    tz = /\((UTC[+-]\d{1,2}(?::?\d{2})?)\)/i.exec(r[i])?.[1]?.toUpperCase() || null
    const val = r.slice(i + 1).find((c) => String(c || '').trim())
    const m = /(\d{4}-\d{2}-\d{2})\D+(\d{4}-\d{2}-\d{2})/.exec(String(val || ''))
    if (m) { from = m[1]; to = m[2] }
  }

  const orders = []
  for (const r of rows.slice(headerIdx + 1)) {
    if (!r || !r.some((c) => String(c || '').trim())) continue
    const get = (i) => (i >= 0 ? String(r[i] ?? '').trim() : '')
    const symbol = get(C.symbol).toUpperCase()
    const side = get(C.side).toUpperCase()
    if (!symbol || (side !== 'BUY' && side !== 'SELL')) continue
    const executed = toNum(get(C.executed)) || 0
    const updateTime = toStamp(get(C.update)) || toStamp(get(C.time))
    orders.push({
      no: get(C.no),
      symbol,
      type: get(C.type).toUpperCase(),
      side,
      price: get(C.price),
      avgPrice: get(C.avg),
      amount: get(C.amount),
      executed,
      status: get(C.status).toUpperCase(),
      time: toStamp(get(C.time)) || updateTime,
      updateTime,
    })
  }
  if (!orders.length && headerIdx < 0) return { ok: false, reason: 'not-futures' }

  if (!from || !to) {
    const days = orders.map((o) => (o.updateTime || '').slice(0, 10)).filter(Boolean).sort()
    from = from || days[0] || null
    to = to || days[days.length - 1] || null
  }

  const filled = orders.filter((o) => o.executed > 0).length
  const canceled = orders.filter((o) => o.executed <= 0 && (o.status === 'CANCELED' || o.status === 'EXPIRED')).length
  return {
    ok: true,
    period: { from, to, tz, offset: tzOffset(tz) },
    orders,
    counts: { total: orders.length, filled, canceled, other: orders.length - filled - canceled },
  }
}

/** 'UTC+7' → '+07:00' */
function tzOffset(tz) {
  const m = /UTC([+-])(\d{1,2})(?::?(\d{2}))?/i.exec(tz || '')
  if (!m) return null
  return `${m[1]}${m[2].padStart(2, '0')}:${m[3] || '00'}`
}

/** Waktu di file (zona periode) → ISO UTC. */
function stampToISO(stamp, offset) {
  if (!stamp) return null
  const d = new Date(`${stamp.replace(' ', 'T')}${offset || ''}`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/* ─────────────────────────── order → posisi ─────────────────────────── */

const sideDir = (side) => (side === 'BUY' ? 'long' : 'short')
const signed = (fill) => (fill.side === 'BUY' ? fill.qty : -fill.qty)
const fillPrice = (o) => toNum(o.avgPrice) || toNum(o.price)

/** Rata-rata tertimbang harga beberapa fill, dibulatkan 7 desimal. */
function wavg(fills) {
  const qty = fills.reduce((s, f) => s + f.qty, 0)
  if (qty <= EPS) return null
  if (fills.length === 1) return round7(fills[0].avgPrice || fills[0].price)
  return round7(fills.reduce((s, f) => s + fillPrice(f) * f.qty, 0) / qty)
}

const sumQty = (fills) => fills.reduce((s, f) => s + f.qty, 0)
const dayOf = (fill) => (fill?.updateTime || '').slice(0, 10) || null
const orderNosOf = (fills) => [...new Set(fills.map((f) => f.no).filter(Boolean))]

/**
 * Trade jurnal yang posisinya sudah terbuka sebelum periode file dimulai —
 * order penutupnya ada di file, order pembukanya tidak.
 */
function seedFor(symbol, firstFill, trades, from, claimed) {
  if (!from || !firstFill) return null
  const dirOfFirst = sideDir(firstFill.side)
  const list = trades.filter((t) =>
    t.pair === symbol &&
    !claimed.has(t.id) &&
    t.status !== 'pending' &&
    t.date && t.date < from &&
    (t.status === 'open' || (t.status === 'closed' && (t.closeDate || '') >= from)) &&
    // order pertama di file harus menutup posisi itu, bukan menambahnya
    t.direction !== dirOfFirst
  )
  if (!list.length) return null
  // Yang sudah tertaut lewat Order No menang; lalu yang paling baru dibuka.
  const nos = new Set([firstFill.no])
  return list.find((t) => (t.binanceOrders || []).some((n) => nos.has(n))) ||
    [...list].sort((a, b) => b.date.localeCompare(a.date))[0]
}

/**
 * Pasangkan order pembuka dan penutup menjadi posisi (mode one-way:
 * posisi dihitung dari jumlah bersih per symbol).
 */
export function buildPositions(orders, trades = [], period = {}) {
  const fills = orders
    .filter((o) => o.executed > 0)
    .map((o) => ({ ...o, qty: o.executed }))
    .sort((a, b) =>
      (a.updateTime || '').localeCompare(b.updateTime || '') ||
      (a.time || '').localeCompare(b.time || '') ||
      String(a.no).localeCompare(String(b.no)))

  const bySymbol = new Map()
  for (const f of fills) {
    if (!bySymbol.has(f.symbol)) bySymbol.set(f.symbol, [])
    bySymbol.get(f.symbol).push(f)
  }

  const positions = []
  const claimed = new Set()
  for (const [symbol, list] of bySymbol) {
    let cur = null
    let net = 0
    const seed = seedFor(symbol, list[0], trades, period.from, claimed)
    if (seed) {
      claimed.add(seed.id)
      const d = deriveTrade(seed)
      const remaining = seed.status === 'open' ? d.remainingSize ?? seed.size : seed.size
      cur = { symbol, direction: seed.direction, seed, opens: [], closes: [], closed: false, flipped: false }
      net = seed.direction === 'long' ? remaining : -remaining
    }

    for (const f of list) {
      const q = signed(f)
      if (!cur || Math.abs(net) <= EPS) {
        cur = { symbol, direction: sideDir(f.side), seed: null, opens: [f], closes: [], closed: false, flipped: false }
        net = q
        continue
      }
      if (Math.sign(q) === Math.sign(net)) {
        cur.opens.push(f)
        net += q
        continue
      }
      // Order berlawanan arah: mengurangi atau menutup posisi.
      if (Math.abs(q) <= Math.abs(net) + EPS * Math.max(1, Math.abs(net))) {
        cur.closes.push(f)
        net += q
        if (Math.abs(net) <= EPS * Math.max(1, Math.abs(q))) {
          net = 0
          cur.closed = true
          positions.push(cur)
          cur = null
        }
        continue
      }
      // Lebih besar dari posisi: tutup, sisanya membuka posisi arah sebaliknya.
      const closeQty = Math.abs(net)
      cur.closes.push({ ...f, qty: closeQty, split: true })
      cur.closed = true
      positions.push(cur)
      cur = {
        symbol, direction: sideDir(f.side), seed: null,
        opens: [{ ...f, qty: f.qty - closeQty, split: true }], closes: [], closed: false, flipped: true,
      }
      net = q + (net > 0 ? closeQty : -closeQty)
    }
    if (cur) positions.push(cur)
  }

  return positions.map((p, i) => ({
    ...p,
    id: `p${i + 1}`,
    entry: p.opens.length ? wavg(p.opens) : null,
    exit: p.closed && p.closes.length ? wavg(p.closes) : null,
    openQty: sumQty(p.opens),
    closeQty: sumQty(p.closes),
    entryDate: dayOf(p.opens[0]),
    closeDate: p.closed ? dayOf(p.closes[p.closes.length - 1]) : null,
    orderNos: orderNosOf([...p.opens, ...p.closes]),
  }))
}

/* ─────────────────────────── pencocokan ─────────────────────────── */

/** Harga yang dipakai untuk mencocokkan entry: limit untuk open order, harga fill untuk sisanya. */
function entryForMatch(p, t) {
  if (t.status === 'pending') {
    const lim = toNum(p.opens[0]?.price)
    return lim && lim > 0 ? lim : p.entry
  }
  return p.entry
}

/** Aturan 1–4 untuk satu posisi yang pembukanya ada di file. */
function findMatch(p, trades, claimed) {
  const free = trades.filter((t) => !claimed.has(t.id))
  // Jalur cepat: Order No yang sudah pernah disimpan.
  const nos = new Set(p.orderNos)
  const linked = free.find((t) => (t.binanceOrders || []).some((n) => nos.has(n)))
  if (linked) return linked

  const hits = free.filter((t) =>
    t.pair === p.symbol &&                           // 1
    t.direction === p.direction &&                   // 1
    !(t.binanceOrders || []).length &&               // sudah tertaut ke order lain
    sameAmount(t.size, p.openQty) &&                 // 2
    comparePrice(t.entry, entryForMatch(p, t)) != null // 3
  )
  if (hits.length <= 1) return hits[0] || null
  // 4 — tanggal sebagai pembeda terakhir
  const target = p.entryDate || ''
  const dist = (t) => (t.date === target ? 0 : Math.abs(new Date(t.date) - new Date(target)) || Infinity)
  return [...hits].sort((a, b) => dist(a) - dist(b))[0]
}

const union = (a = [], b = []) => [...new Set([...(a || []), ...(b || [])])]

/**
 * Tutup (sebagian/penuh) trade berjalan dengan order penutup dari file.
 * Exit sebagian yang sudah dicatat manual dengan harga & size yang sama
 * tidak dicatat dua kali. Fee yang sudah diisi tidak ditimpa.
 */
function closeWithFills(t, closes, offset) {
  let next = t
  const already = [...(t.exits || [])]
  for (const f of closes) {
    const dup = already.findIndex((e) => sameAmount(e.size, f.qty) && comparePrice(e.price, fillPrice(f)) != null)
    if (dup >= 0) { already.splice(dup, 1); continue }
    const ts = stampToISO(f.updateTime, offset) || new Date().toISOString()
    next = applyPartialExit(next, {
      size: f.qty,
      price: round7(f.avgPrice || f.price),
      fees: 0,
      date: dayOf(f),
      ts,
    }, { now: next.updatedAt || ts })
  }
  if (next.status === 'closed' && t.fees) next = { ...next, fees: t.fees }
  // applyPartialExit menambah label histori sendiri — sync punya labelnya sendiri.
  if (next !== t) next = { ...next, history: t.history || [] }
  return next
}

/**
 * Bandingkan satu posisi dari file dengan satu trade jurnal.
 * → { kind: 'same' | 'precision' | 'update' | 'review', after, diffs, reason? }
 */
function resolveMatch(p, t, period, { asClose = false } = {}) {
  const diffs = []
  let next = { ...t }
  const offset = period.offset

  if (asClose) {
    // Order di file adalah penutup trade ini (pembukanya di luar periode).
    const closes = [...p.opens, ...p.closes]
    if (t.status === 'closed') {
      const fileExit = wavg(closes)
      const d = deriveTrade(t)
      if (t.exits?.length) {
        if (comparePrice(d.avgExit, fileExit) == null) return { kind: 'same', after: next, diffs, note: 'exit tertimbang berbeda — jurnal dipertahankan' }
      } else {
        const m = comparePrice(t.exit, fileExit)
        if (m === 'precision' || m === null) {
          diffs.push({ field: 'exit', from: t.exit ?? null, to: fileExit, precision: m === 'precision' })
          next.exit = fileExit
        }
      }
    } else if (t.status === 'open') {
      const closed = closeWithFills(t, closes, offset)
      if (closed.status === 'closed') {
        diffs.push({ field: 'status', from: 'open', to: 'closed' })
        diffs.push({ field: 'exit', from: t.exit ?? null, to: closed.exit })
      } else if ((closed.exits || []).length !== (t.exits || []).length) {
        diffs.push({ field: 'exits', from: (t.exits || []).length, to: closed.exits.length })
      }
      next = closed
    }
    next.binanceOrders = union(t.binanceOrders, p.orderNos)
    return finish(t, next, diffs)
  }

  if (t.status === 'pending') {
    // Limit yang terisi di Binance: Open order → Berjalan, harga dari file.
    const ts = stampToISO(p.opens[0]?.updateTime, offset)
    next = { ...next, status: 'open', entry: p.entry, date: p.entryDate || t.date, fees: 0, ...(ts ? { filledAt: ts } : {}) }
    if (comparePrice(t.entry, p.entry) !== 'same') diffs.push({ field: 'entry', from: t.entry, to: p.entry })
    if (p.closes.length) next = closeWithFills(next, p.closes, offset)
    diffs.unshift({ field: 'status', from: 'pending', to: next.status })
    if (next.status === 'closed') diffs.push({ field: 'exit', from: null, to: next.exit })
    next.binanceOrders = union(t.binanceOrders, p.orderNos)
    return finish(t, next, diffs)
  }

  const me = comparePrice(t.entry, p.entry)
  if (me === 'precision') {
    diffs.push({ field: 'entry', from: t.entry, to: p.entry, precision: true })
    next.entry = p.entry
  }

  if (p.closes.length) {
    if (t.status === 'open') {
      const closed = closeWithFills(next, p.closes, offset)
      if (closed.status === 'closed') {
        diffs.push({ field: 'status', from: 'open', to: 'closed' })
        diffs.push({ field: 'exit', from: t.exit ?? null, to: closed.exit })
      } else if ((closed.exits || []).length !== (t.exits || []).length) {
        diffs.push({ field: 'exits', from: (t.exits || []).length, to: closed.exits.length })
      }
      next = closed
    } else if (t.status === 'closed' && p.closed) {
      if (t.exits?.length) {
        if (comparePrice(deriveTrade(t).avgExit, p.exit) == null) {
          return { kind: 'same', after: { ...next, binanceOrders: union(t.binanceOrders, p.orderNos) }, diffs, note: 'exit tertimbang berbeda — jurnal dipertahankan' }
        }
      } else {
        const mx = comparePrice(t.exit, p.exit)
        if (mx === 'precision' || mx === null) {
          diffs.push({ field: 'exit', from: t.exit ?? null, to: p.exit, precision: mx === 'precision' })
          next.exit = p.exit
        }
      }
    }
  }
  next.binanceOrders = union(t.binanceOrders, p.orderNos)
  return finish(t, next, diffs)
}

function finish(before, after, diffs) {
  const kind = !diffs.length ? 'same' : diffs.every((d) => d.precision) ? 'precision' : 'update'
  return { kind, after, diffs }
}

/** Trade baru dari posisi yang pembukanya ada di file. */
function tradeFromPosition(p, period, now) {
  const offset = period.offset
  const id = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
  const base = {
    id,
    createdAt: now,
    updatedAt: now,
    status: 'open',
    date: p.entryDate,
    closeDate: null,
    placedAt: null,
    filledAt: stampToISO(p.opens[0]?.updateTime, offset),
    pair: p.symbol,
    direction: p.direction,
    timeframe: '',
    entry: p.entry,
    exit: null,
    size: p.openQty,
    sizeMode: 'unit',
    leverage: null,
    fees: 0,
    sl: null,
    tp: null,
    markPrice: null,
    pnlOverride: null,
    tags: [],
    emotion: '',
    notes: '',
    closeNotes: '',
    shots: { setup: [], result: [] },
    exits: [],
    slAfter: null,
    history: [],
    source: 'binance',
    binanceOrders: p.orderNos,
  }
  if (!p.closes.length) return base
  if (p.closed && p.closes.length === 1) {
    return { ...base, status: 'closed', exit: p.exit, closeDate: p.closeDate }
  }
  if (p.closed) {
    // Beberapa order penutup: satu trade, exit tertimbang — sama seperti di form.
    return { ...base, status: 'closed', exit: p.exit, closeDate: p.closeDate }
  }
  return closeWithFills(base, p.closes, offset)
}

/* ─────────────────────────── rencana sync ─────────────────────────── */

const KIND_ORDER = { new: 0, update: 1, precision: 2, delete: 3 }

/**
 * Bandingkan isi file dengan jurnal. Tidak ada yang diubah di sini.
 *
 * → {
 *     period, counts,
 *     changes:  baris yang bisa dicentang (new | update | precision | delete)
 *     same:     trade yang sudah ada dan tidak berubah
 *     review:   posisi yang pembukanya tidak ada di file & tidak cocok dengan jurnal
 *     ignored:  order dibatalkan yang tidak cocok dengan open order mana pun
 *   }
 */
export function planSync(trades, parsed, { now = new Date().toISOString() } = {}) {
  const period = parsed.period || {}
  const positions = buildPositions(parsed.orders, trades, period)
  const claimed = new Set()
  const changes = []
  const same = []
  const review = []
  let n = 0
  const cid = () => `c${++n}`

  // Posisi yang di-seed: trade jurnal yang ditutup oleh order di file.
  for (const p of positions.filter((x) => x.seed)) {
    claimed.add(p.seed.id)
    if (!p.closed && !p.closes.length) continue
    if (p.opens.length) {
      review.push(reviewItem(cid(), p, 'order di file menambah posisi yang dibuka sebelum periode'))
      continue
    }
    const r = resolveMatch({ ...p, opens: [] }, p.seed, period, { asClose: true })
    pushResult(r, p, p.seed)
  }

  for (const p of positions.filter((x) => !x.seed)) {
    const t = findMatch(p, trades, claimed)
    if (t) {
      claimed.add(t.id)
      if (t.status === 'closed' && !p.closed) {
        // Jurnal bilang selesai, file bilang masih terbuka: jurnal yang menang.
        same.push({ id: cid(), trade: t, position: p, after: { ...t, binanceOrders: union(t.binanceOrders, p.orderNos) }, note: 'jurnal sudah menutup trade ini' })
        continue
      }
      pushResult(resolveMatch(p, t, period), p, t)
      continue
    }
    if (p.closed && !p.flipped) {
      changes.push({
        id: cid(), kind: 'new', position: p, before: null,
        after: tradeFromPosition(p, period, now), diffs: [],
      })
      continue
    }
    review.push(reviewItem(cid(), p, p.flipped
      ? 'arah posisi berbalik dalam satu order'
      : p.direction === 'long'
        ? 'tanpa pasangan — penutup Short yang dibuka sebelum periode, atau Long yang masih berjalan'
        : 'tanpa pasangan — penutup Long yang dibuka sebelum periode, atau Short yang masih berjalan'))
  }

  // Order dibatalkan: cocokkan dengan open order di jurnal (B5).
  const ignored = []
  const idle = parsed.orders.filter((o) => o.executed <= 0)
  for (const o of idle) {
    const dir = sideDir(o.side)
    const canceled = o.status === 'CANCELED' || o.status === 'EXPIRED'
    const t = trades.find((x) =>
      !claimed.has(x.id) && x.status === 'pending' && x.pair === o.symbol && x.direction === dir &&
      sameAmount(x.size, o.amount) && comparePrice(x.entry, o.price) != null)
    if (t && canceled) {
      claimed.add(t.id)
      changes.push({
        id: cid(), kind: 'delete', before: t, after: null, order: o,
        diffs: [{ field: 'status', from: 'pending', to: 'deleted' }],
      })
    } else if (t) {
      claimed.add(t.id)
      same.push({ id: cid(), trade: t, after: { ...t, binanceOrders: union(t.binanceOrders, [o.no]) }, note: 'limit masih terpasang di Binance' })
    } else {
      ignored.push({ id: cid(), order: o, reason: canceled ? 'dibatalkan' : 'masih terpasang' })
    }
  }

  changes.sort((a, b) =>
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    rowDate(b).localeCompare(rowDate(a)))

  return { period, counts: parsed.counts, changes, same, review, ignored, positions, now }

  function pushResult(r, p, t) {
    if (r.kind === 'same') {
      same.push({ id: cid(), trade: t, position: p, after: r.after, note: r.note })
    } else {
      changes.push({ id: cid(), kind: r.kind, position: p, before: t, after: r.after, diffs: r.diffs })
    }
  }
}

function reviewItem(id, p, reason) {
  const fills = [...p.opens, ...p.closes]
  return {
    id, kind: 'review', position: p, reason,
    symbol: p.symbol,
    side: fills[0]?.side,
    qty: p.opens.length ? p.openQty : p.closeQty,
    price: p.entry ?? wavg(fills),
    date: dayOf(fills[0]),
  }
}

/** Tanggal yang ditampilkan untuk satu baris perubahan. */
export function rowDate(c) {
  if (c.after) return effectiveDate(c.after) || ''
  if (c.order) return (c.order.updateTime || '').slice(0, 10)
  return c.before ? effectiveDate(c.before) : ''
}

/**
 * Trade jurnal yang bisa dipilih untuk "Cocokkan dengan trade…" pada satu
 * baris "Perlu ditinjau": pair sama, belum dipakai baris lain.
 */
export function reviewCandidates(item, trades, plan) {
  const used = new Set([
    ...plan.changes.map((c) => c.before?.id).filter(Boolean),
    ...plan.same.map((s) => s.trade?.id).filter(Boolean),
  ])
  return trades
    .filter((t) => t.pair === item.symbol && !used.has(t.id))
    .sort((a, b) => effectiveDate(b).localeCompare(effectiveDate(a)))
}

/**
 * Keputusan pengguna untuk satu baris "Perlu ditinjau" → baris perubahan.
 *   { type: 'match', tradeId } — order di file milik trade itu
 *   { type: 'running' }        — catat sebagai posisi berjalan baru
 */
export function resolveReview(item, decision, trades, plan) {
  const p = item.position
  if (decision?.type === 'running') {
    const after = tradeFromPosition({ ...p, closed: false }, plan.period, plan.now)
    return { id: `${item.id}-r`, kind: 'new', position: p, before: null, after, diffs: [], fromReview: item.id }
  }
  if (decision?.type === 'match') {
    const t = trades.find((x) => x.id === decision.tradeId)
    if (!t) return null
    const asClose = t.direction !== p.direction
    const r = resolveMatch(p, t, plan.period, { asClose })
    return {
      id: `${item.id}-m`,
      kind: r.kind === 'same' ? 'link' : r.kind,
      position: p, before: t, after: r.after, diffs: r.diffs, fromReview: item.id,
    }
  }
  return null
}

/* ─────────────────────────── menerapkan ─────────────────────────── */

const HISTORY_LABEL = {
  new: 'diimpor dari Binance',
  update: 'diperbarui dari sync Binance',
  precision: 'sync Binance · presisi 7 desimal',
  link: 'ditautkan ke order Binance',
}

/**
 * Terapkan baris yang dicentang. Murni — mengembalikan array trade baru.
 * Trade yang cocok tapi tidak berubah hanya mendapat Order No-nya.
 */
export function applySync(trades, plan, rows, { now = new Date().toISOString(), linkSame = true } = {}) {
  const replace = new Map()
  const remove = new Set()
  const added = []
  for (const c of rows) {
    if (c.kind === 'delete') { remove.add(c.before.id); continue }
    const label = HISTORY_LABEL[c.kind]
    const history = [...(c.after.history || []), ...(label ? [{ ts: now, label }] : [])]
    const next = { ...c.after, updatedAt: now, history }
    if (c.before) replace.set(c.before.id, next)
    else added.push(next)
  }
  if (linkSame) {
    for (const s of plan.same) {
      if (!s.trade || replace.has(s.trade.id) || remove.has(s.trade.id)) continue
      const nos = s.after?.binanceOrders || []
      const had = s.trade.binanceOrders || []
      if (nos.length && nos.some((x) => !had.includes(x))) replace.set(s.trade.id, { ...s.trade, binanceOrders: nos })
    }
  }
  return [
    ...trades.filter((t) => !remove.has(t.id)).map((t) => replace.get(t.id) || t),
    ...added,
  ]
}

/** Ringkasan untuk dialog konfirmasi: "2 baru · 1 diperbarui · 2 dirapikan · 1 open order dihapus". */
export function summarizeRows(rows) {
  const count = (k) => rows.filter((r) => r.kind === k).length
  const parts = []
  if (count('new')) parts.push(`${count('new')} baru`)
  if (count('update')) parts.push(`${count('update')} diperbarui`)
  if (count('precision')) parts.push(`${count('precision')} dirapikan`)
  if (count('link')) parts.push(`${count('link')} ditautkan`)
  if (count('delete')) parts.push(`${count('delete')} open order dihapus`)
  return parts.join(' · ')
}

/** Metrik periode file sebelum & sesudah sync. */
export function periodMetrics(trades, period) {
  const inPeriod = trades.filter((t) => {
    const d = effectiveDate(t)
    return (!period.from || d >= period.from) && (!period.to || d <= period.to)
  })
  const s = summarize(inPeriod)
  const withoutSl = inPeriod.filter((t) => t.status === 'closed' && (t.sl == null || t.sl === '')).length
  return { ...s, withoutSl }
}
