import { useEffect, useMemo, useState } from 'react'
import { Segmented } from './ui'
import { deriveTrade } from '../lib/calc'
import { money, price as fmtPrice, rVal, size as fmtSize, toneClass, todayISO } from '../lib/format'
import { baseUnitShort } from '../lib/pairs'

const QUICK = [25, 50, 75, 80]

/**
 * Menutup 80% posisi bukan "menutup trade". Panel ini hanya meminta tiga hal:
 * berapa persen, di harga berapa, fee berapa. Sisanya dihitung — lot yang
 * keluar, R yang terkunci, dan lot yang masih berjalan.
 *
 * Persen adalah input utama karena begitu cara trader berpikir; tombol Lot
 * menukar field ke satuan lot bila broker melaporkan begitu.
 */
export default function PartialClose({ trade, onSubmit, onCancel }) {
  const d = useMemo(() => deriveTrade(trade), [trade])
  const unit = baseUnitShort(trade.pair) || 'unit'
  const remaining = d.remainingSize ?? d.size ?? 0

  const [inputMode, setInputMode] = useState('pct')  // 'pct' | 'lot'
  const [pct, setPct] = useState('80')
  const [lot, setLot] = useState('')
  const [exitPrice, setExitPrice] = useState('')
  const [fees, setFees] = useState('')
  const [note, setNote] = useState('')
  const [date, setDate] = useState(todayISO())
  const [slChoice, setSlChoice] = useState('be')     // 'be' | 'keep'

  // Persen selalu relatif terhadap SISA posisi yang masih berjalan.
  useEffect(() => {
    if (inputMode !== 'lot') return
    const n = parseFloat(pct)
    if (Number.isFinite(n) && remaining > 0) setLot(String(round(remaining * (n / 100), 8)))
  }, [inputMode])   // eslint-disable-line react-hooks/exhaustive-deps

  const closeSize = useMemo(() => {
    if (inputMode === 'lot') {
      const n = parseFloat(String(lot).replace(/,/g, ''))
      return Number.isFinite(n) ? Math.min(n, remaining) : null
    }
    const n = parseFloat(String(pct).replace(/,/g, ''))
    if (!Number.isFinite(n)) return null
    return Math.min(remaining, remaining * (n / 100))
  }, [inputMode, pct, lot, remaining])

  const closePct = remaining > 0 && closeSize != null ? (closeSize / remaining) * 100 : null
  const ofTotalPct = d.size && closeSize != null ? (closeSize / d.size) * 100 : null
  const priceNum = parseFloat(String(exitPrice).replace(/,/g, ''))
  const feeNum = parseFloat(String(fees).replace(/,/g, '')) || 0
  const hasPrice = Number.isFinite(priceNum) && priceNum > 0

  const legPnlValue = hasPrice && closeSize != null && d.entry != null
    ? (priceNum - d.entry) * closeSize * d.mul - feeNum
    : null
  const lockedR = legPnlValue != null && d.riskAmount ? legPnlValue / d.riskAmount : null

  const restSize = closeSize != null ? Math.max(0, remaining - closeSize) : remaining
  const restPctOfTotal = d.size ? (restSize / d.size) * 100 : null
  const isFull = restSize <= 1e-9
  const slAfter = slChoice === 'be' ? d.entry : (d.slAfter ?? d.sl)
  const restRisk = d.entry != null && slAfter != null ? Math.abs(d.entry - slAfter) * restSize : null

  const valid = hasPrice && closeSize != null && closeSize > 0

  function submit() {
    if (!valid) return
    onSubmit({
      size: closeSize,
      price: priceNum,
      fees: feeNum,
      note: note.trim(),
      date,
      ts: new Date(`${date}T${new Date().toTimeString().slice(0, 8)}`).toISOString(),
      slAfter: isFull ? (d.slAfter ?? d.sl) : slAfter,
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {/* ── Porsi ── */}
      <div className="field">
        <label htmlFor="pc-portion">
          Porsi ditutup
          <span style={{ color: 'var(--color-neutral-600)' }}>
            {' · dari sisa '}{fmtSize(remaining)} {unit}
          </span>
        </label>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <input
            id="pc-portion"
            className="input mono"
            inputMode="decimal"
            value={inputMode === 'lot' ? lot : pct}
            onChange={(e) => (inputMode === 'lot' ? setLot(e.target.value) : setPct(e.target.value))}
            style={{ flex: 1, fontSize: 19, textAlign: 'right', borderColor: 'var(--color-accent)' }}
          />
          <span className="mono" style={{ fontSize: 19, color: 'var(--color-neutral-500)', minWidth: 34 }}>
            {inputMode === 'lot' ? unit : '%'}
          </span>
        </div>
      </div>

      <div className="seg seg-sm">
        {QUICK.map((q) => (
          <button
            key={q}
            type="button"
            className={'seg-opt' + (inputMode === 'pct' && String(q) === String(pct) ? ' is-active' : '')}
            onClick={() => { setInputMode('pct'); setPct(String(q)) }}
          >
            {q}%
          </button>
        ))}
        <button
          type="button"
          className={'seg-opt' + (inputMode === 'lot' ? ' is-active' : '')}
          onClick={() => setInputMode(inputMode === 'lot' ? 'pct' : 'lot')}
          title={`Masukkan porsi dalam ${unit}`}
        >
          Lot
        </button>
      </div>

      {/* ── Harga & fee ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
        <div className="field">
          <label htmlFor="pc-exit">Exit porsi ini</label>
          <input
            id="pc-exit" className="input mono" inputMode="decimal" autoFocus
            value={exitPrice} onChange={(e) => setExitPrice(e.target.value)}
            placeholder={fmtPrice(d.entry)}
            style={{ borderColor: 'var(--color-accent)' }}
          />
        </div>
        <div className="field">
          <label htmlFor="pc-fees">Fees</label>
          <input
            id="pc-fees" className="input mono" inputMode="decimal"
            value={fees} onChange={(e) => setFees(e.target.value)} placeholder="6.50"
          />
        </div>
      </div>

      {/* ── Hasil terhitung ── */}
      <div className="inset-box">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1px 1fr' }}>
          <div style={{ padding: '8.4px 11.2px' }}>
            <div className="metric-label" style={{ fontSize: 10 }}>Keluar</div>
            <div className={'mono ' + toneClass(legPnlValue)} style={{ fontSize: 19 }}>
              {legPnlValue != null ? money(legPnlValue) : '—'}
            </div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--color-neutral-600)' }}>
              {closeSize != null
                ? <>{fmtSize(closeSize)} dari {fmtSize(d.size)} {unit}</>
                : 'isi porsi'}
            </div>
          </div>
          <div style={{ background: 'var(--color-neutral-800)' }} />
          <div style={{ padding: '8.4px 11.2px' }}>
            <div className="metric-label" style={{ fontSize: 10 }}>R terkunci</div>
            <div className={'mono ' + toneClass(lockedR)} style={{ fontSize: 19 }}>
              {lockedR != null ? rVal(lockedR) : '—'}
            </div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--color-neutral-600)' }}>
              {d.riskAmount == null ? 'isi SL untuk R' : `risiko awal ${money(d.riskAmount, { sign: false })}`}
            </div>
          </div>
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between', padding: '5.6px 11.2px', fontSize: 11,
          background: `color-mix(in srgb, var(--color-${isFull ? 'profit' : 'accent'}) 10%, transparent)`,
        }}>
          <span style={{ color: 'var(--color-neutral-500)' }}>
            {isFull ? 'Menutup seluruh sisa posisi' : 'Sisa berjalan'}
          </span>
          <span className="mono" style={{ color: `var(--color-${isFull ? 'profit' : 'accent'})` }}>
            {isFull
              ? 'trade akan selesai'
              : <>{restPctOfTotal != null ? `${round(restPctOfTotal, 1)}%` : '—'} · {fmtSize(restSize)} {unit}</>}
          </span>
        </div>
      </div>

      {/* ── SL untuk sisa posisi ── */}
      {!isFull && (
        <div>
          <div className="metric-label" style={{ fontSize: 10, marginBottom: 'var(--space-2)' }}>
            SL untuk sisa posisi
          </div>
          <Segmented
            options={[
              { value: 'be', label: `→ BE ${fmtPrice(d.entry)}` },
              { value: 'keep', label: `Tetap ${fmtPrice(d.slAfter ?? d.sl)}` },
            ]}
            value={slChoice}
            onChange={setSlChoice}
            small
          />
          <div className="mono" style={{ fontSize: 10, color: 'var(--color-neutral-600)', marginTop: 4 }}>
            Risiko tersisa {restRisk != null ? money(restRisk, { sign: false }) : '—'}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
        <div className="field">
          <label htmlFor="pc-date">Tanggal exit</label>
          <input id="pc-date" type="date" className="input mono" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pc-note">Catatan <span style={{ color: 'var(--color-neutral-600)' }}>· opsional</span></label>
          <input id="pc-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="TP1" />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
        {onCancel && <button className="btn btn-secondary" onClick={onCancel}>Batal <span className="kbd">Esc</span></button>}
        <button className="btn btn-primary" onClick={submit} disabled={!valid}
          title={valid ? '' : 'Isi porsi dan harga exit'}>
          {isFull
            ? 'Tutup sisa & selesaikan trade'
            : `Tutup ${ofTotalPct != null ? round(ofTotalPct, 1) : '—'}% & simpan`}
        </button>
      </div>

      {!valid && (
        <div style={{ fontSize: 11, color: 'var(--color-neutral-600)', textAlign: 'right', marginTop: -8 }}>
          Wajib: porsi &gt; 0 · harga exit
        </div>
      )}
    </div>
  )
}

function round(n, d = 2) {
  const f = Math.pow(10, d)
  return Math.round(n * f) / f
}
