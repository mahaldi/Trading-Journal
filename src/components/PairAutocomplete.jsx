import { useEffect, useMemo, useRef, useState } from 'react'
import { searchPairs, pairKindLabel } from '../lib/pairs'

/**
 * Input pair dengan autocomplete.
 * Pair dari riwayat trade muncul lebih dulu (dengan jumlah pemakaian),
 * disusul katalog bawaan. Pair baru tetap boleh diketik bebas.
 */
export default function PairAutocomplete({ value, onChange, index, autoFocus, id }) {
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [touched, setTouched] = useState(false)
  const wrapRef = useRef(null)
  const inputRef = useRef(null)

  const matches = useMemo(
    () => (touched ? searchPairs(index, value, 8) : searchPairs(index, '', 8)),
    [index, value, touched]
  )

  useEffect(() => setCursor(0), [value])

  useEffect(() => {
    function onDocDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    // Fase CAPTURE, bukan bubble: event ditangkap dalam perjalanan turun dari
    // document ke elemen sasaran, jadi handler React di tengah jalan yang
    // memanggil stopPropagation tidak bisa menghalangi daftar ini menutup.
    document.addEventListener('mousedown', onDocDown, true)
    return () => document.removeEventListener('mousedown', onDocDown, true)
  }, [])

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  function pick(symbol) {
    onChange(symbol)
    setOpen(false)
    setTouched(false)
    inputRef.current?.focus()
  }

  function onKeyDown(e) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true)
      return
    }
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (e.key === 'Enter') {
      if (matches[cursor]) {
        e.preventDefault()
        pick(matches[cursor].symbol)
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.stopPropagation()
        setOpen(false)
      }
    }
  }

  return (
    <div className="ac-wrap" ref={wrapRef}>
      <input
        id={id}
        ref={inputRef}
        className="input"
        style={{ textTransform: 'uppercase' }}
        value={value}
        placeholder="BTCUSDT"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          onChange(e.target.value.toUpperCase())
          setTouched(true)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && matches.length > 0 && (
        <div className="ac-list">
          {matches.map((m, i) => (
            <div
              key={m.symbol}
              className={'ac-item' + (i === cursor ? ' is-cursor' : '')}
              onMouseEnter={() => setCursor(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(m.symbol)
              }}
            >
              <span className="mono">{m.symbol}</span>
              <small>{m.count > 0 ? `${m.count}× dipakai` : pairKindLabel(m.symbol)}</small>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
