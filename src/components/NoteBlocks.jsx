import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { imageURL } from '../lib/storage'
import { deriveTrade, effectiveDate } from '../lib/calc'
import { money, rVal, shortDate, toneClass } from '../lib/format'
import { tokenize, tradeLabel, slugifyName } from '../lib/notes'

/* ══════════════════════════════════════════════════════════════
   Blok-blok editor Catatan.

   `ctx` dibagikan editor ke semua blok:
     resolve(handle)            → target mention atau null
     images                     → [{ name, blockId, index, image }] gambar bernama di catatan ini
     trades                     → semua trade, terbaru dulu
     linkedIds                  → Set id trade yang sudah tertaut
     onLinkTrade(id)            → mention trade sekaligus menautkannya
     onJumpImage(blockId)       → gulir ke gambar & sorot sebentar
     onOpenTrade(trade)         → buka trade di panel edit
     flashName                  → nama gambar yang rujukannya sedang disorot
   ══════════════════════════════════════════════════════════════ */

/* ─────────────────────────── teks dengan @mention ─────────────────────────── */

/**
 * Paragraf yang mengalir seperti Notes. Saat tidak difokus, mention tampil
 * sebagai teks aksen bergaris bawah (hover = pratinjau, klik = lompat).
 * Saat difokus, teks mentah diedit di textarea yang tumbuh sendiri;
 * mengetik "@" membuka daftar gambar di catatan ini dan trade.
 */
export function MentionText({
  value, onChange, placeholder, ctx, focusSignal, onBackspaceEmpty, onPasteImages,
  className = '', style,
}) {
  const [editing, setEditing] = useState(false)
  const [menu, setMenu] = useState(null) // { start, query, top, left, cursor }
  const taRef = useRef(null)
  const wrapRef = useRef(null)
  const pendingCaret = useRef(null)

  const text = value || ''
  const showRendered = !editing && text.trim() !== ''

  // useLayoutEffect: fokus pindah di commit yang sama, jadi ketikan cepat
  // sesudah Enter tidak sempat jatuh ke field sebelumnya.
  useLayoutEffect(() => {
    if (!focusSignal) return
    pendingCaret.current = focusSignal.pos ?? Infinity
    const ta = taRef.current
    if (ta) {
      const p = Math.min(pendingCaret.current, ta.value.length)
      ta.focus()
      ta.setSelectionRange(p, p)
      pendingCaret.current = null
    }
    setEditing(true)
  }, [focusSignal])

  // Pasang kursor setelah textarea benar-benar ada di DOM.
  useLayoutEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = '0px'
    ta.style.height = ta.scrollHeight + 'px'
    if (pendingCaret.current != null) {
      const p = Math.min(pendingCaret.current, ta.value.length)
      ta.focus()
      ta.setSelectionRange(p, p)
      pendingCaret.current = null
    }
  })

  const segments = useMemo(
    () => (showRendered ? tokenize(text, ctx.resolve) : []),
    [showRendered, text, ctx.resolve]
  )

  const options = useMemo(() => {
    if (!menu) return []
    const q = menu.query.toLowerCase()
    const imgs = ctx.images.filter((i) => i.name.toLowerCase().includes(q)).slice(0, 6)
    const trades = ctx.trades
      .filter((t) => !q || [t.pair, t.id, t.timeframe, ...(t.tags || []), shortDate(effectiveDate(t))]
        .join(' ').toLowerCase().includes(q))
      .sort((a, b) => Number(ctx.linkedIds.has(b.id)) - Number(ctx.linkedIds.has(a.id)))
      .slice(0, 5)
    return [
      ...imgs.map((i) => ({ kind: 'image', handle: i.name, i })),
      ...trades.map((t) => ({ kind: 'trade', handle: t.id, t })),
    ]
  }, [menu, ctx.images, ctx.trades, ctx.linkedIds])

  function updateMenu() {
    const ta = taRef.current
    if (!ta || ta.selectionStart !== ta.selectionEnd) return setMenu(null)
    const pos = ta.selectionStart
    const m = /(^|[^A-Za-z0-9_@])@([A-Za-z0-9._-]*)$/.exec(ta.value.slice(0, pos))
    if (!m) return setMenu(null)
    const start = pos - m[2].length - 1
    const c = caretCoords(ta, start)
    const maxLeft = Math.max(0, (wrapRef.current?.offsetWidth || 400) - 340)
    setMenu((prev) => ({
      start, query: m[2],
      top: c.top + c.lineHeight + 2,
      left: Math.min(c.left, maxLeft),
      cursor: prev && prev.start === start ? prev.cursor : 0,
    }))
  }

  function pick(opt) {
    const ta = taRef.current
    if (!ta || !menu) return
    const insert = '@' + opt.handle + ' '
    const next = text.slice(0, menu.start) + insert + text.slice(ta.selectionStart)
    pendingCaret.current = menu.start + insert.length
    setMenu(null)
    onChange(next)
    if (opt.kind === 'trade') ctx.onLinkTrade(opt.t.id)
  }

  function onKeyDown(e) {
    if (menu && options.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMenu({ ...menu, cursor: (menu.cursor + 1) % options.length }); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMenu({ ...menu, cursor: (menu.cursor - 1 + options.length) % options.length }); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(options[Math.min(menu.cursor, options.length - 1)]); return }
    }
    if (menu && e.key === 'Escape') { e.preventDefault(); setMenu(null); return }
    if (e.key === 'Backspace' && text === '' && onBackspaceEmpty) {
      e.preventDefault()
      onBackspaceEmpty()
    }
  }

  function imageFiles(list) {
    return [...(list || [])].filter((f) => f.type?.startsWith('image/'))
  }

  function onPaste(e) {
    const files = imageFiles(e.clipboardData?.files)
    if (!files.length || !onPasteImages) return
    e.preventDefault()
    onPasteImages(files, taRef.current.selectionStart, taRef.current.selectionEnd)
  }

  function onDrop(e) {
    const files = imageFiles(e.dataTransfer?.files)
    if (!files.length || !onPasteImages) return
    e.preventDefault()
    const pos = taRef.current ? taRef.current.selectionStart : text.length
    onPasteImages(files, pos, pos)
  }

  /** Klik di teks yang sedang ditampilkan → edit, kursor di titik yang diklik. */
  function onRenderedMouseDown(e) {
    if (e.target.closest('[data-mention]')) return
    e.preventDefault()
    let pos = text.length
    const r = document.caretRangeFromPoint?.(e.clientX, e.clientY)
    const seg = r?.startContainer?.parentElement?.closest?.('[data-start]')
    if (seg && wrapRef.current?.contains(seg)) pos = Number(seg.dataset.start) + r.startOffset
    pendingCaret.current = pos
    setEditing(true)
  }

  return (
    <div ref={wrapRef} className="mt-wrap" style={style} onDragOver={(e) => onPasteImages && e.preventDefault()} onDrop={onDrop}>
      {showRendered ? (
        <div
          className={'note-text is-rendered ' + className}
          tabIndex={0}
          onMouseDown={onRenderedMouseDown}
          onFocus={(e) => { if (e.target === e.currentTarget) { pendingCaret.current = text.length; setEditing(true) } }}
        >
          {segments.map((s) =>
            s.type === 'text'
              ? <span key={s.start} data-start={s.start}>{s.text}</span>
              : <Mention key={s.start} seg={s} ctx={ctx} />
          )}
        </div>
      ) : (
        <textarea
          ref={taRef}
          rows={1}
          className={'note-text ' + className}
          value={text}
          placeholder={placeholder}
          onChange={(e) => { onChange(e.target.value); requestAnimationFrame(updateMenu) }}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') updateMenu() }}
          onClick={updateMenu}
          onFocus={() => setEditing(true)}
          onBlur={() => { setEditing(false); setMenu(null) }}
          onPaste={onPaste}
        />
      )}

      {menu && editing && (
        <MentionMenu
          menu={menu} options={options} ctx={ctx}
          onHover={(i) => setMenu({ ...menu, cursor: i })}
          onPick={pick}
        />
      )}
    </div>
  )
}

function MentionMenu({ menu, options, ctx, onHover, onPick }) {
  const imgCount = options.filter((o) => o.kind === 'image').length
  const tradeCount = options.length - imgCount
  const q = menu.query
  return (
    <div className="mention-menu" style={{ top: menu.top, left: menu.left }} onMouseDown={(e) => e.preventDefault()}>
      {options.length === 0 && (
        <div className="ac-empty">
          {ctx.images.length === 0
            ? 'Belum ada gambar bernama di catatan ini, dan tidak ada trade yang cocok.'
            : `Tidak ada yang cocok dengan “${q}”.`}
        </div>
      )}
      {options.map((o, i) => (
        <div key={o.kind + o.handle}>
          {(i === 0 || options[i - 1].kind !== o.kind) && (
            <div className="mm-section">{o.kind === 'image' ? 'Gambar di catatan ini' : 'Trade'}</div>
          )}
          <div
            className={'mm-item' + (i === menu.cursor ? ' is-cursor' : '')}
            onMouseEnter={() => onHover(i)}
            onClick={() => onPick(o)}
          >
            {o.kind === 'image' ? (
              <>
                <span className="mm-thumb">{o.i.image?.id && <img src={imageURL(o.i.image.id)} alt="" />}</span>
                <span style={{ flex: 1 }}><Highlight text={o.i.name} q={q} /></span>
                <span className="mono" style={{ fontSize: 10, color: 'var(--color-neutral-600)' }}>gbr {o.i.index}</span>
              </>
            ) : (
              <TradeLine t={o.t} linked={ctx.linkedIds.has(o.t.id)} />
            )}
          </div>
        </div>
      ))}
      <div className="mm-foot">
        <span>↑↓ pilih · ⏎ sisipkan</span>
        <span className="mono">{imgCount} gambar · {tradeCount} trade</span>
      </div>
    </div>
  )
}

function Highlight({ text, q }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1
  if (i < 0) return text
  return (
    <>
      {text.slice(0, i)}
      <span style={{ color: 'var(--color-accent)' }}>{text.slice(i, i + q.length)}</span>
      {text.slice(i + q.length)}
    </>
  )
}

export function TradeLine({ t, linked }) {
  const d = deriveTrade(t)
  const r = d.actualR ?? d.realizedR
  return (
    <>
      <span className="mono" style={{ fontSize: 10, color: 'var(--color-neutral-600)', width: 44, flex: 'none' }}>
        {shortDate(effectiveDate(t))}
      </span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {tradeLabel(t)}
        {linked && <span className="mono" style={{ fontSize: 10, color: 'var(--color-accent)', marginLeft: 6 }}>tertaut</span>}
      </span>
      <span className={'mono ' + toneClass(r)} style={{ fontSize: 12 }}>
        {t.status === 'closed' ? (r != null ? rVal(r).replace(/(\.\d)\d/, '$1') : '—') : 'jalan'}
      </span>
    </>
  )
}

/** Rujukan di badan catatan: teks aksen bergaris tipis, bukan thumbnail kedua. */
function Mention({ seg, ctx }) {
  const [hover, setHover] = useState(false)
  const t = seg.target
  const isImg = t.kind === 'image'
  const flash = isImg && ctx.flashName && ctx.flashName.toLowerCase() === t.name.toLowerCase()
  return (
    <span
      data-mention
      className={'mention' + (flash ? ' is-flash' : '')}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => (isImg ? ctx.onJumpImage(t.blockId) : ctx.onOpenTrade(t.trade))}
    >
      {isImg ? `◳ ${t.name}` : `↗ ${tradeLabel(t.trade, { tag: false })}`}
      {hover && (
        <span className="mention-pop">
          {isImg ? (
            <>
              <span className="mention-pop-img">{t.image?.id && <img src={imageURL(t.image.id)} alt="" />}</span>
              <span className="mono mention-pop-cap">{t.name} · gbr {t.index} · klik untuk lompat</span>
            </>
          ) : (
            <TradePreview t={t.trade} />
          )}
        </span>
      )}
    </span>
  )
}

function TradePreview({ t }) {
  const d = deriveTrade(t)
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '2px 4px' }}>
      <span style={{ fontSize: 13 }}>{tradeLabel(t)}</span>
      <span className="mono" style={{ fontSize: 11, display: 'flex', gap: 10 }}>
        <span style={{ color: 'var(--color-neutral-600)' }}>{shortDate(effectiveDate(t))}</span>
        <span className={toneClass(d.actualR)}>{d.actualR != null ? rVal(d.actualR) : '—'}</span>
        <span className={toneClass(d.netPnl)}>{d.netPnl != null ? money(d.netPnl) : t.status === 'closed' ? '—' : 'berjalan'}</span>
      </span>
      <span className="mono mention-pop-cap" style={{ padding: 0 }}>klik untuk membuka trade</span>
    </span>
  )
}

/** Posisi piksel sebuah indeks karakter di textarea (teknik div cermin). */
function caretCoords(ta, index) {
  const cs = getComputedStyle(ta)
  const div = document.createElement('div')
  for (const p of ['boxSizing', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
    'paddingTop', 'paddingLeft', 'paddingRight', 'paddingBottom', 'tabSize', 'textTransform']) {
    div.style[p] = cs[p]
  }
  Object.assign(div.style, {
    position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px',
    whiteSpace: 'pre-wrap', overflowWrap: 'break-word', width: ta.offsetWidth + 'px',
  })
  div.textContent = ta.value.slice(0, index)
  const span = document.createElement('span')
  span.textContent = ta.value.slice(index) || '.'
  div.appendChild(span)
  document.body.appendChild(div)
  const out = { top: span.offsetTop, left: span.offsetLeft, lineHeight: parseFloat(cs.lineHeight) || 22 }
  document.body.removeChild(div)
  return out
}

/* ─────────────────────────── judul bagian ─────────────────────────── */

export function HeadingBlock({ block, onChange, onRemove, focusSignal }) {
  const ref = useRef(null)
  useLayoutEffect(() => { if (focusSignal) ref.current?.focus() }, [focusSignal])
  return (
    <input
      ref={ref}
      className="note-heading"
      value={block.text}
      placeholder="Judul bagian"
      onChange={(e) => onChange({ text: e.target.value })}
      onKeyDown={(e) => {
        if (e.key === 'Backspace' && !block.text) { e.preventDefault(); onRemove() }
      }}
    />
  )
}

/* ─────────────────────────── blok fase event ─────────────────────────── */

export function PhaseBlock({ block, onChange, onRemove, ctx, focusSignal, onPasteImages }) {
  const eventRef = useRef(null)
  useLayoutEffect(() => { if (focusSignal) eventRef.current?.focus() }, [focusSignal])
  const setRow = (id, patch) => onChange({ rows: block.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) })
  return (
    <div className="note-phase">
      <div className="phase-head">
        <span className="mono phase-kicker">Blok fase event</span>
        <input
          ref={eventRef}
          className="ghost-input mono"
          style={{ fontSize: 11, flex: 1, textAlign: 'right' }}
          value={block.event}
          placeholder="nama event"
          onChange={(e) => onChange({ event: e.target.value })}
        />
        <input
          className="ghost-input mono"
          style={{ fontSize: 11, width: 84, textAlign: 'right', color: 'var(--color-neutral-600)' }}
          value={block.time}
          placeholder="jam · WIB"
          onChange={(e) => onChange({ time: e.target.value })}
        />
        <button className="shot-btn del" title="Hapus blok fase" onClick={onRemove}>✕</button>
      </div>
      <div className="phase-grid">
        {block.rows.map((r, i) => {
          const last = i === block.rows.length - 1
          return (
            <div key={r.id} className="phase-row" style={{ display: 'contents' }}>
              <div className={'phase-label' + (last ? ' is-last' : '')}>
                <input
                  className="ghost-input mono phase-name"
                  style={{ color: /saat/i.test(r.label) ? 'var(--color-accent)' : undefined }}
                  value={r.label}
                  placeholder="fase"
                  onChange={(e) => setRow(r.id, { label: e.target.value })}
                />
                <input
                  className="ghost-input mono"
                  style={{ fontSize: 10, color: 'var(--color-neutral-600)' }}
                  value={r.offset}
                  placeholder="waktu"
                  onChange={(e) => setRow(r.id, { offset: e.target.value })}
                />
                {block.rows.length > 1 && (
                  <button
                    className="link-btn phase-row-del"
                    onClick={() => onChange({ rows: block.rows.filter((x) => x.id !== r.id) })}
                  >
                    hapus
                  </button>
                )}
              </div>
              <div
                className={'phase-text' + (last ? ' is-last' : '')}
                onMouseDown={(e) => {
                  // Klik di mana pun dalam sel = mulai mengetik di sel itu.
                  if (e.target !== e.currentTarget) return
                  e.preventDefault()
                  e.currentTarget.querySelector('.note-text')?.focus()
                }}
              >
                <MentionText
                  value={r.text}
                  onChange={(text) => setRow(r.id, { text })}
                  placeholder={`Apa yang terjadi ${r.label ? r.label.toLowerCase() : 'di fase ini'}…`}
                  ctx={ctx}
                  onPasteImages={onPasteImages}
                />
              </div>
            </div>
          )
        })}
      </div>
      <button
        className="btn btn-ghost phase-add"
        onClick={() => onChange({ rows: [...block.rows, { id: 'r_' + Math.random().toString(36).slice(2, 9), label: '', offset: '', text: '' }] })}
      >
        + fase
      </button>
    </div>
  )
}

/* ─────────────────────────── gambar ─────────────────────────── */

/**
 * Setelah paste, fokus langsung pindah ke nama gambar. Nama itu bukan hiasan —
 * itulah pegangan @mention, jadi paling murah diberi saat konteksnya masih segar.
 */
export function ImageBlock({
  block, index, refCount, focusSignal, flash, onRename, onChange, onRemove, onReplace, onOpen, onShowRefs, onDone,
}) {
  const [draft, setDraft] = useState(block.name)
  const [nameFocus, setNameFocus] = useState(false)
  const nameRef = useRef(null)
  const fileRef = useRef(null)

  useEffect(() => setDraft(block.name), [block.name])
  useLayoutEffect(() => { if (focusSignal) nameRef.current?.focus() }, [focusSignal])

  function commit() {
    const slug = slugifyName(draft)
    if (slug !== block.name) onRename(slug)
    else setDraft(block.name)
  }

  const img = block.image
  return (
    <div className={'note-img' + (flash ? ' is-flash' : '')} id={`blk-${block.id}`}>
      <div className="note-img-frame">
        {img?.id
          ? <img src={imageURL(img.id)} alt={block.name || 'gambar'} onClick={onOpen} />
          : <span className="mono" style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>gambar hilang</span>}
        {block.name && <span className="img-badge mono">◳ {block.name}</span>}
        <div className="shot-actions">
          <button className="shot-btn" title="Ganti gambar" onClick={() => fileRef.current?.click()}>↺</button>
          <button className="shot-btn" title="Perbesar" onClick={onOpen}>⤢</button>
          <button className="shot-btn del" title="Hapus gambar" onClick={onRemove}>✕</button>
        </div>
        <input
          ref={fileRef} type="file" accept="image/*" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onReplace(f); e.target.value = '' }}
        />
      </div>

      <div className="img-meta">
        <input
          ref={nameRef}
          className={'img-name mono' + (!block.name && !nameFocus ? ' is-empty' : '')}
          value={draft}
          placeholder="Beri nama gambar ini…"
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setNameFocus(true)}
          onBlur={() => { setNameFocus(false); commit() }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); onDone?.() }
            if (e.key === 'Escape') { setDraft(block.name); e.currentTarget.blur() }
          }}
        />
        {nameFocus ? (
          <span className="mono img-hint">
            nama = pegangan @mention{draft && slugifyName(draft) !== draft ? ` → ${slugifyName(draft) || '—'}` : ''} · ⏎ simpan
          </span>
        ) : block.name ? (
          <span className="mono img-hint">
            {refCount ? <>dirujuk {refCount}× di catatan ini · <button className="link-btn" onClick={onShowRefs}>lihat rujukan</button></> : `gbr ${index} · belum dirujuk`}
          </span>
        ) : null}
      </div>

      <div className="img-caption">
        <span className="mono" style={{ color: 'var(--color-neutral-600)' }}>Ket.</span>
        <input
          className="ghost-input"
          value={block.caption}
          placeholder="Keterangan (opsional)"
          onChange={(e) => onChange({ caption: e.target.value })}
        />
      </div>
    </div>
  )
}

/* ─────────────────────────── checklist ─────────────────────────── */

export function ChecklistBlock({ block, onChange, onRemove, focusSignal }) {
  const refs = useRef({})
  const [focusId, setFocusId] = useState(null)

  useLayoutEffect(() => { if (focusSignal) refs.current[block.items[0]?.id]?.focus() }, [focusSignal])
  useEffect(() => {
    if (focusId && refs.current[focusId]) { refs.current[focusId].focus(); setFocusId(null) }
  }, [focusId, block.items])

  const setItem = (id, patch) => onChange({ items: block.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })
  const newItem = () => ({ id: 'c_' + Math.random().toString(36).slice(2, 9), text: '', done: false })
  const doneCount = block.items.filter((i) => i.done && i.text.trim()).length
  const total = block.items.filter((i) => i.text.trim()).length

  return (
    <div className="note-checklist">
      {block.items.map((it, idx) => (
        <div key={it.id} className={'check-item' + (it.done ? ' is-done' : '')}>
          <button
            className={'check-box' + (it.done ? ' is-done' : '')}
            onClick={() => setItem(it.id, { done: !it.done })}
            aria-label={it.done ? 'Tandai belum' : 'Tandai selesai'}
          >
            {it.done ? '✓' : ''}
          </button>
          <input
            ref={(el) => { refs.current[it.id] = el }}
            className="ghost-input"
            value={it.text}
            placeholder="Item…"
            onChange={(e) => setItem(it.id, { text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                const n = newItem()
                const items = [...block.items]
                items.splice(idx + 1, 0, n)
                onChange({ items })
                setFocusId(n.id)
              } else if (e.key === 'Backspace' && !it.text) {
                e.preventDefault()
                if (block.items.length === 1) { onRemove(); return }
                const prev = block.items[idx - 1] || block.items[idx + 1]
                onChange({ items: block.items.filter((x) => x.id !== it.id) })
                setFocusId(prev?.id)
              }
            }}
          />
        </div>
      ))}
      <div className="check-foot">
        <span className="mono">{total ? `${doneCount}/${total} selesai` : '⏎ untuk item baru'}</span>
        <button className="link-btn" style={{ color: 'var(--color-neutral-600)' }} onClick={onRemove}>hapus checklist</button>
      </div>
    </div>
  )
}
