/* ══════════════════════════════════════════════════════════════
   Jembatan ke server file. Tidak ada localStorage, tidak ada IndexedDB —
   semua data adalah file nyata di folder ./data pada komputer ini:

     data/trades.json        seluruh trade
     data/settings.json      pengaturan
     data/images/<id>.png    tiap screenshot

   Gambar cukup dirujuk lewat URL (/api/images/<id>), jadi <img src> bisa
   dipakai langsung tanpa perlu membaca blob ke memori.
   ══════════════════════════════════════════════════════════════ */

async function req(url, options) {
  const res = await fetch(url, options)
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      if (body?.error) detail = body.error
    } catch {}
    throw new Error(detail)
  }
  return res.status === 204 ? null : res.json()
}

/* ─────────────────────────── trades ─────────────────────────── */

export function loadTrades() {
  return req('/api/trades')
}

export function saveTrades(trades) {
  return req('/api/trades', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(trades),
  })
}

/* ─────────────────────────── settings ─────────────────────────── */

export function loadSettings() {
  return req('/api/settings')
}

export function saveSettings(settings) {
  return req('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
}

/* ─────────────────────────── images ─────────────────────────── */

/** URL gambar untuk dipasang langsung ke <img src>. */
export function imageURL(id) {
  return id ? `/api/images/${id}` : null
}

/**
 * Unggah satu gambar; file ditulis ke data/images/ oleh server.
 * Mengembalikan { id, name, size, type, url }.
 */
export async function putImage(blob, name) {
  const form = new FormData()
  form.append('file', blob, name || 'screenshot.png')
  const res = await fetch('/api/images', { method: 'POST', body: form })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      if (body?.error) detail = body.error
    } catch {}
    throw new Error(detail)
  }
  return res.json()
}

export async function deleteImage(id) {
  if (!id) return
  try {
    await req(`/api/images/${id}`, { method: 'DELETE' })
  } catch (err) {
    console.error('[storage] gagal menghapus gambar:', err.message)
  }
}

/** Buang gambar yang tidak lagi dirujuk trade manapun. */
export function pruneImages() {
  return req('/api/images/prune', { method: 'POST' }).catch(() => ({ removed: 0 }))
}

/** Lokasi file sebenarnya di disk — ditampilkan di dialog pengaturan. */
export function getStatus() {
  return req('/api/status')
}
