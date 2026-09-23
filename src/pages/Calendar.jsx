import { useMemo, useState } from 'react'
import { Segmented } from '../components/ui'
import { dailyTotals, deriveTrade } from '../lib/calc'
import { typeOf } from '../lib/notes'
import { money, moneyCompact, rVal, monthLabel, longDate, shortDate, toneClass, DAYS_ID, todayISO } from '../lib/format'

/**
 * Heatmap PnL harian. Intensitas tint = besaran PnL, bukan jumlah trade.
 * Hari tanpa trade tetap terlihat sebagai sel kosong — istirahat juga informasi.
 */
export default function Calendar({ trades, onPickTrade, notesByDate, onOpenNote }) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [unit, setUnit] = useState('$')
  const [selected, setSelected] = useState(null)

  const totals = useMemo(() => dailyTotals(trades), [trades])

  const cells = useMemo(() => {
    const first = new Date(year, month, 1)
    // Minggu dimulai Senin
    const offset = (first.getDay() + 6) % 7
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const out = []
    for (let i = 0; i < offset; i++) out.push(null)
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      out.push({ day: d, iso, data: totals.get(iso) || null })
    }
    while (out.length % 7 !== 0) out.push(null)
    return out
  }, [year, month, totals])

  const monthStats = useMemo(() => {
    const days = cells.filter((c) => c?.data).map((c) => c.data)
    const net = days.reduce((s, d) => s + d.pnl, 0)
    const green = days.filter((d) => d.pnl > 0)
    const red = days.filter((d) => d.pnl < 0)
    const best = days.reduce((a, b) => (!a || b.pnl > a.pnl ? b : a), null)
    const worst = days.reduce((a, b) => (!a || b.pnl < a.pnl ? b : a), null)
    const over = days.filter((d) => d.count > 4).length
    const scale = Math.max(1, ...days.map((d) => Math.abs(unit === 'R' ? d.r : d.pnl)))
    return { net, green: green.length, red: red.length, best, worst, over, scale, count: days.length }
  }, [cells, unit])

  function shift(delta) {
    let m = month + delta
    let y = year
    if (m < 0) { m = 11; y-- }
    if (m > 11) { m = 0; y++ }
    setMonth(m)
    setYear(y)
    setSelected(null)
  }

  const today = todayISO()
  const selectedData = selected ? totals.get(selected) : null
  const selectedNotes = (selected && notesByDate?.get(selected)) || []

  return (
    <div className="card elev-sm" style={{ padding: 'var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
        <div>
          <div className="card-kicker">Kalender</div>
          <div className="card-title">Heatmap PnL harian — {monthLabel(year, month, true)}</div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
          <Segmented options={['$', 'R']} value={unit} onChange={setUnit} small />
          <button className="btn btn-secondary btn-sm" onClick={() => shift(-1)}>◀</button>
          <span className="mono" style={{ fontSize: 13, minWidth: 70, textAlign: 'center' }}>{monthLabel(year, month)}</span>
          <button className="btn btn-secondary btn-sm" onClick={() => shift(1)}>▶</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth()) }}>Hari ini</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 'var(--space-6)' }}>
        <div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 'var(--space-2)',
            fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase',
            color: 'var(--color-neutral-600)', marginBottom: 'var(--space-2)',
          }}>
            {DAYS_ID.map((d) => <span key={d}>{d}</span>)}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 'var(--space-2)' }}>
            {cells.map((c, i) => {
              if (!c) return <div key={i} />
              const dayNotes = notesByDate?.get(c.iso) || []
              const clickable = c.data || dayNotes.length > 0
              const v = c.data ? (unit === 'R' ? c.data.r : c.data.pnl) : null
              const intensity = v != null && monthStats.scale ? Math.min(0.5, (Math.abs(v) / monthStats.scale) * 0.5) : 0
              const tone = v == null ? null : v > 0 ? 'profit' : v < 0 ? 'loss' : null
              const style = tone
                ? {
                    background: `color-mix(in srgb, var(--color-${tone}) ${(intensity * 100).toFixed(0)}%, transparent)`,
                    boxShadow: `inset 0 0 0 1px color-mix(in srgb, var(--color-${tone}) ${((intensity + 0.12) * 100).toFixed(0)}%, transparent)`,
                  }
                : undefined
              return (
                <div
                  key={c.iso}
                  className={
                    'cal-cell' + (clickable ? '' : ' is-empty') + (c.iso === today ? ' is-today' : '') +
                    (c.iso === selected ? ' is-today' : '')
                  }
                  style={style}
                  onClick={() => clickable && setSelected(c.iso === selected ? null : c.iso)}
                  title={[longDate(c.iso), c.data && `${c.data.count} trade`, dayNotes.length && `${dayNotes.length} catatan`].filter(Boolean).join(' · ')}
                >
                  {dayNotes.length > 0 && <span className="cal-note-dot" />}
                  <div className="mono" style={{ fontSize: 10, color: c.data ? 'var(--color-neutral-500)' : 'var(--color-neutral-700)' }}>
                    {c.day}
                  </div>
                  {c.data && (
                    <>
                      <div className={'mono ' + toneClass(c.data.pnl)} style={{ fontSize: 12 }}>
                        {c.data.pnl === 0 ? 'BE' : unit === 'R' ? rVal(c.data.r) : moneyCompact(c.data.pnl)}
                      </div>
                      <div className="mono" style={{ fontSize: 9, color: 'var(--color-neutral-500)' }}>
                        {c.data.count} trade
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginTop: 'var(--space-4)', fontSize: 11, color: 'var(--color-neutral-600)' }}>
            <span>−{moneyCompact(monthStats.scale).replace('+', '')}</span>
            <span style={{ flex: 1, height: 6, borderRadius: 3, background: 'linear-gradient(90deg, var(--color-loss), var(--color-neutral-900) 50%, var(--color-profit))' }} />
            <span>+{moneyCompact(monthStats.scale).replace('+', '')}</span>
            <span style={{ marginLeft: 'var(--space-4)' }}>Intensitas = besaran PnL, bukan jumlah trade</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div className="section-step" style={{ marginBottom: 0 }}>Ringkasan bulan</div>
          <Row label="Net PnL" value={<span className={'mono ' + toneClass(monthStats.net)}>{money(monthStats.net)}</span>} />
          <Row label="Hari hijau / merah" value={<span className="mono">{monthStats.green} / {monthStats.red}</span>} />
          <Row label="Hari terbaik" value={<span className="mono profit">{monthStats.best ? `${shortDate(monthStats.best.date)} ${money(monthStats.best.pnl)}` : '—'}</span>} />
          <Row label="Hari terburuk" value={<span className="mono loss">{monthStats.worst && monthStats.worst.pnl < 0 ? `${shortDate(monthStats.worst.date)} ${money(monthStats.worst.pnl)}` : '—'}</span>} />
          <Row label="Overtrading" value={<span className="mono">{monthStats.over} hari &gt; 4 trade</span>} />
          <div className="divider" />

          {selected && (selectedData || selectedNotes.length > 0) ? (
            <>
              <div className="section-step" style={{ marginBottom: 0 }}>{longDate(selected)}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {(selectedData?.trades || []).map((t) => {
                  const d = deriveTrade(t)
                  return (
                    <div
                      key={t.id}
                      onClick={() => onPickTrade?.(t)}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                        padding: '6px 8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                        background: 'var(--color-bg)', fontSize: 12,
                      }}
                    >
                      <span>{t.pair} {t.direction === 'long' ? '▲' : '▼'} <span className="text-muted">{t.timeframe}</span></span>
                      <span className={'mono ' + toneClass(d.netPnl)}>{money(d.netPnl)}</span>
                    </div>
                  )
                })}
              </div>
              {selectedNotes.length > 0 && (
                <>
                  <div className="metric-label" style={{ marginTop: 'var(--space-2)' }}>Catatan · {selectedNotes.length}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {selectedNotes.map((n) => (
                      <div
                        key={n.id}
                        onClick={() => onOpenNote?.(n.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '6px 8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                          background: 'var(--color-bg)', fontSize: 12,
                        }}
                      >
                        <span className="note-dot" style={{ background: typeOf(n.type).color }} />
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title || 'Tanpa judul'}</span>
                        <span className="note-kind">{typeOf(n.type).label}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <p className="card-body" style={{ lineHeight: 1.6, margin: 0 }}>
              Klik satu sel untuk melihat daftar trade pada tanggal itu. Sel hari ini diberi ring aksen;
              titik aksen kecil di pojok menandai hari yang punya catatan.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, gap: 8 }}>
      <span className="text-muted">{label}</span>
      {value}
    </div>
  )
}
