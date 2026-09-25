import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { normalizeTag, similarTags, rankTags, SEED_TAG_SUGGESTIONS, SOFT_TAG_LIMIT } from '../lib/tags'
import { moneyCompact, toneClass } from '../lib/format'

/**
 * Input tag strategi — empat keadaan sesuai desain B7:
 *
 *  1 kosong        satu baris penjelasan + saran bawaan yang bisa diklik sekali
 *  2 memilih       daftar tag terpakai, diurut frekuensi lalu kemiripan teks,
 *                  tiap opsi membawa jumlah pemakaian dan net PnL-nya
 *  3 membuat baru  normalisasi nama otomatis + tawaran tag mirip yang sudah ada
 *  4 terisi        chip aksen dengan ✕, Backspace menghapus chip terakhir
 *
 * Draft yang diketik tapi belum ditekan Enter TIDAK dibuang: ikut tersimpan
 * saat input kehilangan fokus maupun saat form disimpan (lewat ref.flush()).
 */
const TagInput = forwardRef(function TagInput({ value = [], onChange, suggestions = [], stats = {} }, ref) {
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const wrapRef = useRef(null)
  const inputRef = useRef(null)

  const available = useMemo(() => suggestions.filter((s) => !value.includes(s)), [suggestions, value])
  const matches = useMemo(() => rankTags(available, stats, draft).slice(0, 6), [available, stats, draft])

  const normalized = normalizeTag(draft)
  const exactExists = normalized && suggestions.some((s) => s.toLowerCase() === normalized.toLowerCase())
  const alreadyPicked = normalized && value.some((v) => v.toLowerCase() === normalized.toLowerCase())
  const canCreate = normalized && !exactExists && !alreadyPicked
  const similar = useMemo(
    () => (canCreate ? similarTags(normalized, available) : []),
    [canCreate, normalized, available]
  )

  // Baris terakhir daftar adalah opsi "Buat" bila nama barunya valid
  const rows = canCreate ? [...matches, { create: true }] : matches
  useEffect(() => setCursor(0), [draft])

  /**
   * Masukkan draft yang tertinggal — dipanggil form tepat sebelum menyimpan.
   * Mengembalikan tag yang baru masuk supaya form bisa memakainya langsung
   * tanpa menunggu state React ter-update.
   */
  function flush() {
    const tag = normalizeTag(draft)
    setDraft('')
    if (!tag) return null
    if (value.some((v) => v.toLowerCase() === tag.toLowerCase())) return null
    onChange([...value, tag])
    return tag
  }
  useImperativeHandle(ref, () => ({ flush }))

  useEffect(() => {
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        // Menutup daftar tidak boleh membuang ketikan
        if (draft.trim()) add(draft)
        setOpen(false)
      }
    }
    // Fase capture — lihat catatan yang sama di PairAutocomplete.
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  })

  function add(raw) {
    const tag = normalizeTag(raw)
    setDraft('')
    if (!tag) return
    if (value.some((v) => v.toLowerCase() === tag.toLowerCase())) return
    onChange([...value, tag])
  }

  function remove(tag) {
    onChange(value.filter((t) => t !== tag))
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setCursor((c) => Math.min(c + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const row = open ? rows[cursor] : null
      if (row && !row.create) add(row)
      else add(draft)
    } else if (e.key === 'Backspace' && !draft && value.length) {
      remove(value[value.length - 1])
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation()
      setOpen(false)
    } else if (e.key === ',' || e.key === ' ') {
      // koma dan spasi juga menutup satu tag — mengetik cepat tanpa Enter
      if (draft.trim()) {
        e.preventDefault()
        add(draft)
      }
    }
  }

  const isEmptyLibrary = suggestions.length === 0
  const overLimit = value.length > SOFT_TAG_LIMIT

  return (
    <div className="ac-wrap" ref={wrapRef}>
      <div className="taginput" onClick={() => inputRef.current?.focus()}>
        {value.map((tag) => (
          <span key={tag} className="tag tag-accent">
            #{tag}
            <span
              className="tag-x"
              title="Hapus tag"
              onClick={(e) => {
                e.stopPropagation()
                remove(tag)
              }}
            >
              ✕
            </span>
          </span>
        ))}
        <input
          ref={inputRef}
          value={draft}
          placeholder={value.length ? 'tambah…' : 'Tambah tag…'}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setDraft(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => { if (draft.trim()) add(draft) }}
          onKeyDown={onKeyDown}
        />
        <span className="taginput-hint">#</span>
      </div>

      {/* 1 · keadaan kosong — tidak dibiarkan hampa */}
      {isEmptyLibrary && !draft && (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: 11, color: 'var(--color-neutral-600)', lineHeight: 1.6 }}>
            Belum ada tag tersimpan. Ketik nama strategi lalu tekan Enter — tag akan tersimpan dan
            muncul sebagai pilihan pada entri berikutnya.
          </div>
          <div className="metric-label" style={{ marginTop: 8, marginBottom: 5 }}>Saran awal</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            {SEED_TAG_SUGGESTIONS.filter((s) => !value.includes(s)).map((s) => (
              <button key={s} type="button" className="tag tag-outline tag-btn" onClick={() => add(s)}>
                + #{s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 2 & 3 · memilih / membuat baru */}
      {open && rows.length > 0 && (
        <div className="ac-list">
          {matches.length === 0 && canCreate && (
            <div className="ac-empty">Tidak ada tag yang cocok</div>
          )}

          {matches.map((tag, i) => {
            const st = stats[tag]
            return (
              <div
                key={tag}
                className={'ac-item' + (i === cursor ? ' is-cursor' : '')}
                onMouseEnter={() => setCursor(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  add(tag)
                }}
              >
                <span>#{tag}</span>
                {st && (
                  <small className="mono">
                    {st.count}× · <span className={toneClass(st.netPnl)}>{moneyCompact(st.netPnl)}</span>
                  </small>
                )}
              </div>
            )
          })}

          {canCreate && (
            <>
              <div
                className={'ac-item' + (cursor === rows.length - 1 ? ' is-cursor' : '')}
                onMouseEnter={() => setCursor(rows.length - 1)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  add(draft)
                }}
              >
                <span>Buat “#{normalized}”</span>
                <small className="mono">↵</small>
              </div>
              {similar.length > 0 && (
                <div className="ac-sim">
                  Mirip: {similar.map((s) => `#${s}`).join(', ')} —{' '}
                  <button
                    type="button"
                    className="link-btn"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      add(similar[0])
                    }}
                  >
                    pakai itu?
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* 4 · batas lunak */}
      {overLimit && (
        <div style={{ fontSize: 11, color: 'var(--color-neutral-600)', lineHeight: 1.6, marginTop: 6 }}>
          {value.length} tag pada satu trade — di atas {SOFT_TAG_LIMIT} tag, statistik per-tag
          mulai kehilangan makna karena tiap trade terhitung di banyak kelompok.
        </div>
      )}
    </div>
  )
})

export default TagInput
