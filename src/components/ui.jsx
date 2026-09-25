import { useEffect, useMemo, useRef, useState } from 'react'
import { imageURL } from '../lib/storage'
import { toneClass } from '../lib/format'

/* ─────────────────────────── Segmented control ─────────────────────────── */

export function Segmented({ options, value, onChange, small, style }) {
  return (
    <div className={'seg' + (small ? ' seg-sm' : '')} style={style}>
      {options.map((o) => {
        const val = typeof o === 'string' ? o : o.value
        const label = typeof o === 'string' ? o : o.label
        return (
          <button
            key={val}
            type="button"
            className={'seg-opt' + (value === val ? ' is-active' : '')}
            onClick={() => onChange(val)}
            disabled={typeof o === 'object' ? !!o.disabled : false}
            title={typeof o === 'object' ? o.title : undefined}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

/* ─────────────────────────── Lightbox ─────────────────────────── */

/**
 * Tampilan penuh satu gambar. Bila dibuka dari grup berisi beberapa
 * screenshot, panah kiri/kanan menyusuri grup itu tanpa menutup lightbox.
 */
export function Lightbox({ view, onClose }) {
  const images = view?.images || []
  const [index, setIndex] = useState(view?.index || 0)

  useEffect(() => setIndex(view?.index || 0), [view])

  useEffect(() => {
    if (!view) return
    function onKey(e) {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') setIndex((i) => (i + 1) % images.length)
      else if (e.key === 'ArrowLeft') setIndex((i) => (i - 1 + images.length) % images.length)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [view, images.length, onClose])

  if (!view || !images.length) return null
  const current = images[Math.min(index, images.length - 1)]

  return (
    <div className="lightbox" onClick={onClose}>
      <img src={imageURL(current.id)} alt={current.name || 'Screenshot'} />
      {images.length > 1 && (
        <>
          <button
            className="gallery-nav" style={{ left: 24, width: 40, height: 40 }}
            onClick={(e) => { e.stopPropagation(); setIndex((i) => (i - 1 + images.length) % images.length) }}
          >
            ‹
          </button>
          <button
            className="gallery-nav" style={{ right: 24, width: 40, height: 40 }}
            onClick={(e) => { e.stopPropagation(); setIndex((i) => (i + 1) % images.length) }}
          >
            ›
          </button>
        </>
      )}
      <div className="lightbox-cap mono">
        {current.name}
        {images.length > 1 && <> · {index + 1} / {images.length}</>}
      </div>
    </div>
  )
}

/* ─────────────────────────── Confirm dialog ─────────────────────────── */

export function Confirm({ open, title, body, confirmLabel = 'Ya', danger, onConfirm, onCancel }) {
  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])
  if (!open) return null
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">{title}</div>
        <div style={{ fontSize: 14, opacity: 0.85 }}>{body}</div>
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onCancel}>Batal</button>
          <button className={'btn ' + (danger ? 'btn-danger' : 'btn-primary')} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────── Sparkline ─────────────────────────── */

export function Sparkline({ values, height = 20 }) {
  if (!values?.length) return <span style={{ flex: 1 }} />
  const max = Math.max(...values.map((v) => Math.abs(v)), 1)
  return (
    <span className="spark" style={{ flex: 1, height }}>
      {values.map((v, i) => (
        <span
          key={i}
          style={{
            height: `${Math.max(12, (Math.abs(v) / max) * 100)}%`,
            background: v >= 0 ? 'var(--color-profit)' : 'var(--color-loss)',
            opacity: 0.5 + (Math.abs(v) / max) * 0.4,
          }}
        />
      ))}
    </span>
  )
}

/* ─────────────────────────── Delta bar ─────────────────────────── */

export function ContribBar({ value, max }) {
  const w = max > 0 ? Math.min(100, (Math.abs(value) / max) * 100) : 0
  return (
    <span
      style={{
        display: 'block', height: 6, borderRadius: 3, width: `${w}%`,
        background: value >= 0 ? 'var(--color-profit)' : 'var(--color-loss)',
        opacity: Math.abs(value) < 1 ? 0.4 : 1,
      }}
    />
  )
}

/* ─────────────────────────── Numeric value ─────────────────────────── */

export function Val({ v, render, size = 14, weight = 400, className = '' }) {
  return (
    <span className={`mono ${toneClass(v)} ${className}`} style={{ fontSize: size, fontWeight: weight }}>
      {render(v)}
    </span>
  )
}
