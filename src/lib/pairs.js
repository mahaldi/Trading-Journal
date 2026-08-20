/* ══════════════════════════════════════════════════════════════
   Katalog pair + deteksi unit dasar (base) untuk toggle Position Size.
   ══════════════════════════════════════════════════════════════ */

export const SEED_PAIRS = [
  // Crypto perp / spot
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT',
  'AVAXUSDT', 'LINKUSDT', 'MATICUSDT', 'DOTUSDT', 'ATOMUSDT', 'LTCUSDT',
  'ARBUSDT', 'OPUSDT', 'APTUSDT', 'SUIUSDT', 'INJUSDT', 'TIAUSDT', 'NEARUSDT',
  'FILUSDT', 'TRXUSDT', 'PEPEUSDT', 'WIFUSDT', 'SEIUSDT',
  'BTCUSD', 'ETHUSD', 'BTCUSDC', 'ETHUSDC', 'ETHBTC', 'SOLBTC',
  // Forex major
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'NZDUSD', 'USDCAD',
  // Forex cross
  'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'CHFJPY', 'EURAUD', 'EURCHF',
  'GBPAUD', 'CADJPY', 'NZDJPY', 'AUDNZD', 'USDIDR', 'USDSGD',
  // Logam & energi
  'XAUUSD', 'XAGUSD', 'XPTUSD', 'USOIL', 'UKOIL', 'NATGAS',
  // Indeks
  'US30', 'US100', 'US500', 'NAS100', 'SPX500', 'GER40', 'UK100', 'JP225', 'HK50',
]

const QUOTES = [
  'USDT', 'USDC', 'BUSD', 'TUSD', 'FDUSD', 'USD', 'IDR', 'JPY', 'EUR', 'GBP',
  'AUD', 'NZD', 'CAD', 'CHF', 'SGD', 'BTC', 'ETH', 'BNB',
]

const INDEX_LIKE = /^(US30|US100|US500|NAS100|SPX500|GER40|UK100|JP225|HK50|USOIL|UKOIL|NATGAS|DE40|FRA40|AUS200)$/i

const METAL_LABEL = { XAU: 'oz', XAG: 'oz', XPT: 'oz', XPD: 'oz' }

const FX_CODES = new Set([
  'EUR', 'GBP', 'USD', 'JPY', 'CHF', 'AUD', 'NZD', 'CAD', 'SGD', 'IDR',
  'HKD', 'SEK', 'NOK', 'TRY', 'ZAR', 'MXN', 'CNH',
])

/**
 * Pisahkan pair menjadi base & quote.
 * BTCUSDT → { base:'BTC', quote:'USDT' } · EURUSD → { base:'EUR', quote:'USD' }
 */
export function splitPair(pair) {
  const p = String(pair || '').trim().toUpperCase().replace(/[\/\-_\s]/g, '')
  if (!p) return { base: '', quote: '', kind: 'unknown' }

  if (INDEX_LIKE.test(p)) return { base: p, quote: 'USD', kind: 'index' }

  // Urutkan quote dari yang terpanjang agar USDT menang atas USD
  const sorted = [...QUOTES].sort((a, b) => b.length - a.length)
  for (const q of sorted) {
    if (p.length > q.length && p.endsWith(q)) {
      const base = p.slice(0, p.length - q.length)
      let kind = 'crypto'
      if (METAL_LABEL[base]) kind = 'metal'
      else if (FX_CODES.has(base) && FX_CODES.has(q)) kind = 'fx'
      return { base, quote: q, kind }
    }
  }
  return { base: p, quote: '', kind: 'unknown' }
}

/** Label unit yang dipakai pada toggle Position Size. */
export function baseUnitLabel(pair) {
  const { base, kind } = splitPair(pair)
  if (!base) return 'Unit'
  if (kind === 'metal') return `${METAL_LABEL[base] || 'oz'} ${base}`
  if (kind === 'index') return 'kontrak'
  return base
}

/** Label pendek untuk ditampilkan di sebelah angka size, mis. "0.25 BTC". */
export function baseUnitShort(pair) {
  const { base, kind } = splitPair(pair)
  if (!base) return ''
  if (kind === 'metal') return METAL_LABEL[base] || 'oz'
  if (kind === 'index') return 'kontrak'
  return base
}

/** Deskripsi kategori pair untuk daftar autocomplete. */
export function pairKindLabel(pair) {
  const { kind } = splitPair(pair)
  return { crypto: 'Kripto', fx: 'Forex', metal: 'Logam', index: 'Indeks' }[kind] || ''
}

/**
 * Gabungkan pair bawaan dengan pair dari riwayat trade.
 * Pair yang pernah dipakai muncul lebih dulu, dengan jumlah pemakaian.
 */
export function buildPairIndex(trades) {
  const counts = new Map()
  for (const t of trades) {
    if (!t.pair) continue
    const key = t.pair.toUpperCase()
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  const used = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([symbol, count]) => ({ symbol, count }))
  const usedSet = new Set(used.map((u) => u.symbol))
  const seeds = SEED_PAIRS.filter((s) => !usedSet.has(s)).map((symbol) => ({ symbol, count: 0 }))
  return [...used, ...seeds]
}

/** Cari pair yang cocok dengan query. Prefix-match menang atas substring. */
export function searchPairs(index, query, limit = 8) {
  const q = String(query || '').trim().toUpperCase().replace(/[\/\-_\s]/g, '')
  if (!q) return index.slice(0, limit)
  const starts = []
  const contains = []
  for (const item of index) {
    if (item.symbol.startsWith(q)) starts.push(item)
    else if (item.symbol.includes(q)) contains.push(item)
  }
  return [...starts, ...contains].slice(0, limit)
}
