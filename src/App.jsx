import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Dashboard from './pages/Dashboard'
import Calendar from './pages/Calendar'
import Stats from './pages/Stats'
import Tags from './pages/Tags'
import TradeForm from './components/TradeForm'
import { Segmented, Lightbox, Confirm } from './components/ui'
import {
  loadTrades, saveTrades, loadSettings, saveSettings,
  deleteImage, pruneImages, getStatus,
} from './lib/storage'
import { normalize as normalizeShots, allShots } from './components/ScreenshotSlots'
import { buildPairIndex } from './lib/pairs'
import { allTags, effectiveDate, tagLibrary } from './lib/calc'
import { buildTagStats } from './lib/tags'
import { fileSize } from './lib/format'

const PAGES = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'calendar', label: 'Kalender' },
  { key: 'stats', label: 'Statistik' },
  { key: 'tags', label: 'Tag' },
]

const RANGES = [
  { value: '7', label: '7H' },
  { value: '30', label: '30H' },
  { value: 'ytd', label: 'YTD' },
  { value: 'all', label: 'Semua' },
]

export default function App() {
  const [trades, setTrades] = useState([])
  const [settings, setSettings] = useState({ startingBalance: 10000 })
  const [boot, setBoot] = useState({ loading: true, error: null })
  const [saveState, setSaveState] = useState('idle') // idle | saving | saved | error
  const [status, setStatus] = useState(null)

  const [page, setPage] = useState('dashboard')
  const [range, setRange] = useState('all')
  const [form, setForm] = useState({ open: false, mode: 'create', trade: null })
  const [lightbox, setLightbox] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [newTradeId, setNewTradeId] = useState(null)
  const [showSettings, setShowSettings] = useState(false)

  // Jangan menulis balik ke disk sebelum pembacaan awal selesai —
  // kalau tidak, file bisa tertimpa array kosong saat app baru dibuka.
  const hydrated = useRef(false)
  const saveTimer = useRef(null)

  /* ── baca file saat app dibuka ── */
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [t, s] = await Promise.all([loadTrades(), loadSettings()])
        if (cancelled) return
        // Trade lama menyimpan satu gambar per slot; versi ini memakai array.
        // Migrasi dilakukan saat baca, jadi gambar lama tetap tampil.
        setTrades(
          (Array.isArray(t) ? t : []).map((tr) => ({ ...tr, shots: normalizeShots(tr.shots) }))
        )
        setSettings({ startingBalance: 10000, ...(s || {}) })
        setBoot({ loading: false, error: null })
        hydrated.current = true
        pruneImages().then(refreshStatus)
      } catch (err) {
        if (!cancelled) setBoot({ loading: false, error: err.message })
      }
    })()
    return () => { cancelled = true }
  }, [])

  const refreshStatus = useCallback(() => {
    getStatus().then(setStatus).catch(() => {})
  }, [])

  /* ── tulis trades.json setiap ada perubahan (ditunda sesaat) ── */
  useEffect(() => {
    if (!hydrated.current) return
    setSaveState('saving')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        await saveTrades(trades)
        setSaveState('saved')
        setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 1800)
      } catch (err) {
        console.error(err)
        setSaveState('error')
      }
    }, 350)
    return () => clearTimeout(saveTimer.current)
  }, [trades])

  useEffect(() => {
    if (!hydrated.current) return
    saveSettings(settings).catch((err) => console.error('[settings]', err.message))
  }, [settings])

  /* ── pintasan: N membuka panel entri ── */
  useEffect(() => {
    function onKey(e) {
      if (form.open || confirmDelete || showSettings) return
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        openCreate()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [form.open, confirmDelete, showSettings])

  const pairIndex = useMemo(() => buildPairIndex(trades), [trades])
  const tagSuggestions = useMemo(() => allTags(trades), [trades])
  // Tiap opsi tag membawa jumlah pemakaian dan net PnL-nya, jadi memilih
  // tag sekaligus mengingatkan performa strategi itu.
  const tagStats = useMemo(() => buildTagStats(tagLibrary(trades)), [trades])

  const ranged = useMemo(() => {
    if (range === 'all') return trades
    const now = new Date()
    let cutoff
    if (range === 'ytd') cutoff = `${now.getFullYear()}-01-01`
    else {
      const d = new Date(now)
      d.setDate(d.getDate() - Number(range))
      cutoff = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    return trades.filter((t) => effectiveDate(t) >= cutoff)
  }, [trades, range])

  /* ─────────────────────────── aksi trade ─────────────────────────── */

  const openCreate = useCallback(() => setForm({ open: true, mode: 'create', trade: null }), [])
  const openEdit = useCallback((t) => setForm({ open: true, mode: 'edit', trade: t }), [])
  const openClose = useCallback((t) => setForm({ open: true, mode: 'close', trade: t }), [])

  function handleSave(trade, isNew) {
    const wasClosing = form.mode === 'close'
    setTrades((prev) => {
      const idx = prev.findIndex((t) => t.id === trade.id)
      if (idx === -1) return [...prev, trade]
      const next = [...prev]
      next[idx] = trade
      return next
    })
    setForm({ open: false, mode: 'create', trade: null })
    if (isNew || wasClosing) {
      setPage('dashboard')
      setNewTradeId(trade.id)
      setTimeout(() => setNewTradeId(null), 1600)
    }
    setTimeout(refreshStatus, 600)
  }

  function handleDelete(t) {
    for (const shot of allShots(t.shots)) {
      if (shot?.id) deleteImage(shot.id)
    }
    setTrades((prev) => prev.filter((x) => x.id !== t.id))
    setConfirmDelete(null)
    setTimeout(refreshStatus, 600)
  }

  /* ─────────────────────────── aksi tag ─────────────────────────── */

  const renameTag = (from, to) =>
    setTrades((prev) => prev.map((t) => ({
      ...t,
      tags: [...new Set((t.tags || []).map((x) => (x === from ? to : x)))],
    })))

  const mergeTag = (from, into) => renameTag(from, into)

  const deleteTag = (tag) =>
    setTrades((prev) => prev.map((t) => ({ ...t, tags: (t.tags || []).filter((x) => x !== tag) })))

  /* ─────────────────────────── tampilan ─────────────────────────── */

  if (boot.loading) {
    return <div className="empty-state" style={{ paddingTop: 160 }}>Membaca data/trades.json…</div>
  }

  if (boot.error) {
    return (
      <div className="empty-state" style={{ paddingTop: 140, maxWidth: 560, margin: '0 auto' }}>
        <h4 style={{ margin: 0, color: 'var(--color-loss)' }}>Server file tidak merespons</h4>
        <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--color-neutral-400)' }}>
          App ini membaca dan menulis file di folder <span className="mono">data/</span>, jadi server
          kecilnya harus hidup. Jalankan lagi dengan satu perintah:
        </p>
        <div className="mono inset-box" style={{ padding: '10px 14px', fontSize: 13, color: 'var(--color-accent)' }}>
          npm run dev
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--color-neutral-700)' }}>{boot.error}</div>
        <button className="btn btn-secondary" onClick={() => window.location.reload()}>Coba lagi</button>
      </div>
    )
  }

  return (
    <>
      <div className="nav">
        <span className="nav-brand">My Trading Journey</span>
        {PAGES.map((p) => (
          <button
            key={p.key}
            className={'nav-link' + (page === p.key ? ' is-active' : '')}
            onClick={() => setPage(p.key)}
          >
            {p.label}
          </button>
        ))}
        {page !== 'calendar' && (
          <Segmented options={RANGES} value={range} onChange={setRange} small style={{ marginLeft: 'var(--space-4)' }} />
        )}

        <SaveIndicator state={saveState} />

        <button
          className="btn btn-secondary btn-sm"
          onClick={() => { refreshStatus(); setShowSettings(true) }}
          title="Pengaturan & lokasi file"
        >
          ⚙
        </button>
        <button className="btn btn-primary" onClick={openCreate}>
          + Trade Baru <span className="kbd">N</span>
        </button>
      </div>

      <div className="page">
        {page === 'dashboard' && (
          <Dashboard
            trades={ranged}
            allTrades={trades}
            settings={settings}
            onNew={openCreate}
            onEdit={openEdit}
            onCloseTrade={openClose}
            onDelete={(t) => setConfirmDelete(t)}
            onLightbox={setLightbox}
            newTradeId={newTradeId}
          />
        )}
        {page === 'calendar' && <Calendar trades={trades} onPickTrade={openEdit} />}
        {page === 'stats' && <Stats trades={ranged} />}
        {page === 'tags' && (
          <Tags trades={ranged} onRenameTag={renameTag} onMergeTag={mergeTag} onDeleteTag={deleteTag} />
        )}
      </div>

      <TradeForm
        open={form.open}
        mode={form.mode}
        trade={form.trade}
        pairIndex={pairIndex}
        tagSuggestions={tagSuggestions}
        tagStats={tagStats}
        onSave={handleSave}
        onClose={() => setForm({ open: false, mode: 'create', trade: null })}
        onLightbox={setLightbox}
      />

      <Lightbox view={lightbox} onClose={() => setLightbox(null)} />

      <Confirm
        open={!!confirmDelete}
        title="Hapus trade ini?"
        body={`${confirmDelete?.pair || ''} — barisnya dihapus dari data/trades.json dan file screenshot-nya dihapus dari data/images/.`}
        confirmLabel="Hapus"
        danger
        onConfirm={() => handleDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />

      {showSettings && (
        <div className="dialog-backdrop" onClick={() => setShowSettings(false)}>
          <div className="dialog" style={{ width: 'min(560px, 100%)' }} onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">Pengaturan &amp; data</div>

            <div className="field">
              <label htmlFor="s-bal">
                Saldo awal akun <span style={{ color: 'var(--color-neutral-600)' }}>· untuk kurva mode %</span>
              </label>
              <input
                id="s-bal"
                className="input mono"
                inputMode="decimal"
                value={settings.startingBalance}
                onChange={(e) => setSettings({ ...settings, startingBalance: parseFloat(e.target.value) || 0 })}
              />
            </div>

            <div className="divider" style={{ margin: 'var(--space-2) 0' }} />

            <div className="section-step" style={{ marginBottom: 0 }}>Lokasi file di komputer ini</div>
            {status ? (
              <div className="inset-box" style={{ padding: 'var(--space-3) var(--space-4)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <FileRow label="Trade" value={status.tradesFile} meta={`${status.tradeCount} trade`} />
                <FileRow label="Gambar" value={status.imagesDir + '/'} meta={`${status.imageCount} file · ${fileSize(status.imageBytes)}`} />
              </div>
            ) : (
              <div className="mono" style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>memuat…</div>
            )}

            <div style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.6 }}>
              Semuanya file biasa. <span className="mono">trades.json</span> bisa dibuka dengan editor teks,
              dan screenshot tersimpan sebagai gambar utuh yang bisa dilihat lewat Finder.
              Menyalin folder <span className="mono">data/</span> sama dengan backup lengkap.
            </div>

            <div className="dialog-actions">
              <button className="btn btn-primary" onClick={() => setShowSettings(false)}>Selesai</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function FileRow({ label, value, meta }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', fontSize: 11 }}>
      <span className="metric-label" style={{ minWidth: 52 }}>{label}</span>
      <span className="mono" style={{ flex: 1, wordBreak: 'break-all', color: 'var(--color-neutral-400)' }}>{value}</span>
      <span className="mono" style={{ color: 'var(--color-neutral-600)', whiteSpace: 'nowrap' }}>{meta}</span>
    </div>
  )
}

/** Umpan balik kecil bahwa perubahan sudah benar-benar ditulis ke disk. */
function SaveIndicator({ state }) {
  if (state === 'idle') return <span style={{ marginLeft: 'auto' }} />
  const map = {
    saving: { text: 'menyimpan…', color: 'var(--color-neutral-600)' },
    saved: { text: '✓ tersimpan ke trades.json', color: 'var(--color-profit)' },
    error: { text: '⚠ gagal menyimpan — server mati?', color: 'var(--color-loss)' },
  }
  const s = map[state]
  return (
    <span className="mono" style={{ marginLeft: 'auto', fontSize: 11, color: s.color }}>
      {s.text}
    </span>
  )
}
