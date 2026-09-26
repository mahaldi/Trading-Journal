import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Dashboard from './pages/Dashboard'
import Calendar from './pages/Calendar'
import Stats from './pages/Stats'
import Tags from './pages/Tags'
import Notes from './pages/Notes'
import TradeForm from './components/TradeForm'
import { SyncUploadDialog, SyncPreviewBar, SyncPreview, SyncConfirm, useSyncPreview } from './components/BinanceSync'
import { Segmented, Lightbox, Confirm } from './components/ui'
import {
  loadTrades, saveTrades, loadSettings, saveSettings, loadNotes, saveNotes,
  deleteImage, pruneImages, getStatus,
} from './lib/storage'
import { normalize as normalizeShots, allShots } from './components/ScreenshotSlots'
import { buildPairIndex } from './lib/pairs'
import { allTags, applyPartialExit, effectiveDate, tagLibrary } from './lib/calc'
import { buildTagStats } from './lib/tags'
import { fileSize, price as fmtPrice } from './lib/format'
import { NOTE_TYPES, blankNote, imageBlocks, notesByTrade, notesByDate, togglePin } from './lib/notes'
import { applySync } from './lib/binanceSync'

const PAGES = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'calendar', label: 'Kalender' },
  { key: 'stats', label: 'Statistik' },
  { key: 'notes', label: 'Catatan' },
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
  const [form, setForm] = useState({ open: false, mode: 'create', trade: null, focus: null })
  const [lightbox, setLightbox] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  // Open order yang ditekan "Tutup trade" — belum ada hasil untuk diisi.
  const [confirmOrder, setConfirmOrder] = useState(null)
  const [newTradeId, setNewTradeId] = useState(null)
  const [showSettings, setShowSettings] = useState(false)

  // Sync Order History Binance: dialog unggah → pratinjau → konfirmasi.
  // Selama pratinjau, `trades` belum disentuh sama sekali.
  const [syncDialog, setSyncDialog] = useState(false)
  const [sync, setSync] = useState(null) // { fileName, parsed, skipped: Set, decisions: {} }
  const [syncConfirm, setSyncConfirm] = useState(false)
  const syncPreview = useSyncPreview(sync, trades)

  const [notes, setNotes] = useState([])
  const [notesSave, setNotesSave] = useState('idle')
  const [activeNoteId, setActiveNoteId] = useState(null)
  const [newNoteId, setNewNoteId] = useState(null)
  const [noteMenu, setNoteMenu] = useState(false)
  const [confirmNoteDelete, setConfirmNoteDelete] = useState(null)
  const notesTimer = useRef(null)

  // Jangan menulis balik ke disk sebelum pembacaan awal selesai —
  // kalau tidak, file bisa tertimpa array kosong saat app baru dibuka.
  const hydrated = useRef(false)
  const saveTimer = useRef(null)

  /* ── baca file saat app dibuka ── */
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // notes.json belum ada di jurnal lama → mulai dari daftar kosong.
        const [t, s, n] = await Promise.all([loadTrades(), loadSettings(), loadNotes().catch(() => [])])
        if (cancelled) return
        // Trade lama menyimpan satu gambar per slot; versi ini memakai array.
        // Migrasi dilakukan saat baca, jadi gambar lama tetap tampil.
        setTrades(
          (Array.isArray(t) ? t : []).map((tr) => ({ ...tr, shots: normalizeShots(tr.shots) }))
        )
        setSettings({ startingBalance: 10000, ...(s || {}) })
        setNotes(Array.isArray(n) ? n : [])
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

  /* ── tulis notes.json setiap ada perubahan (ditunda sesaat — mengetik tidak menulis per huruf) ── */
  useEffect(() => {
    if (!hydrated.current) return
    setNotesSave('saving')
    clearTimeout(notesTimer.current)
    notesTimer.current = setTimeout(async () => {
      try {
        await saveNotes(notes)
        setNotesSave('saved')
        setTimeout(() => setNotesSave((s) => (s === 'saved' ? 'idle' : s)), 1800)
      } catch (err) {
        console.error(err)
        setNotesSave('error')
      }
    }, 500)
    return () => clearTimeout(notesTimer.current)
  }, [notes])

  useEffect(() => {
    if (!hydrated.current) return
    saveSettings(settings).catch((err) => console.error('[settings]', err.message))
  }, [settings])

  /* ── pintasan: N membuka panel entri ── */
  useEffect(() => {
    function onKey(e) {
      if (form.open || confirmDelete || confirmOrder || showSettings || confirmNoteDelete || syncDialog || sync) return
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        openCreate()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [form.open, confirmDelete, confirmOrder, showSettings, confirmNoteDelete, syncDialog, sync])

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
  // `focus` membuka panel dengan kursor langsung di satu field (mis. "lengkapi SL" → SL).
  const openEdit = useCallback((t, opts) => setForm({ open: true, mode: 'edit', trade: t, focus: opts?.focus || null }), [])
  // Tombol "Tutup trade" sama di semua status, tapi pada open order ia
  // membuka konfirmasi — bukan panel hasil.
  const openClose = useCallback((t) => {
    if (t.status === 'pending') setConfirmOrder(t)
    else setForm({ open: true, mode: 'close', trade: t })
  }, [])
  const openFill = useCallback((t) => {
    setConfirmOrder(null)
    setForm({ open: true, mode: 'fill', trade: t })
  }, [])
  const openPartial = useCallback((t) => setForm({ open: true, mode: 'partial', trade: t }), [])

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

  /** Satu exit sebagian: trade tetap satu baris, daftar exit-nya yang bertambah. */
  function handlePartialExit(trade, leg) {
    const next = applyPartialExit(trade, leg)
    setTrades((prev) => prev.map((t) => (t.id === next.id ? next : t)))
    setForm({ open: false, mode: 'create', trade: null })
    setPage('dashboard')
    setNewTradeId(next.id)
    setTimeout(() => setNewTradeId(null), 1600)
    setTimeout(refreshStatus, 600)
  }

  function handleDelete(t) {
    for (const shot of allShots(t.shots)) {
      if (shot?.id) deleteImage(shot.id)
    }
    setTrades((prev) => prev.filter((x) => x.id !== t.id))
    setConfirmDelete(null)
    setConfirmOrder(null)
    setTimeout(refreshStatus, 600)
  }

  /* ─────────────────────────── sync Binance ─────────────────────────── */

  function startSyncPreview({ fileName, parsed }) {
    setSyncDialog(false)
    setSync({ fileName, parsed, skipped: new Set(), decisions: {} })
    setPage('dashboard')
    window.scrollTo(0, 0)
  }

  const toggleSyncRow = useCallback((id) => {
    setSync((s) => {
      const skipped = new Set(s.skipped)
      if (skipped.has(id)) skipped.delete(id)
      else skipped.add(id)
      return { ...s, skipped }
    })
  }, [])

  const decideSyncReview = useCallback((id, decision) => {
    setSync((s) => {
      const decisions = { ...s.decisions }
      if (decision) decisions[id] = decision
      else delete decisions[id]
      return { ...s, decisions }
    })
  }, [])

  function requestSyncApply() {
    if (!syncPreview.selected.length) {
      setSync(null)
      return
    }
    setSyncConfirm(true)
  }

  /** Satu-satunya titik di mana hasil sync benar-benar ditulis ke trades.json. */
  function applySyncNow() {
    const rows = syncPreview.selected
    const next = applySync(trades, syncPreview.plan, rows)
    setTrades(next)
    setSyncConfirm(false)
    setSync(null)
    setPage('dashboard')
    const firstNew = rows.find((r) => r.kind === 'new')?.after?.id
    if (firstNew) {
      setNewTradeId(firstNew)
      setTimeout(() => setNewTradeId(null), 1600)
    }
  }

  /* ─────────────────────────── aksi catatan ─────────────────────────── */

  const tradeNotes = useMemo(() => notesByTrade(notes), [notes])
  const dateNotes = useMemo(() => notesByDate(notes), [notes])

  function createNote(type = 'free') {
    const note = blankNote(type, { trades })
    setNotes((prev) => [note, ...prev])
    setActiveNoteId(note.id)
    setNewNoteId(note.id)
    setTimeout(() => setNewNoteId((id) => (id === note.id ? null : id)), 1500)
    setNoteMenu(false)
    setPage('notes')
  }

  const patchNote = useCallback((id, fn) => {
    setNotes((prev) => prev.map((n) => {
      if (n.id !== id) return n
      const next = fn(n)
      return next === n ? n : { ...next, updatedAt: new Date().toISOString() }
    }))
  }, [])

  /** Urutan & pin hanya menata daftar — tidak dihitung sebagai "diubah" (updatedAt tetap). */
  const arrangeNote = useCallback((patches) => {
    if (!patches?.length) return
    setNotes((prev) => prev.map((n) => {
      const mine = patches.filter((p) => p.id === n.id)
      return mine.length ? mine.reduce((acc, p) => ({ ...acc, [p.field]: p.value }), n) : n
    }))
  }, [])

  const togglePinNote = useCallback((id) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? togglePin(n, prev) : n)))
  }, [])

  const openNote = useCallback((id) => {
    setActiveNoteId(id)
    setPage('notes')
  }, [])

  function handleDeleteNote(note) {
    for (const b of imageBlocks(note)) if (b.image?.id) deleteImage(b.image.id)
    setNotes((prev) => prev.filter((n) => n.id !== note.id))
    setActiveNoteId(null)
    setConfirmNoteDelete(null)
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
      <div className={sync ? 'sync-sticky' : undefined}>
      {sync && (
        <SyncPreviewBar
          fileName={sync.fileName}
          period={sync.parsed.period}
          count={syncPreview.selected.length}
          onCancel={() => setSync(null)}
          onApply={requestSyncApply}
        />
      )}
      <div className={'nav' + (sync ? ' is-locked' : '')}>
        <span className="nav-brand">My Trading Journey</span>
        {PAGES.map((p) => (
          <button
            key={p.key}
            className={'nav-link' + (page === p.key ? ' is-active' : '')}
            onClick={() => setPage(p.key)}
            disabled={!!sync}
          >
            {p.label}
          </button>
        ))}
        {!sync && page !== 'calendar' && page !== 'notes' && (
          <Segmented options={RANGES} value={range} onChange={setRange} small style={{ marginLeft: 'var(--space-4)' }} />
        )}

        {page === 'notes'
          ? <SaveIndicator state={notesSave} file="notes.json" />
          : <SaveIndicator state={saveState} />}

        <button
          className="btn btn-secondary btn-sm"
          onClick={() => { refreshStatus(); setShowSettings(true) }}
          title="Pengaturan & lokasi file"
        >
          ⚙
        </button>
        {page === 'notes' ? (
          <span className="btn-split">
            <button className="btn btn-primary" onClick={() => createNote('free')}>+ Catatan</button>
            <button className="btn btn-primary" onClick={() => setNoteMenu((v) => !v)} title="Pilih template" aria-label="Pilih template">▾</button>
            {noteMenu && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onMouseDown={() => setNoteMenu(false)} />
                <div className="popover" style={{ right: 0, width: 260, top: 'calc(100% + 6px)' }}>
                  <div className="mm-section">Mulai dari template</div>
                  {NOTE_TYPES.map((t) => (
                    <button key={t.key} className="menu-item" onClick={() => createNote(t.key)}>
                      <span className="note-dot" style={{ width: 6, height: 6, background: t.color }} />
                      <span style={{ flex: 1 }}>{t.full}</span>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--color-neutral-600)' }}>{t.outline.length > 1 ? `${t.outline.length} bagian` : 'kosong'}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </span>
        ) : (
          <>
            <button
              className="btn btn-secondary"
              onClick={() => setSyncDialog(true)}
              disabled={!!sync}
              title="Impor Futures Order History (.xlsx) dari Binance"
            >
              ⇪ Sync Binance
            </button>
            <button className="btn btn-primary" onClick={openCreate} disabled={!!sync}>
              + Trade Baru <span className="kbd">N</span>
            </button>
          </>
        )}
      </div>
      </div>

      <div className={'page' + (page === 'notes' ? ' page-notes' : '')}>
        {sync && syncPreview.plan && (
          <SyncPreview
            trades={trades}
            sync={sync}
            preview={syncPreview}
            onToggle={toggleSyncRow}
            onDecide={decideSyncReview}
          />
        )}
        {!sync && page === 'dashboard' && (
          <Dashboard
            trades={ranged}
            allTrades={trades}
            settings={settings}
            onNew={openCreate}
            onEdit={openEdit}
            onCloseTrade={openClose}
            onPartialClose={openPartial}
            onDelete={(t) => setConfirmDelete(t)}
            onLightbox={setLightbox}
            newTradeId={newTradeId}
            notesByTrade={tradeNotes}
            onOpenNote={openNote}
          />
        )}
        {!sync && page === 'calendar' && (
          <Calendar trades={trades} onPickTrade={openEdit} notesByDate={dateNotes} onOpenNote={openNote} />
        )}
        {!sync && page === 'notes' && (
          <Notes
            notes={notes}
            trades={trades}
            activeId={activeNoteId}
            newNoteId={newNoteId}
            saveState={notesSave}
            onSelect={setActiveNoteId}
            onCreate={createNote}
            onPatch={patchNote}
            onDelete={(n) => setConfirmNoteDelete(n)}
            onArrange={arrangeNote}
            onTogglePin={togglePinNote}
            onOpenTrade={openEdit}
            onLightbox={setLightbox}
          />
        )}
        {!sync && page === 'stats' && <Stats trades={ranged} />}
        {!sync && page === 'tags' && (
          <Tags trades={ranged} onRenameTag={renameTag} onMergeTag={mergeTag} onDeleteTag={deleteTag} />
        )}
      </div>

      <TradeForm
        open={form.open}
        mode={form.mode}
        trade={form.trade}
        focusField={form.focus}
        pairIndex={pairIndex}
        tagSuggestions={tagSuggestions}
        tagStats={tagStats}
        onSave={handleSave}
        onPartialExit={handlePartialExit}
        onClose={() => setForm({ open: false, mode: 'create', trade: null })}
        onLightbox={setLightbox}
      />

      <Lightbox view={lightbox} onClose={() => setLightbox(null)} />

      <SyncUploadDialog open={syncDialog} onCancel={() => setSyncDialog(false)} onPreview={startSyncPreview} />

      <SyncConfirm
        open={syncConfirm}
        rows={syncPreview.selected}
        onBack={() => setSyncConfirm(false)}
        onApply={applySyncNow}
      />

      <Confirm
        open={!!confirmDelete}
        title="Hapus trade ini?"
        body={`${confirmDelete?.pair || ''} — barisnya dihapus dari data/trades.json dan file screenshot-nya dihapus dari data/images/.`}
        confirmLabel="Hapus"
        danger
        onConfirm={() => handleDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />

      <OrderCloseDialog
        order={confirmOrder}
        onCancel={() => setConfirmOrder(null)}
        onFilled={() => openFill(confirmOrder)}
        onDelete={() => handleDelete(confirmOrder)}
      />

      <Confirm
        open={!!confirmNoteDelete}
        title="Hapus catatan ini?"
        body={`${confirmNoteDelete?.title || 'Tanpa judul'} — dihapus dari data/notes.json${
          confirmNoteDelete && imageBlocks(confirmNoteDelete).length
            ? `, beserta ${imageBlocks(confirmNoteDelete).length} gambarnya di data/images/`
            : ''
        }. Trade yang tertaut tidak ikut terhapus.`}
        confirmLabel="Hapus"
        danger
        onConfirm={() => handleDeleteNote(confirmNoteDelete)}
        onCancel={() => setConfirmNoteDelete(null)}
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
                {status.notesFile && (
                  <FileRow label="Catatan" value={status.notesFile} meta={`${status.noteCount} catatan`} />
                )}
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

/**
 * Konfirmasi "Tutup trade" pada open order. Tiga jalan keluar:
 * batal · sudah filled → Berjalan · hapus order (permanen, tanpa undo).
 */
function OrderCloseDialog({ order, onCancel, onFilled, onDelete }) {
  useEffect(() => {
    if (!order) return
    function onKey(e) {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [order, onCancel])
  if (!order) return null
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="order-close-title" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title" id="order-close-title">Order ini belum terisi</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', fontSize: 14 }}>
          <p style={{ margin: 0, lineHeight: 1.6, color: 'var(--color-neutral-400)' }}>
            <span style={{ color: 'var(--color-text)' }}>
              {order.pair} {order.direction === 'long' ? '▲' : '▼'} limit {fmtPrice(order.entry)}
            </span>{' '}
            masih berstatus open order. Menutupnya akan{' '}
            <span style={{ color: 'var(--color-text)' }}>menghapus order ini dari jurnal</span> — tidak masuk
            histori, kalender, maupun statistik.
          </p>
          <div className="inset-box" style={{ background: 'var(--color-bg)', padding: '8.4px 11.2px', fontSize: 12, lineHeight: 1.6, color: 'var(--color-neutral-400)' }}>
            Kalau order sebenarnya sudah filled, ubah statusnya ke{' '}
            <span className="mono" style={{ color: 'var(--color-text)' }}>Berjalan</span> dulu, lalu tutup seperti biasa.
          </div>
        </div>
        <div className="dialog-actions" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={onCancel} autoFocus>Batal</button>
          <button className="btn btn-secondary" onClick={onFilled}>Sudah filled → Berjalan</button>
          <button className="btn btn-loss" onClick={onDelete} title="Dihapus permanen — tidak bisa di-undo">Hapus order</button>
        </div>
      </div>
    </div>
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
function SaveIndicator({ state, file = 'trades.json' }) {
  if (state === 'idle') return <span style={{ marginLeft: 'auto' }} />
  const map = {
    saving: { text: 'menyimpan…', color: 'var(--color-neutral-600)' },
    saved: { text: `✓ tersimpan ke ${file}`, color: 'var(--color-profit)' },
    error: { text: '⚠ gagal menyimpan — server mati?', color: 'var(--color-loss)' },
  }
  const s = map[state]
  return (
    <span className="mono" style={{ marginLeft: 'auto', fontSize: 11, color: s.color }}>
      {s.text}
    </span>
  )
}
