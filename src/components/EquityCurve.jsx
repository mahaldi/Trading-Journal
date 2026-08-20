import { useMemo, useRef, useState } from 'react'
import { money, moneyCompact, rVal, pct, shortDate } from '../lib/format'

const W = 700
const H = 232
const PAD_TOP = 14
const PAD_BOTTOM = 46

/**
 * Kurva ekuitas: area chart dengan garis nol putus-putus, segmen drawdown
 * diwarnai merah redup, crosshair mengikuti kursor, dan tooltip yang
 * menyebutkan trade penyebab perubahan. Toggle $ / R / % di komponen induk.
 */
export default function EquityCurve({ curve, unit = '$', startingBalance = 10000, onPickTrade }) {
  const [hover, setHover] = useState(null)
  const svgRef = useRef(null)

  const series = useMemo(() => {
    const val = (p) => {
      if (unit === 'R') return p.rEquity
      if (unit === '%') return startingBalance > 0 ? (p.equity / startingBalance) * 100 : 0
      return p.equity
    }
    const pts = [{ x: 0, v: 0, point: null }, ...curve.map((p, i) => ({ i, v: val(p), point: p }))]
    return pts
  }, [curve, unit, startingBalance])

  const { coords, zeroY, maxLabel } = useMemo(() => {
    const vals = series.map((s) => s.v)
    const lo = Math.min(0, ...vals)
    const hi = Math.max(0, ...vals)
    const span = hi - lo || 1
    const pad = span * 0.12
    const min = lo - pad
    const max = hi + pad
    const plotH = H - PAD_TOP - PAD_BOTTOM
    const toY = (v) => PAD_TOP + plotH - ((v - min) / (max - min)) * plotH
    const toX = (i) => (series.length <= 1 ? 0 : (i / (series.length - 1)) * W)
    return {
      coords: series.map((s, i) => ({ ...s, x: toX(i), y: toY(s.v) })),
      zeroY: toY(0),
      maxLabel: hi,
    }
  }, [series])

  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ')
  const areaPath =
    coords.length > 1
      ? `${linePath} L${W} ${H - PAD_BOTTOM} L0 ${H - PAD_BOTTOM} Z`
      : ''

  // Segmen menurun (drawdown) diwarnai terpisah
  const ddSegments = useMemo(() => {
    const segs = []
    let peak = -Infinity
    let run = null
    for (let i = 0; i < coords.length; i++) {
      const c = coords[i]
      if (c.v >= peak) {
        peak = c.v
        if (run && run.length > 1) segs.push(run)
        run = [c]
      } else {
        if (!run) run = [coords[Math.max(0, i - 1)]]
        run.push(c)
      }
    }
    if (run && run.length > 1) segs.push(run)
    return segs.map((s) => s.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' '))
  }, [coords])

  function onMove(e) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || coords.length < 2) return
    const rel = ((e.clientX - rect.left) / rect.width) * W
    let nearest = coords[0]
    let best = Infinity
    for (const c of coords) {
      const d = Math.abs(c.x - rel)
      if (d < best) { best = d; nearest = c }
    }
    setHover(nearest)
  }

  const fmt = (v) => (unit === 'R' ? rVal(v) : unit === '%' ? pct(v) : money(v))

  if (!curve.length) {
    return (
      <div className="empty-state" style={{ padding: '48px 0' }}>
        <div style={{ fontSize: 13 }}>Belum ada trade selesai — kurva ekuitas muncul setelah trade pertama ditutup.</div>
      </div>
    )
  }

  const tipW = 196
  const tipX = hover ? Math.min(Math.max(hover.x - tipW / 2, 0), W - tipW) : 0
  const tipY = hover ? Math.max(hover.y - 76, 0) : 0

  return (
    <div style={{ position: 'relative', marginTop: 'var(--space-3)' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', overflow: 'visible', cursor: 'crosshair' }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onClick={() => hover?.point?.trade && onPickTrade?.(hover.point.trade)}
      >
        <defs>
          <linearGradient id="eqf" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#9184d9" stopOpacity=".28" />
            <stop offset="1" stopColor="#9184d9" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="eql" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#796cbf" />
            <stop offset="1" stopColor="#b5abfc" />
          </linearGradient>
        </defs>

        <g stroke="#292b31" strokeWidth="1">
          {[0.15, 0.4, 0.65, 0.9].map((f) => {
            const y = PAD_TOP + (H - PAD_TOP - PAD_BOTTOM) * f
            return <line key={f} x1="0" y1={y} x2={W} y2={y} />
          })}
        </g>

        <line x1="0" y1={zeroY} x2={W} y2={zeroY} stroke="#595d6c" strokeDasharray="3 4" />
        <text x={W + 2} y={zeroY + 4} fill="#75798c" fontSize="10" fontFamily="JetBrains Mono, monospace">0</text>
        <text x={W + 2} y={PAD_TOP + 4} fill="#75798c" fontSize="10" fontFamily="JetBrains Mono, monospace">
          {unit === 'R' ? rVal(maxLabel, { sign: false }) : unit === '%' ? pct(maxLabel, 0) : moneyCompact(maxLabel)}
        </text>

        {areaPath && <path d={areaPath} fill="url(#eqf)" />}
        <path d={linePath} fill="none" stroke="url(#eql)" strokeWidth="2" strokeLinejoin="round" />
        {ddSegments.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="#c96b7c" strokeWidth="2" opacity=".55" />
        ))}

        {hover && (
          <>
            <line x1={hover.x} y1={PAD_TOP} x2={hover.x} y2={H - PAD_BOTTOM} stroke="#9184d9" strokeDasharray="2 3" opacity=".6" />
            <circle cx={hover.x} cy={hover.y} r="4.5" fill="#161826" stroke="#b5abfc" strokeWidth="2" />
            {hover.point && (
              <g transform={`translate(${tipX},${tipY})`} pointerEvents="none">
                <rect width={tipW} height="64" rx="8" fill="#232532" stroke="#595d6c" />
                <text x="12" y="19" fill="#9397ab" fontSize="10" fontFamily="JetBrains Mono, monospace">
                  {shortDate(hover.point.date)} · {hover.point.trade.pair}
                </text>
                <text x="12" y="38" fill="#e9e9ed" fontSize="14" fontFamily="JetBrains Mono, monospace">
                  Equity {fmt(hover.v)}
                </text>
                <text
                  x="12" y="54"
                  fill={hover.point.pnl >= 0 ? '#6fd3a8' : '#c96b7c'}
                  fontSize="10" fontFamily="JetBrains Mono, monospace"
                >
                  {money(hover.point.pnl)} {hover.point.r != null ? `(${rVal(hover.point.r)})` : ''}
                </text>
              </g>
            )}
          </>
        )}

        <text x="0" y={H - 18} fill="#75798c" fontSize="10" fontFamily="JetBrains Mono, monospace">
          {shortDate(curve[0]?.date)}
        </text>
        <text x={W} y={H - 18} textAnchor="end" fill="#75798c" fontSize="10" fontFamily="JetBrains Mono, monospace">
          {shortDate(curve[curve.length - 1]?.date)}
        </text>
      </svg>
    </div>
  )
}
