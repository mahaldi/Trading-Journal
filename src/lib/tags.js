/* ══════════════════════════════════════════════════════════════
   Aturan tag: normalisasi nama, deteksi ejaan mirip, dan statistik
   yang ditampilkan di daftar pilihan.
   ══════════════════════════════════════════════════════════════ */

/** Saran bawaan — hanya muncul selama pustaka tag masih kosong. */
export const SEED_TAG_SUGGESTIONS = ['Breakout', 'Pullback', 'MeanRev', 'NewsPlay']

/** Batas lunak: di atas ini statistik per-tag mulai kehilangan makna. */
export const SOFT_TAG_LIMIT = 5

/**
 * Rapikan nama tag: buang '#', spasi jadi '_', tiap kata berhuruf awal kapital.
 * "liquidity sweep" → "Liquidity_Sweep"
 *
 * Hanya huruf pertama tiap kata yang disentuh, sisanya dibiarkan apa adanya,
 * sehingga singkatan yang sengaja ditulis kapital tetap utuh: "RSI_Div".
 */
export function normalizeTag(raw) {
  const cleaned = String(raw || '')
    .trim()
    .replace(/^#+/, '')
    .replace(/[^\p{L}\p{N}_\s-]/gu, '')
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  if (!cleaned) return ''
  return cleaned
    .split('_')
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join('_')
}

/** Jarak edit Levenshtein — untuk menangkap salah ketik. */
function levenshtein(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
    prev = cur
  }
  return prev[b.length]
}

/**
 * Tag yang mungkin maksudnya sama — supaya tidak muncul dua ejaan
 * untuk hal yang sama. Cocok bila salah ketik (jarak ≤ 2) atau
 * berbagi satu kata penyusun ("Liquidity_Sweep" ~ "Liquidity_Grab").
 */
export function similarTags(candidate, existing, limit = 2) {
  const c = normalizeTag(candidate).toLowerCase()
  if (!c) return []
  const cTokens = new Set(c.split('_').filter((t) => t.length > 2))
  const hits = []
  for (const tag of existing) {
    const e = tag.toLowerCase()
    if (e === c) continue
    const dist = levenshtein(e, c)
    const shared = e.split('_').filter((t) => t.length > 2).some((t) => cTokens.has(t))
    if (dist <= 2 || shared) hits.push({ tag, score: dist })
  }
  return hits.sort((a, b) => a.score - b.score).slice(0, limit).map((h) => h.tag)
}

/**
 * Statistik per tag untuk ditampilkan di daftar pilihan:
 * { Breakout: { count: 46, netPnl: 2140 } }
 */
export function buildTagStats(library) {
  const map = {}
  for (const row of library) {
    map[row.key] = { count: row.count, netPnl: row.netPnl }
  }
  return map
}

/**
 * Urutkan kandidat: frekuensi dulu, lalu kemiripan teks dengan query.
 * Prefix-match selalu menang atas substring.
 */
export function rankTags(candidates, stats, query) {
  const q = normalizeTag(query).toLowerCase()
  const scored = candidates
    .map((tag) => {
      const t = tag.toLowerCase()
      if (q && !t.includes(q)) return null
      return { tag, prefix: q && t.startsWith(q) ? 0 : 1, count: stats[tag]?.count || 0 }
    })
    .filter(Boolean)
  return scored
    .sort((a, b) => a.prefix - b.prefix || b.count - a.count || a.tag.localeCompare(b.tag))
    .map((s) => s.tag)
}
