/* Pemformat angka & tanggal — dipakai di seluruh app agar konsisten. */

const MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const MONTHS_ID_FULL = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli',
  'Agustus', 'September', 'Oktober', 'November', 'Desember']
export const DAYS_ID = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']

export function money(v, { sign = true, decimals = 2 } = {}) {
  if (v == null || !Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  const body = abs.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  const prefix = v < 0 ? '−' : sign && v > 0 ? '+' : ''
  return `${prefix}$${body}`
}

export function moneyCompact(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  const prefix = v < 0 ? '−' : v > 0 ? '+' : ''
  if (abs >= 1000) return `${prefix}$${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`
  return `${prefix}$${Math.round(abs)}`
}

export function num(v, decimals = 2) {
  if (v == null || !Number.isFinite(v)) return '—'
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

/** Harga: presisi menyesuaikan besaran, tanpa nol berlebih. */
export function price(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  const decimals = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 5 : 8
  return v
    .toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: decimals })
}

export function size(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  const decimals = abs >= 1000 ? 0 : abs >= 1 ? 3 : 6
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: decimals })
}

export function rVal(v, { sign = true } = {}) {
  if (v == null || !Number.isFinite(v)) return '—'
  const prefix = v < 0 ? '−' : sign && v > 0 ? '+' : ''
  return `${prefix}${Math.abs(v).toFixed(2)}R`
}

export function pct(v, decimals = 1) {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v.toFixed(decimals)}%`
}

/** '2026-08-19' → '19 Agu' */
export function shortDate(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${d} ${MONTHS_ID[m - 1]}`
}

/** '2026-08-19' → '19 Agustus 2026' */
export function longDate(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${d} ${MONTHS_ID_FULL[m - 1]} ${y}`
}

export function monthLabel(year, monthIdx, full = false) {
  return `${(full ? MONTHS_ID_FULL : MONTHS_ID)[monthIdx]} ${year}`
}

/** ISO timestamp → '19 Agu 21:04' */
export function stamp(iso) {
  if (!iso) return '—'
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return '—'
  const hh = String(dt.getHours()).padStart(2, '0')
  const mm = String(dt.getMinutes()).padStart(2, '0')
  return `${dt.getDate()} ${MONTHS_ID[dt.getMonth()]} ${hh}:${mm}`
}

/** Durasi sejak `iso` sampai `now` → '12m', '6j', '3h' (menit · jam · hari). */
export function ago(iso, now = Date.now()) {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const mins = Math.max(0, Math.floor((now - t) / 60000))
  if (mins < 1) return 'baru saja'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}j`
  return `${Math.floor(hours / 24)}h`
}

export function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function fileSize(bytes) {
  if (!Number.isFinite(bytes)) return ''
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

/** Kelas warna sesuai hasil: hijau/merah/netral. */
export function toneClass(v) {
  if (v == null || !Number.isFinite(v)) return 'flat'
  if (v > 0.0000001) return 'profit'
  if (v < -0.0000001) return 'loss'
  return 'flat'
}
