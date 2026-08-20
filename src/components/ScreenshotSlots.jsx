import { useEffect, useRef, useState } from 'react'
import { putImage, deleteImage, imageURL } from '../lib/storage'
import { fileSize } from '../lib/format'

/**
 * Dua grup screenshot: Setup (Entry) dan Result (Exit).
 * Tiap grup menampung BANYAK gambar — satu setup sering butuh beberapa
 * timeframe (H4 struktur, M15 entry, D1 konteks).
 *
 * Paste tetap jalur utama: ⌘V menambah gambar ke grup yang sedang aktif.
 * Gambar pertama tiap grup ditandai "Utama" — itu yang dipakai sebagai
 * pratayang di tabel histori. Urutan bisa diubah dengan menggeser tile.
 */

const GROUPS = [
  { key: 'setup', label: 'Setup (Entry)' },
  { key: 'result', label: 'Result (Exit)' },
]

const MIN_CELLS = 4

export default function ScreenshotSlots({ shots, onChange, onLightbox, pasteScopeRef }) {
  const [active, setActive] = useState('setup')
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(null)
  const fileInputs = { setup: useRef(null), result: useRef(null) }

  // Lewat normalize(), jadi trade lama yang menyimpan satu objek per slot
  // ikut terbaca — bukan diperlakukan sebagai grup kosong.
  const list = (key) => normalize(shots)[key]

  async function accept(group, files) {
    const images = [...files].filter((f) => f.type?.startsWith('image/'))
    if (!images.length) return
    setBusy(group)
    try {
      const saved = []
      for (const file of images) {
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T-]/g, '')
        const name = file.name && file.name !== 'image.png' ? file.name : `paste_${stamp}.png`
        saved.push(await putImage(file, name))
      }
      const wasEmpty = list(group).length === 0
      onChange({ ...normalize(shots), [group]: [...list(group), ...saved] })

      // Paste pertama pada form baru langsung memindahkan fokus ke grup
      // kedua, supaya setup lalu result bisa ditempel berurutan tanpa mouse.
      if (group === 'setup' && wasEmpty && list('result').length === 0) setActive('result')
    } catch (err) {
      console.error('[screenshot] gagal menyimpan:', err)
      alert('Gagal menyimpan gambar: ' + err.message)
    } finally {
      setBusy(null)
    }
  }

  function removeAt(group, index) {
    const arr = list(group)
    const target = arr[index]
    onChange({ ...normalize(shots), [group]: arr.filter((_, i) => i !== index) })
    if (target?.id) deleteImage(target.id)
    setActive(group)
  }

  function reorder(group, from, to) {
    const arr = [...list(group)]
    if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return
    const [moved] = arr.splice(from, 1)
    arr.splice(to, 0, moved)
    onChange({ ...normalize(shots), [group]: arr })
  }

  /* ── paste di mana pun dalam panel ── */
  useEffect(() => {
    function onPaste(e) {
      const items = e.clipboardData?.items
      if (!items) return
      const files = []
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const f = item.getAsFile()
          if (f) files.push(f)
        }
      }
      if (files.length) {
        e.preventDefault()
        accept(active, files)
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  })

  /* ── sorot kedua grup saat file diseret ke dalam panel ── */
  useEffect(() => {
    const scope = pasteScopeRef?.current
    if (!scope) return
    let depth = 0
    const onEnter = (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return
      depth++
      setDragging(true)
    }
    const onLeave = () => { depth = Math.max(0, depth - 1); if (!depth) setDragging(false) }
    const onOver = (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault() }
    const onDrop = () => { depth = 0; setDragging(false) }
    scope.addEventListener('dragenter', onEnter)
    scope.addEventListener('dragleave', onLeave)
    scope.addEventListener('dragover', onOver)
    scope.addEventListener('drop', onDrop)
    return () => {
      scope.removeEventListener('dragenter', onEnter)
      scope.removeEventListener('dragleave', onLeave)
      scope.removeEventListener('dragover', onOver)
      scope.removeEventListener('drop', onDrop)
    }
  }, [pasteScopeRef])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {GROUPS.map(({ key, label }) => {
        const arr = list(key)
        const isActive = active === key
        return (
          <ShotGroup
            key={key}
            groupKey={key}
            label={label}
            images={arr}
            isActive={isActive}
            isDropping={dragging}
            busy={busy === key}
            inputRef={fileInputs[key]}
            onActivate={() => setActive(key)}
            onFiles={(files) => accept(key, files)}
            onRemove={(i) => removeAt(key, i)}
            onReorder={(from, to) => reorder(key, from, to)}
            onLightbox={(i) => onLightbox?.({ images: arr, index: i })}
          />
        )
      })}
    </div>
  )
}

function ShotGroup({
  groupKey, label, images, isActive, isDropping, busy,
  inputRef, onActivate, onFiles, onRemove, onReorder, onLightbox,
}) {
  const [dragIndex, setDragIndex] = useState(null)
  const [overIndex, setOverIndex] = useState(null)

  const ghosts = Math.max(0, MIN_CELLS - images.length - 1)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        <div className="mono" style={{ fontSize: 11, color: isActive ? 'var(--color-accent)' : 'var(--color-neutral-600)' }}>
          {busy
            ? 'menyimpan…'
            : images.length > 0
              ? `${images.length} gambar${images.length > 1 ? ' · geser untuk urutkan' : ''}`
              : isActive
                ? 'slot aktif · siap ditempel'
                : 'kosong'}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files)
          e.target.value = ''
        }}
      />

      <div className="shotgrid">
        {images.map((img, i) => (
          <div
            key={img.id}
            className={
              'shot-tile' +
              (dragIndex === i ? ' is-dragging' : '') +
              (overIndex === i && dragIndex !== null && dragIndex !== i ? ' is-over' : '')
            }
            draggable
            onDragStart={(e) => {
              setDragIndex(i)
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', String(i))
            }}
            onDragEnd={() => { setDragIndex(null); setOverIndex(null) }}
            onDragOver={(e) => {
              if (dragIndex === null) return
              e.preventDefault()
              e.stopPropagation()
              setOverIndex(i)
            }}
            onDrop={(e) => {
              if (dragIndex === null) return
              e.preventDefault()
              e.stopPropagation()
              onReorder(dragIndex, i)
              setDragIndex(null)
              setOverIndex(null)
            }}
            title={`${img.name} · ${fileSize(img.size)}`}
          >
            <img src={imageURL(img.id)} alt={`${label} ${i + 1}`} loading="lazy" draggable={false} />
            {i === 0 && <span className="badge-primary">Utama</span>}
            <div className="shot-actions">
              <button type="button" className="shot-btn" title="Perbesar"
                onClick={(e) => { e.stopPropagation(); onLightbox(i) }}>⤢</button>
              <button type="button" className="shot-btn del" title="Hapus"
                onClick={(e) => { e.stopPropagation(); onRemove(i) }}>✕</button>
            </div>
          </div>
        ))}

        <div
          className={'shot-add' + (isActive ? ' is-active' : '') + (isDropping ? ' is-drop' : '')}
          onClick={() => { onActivate(); inputRef.current?.click() }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (e.dataTransfer?.files?.length) onFiles(e.dataTransfer.files)
          }}
          title="Klik untuk pilih file, atau tempel dengan Ctrl/⌘+V"
        >
          <span>
            + <span className="mono">⌘V</span>
            <br />tambah
          </span>
        </div>

        {Array.from({ length: ghosts }, (_, i) => <div key={'g' + i} className="shot-ghost" />)}
      </div>
    </div>
  )
}

/* ─────────────────────────── bentuk data ─────────────────────────── */

/**
 * Samakan bentuk shots ke array. Data lama menyimpan satu objek per slot
 * (atau null); versi ini menyimpan array, jadi trade lama ikut terbaca
 * tanpa kehilangan gambarnya.
 */
export function normalize(shots) {
  const toArr = (v) => (Array.isArray(v) ? v.filter(Boolean) : v ? [v] : [])
  return { setup: toArr(shots?.setup), result: toArr(shots?.result) }
}

/** Semua gambar sebuah trade, kedua grup digabung — untuk hapus & prune. */
export function allShots(shots) {
  const n = normalize(shots)
  return [...n.setup, ...n.result]
}

/**
 * Gambar disajikan server dari data/images/, jadi cukup pasang URL-nya
 * ke <img src> — tidak perlu memuat blob ke memori sama sekali.
 */
export function ImagePreview({ id, alt, style }) {
  if (!id) return null
  return <img src={imageURL(id)} alt={alt || ''} style={style} loading="lazy" />
}
