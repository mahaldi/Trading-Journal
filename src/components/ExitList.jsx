import { deriveTrade, legPnl } from '../lib/calc'
import { money, price as fmtPrice, rVal, size as fmtSize, stamp, toneClass } from '../lib/format'
import { baseUnitShort } from '../lib/pairs'

/**
 * Daftar exit sebuah trade: bar dua warna di atas (berapa yang sudah keluar,
 * berapa yang masih di pasar), lalu satu baris per exit dengan waktu, porsi,
 * harga, fee dan R-nya sendiri. Sisa posisi selalu baris terakhir.
 *
 * Dipakai di dua tempat: kartu posisi berjalan (Dashboard) dan panel detail
 * trade yang sudah selesai.
 */
export default function ExitList({ trade, d: derived, compact, children }) {
  const d = derived || deriveTrade(trade)
  if (!d.exitCount) return null

  const unit = baseUnitShort(trade.pair)
  const closedPct = (d.closedPortion ?? 0) * 100
  const remainPct = 100 - closedPct
  const stillOpen = trade.status !== 'closed' && (d.remainingSize ?? 0) > 1e-9

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {/* Bar dua warna — satu-satunya grafik yang dibutuhkan di sini */}
      <div>
        <div style={{
          display: 'flex', height: 6, borderRadius: 'var(--radius-sm)', overflow: 'hidden',
          background: 'var(--color-neutral-800)',
        }}>
          <span style={{ width: `${closedPct}%`, background: 'var(--color-profit)' }} />
          <span style={{ width: `${remainPct}%`, background: 'var(--color-accent)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          <span className="mono" style={{ fontSize: 10, color: 'var(--color-profit)' }}>
            {fmtPct(closedPct)} ditutup
          </span>
          {remainPct > 0.05 && (
            <span className="mono" style={{ fontSize: 10, color: 'var(--color-accent)' }}>
              {fmtPct(remainPct)} berjalan
            </span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {d.legs.map((leg, i) => {
          const pnl = legPnl(leg, d.entry, d.mul)
          const r = pnl != null && d.riskAmount ? pnl / d.riskAmount : null
          const portion = d.size ? (leg.size / d.size) * 100 : null
          return (
            <div key={leg.id || i} className="exit-row">
              <span className="mono exit-row-time">
                {leg.date ? <>{shortStamp(leg)}</> : '—'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mono" style={{ fontSize: 12 }}>
                  {portion != null ? `${fmtPct(portion)} @ ` : ''}{fmtPrice(leg.price)}
                </div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--color-neutral-600)' }}>
                  {leg.note ? `${leg.note} · ` : ''}{fmtSize(leg.size)} {unit}
                  {leg.fees ? ` · fee ${money(leg.fees, { sign: false })}` : ''}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className={'mono ' + toneClass(pnl)} style={{ fontSize: 12 }}>{money(pnl)}</div>
                <div className={'mono ' + toneClass(r)} style={{ fontSize: 10 }}>{rVal(r)}</div>
              </div>
            </div>
          )
        })}

        {stillOpen && (
          <div className="exit-row is-running">
            <span className="pulse-dot" style={{ margin: '0 21px 0 4px' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="mono" style={{ fontSize: 12 }}>
                {fmtPct(remainPct)} berjalan · {fmtSize(d.remainingSize)} {unit}
              </div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--color-neutral-600)' }}>
                SL {fmtPrice(d.slAfter)}{isBE(d) ? ' BE' : ''}
                {d.tp != null ? ` · TP ${fmtPrice(d.tp)}` : ''}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className={'mono ' + toneClass(d.floatingR)} style={{ fontSize: 12 }}>
                {d.floatingR != null ? rVal(d.floatingR) : '—'}
              </div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--color-neutral-600)' }}>
                {d.floatingPnl != null ? money(d.floatingPnl) : 'isi harga terakhir'}
              </div>
            </div>
          </div>
        )}
      </div>

      {stillOpen && d.remainingRisk != null && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', paddingTop: 'var(--space-2)',
          boxShadow: 'inset 0 1px 0 var(--color-neutral-800)', fontSize: 11,
        }}>
          <span style={{ color: 'var(--color-neutral-500)' }}>
            Risiko tersisa{isBE(d) ? ' setelah SL ke BE' : ''}
          </span>
          <span className="mono" style={{ color: d.remainingRisk < 0.01 ? 'var(--color-neutral-400)' : 'var(--color-loss)' }}>
            {money(d.remainingRisk, { sign: false })}
          </span>
        </div>
      )}

      {!compact && d.realizedPnl != null && stillOpen && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
          <span style={{ color: 'var(--color-neutral-500)' }}>Sudah terkunci</span>
          <span className={'mono ' + toneClass(d.realizedPnl)}>
            {money(d.realizedPnl)} · {rVal(d.realizedR)}
          </span>
        </div>
      )}

      {children}
    </div>
  )
}

const isBE = (d) => d.slAfter != null && d.entry != null && Math.abs(d.slAfter - d.entry) < 1e-9

function fmtPct(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  const rounded = Math.round(v * 10) / 10
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`
}

function shortStamp(leg) {
  const s = stamp(leg.ts)
  if (s === '—') return leg.date || '—'
  const [d, m, time] = s.split(' ')
  return <>{d} {m}<br />{time}</>
}
