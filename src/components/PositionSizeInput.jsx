import { useEffect, useRef, useState } from 'react'
import { baseUnitShort } from '../lib/pairs'
import { size as fmtSize, money } from '../lib/format'

/**
 * Position Size dengan toggle unit.
 *
 * Nilai selalu DISIMPAN dalam unit dasar pair (mis. 0.25 BTC) supaya semua
 * perhitungan PnL memakai satu satuan. Mode "USD" hanya cara memasukkannya:
 * angka dolar dibagi harga entry menjadi unit. Karena itu mode USD butuh
 * Entry Price terisi — kalau kosong, toggle-nya dinonaktifkan.
 */
export default function PositionSizeInput({ value, onChange, pair, entry, mode, onModeChange }) {
  const unit = baseUnitShort(pair) || 'Unit'
  const hasEntry = Number.isFinite(entry) && entry > 0
  const usable = mode === 'usd' ? 'usd' : 'unit'

  const [draft, setDraft] = useState('')
  const focused = useRef(false)

  // Sinkronkan tampilan dari nilai kanonik saat tidak sedang diketik.
  useEffect(() => {
    if (focused.current) return
    if (value == null || !Number.isFinite(value)) {
      setDraft('')
      return
    }
    if (usable === 'usd') {
      setDraft(hasEntry ? String(round(value * entry, 2)) : '')
    } else {
      setDraft(String(round(value, 8)))
    }
  }, [value, usable, entry, hasEntry])

  function commit(text) {
    setDraft(text)
    const n = parseFloat(String(text).replace(/,/g, ''))
    if (!Number.isFinite(n)) {
      onChange(null)
      return
    }
    if (usable === 'usd') {
      onChange(hasEntry ? n / entry : null)
    } else {
      onChange(n)
    }
  }

  function switchMode(next) {
    focused.current = false
    onModeChange(next)
  }

  const notional = Number.isFinite(value) && hasEntry ? value * entry : null

  return (
    <div className="field">
      <label htmlFor="f-size">Position Size</label>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <input
          id="f-size"
          className="input mono"
          inputMode="decimal"
          placeholder={usable === 'usd' ? '2500' : '0.25'}
          value={draft}
          onFocus={() => (focused.current = true)}
          onBlur={() => (focused.current = false)}
          onChange={(e) => commit(e.target.value)}
        />
        <div className="seg seg-sm" style={{ flex: 'none' }}>
          <button
            type="button"
            className={'seg-opt' + (usable === 'unit' ? ' is-active' : '')}
            onClick={() => switchMode('unit')}
            title={`Masukkan size dalam ${unit}`}
          >
            {unit}
          </button>
          <button
            type="button"
            className={'seg-opt' + (usable === 'usd' ? ' is-active' : '')}
            onClick={() => switchMode('usd')}
            title="Masukkan size sebagai nilai notional dalam USD"
          >
            USD
          </button>
        </div>
      </div>
      <div className="mono" style={{ fontSize: 10, color: 'var(--color-neutral-600)', marginTop: 4 }}>
        {!hasEntry && usable === 'usd' ? (
          <span style={{ color: 'var(--color-loss)' }}>Isi Entry Price dulu untuk mode USD</span>
        ) : Number.isFinite(value) ? (
          usable === 'usd' ? (
            <>= {fmtSize(value)} {unit} @ entry</>
          ) : (
            <>= {money(notional, { sign: false })} notional</>
          )
        ) : (
          <>Disimpan sebagai {unit}; mode USD dibagi harga entry</>
        )}
      </div>
    </div>
  )
}

function round(n, d) {
  const f = Math.pow(10, d)
  return Math.round(n * f) / f
}
