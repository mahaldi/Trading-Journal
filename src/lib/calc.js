/* ══════════════════════════════════════════════════════════════
   Semua perhitungan jurnal. Fungsi murni — mudah diuji, tanpa state.
   ══════════════════════════════════════════════════════════════ */

export const EMOTIONS = ['Confident', 'Calm', 'FOMO', 'Revenge', 'Hesitant', 'Bored']
export const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1']

const num = (v) => {
  if (v === '' || v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

export const dirMul = (direction) => (direction === 'short' ? -1 : 1)

const EPS = 1e-9

/**
 * Semua exit dari satu trade sebagai daftar tunggal — termasuk exit terakhir
 * yang masih disimpan di field lama `exit`/`fees`.
 *
 * Trade lama (tanpa `exits`) menghasilkan tepat satu leg berisi seluruh size,
 * jadi setiap perhitungan di bawah ini identik dengan versi sebelumnya.
 */
export function exitLegs(t) {
  const size = num(t.size)
  const legs = []

  for (const e of t.exits || []) {
    const price = num(e.price)
    const legSize = num(e.size)
    if (price == null || legSize == null || legSize <= 0) continue
    legs.push({
      id: e.id,
      ts: e.ts || null,
      date: e.date || (e.ts || '').slice(0, 10) || null,
      size: legSize,
      price,
      fees: num(e.fees) || 0,
      note: e.note || '',
      kind: 'partial',
    })
  }

  const partialSize = legs.reduce((s, l) => s + l.size, 0)
  const finalPrice = num(t.exit)
  if (t.status === 'closed' && finalPrice != null) {
    // Sisa posisi ditutup pada harga `exit`. Untuk trade tanpa partial,
    // sisa = seluruh size, persis seperti dulu.
    const rest = size != null ? size - partialSize : null
    const legSize = rest != null ? rest : null
    if (legSize != null && legSize > EPS) {
      legs.push({
        id: 'final',
        ts: t.updatedAt || null,
        date: t.closeDate || t.date || null,
        size: legSize,
        price: finalPrice,
        fees: num(t.fees) || 0,
        note: '',
        kind: 'final',
      })
    }
  }

  return legs
}

/** PnL kotor satu leg, sudah dikurangi fee leg itu sendiri. */
export function legPnl(leg, entry, mul) {
  if (entry == null) return null
  return (leg.price - entry) * leg.size * mul - leg.fees
}

/**
 * Turunkan semua angka dari satu trade.
 * Mengembalikan objek dengan nilai null bila datanya belum cukup.
 */
export function deriveTrade(t) {
  const entry = num(t.entry)
  const exit = num(t.exit)
  const sl = num(t.sl)
  const slAfter = num(t.slAfter) ?? sl
  const tp = num(t.tp)
  const size = num(t.size)
  const fees = num(t.fees) || 0
  const mark = num(t.markPrice)
  const mul = dirMul(t.direction)

  const notional = entry != null && size != null ? entry * size : null
  const riskPerUnit = entry != null && sl != null ? Math.abs(entry - sl) : null
  const riskAmount = riskPerUnit != null && size != null ? riskPerUnit * size : null
  const rewardPerUnit = entry != null && tp != null ? Math.abs(tp - entry) : null
  const rewardAmount = rewardPerUnit != null && size != null ? rewardPerUnit * size : null

  const plannedR =
    riskPerUnit != null && rewardPerUnit != null && riskPerUnit > 0
      ? rewardPerUnit / riskPerUnit
      : null

  const closed = t.status === 'closed'

  /* ── exit bertahap ── */
  const legs = exitLegs(t)
  const exitCount = legs.length
  const closedSize = legs.reduce((s, l) => s + l.size, 0)
  const remainingSize = size != null ? Math.max(0, size - closedSize) : null
  const closedPortion = size ? Math.min(1, closedSize / size) : null
  const remainingPortion = closedPortion != null ? 1 - closedPortion : null
  const isPartial = !closed && closedSize > EPS && (remainingSize ?? 0) > EPS
  const totalFees = legs.reduce((s, l) => s + l.fees, 0)

  // Rata-rata exit tertimbang — bukan harga exit terakhir.
  const avgExit = closedSize > EPS
    ? legs.reduce((s, l) => s + l.price * l.size, 0) / closedSize
    : null

  // PnL yang sudah benar-benar terkunci, walau trade masih berjalan.
  let realizedPnl = null
  if (entry != null && legs.length) {
    realizedPnl = legs.reduce((s, l) => s + legPnl(l, entry, mul), 0)
  }
  const realizedR = realizedPnl != null && riskAmount ? realizedPnl / riskAmount : null

  // grossPnl dipertahankan untuk trade satu-exit (dipakai di UI & tes lama).
  let grossPnl = null
  if (closed && entry != null && exit != null && size != null) {
    grossPnl = legs.length
      ? legs.reduce((s, l) => s + (l.price - entry) * l.size * mul, 0)
      : (exit - entry) * size * mul
  }

  const override = num(t.pnlOverride)
  let netPnl = null
  if (override != null) netPnl = override
  else if (closed && realizedPnl != null) netPnl = realizedPnl

  const actualR = netPnl != null && riskAmount ? netPnl / riskAmount : null

  // Floating hanya untuk sisa posisi yang masih di pasar.
  let floatingPnl = null
  let floatingR = null
  if (!closed && mark != null && entry != null && remainingSize != null && remainingSize > EPS) {
    floatingPnl = (mark - entry) * remainingSize * mul - fees
    if (riskAmount) floatingR = floatingPnl / riskAmount
  }

  // Risiko yang masih di meja: sisa size dikali jarak ke SL yang berlaku sekarang.
  const remainingRisk =
    entry != null && slAfter != null && remainingSize != null
      ? Math.abs(entry - slAfter) * remainingSize
      : null

  const deviationR = plannedR != null && actualR != null ? actualR - plannedR : null

  return {
    entry, exit, sl, slAfter, tp, size, fees, mark, mul,
    notional, riskPerUnit, riskAmount, rewardAmount,
    plannedR, grossPnl, netPnl, actualR,
    floatingPnl, floatingR, deviationR,
    legs, exitCount, closedSize, remainingSize,
    closedPortion, remainingPortion, isPartial,
    totalFees, avgExit, realizedPnl, realizedR, remainingRisk,
    outcome: outcomeOf(netPnl),
  }
}

export function outcomeOf(netPnl) {
  if (netPnl == null) return 'none'
  if (netPnl > 0.0000001) return 'win'
  if (netPnl < -0.0000001) return 'loss'
  return 'be'
}

/**
 * Kata untuk deviasi eksekusi — jurnal merekam kualitas eksekusi, bukan hasil saja.
 * Untuk trade scale-out, R di bawah rencana biasanya konsekuensi wajar dari
 * mengambil sebagian di TP1, jadi kata-katanya berbeda dari "SL kena".
 */
export function deviationLabel(d, { scaled = false } = {}) {
  if (d == null) return null
  if (Math.abs(d) <= 0.15) return { text: 'sesuai rencana', tone: 'flat' }
  if (d > 0) return { text: d > 0.5 ? 'exit lebih jauh dari rencana' : 'sedikit di atas rencana', tone: 'profit' }
  if (scaled) {
    return { text: d < -0.5 ? 'scale-out jauh di bawah target' : 'scale-out sedikit di bawah target', tone: 'loss' }
  }
  return { text: d < -0.5 ? 'exit terlalu cepat / SL kena' : 'sedikit di bawah rencana', tone: 'loss' }
}

/** Tanggal yang dipakai untuk mengurutkan pada kurva & kalender. */
export function effectiveDate(t) {
  return t.closeDate || t.date || (t.createdAt || '').slice(0, 10)
}

export const closedTrades = (trades) => trades.filter((t) => t.status === 'closed')
export const openTrades = (trades) => trades.filter((t) => t.status !== 'closed')

/** Urut menaik berdasarkan tanggal efektif, lalu waktu pembuatan. */
export function sortByDate(trades, dir = 1) {
  return [...trades].sort((a, b) => {
    const d = effectiveDate(a).localeCompare(effectiveDate(b))
    if (d !== 0) return d * dir
    return String(a.createdAt || '').localeCompare(String(b.createdAt || '')) * dir
  })
}

/**
 * Rangkuman metrik dari sekumpulan trade yang sudah ditutup.
 * Posisi berjalan sengaja tidak dihitung — belum ada hasil untuk dinilai.
 */
export function summarize(trades) {
  const closed = closedTrades(trades)
  const rows = closed.map((t) => ({ t, d: deriveTrade(t) })).filter((x) => x.d.netPnl != null)

  let netPnl = 0, sumWin = 0, sumLoss = 0
  let wins = 0, losses = 0, be = 0
  const rs = [], plannedRs = []
  const days = new Set()

  for (const { t, d } of rows) {
    netPnl += d.netPnl
    if (d.outcome === 'win') { wins++; sumWin += d.netPnl }
    else if (d.outcome === 'loss') { losses++; sumLoss += d.netPnl }
    else be++
    if (d.actualR != null) rs.push(d.actualR)
    if (d.plannedR != null) plannedRs.push(d.plannedR)
    days.add(effectiveDate(t))
  }

  const total = rows.length
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null)

  // Runtun kemenangan terpanjang
  let streak = 0, bestStreak = 0, lossStreak = 0, worstStreak = 0
  for (const { d } of sortByDate(rows.map((r) => r.t)).map((t) => ({ d: deriveTrade(t) }))) {
    if (d.outcome === 'win') { streak++; lossStreak = 0; bestStreak = Math.max(bestStreak, streak) }
    else if (d.outcome === 'loss') { lossStreak++; streak = 0; worstStreak = Math.max(worstStreak, lossStreak) }
    else { streak = 0; lossStreak = 0 }
  }

  const curve = equityCurve(closed)
  let peak = 0, maxDD = 0, maxDDPct = 0
  for (const p of curve) {
    peak = Math.max(peak, p.equity)
    const dd = p.equity - peak
    if (dd < maxDD) {
      maxDD = dd
      maxDDPct = peak > 0 ? (dd / peak) * 100 : 0
    }
  }

  return {
    netPnl, total, wins, losses, be,
    winRate: total ? (wins / total) * 100 : null,
    profitFactor: sumLoss !== 0 ? sumWin / Math.abs(sumLoss) : sumWin > 0 ? Infinity : null,
    avgWin: wins ? sumWin / wins : null,
    avgLoss: losses ? sumLoss / losses : null,
    avgR: mean(rs),
    avgPlannedR: mean(plannedRs),
    expectancy: mean(rs),
    bestStreak, worstStreak,
    maxDD, maxDDPct,
    activeDays: days.size,
    tradesPerDay: days.size ? total / days.size : null,
    curve,
  }
}

/** Deret kumulatif PnL. Titik pertama adalah nol agar garis mulai dari dasar. */
export function equityCurve(trades) {
  const rows = sortByDate(closedTrades(trades))
  let equity = 0
  let rSum = 0
  const out = []
  for (const t of rows) {
    const d = deriveTrade(t)
    if (d.netPnl == null) continue
    equity += d.netPnl
    if (d.actualR != null) rSum += d.actualR
    out.push({
      date: effectiveDate(t),
      equity,
      rEquity: rSum,
      pnl: d.netPnl,
      r: d.actualR,
      trade: t,
    })
  }
  return out
}

/** Rangkum PnL per hari untuk heatmap kalender. */
export function dailyTotals(trades) {
  const map = new Map()
  for (const t of closedTrades(trades)) {
    const d = deriveTrade(t)
    if (d.netPnl == null) continue
    const key = effectiveDate(t)
    const cur = map.get(key) || { date: key, pnl: 0, r: 0, count: 0, trades: [] }
    cur.pnl += d.netPnl
    if (d.actualR != null) cur.r += d.actualR
    cur.count++
    cur.trades.push(t)
    map.set(key, cur)
  }
  return map
}

/**
 * Kelompokkan trade menurut satu dimensi lalu hitung performanya.
 * dimension: 'tags' | 'pair' | 'emotion' | 'timeframe' | 'direction'
 */
export function groupPerformance(trades, dimension) {
  const buckets = new Map()
  const push = (key, t) => {
    if (!key) key = '—'
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(t)
  }
  for (const t of closedTrades(trades)) {
    if (dimension === 'tags') {
      const tags = t.tags?.length ? t.tags : ['(tanpa tag)']
      for (const tag of tags) push(tag, t)
    } else {
      push(t[dimension], t)
    }
  }
  const rows = [...buckets.entries()].map(([key, list]) => {
    const s = summarize(list)
    return {
      key,
      count: s.total,
      winRate: s.winRate,
      avgR: s.avgR,
      expectancy: s.expectancy,
      netPnl: s.netPnl,
      trades: list,
    }
  })
  return rows.sort((a, b) => b.netPnl - a.netPnl)
}

/** Sebaran R untuk histogram: bucket 0.5R dari −3R sampai +5R. */
export function rDistribution(trades) {
  const edges = [-3, -2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]
  const bins = edges.slice(0, -1).map((lo, i) => ({ lo, hi: edges[i + 1], count: 0 }))
  for (const t of closedTrades(trades)) {
    const { actualR } = deriveTrade(t)
    if (actualR == null) continue
    const clamped = Math.max(edges[0], Math.min(actualR, edges[edges.length - 1] - 0.001))
    const idx = bins.findIndex((b) => clamped >= b.lo && clamped < b.hi)
    if (idx >= 0) bins[idx].count++
  }
  return bins
}

/** Semua tag yang pernah dipakai, dengan performanya. */
export function tagLibrary(trades) {
  const rows = groupPerformance(trades, 'tags').filter((r) => r.key !== '(tanpa tag)')
  const now = Date.now()
  return rows.map((r) => {
    const sorted = sortByDate(r.trades, -1)
    const last = sorted[0]
    const lastUsed = last ? effectiveDate(last) : null
    const daysSince = lastUsed ? Math.floor((now - new Date(lastUsed + 'T00:00:00').getTime()) / 86400000) : null
    const spark = sortByDate(r.trades).slice(-5).map((t) => deriveTrade(t).netPnl || 0)
    return { ...r, lastUsed, daysSince, spark, stale: daysSince != null && daysSince > 90 }
  })
}

export function allTags(trades) {
  const set = new Set()
  for (const t of trades) for (const tag of t.tags || []) set.add(tag)
  return [...set].sort((a, b) => a.localeCompare(b))
}

/* ══════════════════════════════════════════════════════════════
   Tutup sebagian posisi
   ══════════════════════════════════════════════════════════════ */

/** Trade yang sebagian posisinya sudah ditutup tapi belum selesai. */
export const isPartiallyClosed = (t) => deriveTrade(t).isPartial

export const partialTrades = (trades) => trades.filter(isPartiallyClosed)

export function newExitId() {
  return `x_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Tambahkan satu exit sebagian ke sebuah trade dan kembalikan trade baru.
 * Murni — tidak menyentuh objek aslinya.
 *
 * `leg.size` adalah jumlah unit yang keluar (bukan persen). Bila sisa posisi
 * habis, trade otomatis menjadi 'closed': leg terakhir dipindahkan ke field
 * `exit`/`fees` supaya bentuk datanya sama dengan trade satu-exit.
 */
export function applyPartialExit(trade, leg, { now = new Date().toISOString() } = {}) {
  const t = { ...trade }
  const size = Number(t.size)
  const prior = deriveTrade(t)
  const legSize = Math.min(Number(leg.size), prior.remainingSize ?? Number(leg.size))
  if (!Number.isFinite(legSize) || legSize <= 0) return trade

  const entry = {
    id: leg.id || newExitId(),
    ts: leg.ts || now,
    date: leg.date || (leg.ts || now).slice(0, 10),
    size: legSize,
    price: Number(leg.price),
    fees: Number(leg.fees) || 0,
    note: leg.note || '',
  }

  const exits = [...(t.exits || []), entry]
  const closedSize = exits.reduce((s, e) => s + Number(e.size), 0)
  const rest = size - closedSize
  const portionPct = size ? Math.round((legSize / size) * 1000) / 10 : null
  const history = [...(t.history || [])]

  if (rest <= 1e-9) {
    // Leg terakhir jadi exit penuh; sisanya tetap tercatat di daftar exit.
    exits.pop()
    history.push({ ts: now, label: exits.length ? `ditutup penuh · sisa ${portionPct}%` : 'ditutup' })
    return {
      ...t,
      exits,
      status: 'closed',
      exit: entry.price,
      fees: entry.fees,
      closeDate: entry.date,
      closeNotes: entry.note || t.closeNotes || '',
      markPrice: null,
      slAfter: leg.slAfter ?? t.slAfter ?? null,
      updatedAt: now,
      history,
    }
  }

  history.push({ ts: now, label: `ditutup sebagian ${portionPct}% @ ${entry.price}` })
  return {
    ...t,
    exits,
    status: 'open',
    exit: null,
    closeDate: null,
    slAfter: leg.slAfter ?? t.slAfter ?? null,
    updatedAt: now,
    history,
  }
}
