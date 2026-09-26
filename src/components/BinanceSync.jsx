import { useEffect, useMemo, useRef, useState } from 'react'
import { readXlsxRows } from '../lib/xlsx'
import {
  parseOrderHistory, planSync, applySync, periodMetrics, summarizeRows,
  resolveReview, reviewCandidates, rowDate,
} from '../lib/binanceSync'
import { deriveTrade, effectiveDate, STATUS_LABEL } from '../lib/calc'
import { money, rVal, shortDate, size as fmtSize, toneClass } from '../lib/format'

/** Harga sampai 7 desimal — presisi yang dipakai sync, supaya selisih digit terlihat. */
const fmtPrice = (v) => {
  const n = typeof v === 'number' ? v : Number(v)
  if (v == null || v === '' || !Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US', { maximumFractionDigits: 7 })
}

/* ══════════════════════════════════════════════════════════════
   F · Sync Order History Binance
   F1 dialog unggah · F2 dashboard mode pratinjau · F5 konfirmasi.
   Selama pratinjau tidak ada yang disimpan — Batal membuang semuanya.
   ══════════════════════════════════════════════════════════════ */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

/** '2026-08-25','2026-09-25' → '25 Agu – 25 Sep' (+ tahun bila diminta) */
export function periodLabel(period, { year = false } = {}) {
  if (!period?.from || !period?.to) return '—'
  const f = (iso) => {
    const [, m, d] = iso.split('-').map(Number)
    return `${d} ${MONTHS[m - 1]}`
  }
  const y = year ? ` ${period.to.slice(0, 4)}` : ''
  const tz = year && period.tz ? ` (${period.tz})` : ''
  return `${f(period.from)} – ${f(period.to)}${y}${tz}`
}

/* ─────────────────────────── F1 · dialog unggah ─────────────────────────── */

export function SyncUploadDialog({ open, onCancel, onPreview }) {
  const [state, setState] = useState({ step: 'empty' }) // empty | reading | ok | error
  const [drag, setDrag] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (open) setState({ step: 'empty' })
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  async function read(file) {
    if (!file) return
    setState({ step: 'reading', name: file.name })
    try {
      const rows = await readXlsxRows(await file.arrayBuffer())
      const parsed = parseOrderHistory(rows)
      if (!parsed.ok) setState({ step: 'error', name: file.name })
      else setState({ step: 'ok', name: file.name, parsed })
    } catch {
      // Bukan .xlsx atau rusak — pesan yang sama: sebut file yang diharapkan.
      setState({ step: 'error', name: file.name })
    }
  }

  function pick() {
    if (inputRef.current) {
      inputRef.current.value = ''
      inputRef.current.click()
    }
  }

  if (!open) return null
  const { step, name, parsed } = state
  const c = parsed?.counts

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div
        className="dialog sync-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-title"
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false) }}
        onDrop={(e) => { e.preventDefault(); setDrag(false); read(e.dataTransfer.files?.[0]) }}
      >
        <div className="dialog-title" id="sync-title">Sync Order History Binance</div>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          hidden
          onChange={(e) => read(e.target.files?.[0])}
        />

        {step === 'empty' && (
          <button type="button" className={'sync-drop' + (drag ? ' is-drop' : '')} onClick={pick}>
            <span style={{ fontSize: 18, color: 'var(--color-neutral-500)' }}>▤</span>
            <span>
              Tarik file <span className="mono">.xlsx</span> ke sini atau{' '}
              <span style={{ color: 'var(--color-accent)', textDecoration: 'underline', textUnderlineOffset: 3 }}>pilih file</span>
            </span>
            <span className="metric-sub">Binance → Orders → Futures → Order History → Export</span>
          </button>
        )}

        {step === 'reading' && (
          <div className="sync-file">
            <span className="sync-file-icon">▤</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="mono sync-file-name">{name}</div>
              <div className="metric-sub">membaca…</div>
            </div>
          </div>
        )}

        {step === 'ok' && (
          <>
            <div className={'sync-file' + (drag ? ' is-drop' : '')}>
              <span className="sync-file-icon">▤</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mono sync-file-name" title={name}>{name}</div>
                <div className="metric-sub">terbaca · file tidak disimpan</div>
              </div>
              <button type="button" className="sync-x" onClick={() => setState({ step: 'empty' })} title="Pilih file lain" aria-label="Hapus file">✕</button>
            </div>
            <div className="inset-box sync-summary">
              <div><span>Periode</span><span className="mono">{periodLabel(parsed.period, { year: true })}</span></div>
              <div>
                <span>Order</span>
                <span className="mono">
                  {c.total} · {c.filled} terisi · {c.canceled} dibatalkan{c.other ? ` · ${c.other} lainnya` : ''}
                </span>
              </div>
            </div>
          </>
        )}

        {step === 'error' && (
          <>
            <div className="sync-file is-error">
              <span className="sync-file-icon">▤</span>
              <div className="mono sync-file-name" style={{ flex: 1 }} title={name}>{name}</div>
            </div>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
              File ini bukan Futures Order History. Di Binance, buka{' '}
              <span style={{ whiteSpace: 'nowrap' }}>Orders → Futures → Order History</span>, lalu pilih Export.
            </p>
          </>
        )}

        <div className="dialog-actions">
          <button className="btn btn-ghost" onClick={onCancel}>Batal</button>
          {step === 'error' ? (
            <button className="btn btn-secondary" onClick={pick}>Pilih file lain</button>
          ) : (
            <button
              className="btn btn-primary"
              disabled={step !== 'ok'}
              onClick={() => onPreview({ fileName: name, parsed })}
            >
              Lihat pratinjau
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────── state pratinjau ─────────────────────────── */

/** Semua turunan pratinjau dari satu tempat — dipakai bilah atas & halaman. */
export function useSyncPreview(sync, trades) {
  const plan = useMemo(() => (sync ? planSync(trades, sync.parsed) : null), [sync?.parsed, trades])

  const reviewRows = useMemo(() => {
    if (!plan) return []
    return plan.review
      .map((item) => {
        const d = sync.decisions[item.id]
        if (!d || d.type === 'ignore') return null
        return resolveReview(item, d, trades, plan)
      })
      .filter(Boolean)
  }, [plan, sync?.decisions, trades])

  const rows = useMemo(() => (plan ? [...plan.changes, ...reviewRows] : []), [plan, reviewRows])
  const selected = useMemo(() => rows.filter((r) => !sync?.skipped.has(r.id)), [rows, sync?.skipped])
  const after = useMemo(() => (plan ? applySync(trades, plan, selected, { linkSame: false }) : trades), [trades, plan, selected])

  return { plan, rows, selected, after }
}

/* ─────────────────────────── F2 · bilah pratinjau ─────────────────────────── */

export function SyncPreviewBar({ fileName, period, count, onCancel, onApply }) {
  return (
    <div className="sync-bar">
      <span className="pulse-dot" />
      <span style={{ fontSize: 13, fontWeight: 500 }}>Pratinjau sync</span>
      <span className="mono sync-bar-file" title={fileName}>{fileName}</span>
      <span className="mono" style={{ fontSize: 11, color: 'var(--color-neutral-400)' }}>{periodLabel(period)}</span>
      <span className="sync-chip">belum disimpan</span>
      <span style={{ marginLeft: 'auto' }} />
      <button className="btn btn-ghost btn-sm" onClick={onCancel}>Batal</button>
      <button className="btn btn-primary btn-sm" onClick={onApply}>
        {count ? `Terapkan ${count} perubahan` : 'Tutup pratinjau'}
      </button>
    </div>
  )
}

/* ─────────────────────────── F2 · dashboard mode pratinjau ─────────────────────────── */

export function SyncPreview({ trades, sync, preview, onToggle, onDecide }) {
  const { plan, rows, selected, after } = preview
  const [openSame, setOpenSame] = useState(false)
  const [openReview, setOpenReview] = useState(true)
  const [openIgnored, setOpenIgnored] = useState(false)

  const before = useMemo(() => periodMetrics(trades, plan.period), [trades, plan.period])
  const next = useMemo(() => periodMetrics(after, plan.period), [after, plan.period])

  const newCount = selected.filter((r) => r.kind === 'new').length
  const closedCount = selected.filter((r) => r.before?.status !== 'closed' && r.after?.status === 'closed' && r.kind !== 'new').length
  const pendingReview = plan.review.filter((r) => !sync.decisions[r.id])
  const ignoredReview = plan.review.filter((r) => sync.decisions[r.id]?.type === 'ignore')
  const rUnchanged = (before.avgR ?? null) === (next.avgR ?? null) ||
    (before.avgR != null && next.avgR != null && Math.abs(before.avgR - next.avgR) < 0.005)

  return (
    <>
      {/* ── metrik: angka lama dicoret → angka baru ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
        <div className="card elev-sm" style={{ gap: 'var(--space-1)', padding: '14px 16.8px', borderLeft: `2px solid var(--color-${next.netPnl >= 0 ? 'profit' : 'loss'})` }}>
          <div className="metric-label">Net PnL</div>
          <BeforeAfter
            from={money(before.netPnl)}
            to={money(next.netPnl)}
            changed={Math.abs(next.netPnl - before.netPnl) >= 0.005}
            toClass={toneClass(next.netPnl)}
            size={34}
          />
          <div className="metric-sub">
            periode file{Math.abs(next.netPnl - before.netPnl) >= 0.005 && (
              <> · <span style={{ color: 'var(--color-accent)' }}>{money(next.netPnl - before.netPnl)} dari sync</span></>
            )}
          </div>
        </div>

        <div className="card elev-sm" style={{ gap: 'var(--space-1)', padding: '14px 16.8px' }}>
          <div className="metric-label">Win Rate</div>
          <BeforeAfter
            from={before.winRate != null ? `${before.winRate.toFixed(1)}%` : '—'}
            to={next.winRate != null ? next.winRate.toFixed(1) : '—'}
            unit="%"
            changed={(before.winRate ?? -1).toFixed(1) !== (next.winRate ?? -1).toFixed(1)}
          />
          <div className="mono metric-sub">{next.wins} W · {next.losses} L{next.be ? ` · ${next.be} BE` : ''}</div>
        </div>

        <div className="card elev-sm" style={{ gap: 'var(--space-1)', padding: '14px 16.8px' }}>
          <div className="metric-label">Total Trades</div>
          <BeforeAfter from={String(before.total)} to={String(next.total)} changed={before.total !== next.total} />
          <div className="metric-sub">
            {newCount || closedCount
              ? [newCount && `${newCount} baru`, closedCount && `${closedCount} ditutup`].filter(Boolean).join(' · ')
              : 'tidak berubah'}
          </div>
        </div>

        <div className="card elev-sm" style={{ gap: 'var(--space-1)', padding: '14px 16.8px' }}>
          <div className="metric-label">R:R Aktual</div>
          <BeforeAfter
            from={before.avgR != null ? `${before.avgR.toFixed(2)}R` : '—'}
            to={next.avgR != null ? next.avgR.toFixed(2) : '—'}
            unit="R"
            changed={!rUnchanged}
          />
          <div className="metric-sub">
            {rUnchanged ? 'tidak berubah' : 'periode file'}
            {next.withoutSl > 0 && <> · {next.withoutSl} trade tanpa SL</>}
          </div>
        </div>
      </div>

      {/* ── histori · pratinjau ── */}
      <div className="card elev-sm" style={{ padding: '16.8px 0 5.6px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 16.8px 8.4px' }}>
          <div>
            <div className="card-kicker">Histori · Pratinjau</div>
            <div className="card-title">
              {rows.length ? `${rows.length} perubahan dari file` : 'Tidak ada perubahan dari file'}
            </div>
          </div>
          {rows.length > 0 && (
            <span className="mono" style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>
              hapus centang untuk melewati satu baris
            </span>
          )}
        </div>

        <table className="table sync-table">
          {rows.length > 0 && (
            <thead>
              <tr>
                <th style={{ width: 34, paddingLeft: 16.8 }} />
                <th style={{ width: 70 }}>Tanggal</th>
                <th style={{ width: 150 }}>Pair</th>
                <th style={{ width: 90 }}>Arah</th>
                <th>Perubahan</th>
                <th style={{ textAlign: 'right', width: 70 }}>R</th>
                <th style={{ textAlign: 'right', width: 130, paddingRight: 16.8 }}>PnL</th>
              </tr>
            </thead>
          )}
          <tbody>
            {rows.map((r) => (
              <ChangeRow key={r.id} row={r} checked={!sync.skipped.has(r.id)} onToggle={() => onToggle(r.id)} />
            ))}
            {plan.same.length > 0 && (
              <>
                <tr className="row sync-same" onClick={() => setOpenSame((v) => !v)}>
                  <td colSpan={7} style={{ paddingLeft: 16.8 }}>
                    <span className="sync-caret">{openSame ? '⌄' : '›'}</span>
                    <span style={{ fontSize: 13, color: 'var(--color-neutral-400)' }}>
                      {plan.same.length} trade sudah ada — tidak berubah
                    </span>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--color-neutral-600)', marginLeft: 10 }}>
                      {plan.same.slice(0, 2).map((s) => s.trade.pair).join(' · ')}
                      {plan.same.length > 2 ? ` · +${plan.same.length - 2}` : ''}
                    </span>
                  </td>
                </tr>
                {openSame && plan.same.map((s) => {
                  const d = deriveTrade(s.trade)
                  return (
                    <tr key={s.id} className="row sync-same-item">
                      <td style={{ paddingLeft: 16.8 }} />
                      <td className="mono" style={{ color: 'var(--color-neutral-600)' }}>{shortDate(effectiveDate(s.trade))}</td>
                      <td style={{ color: 'var(--color-neutral-400)' }}>{s.trade.pair}</td>
                      <td><DirTag direction={s.trade.direction} dim /></td>
                      <td className="mono" style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>
                        {fmtPrice(d.entry)} → {fmtPrice(d.exit)} · {fmtSize(d.size)}
                        {s.note ? ` · ${s.note}` : ' · cocok, tidak diduplikasi'}
                      </td>
                      <td className="mono" style={{ textAlign: 'right', color: 'var(--color-neutral-600)' }}>{d.actualR != null ? rVal(d.actualR) : '—'}</td>
                      <td className="mono" style={{ textAlign: 'right', paddingRight: 16.8, color: 'var(--color-neutral-600)' }}>{money(d.netPnl)}</td>
                    </tr>
                  )
                })}
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* ── perlu ditinjau · diabaikan ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginTop: 'var(--space-4)', alignItems: 'start' }}>
        <div className="sync-panel">
          <button type="button" className="sync-panel-head" onClick={() => setOpenReview((v) => !v)}>
            <span className="sync-caret">{openReview ? '⌄' : '›'}</span>
            <span style={{ fontSize: 13 }}>Perlu ditinjau · {pendingReview.length}</span>
            <span className="sync-panel-note">order pembuka di luar periode file</span>
          </button>
          {openReview && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {plan.review.length === 0 && (
                <div className="metric-sub" style={{ lineHeight: 1.6 }}>Semua order di file sudah punya pasangan.</div>
              )}
              {plan.review.map((item) => (
                <ReviewItem
                  key={item.id}
                  item={item}
                  decision={sync.decisions[item.id]}
                  candidates={reviewCandidates(item, trades, plan)}
                  onDecide={(d) => onDecide(item.id, d)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="sync-panel">
          <button type="button" className="sync-panel-head" onClick={() => setOpenIgnored((v) => !v)}>
            <span className="sync-caret">{openIgnored ? '⌄' : '›'}</span>
            <span style={{ fontSize: 13, color: 'var(--color-neutral-400)' }}>
              Diabaikan · {plan.ignored.length} order dibatalkan{ignoredReview.length ? ` · ${ignoredReview.length} ditinjau` : ''}
            </span>
            <span className="sync-panel-note">informasi saja</span>
          </button>
          <div className="metric-sub" style={{ lineHeight: 1.6 }}>
            Order CANCELED yang tidak cocok dengan open order mana pun di jurnal. Tidak ada yang disimpan dari kelompok ini.
          </div>
          {openIgnored && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 'var(--space-2)' }}>
              {plan.ignored.map(({ id, order: o, reason }) => (
                <div key={id} className="mono sync-ignored">
                  <span style={{ width: 44 }}>{shortDate(o.updateTime?.slice(0, 10))}</span>
                  <span style={{ flex: 1, color: 'var(--color-neutral-400)' }}>{o.symbol} {o.side} {o.type.toLowerCase()}</span>
                  <span>{fmtPrice(Number(o.price))} · {fmtSize(Number(o.amount))}</span>
                  <span style={{ width: 90, textAlign: 'right' }}>{reason}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function BeforeAfter({ from, to, unit, changed, toClass = '', size = 26 }) {
  return (
    <div className="mono" style={{ display: 'flex', alignItems: 'baseline', gap: 8, lineHeight: 1.1 }}>
      {changed && (
        <>
          <span className="sync-old">{from}</span>
          <span style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>→</span>
        </>
      )}
      <span className={toClass} style={{ fontSize: size, fontWeight: 500 }}>
        {to}
        {unit && <span style={{ fontSize: 16, color: 'var(--color-neutral-600)' }}>{unit}</span>}
      </span>
    </div>
  )
}

function DirTag({ direction, dim }) {
  return (
    <span className="tag" style={{
      background: 'var(--color-neutral-900)',
      color: `var(--color-${direction === 'long' ? 'profit' : 'loss'})`,
      opacity: dim ? 0.7 : 1,
    }}>
      {direction === 'long' ? '▲ Long' : '▼ Short'}
    </span>
  )
}

const FIELD_LABEL = { status: 'status', entry: 'entry', exit: 'exit', exits: 'exit sebagian' }

function fmtField(field, v) {
  if (field === 'status') return v === 'deleted' ? 'dihapus' : STATUS_LABEL[v] || v
  if (field === 'exits') return `${v}×`
  return v == null ? '—' : fmtPrice(Number(v))
}

function ChangeRow({ row: r, checked, onToggle }) {
  const t = r.after || r.before
  const d = r.after ? deriveTrade(r.after) : null
  const prev = r.before && r.after ? deriveTrade(r.before) : null

  let tag
  let detail
  if (r.kind === 'new') {
    tag = <span className="tag tag-accent">baru · Binance</span>
    detail = (
      <>
        <span className="mono sync-detail">
          {fmtPrice(d.entry)} → {d.exit != null ? fmtPrice(d.exit) : 'berjalan'} · {fmtSize(d.size)}
        </span>
        <span className="sync-chip">fee 0</span>
        {r.after.sl == null && <span className="sync-chip">lengkapi SL</span>}
      </>
    )
  } else if (r.kind === 'delete') {
    tag = <span className="tag sync-tag-loss">hapus open order</span>
    detail = (
      <span className="mono sync-detail">
        limit {fmtPrice(r.before.entry)} · {r.order?.status || 'CANCELED'} di Binance
      </span>
    )
  } else if (r.kind === 'link') {
    tag = <span className="tag tag-neutral">ditautkan</span>
    detail = <span className="mono sync-detail">Order No disimpan · angka tidak berubah</span>
  } else {
    tag = r.kind === 'precision'
      ? <span className="sync-chip">presisi 7 desimal</span>
      : <span className="tag tag-neutral">diperbarui</span>
    detail = r.diffs.map((x) => (
      <span key={x.field} className="mono sync-detail">
        {FIELD_LABEL[x.field] || x.field}{' '}
        {x.from != null && x.from !== '' ? <s>{fmtField(x.field, x.from)}</s> : <span>—</span>}
        {' → '}
        <span style={{ color: 'var(--color-accent)' }}>{fmtField(x.field, x.to)}</span>
      </span>
    ))
  }

  let pnl
  if (r.kind === 'delete') pnl = <span className="flat">—</span>
  else if (r.kind === 'precision' && prev) {
    const delta = (d.netPnl ?? 0) - (prev.netPnl ?? 0)
    pnl = <span className="flat">{Math.abs(delta) < 0.01 ? 'selisih < $0.01' : `selisih ${money(delta)}`}</span>
  } else {
    pnl = d?.netPnl != null
      ? <span className={toneClass(d.netPnl)}>{money(d.netPnl)}</span>
      : <span className="flat">{d?.floatingPnl != null ? money(d.floatingPnl) : '—'}</span>
  }

  return (
    <tr className={'row sync-row' + (r.kind === 'new' ? ' is-new-row' : '') + (checked ? '' : ' is-skipped')}>
      <td style={{ paddingLeft: 16.8 }}>
        <input type="checkbox" className="sync-check" checked={checked} onChange={onToggle} aria-label={`Terapkan ${t.pair}`} />
      </td>
      <td className="mono" style={{ color: 'var(--color-neutral-500)' }}>{shortDate(rowDate(r))}</td>
      <td style={{ fontWeight: 500 }}>{t.pair}</td>
      <td><DirTag direction={t.direction} /></td>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>{tag}{detail}</div>
      </td>
      <td className={'mono ' + toneClass(d?.actualR)} style={{ textAlign: 'right' }}>
        {d?.actualR != null ? rVal(d.actualR) : '—'}
      </td>
      <td className="mono" style={{ textAlign: 'right', paddingRight: 16.8, fontWeight: 500 }}>{pnl}</td>
    </tr>
  )
}

function ReviewItem({ item, decision, candidates, onDecide }) {
  const [menu, setMenu] = useState(false)
  const matched = decision?.type === 'match' ? candidates.find((t) => t.id === decision.tradeId) : null

  return (
    <div className={'sync-review' + (decision ? ' is-decided' : '')}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13 }}>
          <span style={{ fontWeight: 500 }}>{item.symbol}</span>{' '}
          <span className="mono" style={{ color: 'var(--color-neutral-400)' }}>{item.side}</span>
        </div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--color-neutral-600)' }}>
          {shortDate(item.date)} · {fmtPrice(item.price)} · {fmtSize(item.qty)}
        </div>
        {!decision && <div style={{ fontSize: 11, color: 'var(--color-neutral-600)', marginTop: 2 }}>{item.reason}</div>}
        {decision && (
          <div style={{ fontSize: 11, color: 'var(--color-accent)', marginTop: 2 }}>
            {decision.type === 'ignore' && <span style={{ color: 'var(--color-neutral-500)' }}>diabaikan</span>}
            {decision.type === 'running' && 'dicatat sebagai posisi berjalan baru'}
            {decision.type === 'match' && matched && (
              <>cocok dengan {matched.pair} {matched.direction === 'long' ? '▲' : '▼'} {shortDate(matched.date)} · entry {fmtPrice(matched.entry)}</>
            )}
            {' · '}
            <button type="button" className="link-btn" onClick={() => onDecide(null)}>urungkan</button>
          </div>
        )}
      </div>
      {!decision && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', position: 'relative' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setMenu((v) => !v)}>Cocokkan dengan trade…</button>
          <button className="btn btn-ghost btn-sm" onClick={() => onDecide({ type: 'ignore' })}>Abaikan</button>
          {menu && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onMouseDown={() => setMenu(false)} />
              <div className="popover" style={{ right: 0, width: 320 }}>
                <div className="mm-section">Trade {item.symbol} di jurnal</div>
                {candidates.length === 0 && (
                  <div className="mm-note">Tidak ada trade {item.symbol} yang belum tertaut.</div>
                )}
                {candidates.map((t) => (
                  <button
                    key={t.id}
                    className="menu-item"
                    onClick={() => { setMenu(false); onDecide({ type: 'match', tradeId: t.id }) }}
                  >
                    <span className="mono" style={{ width: 44, fontSize: 11, color: 'var(--color-neutral-500)' }}>{shortDate(t.date)}</span>
                    <span style={{ flex: 1 }}>{t.pair} {t.direction === 'long' ? '▲' : '▼'}</span>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>
                      {fmtPrice(t.entry)} · {fmtSize(t.size)} · {STATUS_LABEL[t.status]}
                    </span>
                  </button>
                ))}
                <div className="divider" style={{ margin: '4px 0' }} />
                <button className="menu-item" onClick={() => { setMenu(false); onDecide({ type: 'running' }) }}>
                  <span className="pulse-dot" />
                  <span style={{ flex: 1 }}>Catat sebagai posisi berjalan baru</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────── F5 · konfirmasi ─────────────────────────── */

export function SyncConfirm({ open, rows, onBack, onApply }) {
  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape') onBack()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onBack])
  if (!open) return null
  return (
    <div className="dialog-backdrop" onClick={onBack}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="sync-confirm-title" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title" id="sync-confirm-title">Terapkan sync?</div>
        <div className="mono" style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{summarizeRows(rows)}</div>
        <div className="inset-box" style={{ background: 'var(--color-bg)', padding: '8.4px 11.2px', fontSize: 12, lineHeight: 1.6, color: 'var(--color-neutral-400)' }}>
          Setelah diterapkan, data tidak bisa dikembalikan ke keadaan sebelumnya.
        </div>
        <div className="dialog-actions">
          <button className="btn btn-ghost" onClick={onBack} autoFocus>Kembali ke pratinjau</button>
          <button className="btn btn-primary" onClick={onApply}>Terapkan</button>
        </div>
      </div>
    </div>
  )
}

