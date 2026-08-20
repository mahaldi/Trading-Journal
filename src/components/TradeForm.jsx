import { useEffect, useMemo, useRef, useState } from 'react'
import PairAutocomplete from './PairAutocomplete'
import PositionSizeInput from './PositionSizeInput'
import ScreenshotSlots, { normalize as normalizeShots } from './ScreenshotSlots'
import TagInput from './TagInput'
import { Segmented, Confirm } from './ui'
import { deriveTrade, deviationLabel, EMOTIONS, TIMEFRAMES } from '../lib/calc'
import { money, rVal, stamp, todayISO } from '../lib/format'
import { baseUnitShort } from '../lib/pairs'

const emptyForm = () => ({
  id: null,
  status: 'closed',
  date: todayISO(),
  closeDate: todayISO(),
  pair: '',
  direction: 'long',
  timeframe: 'H4',
  entry: '',
  exit: '',
  size: null,
  sizeMode: 'unit',
  leverage: '',
  fees: '',
  sl: '',
  tp: '',
  markPrice: '',
  pnlOverride: '',
  tags: [],
  emotion: '',
  notes: '',
  closeNotes: '',
  shots: { setup: [], result: [] },
  history: [],
  createdAt: null,
})

/**
 * Panel entri 520px dari kanan. Dashboard tetap terlihat di belakang.
 * Mode: 'create' | 'edit' | 'close' (menutup posisi yang berjalan).
 */
export default function TradeForm({ open, mode = 'create', trade, pairIndex, tagSuggestions, tagStats, onSave, onClose, onLightbox }) {
  const [f, setF] = useState(emptyForm)
  const [dirty, setDirty] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const panelRef = useRef(null)
  const tagRef = useRef(null)

  // Muat data saat panel dibuka
  useEffect(() => {
    if (!open) return
    if (trade) {
      setF({
        ...emptyForm(),
        ...trade,
        entry: trade.entry ?? '',
        exit: trade.exit ?? '',
        leverage: trade.leverage ?? '',
        fees: trade.fees ?? '',
        sl: trade.sl ?? '',
        tp: trade.tp ?? '',
        markPrice: trade.markPrice ?? '',
        pnlOverride: trade.pnlOverride ?? '',
        sizeMode: trade.sizeMode || 'unit',
        shots: normalizeShots(trade.shots),
        status: mode === 'close' ? 'closed' : trade.status,
        closeDate: trade.closeDate || todayISO(),
        tags: trade.tags || [],
        history: trade.history || [],
      })
    } else {
      setF(emptyForm())
    }
    setDirty(false)
  }, [open, trade, mode])

  const set = (patch) => {
    setF((prev) => ({ ...prev, ...patch }))
    setDirty(true)
  }

  const isOpenPos = f.status === 'open'
  const d = useMemo(
    () => deriveTrade({ ...f, pnlOverride: f.pnlOverride === '' ? null : f.pnlOverride }),
    [f]
  )
  const computedNet = useMemo(() => deriveTrade({ ...f, pnlOverride: null }).netPnl, [f])
  const dev = deviationLabel(d.deviationR)
  const unit = baseUnitShort(f.pair)

  const valid = f.pair.trim() && Number.isFinite(d.entry) && Number.isFinite(d.size) && d.size > 0

  function handleSave() {
    if (!valid) return
    // Tag yang sudah diketik tapi belum ditekan Enter ikut tersimpan —
    // sebelumnya ketikan seperti ini terbuang diam-diam.
    const pendingTag = tagRef.current?.flush?.()
    const tags = pendingTag && !f.tags.includes(pendingTag) ? [...f.tags, pendingTag] : f.tags
    const now = new Date().toISOString()
    const numOrNull = (v) => {
      if (v === '' || v == null) return null
      const n = parseFloat(String(v).replace(/,/g, ''))
      return Number.isFinite(n) ? n : null
    }
    const isNew = !f.id
    const history = [...(f.history || [])]
    if (isNew) history.push({ ts: now, label: f.status === 'open' ? 'dicatat sebagai berjalan' : 'dicatat' })
    else if (mode === 'close') history.push({ ts: now, label: 'ditutup' })
    else history.push({ ts: now, label: 'diubah' })

    onSave({
      id: f.id || `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: f.createdAt || now,
      updatedAt: now,
      status: f.status,
      date: f.date || todayISO(),
      closeDate: f.status === 'closed' ? f.closeDate || f.date || todayISO() : null,
      pair: f.pair.trim().toUpperCase(),
      direction: f.direction,
      timeframe: f.timeframe,
      entry: numOrNull(f.entry),
      exit: f.status === 'closed' ? numOrNull(f.exit) : null,
      size: f.size,
      sizeMode: f.sizeMode,
      leverage: numOrNull(f.leverage),
      fees: numOrNull(f.fees) || 0,
      sl: numOrNull(f.sl),
      tp: numOrNull(f.tp),
      markPrice: f.status === 'open' ? numOrNull(f.markPrice) : null,
      pnlOverride: f.pnlOverride === '' ? null : numOrNull(f.pnlOverride),
      tags,
      emotion: f.emotion,
      notes: f.notes,
      closeNotes: f.closeNotes,
      shots: normalizeShots(f.shots),
      history,
    }, isNew)
  }

  function requestClose() {
    if (dirty) setConfirmClose(true)
    else onClose()
  }

  // Pintasan papan ketik: Esc menutup, ⌘/Ctrl+Enter menyimpan
  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape' && !confirmClose) {
        e.preventDefault()
        requestClose()
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleSave()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  if (!open) return null

  const title = mode === 'close' ? 'Tutup trade' : mode === 'edit' ? 'Ubah trade' : 'Catat trade'
  const kicker = mode === 'close' ? 'Isi Hasil' : mode === 'edit' ? 'Edit Entri' : 'Entri Baru'

  return (
    <>
      <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && requestClose()}>
        {/* Panel sengaja TIDAK memakai stopPropagation: overlay sudah menyaring
            dengan e.target === e.currentTarget, sementara stopPropagation di
            sini ikut membekap event mousedown yang dipakai daftar autocomplete
            untuk tahu kapan harus menutup. */}
        <div className="slideover" ref={panelRef}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-6)' }}>
            <div>
              <div className="card-kicker">{kicker}</div>
              <h4 style={{ margin: 0 }}>{title}</h4>
            </div>
            <button className="btn btn-secondary btn-icon" onClick={requestClose} title="Tutup (Esc)">✕</button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
            {/* ── 1 · Data Dasar ── */}
            <section>
              <div className="section-step">1 · Data Dasar</div>

              <Segmented
                options={[
                  { value: 'open', label: '● Berjalan' },
                  { value: 'closed', label: '✓ Selesai' },
                ]}
                value={f.status}
                onChange={(v) => set({ status: v, closeDate: v === 'closed' ? f.closeDate || todayISO() : null })}
                style={{ marginBottom: 'var(--space-3)' }}
              />

              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 'var(--space-3)' }}>
                <div className="field">
                  <label htmlFor="f-pair">Pair</label>
                  <PairAutocomplete
                    id="f-pair"
                    value={f.pair}
                    onChange={(v) => set({ pair: v })}
                    index={pairIndex}
                    autoFocus={mode !== 'close'}
                  />
                </div>
                <div className="field">
                  <label htmlFor="f-tf">Timeframe</label>
                  <select id="f-tf" className="input mono" value={f.timeframe} onChange={(e) => set({ timeframe: e.target.value })}>
                    {TIMEFRAMES.map((tf) => <option key={tf} value={tf}>{tf}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-3)', alignItems: 'flex-end' }}>
                <Segmented
                  options={[
                    { value: 'long', label: '▲ Long' },
                    { value: 'short', label: '▼ Short' },
                  ]}
                  value={f.direction}
                  onChange={(v) => set({ direction: v })}
                />
                <div className="field" style={{ flex: 1 }}>
                  <label htmlFor="f-date">Tanggal entry</label>
                  <input id="f-date" type="date" className="input mono" value={f.date} onChange={(e) => set({ date: e.target.value })} />
                </div>
                {f.status === 'closed' && (
                  <div className="field" style={{ flex: 1 }}>
                    <label htmlFor="f-cdate">Tanggal exit</label>
                    <input id="f-cdate" type="date" className="input mono" value={f.closeDate || ''} onChange={(e) => set({ closeDate: e.target.value })} />
                  </div>
                )}
              </div>
            </section>

            {/* ── 2 · Eksekusi ── */}
            <section>
              <div className="section-step">2 · Eksekusi &amp; Rencana</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                <div className="field">
                  <label htmlFor="f-entry">Entry Price</label>
                  <input id="f-entry" className="input mono" inputMode="decimal" value={f.entry} onChange={(e) => set({ entry: e.target.value })} placeholder="64210" />
                </div>
                <div className="field" style={{ opacity: isOpenPos ? 0.4 : 1 }}>
                  <label htmlFor="f-exit">Exit Price {isOpenPos && <span style={{ color: 'var(--color-neutral-600)' }}>· terkunci</span>}</label>
                  <input
                    id="f-exit" className="input mono" inputMode="decimal" disabled={isOpenPos}
                    value={isOpenPos ? '' : f.exit}
                    onChange={(e) => set({ exit: e.target.value })}
                    placeholder={isOpenPos ? 'terisi saat ditutup' : '65480'}
                    style={mode === 'close' ? { borderColor: 'var(--color-accent)' } : undefined}
                  />
                </div>

                <PositionSizeInput
                  value={f.size}
                  onChange={(v) => set({ size: v })}
                  pair={f.pair}
                  entry={parseFloat(f.entry)}
                  mode={f.sizeMode}
                  onModeChange={(m) => set({ sizeMode: m })}
                />

                <div className="field">
                  <label htmlFor="f-lev">Leverage</label>
                  <input id="f-lev" className="input mono" inputMode="decimal" value={f.leverage} onChange={(e) => set({ leverage: e.target.value })} placeholder="5" />
                </div>

                <div className="field">
                  <label htmlFor="f-fees">Fees</label>
                  <input id="f-fees" className="input mono" inputMode="decimal" value={f.fees} onChange={(e) => set({ fees: e.target.value })} placeholder="8.20" />
                </div>

                {isOpenPos ? (
                  <div className="field">
                    <label htmlFor="f-mark">Harga terakhir <span style={{ color: 'var(--color-neutral-600)' }}>· opsional</span></label>
                    <input id="f-mark" className="input mono" inputMode="decimal" value={f.markPrice} onChange={(e) => set({ markPrice: e.target.value })} placeholder="untuk R floating" />
                  </div>
                ) : (
                  <div className="field">
                    <label htmlFor="f-pnl">
                      Realized PnL <span style={{ color: 'var(--color-neutral-600)' }}>· otomatis, bisa ditimpa</span>
                    </label>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <input
                        id="f-pnl"
                        className={'input mono ' + (d.netPnl > 0 ? 'input-profit' : d.netPnl < 0 ? 'input-loss' : '')}
                        inputMode="decimal"
                        value={f.pnlOverride}
                        onChange={(e) => set({ pnlOverride: e.target.value })}
                        placeholder={computedNet != null ? computedNet.toFixed(2) : 'terhitung'}
                      />
                      {f.pnlOverride !== '' && (
                        <button className="btn btn-secondary btn-sm" onClick={() => set({ pnlOverride: '' })} title="Kembali ke nilai terhitung">↺</button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="divider" style={{ margin: 'var(--space-4) 0' }} />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                <div className="field">
                  <label htmlFor="f-sl">Stop Loss awal</label>
                  <input id="f-sl" className="input mono" inputMode="decimal" value={f.sl} onChange={(e) => set({ sl: e.target.value })} placeholder="63600" />
                </div>
                <div className="field">
                  <label htmlFor="f-tp">Take Profit awal</label>
                  <input id="f-tp" className="input mono" inputMode="decimal" value={f.tp} onChange={(e) => set({ tp: e.target.value })} placeholder="65900" />
                </div>
              </div>

              {/* Bar ringkasan R:R — umpan balik langsung */}
              <div className="inset-box" style={{ marginTop: 'var(--space-3)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1px 1fr' }}>
                  <div style={{ padding: '8.4px 11.2px' }}>
                    <div className="metric-label" style={{ fontSize: 10 }}>Rencana · dari SL/TP</div>
                    <div className="mono" style={{ fontSize: 19, color: 'var(--color-accent)' }}>
                      {d.plannedR != null ? rVal(d.plannedR, { sign: false }) : '—'}
                    </div>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--color-neutral-600)' }}>
                      {d.riskAmount != null
                        ? <>risiko {money(d.riskAmount, { sign: false })}{d.rewardAmount != null ? ` → target ${money(d.rewardAmount, { sign: false })}` : ''}</>
                        : 'isi SL untuk melihat risiko'}
                    </div>
                  </div>
                  <div style={{ background: 'var(--color-neutral-800)' }} />
                  <div style={{ padding: '8.4px 11.2px' }}>
                    <div className="metric-label" style={{ fontSize: 10 }}>Aktual · dari exit</div>
                    <div
                      className="mono"
                      style={{ fontSize: 19, color: d.actualR == null ? 'var(--color-neutral-600)' : d.actualR >= 0 ? 'var(--color-profit)' : 'var(--color-loss)' }}
                    >
                      {isOpenPos ? '—' : d.actualR != null ? rVal(d.actualR) : '—'}
                    </div>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--color-neutral-600)' }}>
                      {isOpenPos
                        ? 'terisi saat trade ditutup'
                        : d.netPnl != null
                          ? `${money(d.netPnl)} setelah fees`
                          : 'isi Exit Price'}
                    </div>
                  </div>
                </div>

                {isOpenPos && d.floatingR != null && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '5.6px 11.2px',
                    background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)', fontSize: 11, color: 'var(--color-accent)',
                  }}>
                    <span className="pulse-dot" />
                    Trade masih berjalan — floating saat ini {rVal(d.floatingR)} ({money(d.floatingPnl)})
                  </div>
                )}
                {!isOpenPos && dev && (
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', padding: '5.6px 11.2px', fontSize: 11,
                    background: `color-mix(in srgb, var(--color-${dev.tone === 'flat' ? 'neutral-700' : dev.tone}) 10%, transparent)`,
                  }}>
                    <span style={{ color: 'var(--color-neutral-500)' }}>Deviasi eksekusi</span>
                    <span className={'mono ' + dev.tone}>{rVal(d.deviationR)} · {dev.text}</span>
                  </div>
                )}
              </div>
            </section>

            {/* ── 3 · Screenshot ── */}
            <section>
              <div className="section-step">3 · Screenshot</div>
              <ScreenshotSlots
                shots={f.shots}
                onChange={(nextShots) => set({ shots: nextShots })}
                onLightbox={onLightbox}
                pasteScopeRef={panelRef}
              />
            </section>

            {/* ── 4 · Catatan ── */}
            <section>
              <div className="section-step">4 · Catatan</div>
              <div className="field">
                <label htmlFor="f-notes">Deskripsi analisis</label>
                <textarea
                  id="f-notes" className="input" style={{ minHeight: 70 }}
                  value={f.notes} onChange={(e) => set({ notes: e.target.value })}
                  placeholder="Kenapa masuk di sini? Apa konfirmasinya?"
                />
              </div>
              <div className="field" style={{ marginTop: 'var(--space-3)' }}>
                <label>Strategi · tag</label>
                <TagInput
                  ref={tagRef}
                  value={f.tags}
                  onChange={(v) => set({ tags: v })}
                  suggestions={tagSuggestions}
                  stats={tagStats}
                />
              </div>
              <div className="field" style={{ marginTop: 'var(--space-3)' }}>
                <label htmlFor="f-emo">Psikologi saat entry</label>
                <select id="f-emo" className="input" value={f.emotion} onChange={(e) => set({ emotion: e.target.value })}>
                  <option value="">— pilih —</option>
                  {EMOTIONS.map((em) => <option key={em} value={em}>{em}</option>)}
                </select>
              </div>
              {!isOpenPos && (
                <div className="field" style={{ marginTop: 'var(--space-3)' }}>
                  <label htmlFor="f-cnotes">Catatan penutupan</label>
                  <textarea
                    id="f-cnotes" className="input" style={{ minHeight: 48 }}
                    value={f.closeNotes} onChange={(e) => set({ closeNotes: e.target.value })}
                    placeholder="TP1 kena, sisa trailing."
                  />
                </div>
              )}
            </section>

            {f.history?.length > 0 && (
              <div className="mono" style={{ fontSize: 10, color: 'var(--color-neutral-700)' }}>
                {f.history.slice(-3).map((h, i) => (
                  <div key={i}>{h.label} {stamp(h.ts)}</div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end', paddingTop: 'var(--space-2)' }}>
              <button className="btn btn-secondary" onClick={requestClose}>
                Batal <span className="kbd">Esc</span>
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={!valid} title={valid ? '' : 'Pair, Entry Price, dan Position Size wajib diisi'}>
                {f.status === 'open' ? 'Simpan sebagai berjalan' : mode === 'close' ? 'Tutup trade & simpan' : 'Simpan trade'}
                <span className="kbd">⌘↵</span>
              </button>
            </div>

            {!valid && (
              <div style={{ fontSize: 11, color: 'var(--color-neutral-600)', textAlign: 'right', marginTop: -8 }}>
                Wajib: Pair · Entry Price · Position Size{unit ? ` (${unit})` : ''}
              </div>
            )}
          </div>
        </div>
      </div>

      <Confirm
        open={confirmClose}
        title="Tutup tanpa menyimpan?"
        body="Ada isian yang belum disimpan. Menutup panel akan membuangnya."
        confirmLabel="Buang & tutup"
        danger
        onConfirm={() => { setConfirmClose(false); onClose() }}
        onCancel={() => setConfirmClose(false)}
      />
    </>
  )
}
