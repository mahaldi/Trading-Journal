import { useMemo, useState } from 'react'
import { Segmented, ContribBar } from '../components/ui'
import { groupPerformance, rDistribution, summarize, deriveTrade, closedTrades } from '../lib/calc'
import { money, rVal, pct, toneClass } from '../lib/format'

const DIMENSIONS = [
  { value: 'tags', label: 'Strategi' },
  { value: 'pair', label: 'Pair' },
  { value: 'emotion', label: 'Emosi' },
  { value: 'timeframe', label: 'TF' },
  { value: 'direction', label: 'Arah' },
]

export default function Stats({ trades }) {
  const [dim, setDim] = useState('tags')

  const rows = useMemo(() => groupPerformance(trades, dim), [trades, dim])
  const dist = useMemo(() => rDistribution(trades), [trades])
  const s = useMemo(() => summarize(trades), [trades])
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.netPnl)))
  const maxBin = Math.max(1, ...dist.map((b) => b.count))

  // Performa per hari dalam minggu — pola kebiasaan
  const byWeekday = useMemo(() => {
    const names = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']
    const buckets = names.map((n) => ({ name: n, pnl: 0, count: 0 }))
    for (const t of closedTrades(trades)) {
      const d = deriveTrade(t)
      if (d.netPnl == null) continue
      const iso = t.closeDate || t.date
      if (!iso) continue
      const dt = new Date(iso + 'T00:00:00')
      if (Number.isNaN(dt.getTime())) continue
      const idx = (dt.getDay() + 6) % 7
      buckets[idx].pnl += d.netPnl
      buckets[idx].count++
    }
    return buckets
  }, [trades])
  const maxWd = Math.max(1, ...byWeekday.map((b) => Math.abs(b.pnl)))

  const label = DIMENSIONS.find((d) => d.value === dim)?.label || ''

  if (!closedTrades(trades).length) {
    return (
      <div className="card elev-sm" style={{ padding: 'var(--space-6)' }}>
        <div className="empty-state">
          <div style={{ fontSize: 15, color: 'var(--color-neutral-400)' }}>
            Statistik muncul setelah ada trade yang ditutup.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 'var(--space-6)', alignItems: 'start' }}>
      <div className="card elev-sm" style={{ padding: 'var(--space-6)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
          <div>
            <div className="card-kicker">Statistik</div>
            <div className="card-title">Performa per dimensi</div>
          </div>
          <Segmented options={DIMENSIONS} value={dim} onChange={setDim} small />
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>{label}</th>
              <th style={{ textAlign: 'right' }}>Trade</th>
              <th style={{ textAlign: 'right' }}>Win</th>
              <th style={{ textAlign: 'right' }}>Avg R</th>
              <th style={{ textAlign: 'right' }}>Expectancy</th>
              <th style={{ textAlign: 'right' }}>Net PnL</th>
              <th style={{ width: 110 }}>Kontribusi</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} className="row">
                <td>
                  <span className={'tag ' + (i === 0 ? 'tag-accent' : 'tag-neutral')}>
                    {dim === 'tags' ? '#' : ''}{r.key}
                  </span>
                </td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.count}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.winRate != null ? `${r.winRate.toFixed(0)}%` : '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.avgR != null ? `${r.avgR.toFixed(2)}R` : '—'}</td>
                <td className={'mono ' + toneClass(r.expectancy)} style={{ textAlign: 'right' }}>{rVal(r.expectancy)}</td>
                <td className={'mono ' + toneClass(r.netPnl)} style={{ textAlign: 'right' }}>{money(r.netPnl)}</td>
                <td><ContribBar value={r.netPnl} max={maxAbs} /></td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-6)', marginTop: 'var(--space-6)' }}>
          <div>
            <div className="section-step">Sebaran R</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 70 }}>
              {dist.map((b, i) => (
                <span
                  key={i}
                  title={`${b.lo}R … ${b.hi}R · ${b.count} trade`}
                  style={{
                    flex: 1, borderRadius: '2px 2px 0 0',
                    height: `${Math.max(b.count ? 6 : 2, (b.count / maxBin) * 100)}%`,
                    background: b.hi <= 0 ? 'var(--color-loss)' : 'var(--color-profit)',
                    opacity: b.count ? 0.85 : 0.18,
                  }}
                />
              ))}
            </div>
            <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--color-neutral-600)', marginTop: 4 }}>
              <span>−3R</span><span>0</span><span>+5R</span>
            </div>
          </div>

          <div>
            <div className="section-step">PnL per hari</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, height: 70 }}>
              {byWeekday.map((b) => (
                <div key={b.name} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, height: '100%', justifyContent: 'flex-end' }}>
                  <span
                    title={`${b.name}: ${money(b.pnl)} · ${b.count} trade`}
                    style={{
                      width: '100%', borderRadius: '2px 2px 0 0',
                      height: `${Math.max(b.count ? 6 : 2, (Math.abs(b.pnl) / maxWd) * 78)}%`,
                      background: b.pnl >= 0 ? 'var(--color-profit)' : 'var(--color-loss)',
                      opacity: b.count ? 0.85 : 0.18,
                    }}
                  />
                  <span className="mono" style={{ fontSize: 9, color: 'var(--color-neutral-600)' }}>{b.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card elev-sm" style={{ padding: 'var(--space-6)', gap: 'var(--space-3)' }}>
        <div>
          <div className="card-kicker">Ringkasan</div>
          <div className="card-title">Angka kunci</div>
        </div>
        <Row label="Net PnL" value={<span className={'mono ' + toneClass(s.netPnl)} style={{ fontSize: 15 }}>{money(s.netPnl)}</span>} />
        <Row label="Trade selesai" value={<span className="mono">{s.total}</span>} />
        <Row label="Win rate" value={<span className="mono">{pct(s.winRate)}</span>} />
        <Row label="Profit factor" value={<span className="mono">{s.profitFactor === Infinity ? '∞' : s.profitFactor?.toFixed(2) ?? '—'}</span>} />
        <Row label="Expectancy" value={<span className={'mono ' + toneClass(s.expectancy)}>{rVal(s.expectancy)}</span>} />
        <Row label="Avg R aktual" value={<span className="mono">{s.avgR != null ? `${s.avgR.toFixed(2)}R` : '—'}</span>} />
        <Row label="Avg R rencana" value={<span className="mono">{s.avgPlannedR != null ? `${s.avgPlannedR.toFixed(2)}R` : '—'}</span>} />
        <Row label="Avg win" value={<span className="mono profit">{money(s.avgWin, { sign: false })}</span>} />
        <Row label="Avg loss" value={<span className="mono loss">{money(s.avgLoss ? Math.abs(s.avgLoss) : null, { sign: false })}</span>} />
        <Row label="Max drawdown" value={<span className="mono loss">{s.maxDD ? `${money(s.maxDD)} (${pct(s.maxDDPct)})` : '—'}</span>} />
        <Row label="Streak W / L" value={<span className="mono">{s.bestStreak} / {s.worstStreak}</span>} />
        <Row label="Hari aktif" value={<span className="mono">{s.activeDays}</span>} />
        <div className="divider" style={{ margin: 'var(--space-2) 0' }} />
        <p className="card-body" style={{ lineHeight: 1.6, margin: 0 }}>
          Expectancy adalah rata-rata R per trade — angka yang paling jujur menilai sebuah strategi,
          karena tidak bergantung pada ukuran akun maupun besar posisi. Positif berarti sistemnya layak diulang.
        </p>
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
