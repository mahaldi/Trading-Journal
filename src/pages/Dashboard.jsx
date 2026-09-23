import { Fragment, useMemo, useState } from 'react'
import EquityCurve from '../components/EquityCurve'
import ExitList from '../components/ExitList'
import { normalize as normalizeShots } from '../components/ScreenshotSlots'
import { Segmented } from '../components/ui'
import { imageURL } from '../lib/storage'
import {
  summarize, deriveTrade, openTrades, closedTrades, sortByDate,
  effectiveDate, deviationLabel, tagLibrary,
} from '../lib/calc'
import { money, moneyCompact, rVal, pct, price, size as fmtSize, shortDate, stamp, toneClass } from '../lib/format'
import { baseUnitShort } from '../lib/pairs'
import { typeOf } from '../lib/notes'

const FILTERS = [
  { value: 'all', label: 'Semua' },
  { value: 'long', label: 'Long' },
  { value: 'short', label: 'Short' },
  { value: 'win', label: 'Menang' },
  { value: 'loss', label: 'Kalah' },
  { value: 'scaled', label: 'Scale-out', title: 'Trade dengan lebih dari satu exit' },
]

export default function Dashboard({ trades, allTrades, settings, onNew, onEdit, onCloseTrade, onPartialClose, onDelete, onLightbox, newTradeId, notesByTrade, onOpenNote }) {
  const [curveUnit, setCurveUnit] = useState('$')
  const [filter, setFilter] = useState('all')
  const [openRow, setOpenRow] = useState(null)
  const [openRunning, setOpenRunning] = useState(null)
  const [sortExits, setSortExits] = useState(false)

  const s = useMemo(() => summarize(trades), [trades])
  const running = useMemo(() => sortByDate(openTrades(allTrades), -1), [allTrades])
  const topTags = useMemo(() => tagLibrary(trades).slice(0, 3), [trades])

  const history = useMemo(() => {
    let rows = sortByDate(closedTrades(trades), -1)
    if (filter === 'long' || filter === 'short') rows = rows.filter((t) => t.direction === filter)
    if (filter === 'win') rows = rows.filter((t) => deriveTrade(t).outcome === 'win')
    if (filter === 'loss') rows = rows.filter((t) => deriveTrade(t).outcome === 'loss')
    if (filter === 'scaled') rows = rows.filter((t) => deriveTrade(t).exitCount > 1)
    if (sortExits) {
      rows = [...rows].sort((a, b) => deriveTrade(b).exitCount - deriveTrade(a).exitCount)
    }
    return rows
  }, [trades, filter, sortExits])

  // Sparkline jumlah trade per hari untuk kartu Total Trades
  const volumeBars = useMemo(() => {
    const byDay = new Map()
    for (const t of closedTrades(trades)) {
      const k = effectiveDate(t)
      byDay.set(k, (byDay.get(k) || 0) + 1)
    }
    return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-6).map(([, c]) => c)
  }, [trades])
  const maxBar = Math.max(1, ...volumeBars)

  return (
    <>
      {/* ── Baris metrik ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
        <div className="card elev-sm" style={{ gap: 'var(--space-1)', padding: '14px 16.8px', borderLeft: `2px solid var(--color-${s.netPnl >= 0 ? 'profit' : 'loss'})` }}>
          <div className="metric-label">Net PnL</div>
          <div className={'mono ' + toneClass(s.netPnl)} style={{ fontSize: 34, fontWeight: 500, lineHeight: 1.1 }}>
            {money(s.netPnl)}
          </div>
          <div className="metric-sub">
            setelah fees · {s.total} trade selesai
            {running.length > 0 && <> · <span style={{ color: 'var(--color-accent)' }}>{running.length} berjalan belum dihitung</span></>}
          </div>
        </div>

        <div className="card elev-sm" style={{ gap: 'var(--space-1)', padding: '14px 16.8px' }}>
          <div className="metric-label">Win Rate</div>
          <div className="mono" style={{ fontSize: 26, fontWeight: 500, lineHeight: 1.1 }}>
            {s.winRate != null ? s.winRate.toFixed(1) : '—'}
            <span style={{ fontSize: 16, color: 'var(--color-neutral-600)' }}>%</span>
          </div>
          <div style={{ display: 'flex', height: 4, borderRadius: 2, overflow: 'hidden', background: 'var(--color-neutral-900)', marginTop: 'var(--space-2)' }}>
            <span style={{ width: `${s.total ? (s.wins / s.total) * 100 : 0}%`, background: 'var(--color-profit)' }} />
            <span style={{ width: `${s.total ? (s.be / s.total) * 100 : 0}%`, background: 'var(--color-neutral-700)' }} />
            <span style={{ width: `${s.total ? (s.losses / s.total) * 100 : 0}%`, background: 'var(--color-loss)' }} />
          </div>
          <div className="mono metric-sub">{s.wins} W · {s.losses} L{s.be ? ` · ${s.be} BE` : ''}</div>
        </div>

        <div className="card elev-sm" style={{ gap: 'var(--space-1)', padding: '14px 16.8px' }}>
          <div className="metric-label">Total Trades</div>
          <div className="mono" style={{ fontSize: 26, fontWeight: 500, lineHeight: 1.1 }}>{s.total}</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 18, marginTop: 'var(--space-2)' }}>
            {volumeBars.length ? volumeBars.map((c, i) => (
              <span key={i} style={{
                width: 5, height: `${(c / maxBar) * 100}%`,
                background: i === volumeBars.length - 1 ? 'var(--color-accent)' : 'var(--color-neutral-800)',
              }} />
            )) : <span className="metric-sub">—</span>}
          </div>
          <div className="metric-sub">
            {s.tradesPerDay != null ? `${s.tradesPerDay.toFixed(1)} trade / hari aktif` : 'belum ada data'}
          </div>
        </div>

        <div className="card elev-sm" style={{ gap: 'var(--space-1)', padding: '14px 16.8px' }}>
          <div className="metric-label">R:R Aktual</div>
          <div className="mono" style={{ fontSize: 26, fontWeight: 500, lineHeight: 1.1 }}>
            {s.avgR != null ? s.avgR.toFixed(2) : '—'}
            <span style={{ fontSize: 16, color: 'var(--color-neutral-600)' }}>R</span>
          </div>
          <div className="metric-sub">
            {s.avgPlannedR != null ? <>rencana {s.avgPlannedR.toFixed(2)}R</> : 'rencana —'}
            {s.avgR != null && s.avgPlannedR != null && (
              <> · <span className={toneClass(s.avgR - s.avgPlannedR)}>{rVal(s.avgR - s.avgPlannedR)} slippage</span></>
            )}
          </div>
        </div>
      </div>

      {/* ── Equity curve + konteks risiko ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 'var(--space-6)' }}>
        <div className="card elev-sm" style={{ padding: 'var(--space-6)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div>
              <div className="card-kicker">Equity Curve</div>
              <div className="card-title">Akumulasi PnL</div>
            </div>
            <Segmented options={['$', 'R', '%']} value={curveUnit} onChange={setCurveUnit} small />
          </div>
          <EquityCurve
            curve={s.curve}
            unit={curveUnit}
            startingBalance={settings.startingBalance || 10000}
            onPickTrade={(t) => setOpenRow(t.id)}
          />
        </div>

        <div className="card elev-sm" style={{ padding: 'var(--space-6)', gap: 'var(--space-4)' }}>
          <div>
            <div className="card-kicker">Drawdown &amp; Sebaran</div>
            <div className="card-title">Konteks risiko</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <Stat label="Max Drawdown" value={<span className="mono loss">{s.maxDD ? `${money(s.maxDD)} (${pct(s.maxDDPct)})` : '—'}</span>} />
            <Stat label="Profit Factor" value={<span className="mono">{s.profitFactor == null ? '—' : s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2)}</span>} />
            <Stat label="Avg Win / Avg Loss" value={<span className="mono">{money(s.avgWin, { sign: false })} / {money(s.avgLoss ? Math.abs(s.avgLoss) : null, { sign: false })}</span>} />
            <Stat label="Expectancy" value={<span className={'mono ' + toneClass(s.expectancy)}>{rVal(s.expectancy)}</span>} />
            <Stat label="Streak terpanjang" value={<span className="mono">{s.bestStreak} W · {s.worstStreak} L</span>} />
          </div>
          <div className="divider" />
          <div className="metric-label">Tag teratas</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            {topTags.length ? topTags.map((t, i) => (
              <span key={t.key} className={'tag ' + (i === 0 ? 'tag-accent' : 'tag-neutral')}>
                #{t.key} · {moneyCompact(t.netPnl)}
              </span>
            )) : <span className="metric-sub">belum ada tag</span>}
          </div>
        </div>
      </div>

      {/* ── Posisi berjalan ── */}
      {running.length > 0 && (
        <div className="card elev-sm" style={{ padding: 'var(--space-6)', marginTop: 'var(--space-6)' }}>
          <div className="metric-label" style={{ marginBottom: 'var(--space-3)' }}>
            Posisi berjalan · {running.length}
            <span style={{ textTransform: 'none', letterSpacing: 0, marginLeft: 8, color: 'var(--color-neutral-700)' }}>
              tidak dihitung ke Net PnL maupun Win Rate sampai ditutup
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {running.map((t) => {
              const d = deriveTrade(t)
              const expanded = openRunning === t.id
              const restPct = d.remainingPortion != null ? Math.round(d.remainingPortion * 1000) / 10 : null
              return (
                <div key={t.id} style={{
                  padding: 'var(--space-3)',
                  borderRadius: 'var(--radius-md)', background: 'var(--color-bg)',
                  boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 40%, transparent)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <span className="pulse-dot" />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
                        {t.pair} {t.direction === 'long' ? '▲' : '▼'} {t.timeframe}
                        {d.isPartial && <span className="tag tag-accent" style={{ fontSize: 10 }}>Sebagian ditutup</span>}
                      </div>
                      <div className="mono" style={{ fontSize: 10, color: 'var(--color-neutral-600)' }}>
                        entry {price(d.entry)} · SL {price(d.slAfter)} · {fmtSize(d.remainingSize)} {baseUnitShort(t.pair)}
                        {d.isPartial ? ` dari ${fmtSize(d.size)}` : ''}
                        {d.plannedR != null && ` · rencana ${rVal(d.plannedR, { sign: false })}`}
                      </div>
                    </div>
                    {d.isPartial && (
                      <div style={{ textAlign: 'right' }}>
                        <div className={'mono ' + toneClass(d.realizedR)} style={{ fontSize: 13 }}>
                          {rVal(d.realizedR)}
                        </div>
                        <div className="mono" style={{ fontSize: 10, color: 'var(--color-neutral-600)' }}>terkunci</div>
                      </div>
                    )}
                    <div style={{ textAlign: 'right' }}>
                      <div className={'mono ' + toneClass(d.floatingR)} style={{ fontSize: 13 }}>
                        {d.floatingR != null ? rVal(d.floatingR) : '—'}
                      </div>
                      <div className="mono" style={{ fontSize: 10, color: 'var(--color-neutral-600)' }}>
                        {d.floatingPnl != null ? `${money(d.floatingPnl)} floating` : 'isi harga terakhir'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => onPartialClose(t)}
                        title="Tutup sebagian posisi, sisanya tetap berjalan">
                        {d.isPartial ? 'Tutup sebagian lagi' : '◗ Sebagian'}
                      </button>
                      <button className="btn btn-primary btn-sm" onClick={() => onCloseTrade(t)}>
                        {d.isPartial && restPct != null ? `Tutup sisa ${restPct}%` : 'Tutup trade'}
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => onEdit(t)}>Edit</button>
                      {d.isPartial && (
                        <button className="btn btn-secondary btn-sm btn-icon"
                          onClick={() => setOpenRunning(expanded ? null : t.id)}
                          title={expanded ? 'Sembunyikan daftar exit' : `Lihat ${d.exitCount} exit`}>
                          {expanded ? '▴' : '▾'}
                        </button>
                      )}
                    </div>
                  </div>

                  {d.isPartial && expanded && (
                    <div style={{ marginTop: 'var(--space-3)', paddingTop: 'var(--space-3)', boxShadow: 'inset 0 1px 0 var(--color-neutral-800)' }}>
                      <ExitList trade={t} d={d} compact />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Histori trade ── */}
      <div className="card elev-sm" style={{ padding: '16.8px 0 5.6px', marginTop: 'var(--space-6)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 16.8px 8.4px' }}>
          <div>
            <div className="card-kicker">Histori</div>
            <div className="card-title">Trade terakhir</div>
          </div>
          <Segmented options={FILTERS} value={filter} onChange={setFilter} small />
        </div>

        {history.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: 15, color: 'var(--color-neutral-400)' }}>
              {closedTrades(trades).length === 0 ? 'Belum ada trade tercatat.' : 'Tidak ada trade yang cocok dengan filter ini.'}
            </div>
            {closedTrades(trades).length === 0 && (
              <button className="btn btn-primary" onClick={onNew}>+ Catat trade pertama</button>
            )}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ paddingLeft: 16.8 }}>Tanggal</th>
                <th>Pair</th>
                <th>Arah</th>
                <th>TF</th>
                <th>Strategi</th>
                <th>Emosi</th>
                <th
                  style={{ textAlign: 'right', cursor: 'pointer', color: sortExits ? 'var(--color-accent)' : undefined }}
                  onClick={() => setSortExits((v) => !v)}
                  title="Jumlah exit — klik untuk mengurutkan"
                >
                  Exit {sortExits ? '▾' : ''}
                </th>
                <th style={{ textAlign: 'right' }}>R</th>
                <th style={{ textAlign: 'right', paddingRight: 16.8 }}>PnL</th>
              </tr>
            </thead>
            <tbody>
              {history.map((t) => {
                const d = deriveTrade(t)
                const isOpen = openRow === t.id
                return (
                  <Fragment key={t.id}>
                    <tr
                      className={'row' + (t.id === newTradeId ? ' is-new' : '')}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setOpenRow(isOpen ? null : t.id)}
                    >
                      <td className="mono" style={{ paddingLeft: 16.8, color: 'var(--color-neutral-500)' }}>
                        {shortDate(effectiveDate(t))}
                      </td>
                      <td style={{ fontWeight: 500 }}>{t.pair}</td>
                      <td>
                        <span className="tag" style={{
                          background: 'var(--color-neutral-900)',
                          color: `var(--color-${t.direction === 'long' ? 'profit' : 'loss'})`,
                        }}>
                          {t.direction === 'long' ? '▲ Long' : '▼ Short'}
                        </span>
                      </td>
                      <td className="mono" style={{ color: 'var(--color-neutral-500)' }}>{t.timeframe}</td>
                      <td>
                        {t.tags?.length ? (
                          <span className="tag tag-accent">#{t.tags[0]}{t.tags.length > 1 ? ` +${t.tags.length - 1}` : ''}</span>
                        ) : <span style={{ color: 'var(--color-neutral-700)', fontSize: 12 }}>—</span>}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{t.emotion || '—'}</td>
                      <td className="mono" style={{ textAlign: 'right', color: d.exitCount > 1 ? 'var(--color-accent)' : 'var(--color-neutral-700)' }}>
                        {d.exitCount > 1 ? `${d.exitCount}×` : '1'}
                      </td>
                      <td className={'mono ' + toneClass(d.actualR)} style={{ textAlign: 'right' }}>
                        {d.actualR != null ? rVal(d.actualR) : '—'}
                      </td>
                      <td className={'mono ' + toneClass(d.netPnl)} style={{ textAlign: 'right', paddingRight: 16.8, fontWeight: 500 }}>
                        {money(d.netPnl)} {d.outcome === 'be' && <span style={{ fontSize: 10 }}>BE</span>}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={9} style={{ padding: 0 }}>
                          <TradeDetail trade={t} d={d} onEdit={onEdit} onDelete={onDelete} onLightbox={onLightbox} notes={notesByTrade?.get(t.id)} onOpenNote={onOpenNote} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

function Stat({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, gap: 8 }}>
      <span className="text-muted">{label}</span>
      {value}
    </div>
  )
}

/** Panel ekspansi inline: niat · bukti · hasil, berdampingan. */
function TradeDetail({ trade: t, d, onEdit, onDelete, onLightbox, notes, onOpenNote }) {
  const dev = deviationLabel(d.deviationR, { scaled: d.exitCount > 1 })
  const shots = normalizeShots(t.shots)
  const scaled = d.exitCount > 1
  return (
    <div style={{
      background: 'var(--color-inset)', boxShadow: 'inset 0 0 0 1px var(--color-neutral-800)',
      borderRadius: 'var(--radius-md)', margin: '0 11.2px 11.2px', padding: 'var(--space-6)',
      display: 'flex', flexDirection: 'column', gap: 'var(--space-6)',
    }}>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 260px', gap: 'var(--space-6)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <div className="section-step" style={{ marginBottom: 0 }}>Setup (Entry)</div>
        <ShotGallery images={shots.setup} label="screenshot chart · entry" onLightbox={onLightbox} />
        <p style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--color-neutral-400)', margin: '5.6px 0 0' }}>
          {t.notes ? `“${t.notes}”` : <span style={{ color: 'var(--color-neutral-700)' }}>Belum ada catatan analisis.</span>}
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <div className="section-step" style={{ marginBottom: 0 }}>Result (Exit)</div>
        <ShotGallery images={shots.result} label="screenshot chart · exit" onLightbox={onLightbox} />
        <p style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--color-neutral-400)', margin: '5.6px 0 0' }}>
          {t.closeNotes ? `“${t.closeNotes}”` : <span style={{ color: 'var(--color-neutral-700)' }}>Belum ada catatan penutupan.</span>}
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div className="metric-label">Eksekusi</div>
        <Stat label="Entry / Exit" value={<span className="mono">{price(d.entry)} → {price(d.exit)}</span>} />
        <Stat label="SL / TP awal" value={<span className="mono">{price(d.sl)} / {price(d.tp)}</span>} />
        <Stat label="Size · Leverage" value={<span className="mono">{fmtSize(d.size)} {baseUnitShort(t.pair)}{t.leverage ? ` · ${t.leverage}×` : ''}</span>} />
        <Stat label="Notional" value={<span className="mono">{money(d.notional, { sign: false })}</span>} />
        <Stat label="Fees" value={<span className="mono loss">{d.fees ? `−${money(d.fees, { sign: false })}` : '—'}</span>} />
        {t.pnlOverride != null && <Stat label="PnL" value={<span className="mono" style={{ color: 'var(--color-accent)' }}>ditimpa manual</span>} />}
        <div className="divider" />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="text-muted" style={{ fontSize: 12 }}>R:R rencana → aktual</span>
          <span className="mono" style={{ fontSize: 15 }}>
            {d.plannedR != null ? rVal(d.plannedR, { sign: false }) : '—'} → <span className={toneClass(d.actualR)}>{d.actualR != null ? rVal(d.actualR) : '—'}</span>
          </span>
        </div>
        {dev && <div className={'mono ' + dev.tone} style={{ fontSize: 11, textAlign: 'right' }}>{dev.text}</div>}
        {t.tags?.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {t.tags.map((tag) => <span key={tag} className="tag tag-neutral">#{tag}</span>)}
          </div>
        )}
        {t.history?.length > 0 && (
          <div className="mono" style={{ fontSize: 10, color: 'var(--color-neutral-700)' }}>
            {t.history[t.history.length - 1].label} {stamp(t.history[t.history.length - 1].ts)}
          </div>
        )}
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'auto' }}>
          <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); onEdit(t) }}>Edit</button>
          <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); onDelete(t) }}>Hapus</button>
        </div>
      </div>
    </div>

    {notes?.length > 0 && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <div className="section-step" style={{ marginBottom: 0 }}>Catatan tertaut · {notes.length}</div>
        {notes.map((n) => (
          <div
            key={n.id}
            className="linked-row"
            style={{ background: 'var(--color-bg)' }}
            onClick={(e) => { e.stopPropagation(); onOpenNote?.(n.id) }}
          >
            <span className="note-dot" style={{ background: typeOf(n.type).color }} />
            <span style={{ fontSize: 13, flex: 1 }}>{n.title || 'Tanpa judul'}</span>
            <span className="note-kind">{typeOf(n.type).label}</span>
            <span className="mono" style={{ fontSize: 10, color: 'var(--color-neutral-600)', width: 44, textAlign: 'right' }}>{shortDate(n.date)}</span>
          </div>
        ))}
      </div>
    )}

    {scaled && (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 'var(--space-6)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <div className="section-step" style={{ marginBottom: 0 }}>
            Scale out · {d.exitCount} exit
          </div>
          <ExitList trade={t} d={d} compact />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div className="metric-label">Hasil gabungan</div>
          <Stat label="Exit rata-rata tertimbang" value={<span className="mono">{price(d.avgExit)}</span>} />
          <Stat label="Realized PnL total" value={<span className={'mono ' + toneClass(d.realizedPnl)}>{money(d.realizedPnl)}</span>} />
          <Stat label="Fee gabungan" value={<span className="mono loss">{d.totalFees ? `−${money(d.totalFees, { sign: false })}` : '—'}</span>} />
          <Stat label="Rentang exit" value={<span className="mono">{exitSpan(d)}</span>} />
          <Stat label="Dihitung di Win Rate" value={<span className="mono" style={{ color: 'var(--color-neutral-400)' }}>1 trade</span>} />
          <div style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--color-neutral-600)' }}>
            R aktual adalah rata-rata tertimbang semua exit, bukan harga exit terakhir — jadi
            scale-out tidak membuat angkanya terlihat lebih buruk dari kenyataannya.
          </div>
        </div>
      </div>
    )}
    </div>
  )
}

/** Rentang tanggal dari exit pertama sampai terakhir. */
function exitSpan(d) {
  const dates = d.legs.map((l) => l.date).filter(Boolean).sort()
  if (!dates.length) return '—'
  const a = shortDate(dates[0])
  const b = shortDate(dates[dates.length - 1])
  return a === b ? a : `${a} → ${b}`
}

/**
 * Galeri bukti: satu gambar besar dengan panah ‹ › dan penghitung,
 * plus strip thumbnail di bawah. Gambar pertama adalah "Utama".
 */
function ShotGallery({ images, label, onLightbox }) {
  const [i, setI] = useState(0)
  const count = images.length
  const index = Math.min(i, Math.max(0, count - 1))

  if (!count) {
    return (
      <div style={{
        aspectRatio: '16/10', borderRadius: 'var(--radius-md)',
        background: 'linear-gradient(135deg, var(--color-surface), var(--color-panel))',
        boxShadow: 'inset 0 0 0 1px var(--color-neutral-800)',
        display: 'grid', placeItems: 'center', color: 'var(--color-neutral-700)', fontSize: 11,
      }}>
        {label}
      </div>
    )
  }

  const step = (delta) => setI((prev) => (prev + delta + count) % count)

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div
        className="gallery-main"
        onClick={() => onLightbox({ images, index })}
        title="Klik untuk perbesar"
      >
        <img src={imageURL(images[index].id)} alt={`${label} ${index + 1}`} loading="lazy" />
        {count > 1 && (
          <>
            <button className="gallery-nav" style={{ left: 6 }} title="Sebelumnya"
              onClick={(e) => { e.stopPropagation(); step(-1) }}>‹</button>
            <button className="gallery-nav" style={{ right: 6 }} title="Berikutnya"
              onClick={(e) => { e.stopPropagation(); step(1) }}>›</button>
            <span className="gallery-count">{index + 1} / {count}</span>
          </>
        )}
      </div>

      {count > 1 && (
        <div className="gallery-strip">
          {images.map((img, n) => (
            <div
              key={img.id}
              className={'gallery-thumb' + (n === index ? ' is-active' : '')}
              onClick={(e) => { e.stopPropagation(); setI(n) }}
              title={img.name}
            >
              <img src={imageURL(img.id)} alt="" loading="lazy" />
              {n === 0 && <span className="thumb-dot" />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
