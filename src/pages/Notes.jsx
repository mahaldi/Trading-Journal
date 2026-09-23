import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MentionText, HeadingBlock, PhaseBlock, ImageBlock, ChecklistBlock, TradeLine } from '../components/NoteBlocks'
import { putImage, deleteImage } from '../lib/storage'
import { deriveTrade, effectiveDate, sortByDate } from '../lib/calc'
import { money, rVal, shortDate, longDate, toneClass } from '../lib/format'
import {
  NOTE_TYPES, typeOf, groupByMonth, noteMatches, noteSnippet, linkedTradeIds, mentionedTradeIds,
  imageBlocks, makeResolver, countMentions, uniqueImageName, renameMentions,
  textBlock, phaseBlock, checklistBlock, imageBlock, tradeLabel,
} from '../lib/notes'

/* ══════════════════════════════════════════════════════════════
   Tab Catatan — terpisah dari Notes pribadi dan berdiri sendiri dari
   jurnal trade. Kiri: daftar dua baris per bulan. Kanan: editor mengalir.
   ══════════════════════════════════════════════════════════════ */

export default function Notes({
  notes, trades, activeId, newNoteId, saveState,
  onSelect, onCreate, onPatch, onDelete, onOpenTrade, onLightbox,
}) {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('all')

  const tradesById = useMemo(() => new Map(trades.map((t) => [t.id, t])), [trades])

  const filtered = useMemo(
    () => notes.filter((n) => (kind === 'all' || n.type === kind) && noteMatches(n, query)),
    [notes, kind, query]
  )
  const groups = useMemo(() => groupByMonth(filtered), [filtered])
  const counts = useMemo(() => {
    const c = {}
    for (const n of notes) c[n.type] = (c[n.type] || 0) + 1
    return c
  }, [notes])

  const active = notes.find((n) => n.id === activeId) || null

  // Belum ada yang dipilih → buka catatan teratas.
  useEffect(() => {
    if (!active && groups[0]?.notes[0]) onSelect(groups[0].notes[0].id)
  }, [active, groups, onSelect])

  // Catatan baru harus terlihat di daftar walau filter sedang aktif.
  useEffect(() => {
    if (newNoteId) { setQuery(''); setKind('all') }
  }, [newNoteId])

  return (
    <div className="card elev-md notes-shell">
      <aside className="notes-list">
        <input
          className="input"
          value={query}
          placeholder="Cari catatan…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') setQuery('') }}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5.6 }}>
          <button className={'tag tag-btn ' + (kind === 'all' ? 'tag-accent' : 'tag-outline')} onClick={() => setKind('all')}>
            Semua · {notes.length}
          </button>
          {NOTE_TYPES.filter((t) => t.key !== 'free' || counts.free).map((t) => (
            <button
              key={t.key}
              className={'tag tag-btn ' + (kind === t.key ? 'tag-accent' : 'tag-outline')}
              onClick={() => setKind(kind === t.key ? 'all' : t.key)}
              title={`${counts[t.key] || 0} catatan`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 5.6 }}>
          {notes.length === 0 && (
            <div className="note-list-empty">Belum ada catatan. Pilih titik awal di sebelah kanan.</div>
          )}
          {notes.length > 0 && groups.length === 0 && (
            <div className="note-list-empty">Tidak ada catatan yang cocok.</div>
          )}
          {groups.map((g) => (
            <div key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 5.6 }}>
              <div className="note-month">{g.label}</div>
              {g.notes.map((n) => (
                <NoteRow key={n.id} note={n} active={n.id === activeId} tradesById={tradesById} onClick={() => onSelect(n.id)} />
              ))}
            </div>
          ))}
        </div>
      </aside>

      {active ? (
        <NoteEditor
          key={active.id}
          note={active}
          isNew={active.id === newNoteId}
          trades={trades}
          tradesById={tradesById}
          saveState={saveState}
          patch={(fn) => onPatch(active.id, fn)}
          onDelete={() => onDelete(active)}
          onOpenTrade={onOpenTrade}
          onLightbox={onLightbox}
        />
      ) : (
        <TemplatePicker onCreate={onCreate} />
      )}
    </div>
  )
}

/* ─────────────────────────── baris daftar ─────────────────────────── */

function NoteRow({ note, active, tradesById, onClick }) {
  const t = typeOf(note.type)
  const imgs = imageBlocks(note).length
  const linked = linkedTradeIds(note, tradesById).length
  const snippet = noteSnippet(note, tradesById)
  return (
    <div className={'note-row' + (active ? ' is-active' : '')} onClick={onClick}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5.6, marginBottom: 2.8 }}>
        <span className="note-dot" style={{ background: t.color }} />
        <span className="note-kind" style={{ color: active && note.type === 'event' ? 'var(--color-accent)' : undefined }}>{t.label}</span>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 10, color: 'var(--color-neutral-600)' }}>{shortDate(note.date)}</span>
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.35, color: note.title ? undefined : 'var(--color-neutral-600)' }}>
        {note.title || 'Tanpa judul'}
      </div>
      {snippet && <div className="note-snippet">{snippet}</div>}
      {(imgs > 0 || linked > 0) && (
        <div style={{ display: 'flex', gap: 8.4, marginTop: 5.6 }}>
          {imgs > 0 && <span className="mono note-count">◳ {imgs}</span>}
          {linked > 0 && <span className="mono note-count">↗ {linked} trade</span>}
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────── keadaan kosong: lima template ─────────────────────────── */

function TemplatePicker({ onCreate }) {
  return (
    <div className="note-editor" style={{ justifyContent: 'center' }}>
      <div style={{ maxWidth: 860, margin: '0 auto', width: '100%' }}>
        <div className="card-kicker">Catatan</div>
        <div className="card-title" style={{ marginBottom: 5.6 }}>Mulai dari mana?</div>
        <p className="card-body" style={{ lineHeight: 1.6, margin: '0 0 16.8px', maxWidth: 620 }}>
          Template hanya titik awal, bukan kerangkeng: memilih jenis mengisi blok awal dan menentukan
          titik warna di daftar. Setelah itu blok apa pun bisa ditambah atau dihapus, dan jenis bisa diganti tanpa kehilangan isi.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 11.2 }}>
          {NOTE_TYPES.map((t) => (
            <button key={t.key} className="tpl-card" onClick={() => onCreate(t.key)}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5.6 }}>
                <span className="note-dot" style={{ width: 6, height: 6, background: t.color }} />
                <span style={{ fontSize: 13 }}>{t.full}</span>
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2.8 }}>
                {t.outline.map((o) => (
                  <span key={o} className="mono" style={{ fontSize: 10, color: /fase/.test(o) ? 'var(--color-accent)' : 'var(--color-neutral-500)' }}>{o}</span>
                ))}
              </span>
              <span className="card-body" style={{ fontSize: 11, lineHeight: 1.55 }}>{t.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────── editor ─────────────────────────── */

function NoteEditor({ note, isNew, trades, tradesById, saveState, patch, onDelete, onOpenTrade, onLightbox }) {
  const [focus, setFocus] = useState(null)          // { id, pos, n } — blok yang harus difokus
  const [activeBlock, setActiveBlock] = useState(null)
  const [flashBlock, setFlashBlock] = useState(null)
  const [flashName, setFlashName] = useState(null)
  const [uploading, setUploading] = useState(0)
  const [error, setError] = useState(null)
  const [menu, setMenu] = useState(null)            // 'more' | 'link' | 'insertTrade'
  const [tagDraft, setTagDraft] = useState(null)
  const titleRef = useRef(null)
  const fileRef = useRef(null)
  const flashTimer = useRef(null)

  useEffect(() => { if (isNew) titleRef.current?.focus() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(flashTimer.current), [])

  const blocks = note.blocks || []
  const sortedTrades = useMemo(() => sortByDate(trades, -1), [trades])
  const linkedIds = useMemo(() => new Set(linkedTradeIds(note, tradesById)), [note, tradesById])
  const mentioned = useMemo(() => mentionedTradeIds(note), [note])
  const resolve = useMemo(() => makeResolver(note, tradesById), [note, tradesById])
  const images = useMemo(
    () => imageBlocks(note).map((b, i) => ({ name: b.name, blockId: b.id, index: i + 1, image: b.image })).filter((x) => x.name),
    [note]
  )

  /* ── operasi blok ── */

  const setBlocks = useCallback((fn) => patch((n) => ({ ...n, blocks: fn(n.blocks || []) })), [patch])
  const updateBlock = useCallback((id, p) => setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, ...p } : b))), [setBlocks])
  const focusBlock = (id, pos) => setFocus({ id, pos, n: Date.now() })

  /** Sisipkan blok terstruktur setelah `afterId`; selalu sisakan paragraf sesudahnya untuk lanjut mengetik. */
  function insertBlock(block, afterId = activeBlock) {
    setBlocks((bs) => {
      let i = afterId ? bs.findIndex((b) => b.id === afterId) : bs.length - 1
      if (i === -1) i = bs.length - 1
      // Paragraf kosong tempat kursor berada diganti langsung oleh blok baru.
      if (bs[i]?.kind === 'text' && !bs[i].text.trim()) {
        const next = [...bs]
        next.splice(i, 1, block)
        if (next[i + 1]?.kind !== 'text') next.splice(i + 1, 0, textBlock())
        return next
      }
      const next = [...bs]
      next.splice(i + 1, 0, block)
      if (next[i + 2]?.kind !== 'text') next.splice(i + 2, 0, textBlock())
      return next
    })
    setActiveBlock(block.id)
    focusBlock(block.id)
  }

  /** Hapus satu blok; dua paragraf yang jadi bersebelahan digabung. */
  function removeBlock(id, { focusPrev = true } = {}) {
    const i = blocks.findIndex((b) => b.id === id)
    const b = blocks[i]
    if (!b) return
    if (b.kind === 'image' && b.image?.id) deleteImage(b.image.id)
    const prev = blocks[i - 1]
    const nextB = blocks[i + 1]
    setBlocks((bs) => {
      let out = bs.filter((x) => x.id !== id)
      const p = out[i - 1]
      const q = out[i]
      if (p?.kind === 'text' && q?.kind === 'text') {
        const joined = [p.text, q.text].filter((s) => s !== '').join('\n')
        out = [...out.slice(0, i - 1), { ...p, text: joined }, ...out.slice(i + 1)]
      }
      if (!out.length || out[out.length - 1].kind !== 'text') out = [...out, textBlock()]
      return out
    })
    const target = focusPrev ? prev || nextB : nextB || prev
    if (target) {
      setActiveBlock(target.id)
      focusBlock(target.id, target.kind === 'text' ? target.text.length : undefined)
    }
  }

  /** Paste/drop/pilih file: unggah ke data/images/, lalu sisipkan di posisi kursor. */
  async function addImages(files, at) {
    setError(null)
    setUploading((u) => u + files.length)
    try {
      const metas = []
      for (const f of files) {
        const m = await putImage(f, f.name)
        metas.push({ id: m.id, name: m.name, size: m.size, type: m.type, width: m.width, height: m.height })
      }
      const imgs = metas.map((m) => imageBlock(m))
      setBlocks((bs) => {
        const i = bs.findIndex((b) => b.id === at.blockId)
        if (i === -1) return [...bs, ...imgs, textBlock()]
        const b = bs[i]
        if (b.kind === 'text' && at.split) {
          const before = b.text.slice(0, at.start).replace(/\s+$/, '')
          const after = b.text.slice(at.end).replace(/^\s+/, '')
          const head = before ? [{ ...b, text: before }] : []
          return [...bs.slice(0, i), ...head, ...imgs, textBlock(after), ...bs.slice(i + 1)]
        }
        const tail = bs[i + 1]?.kind === 'text' ? [] : [textBlock()]
        return [...bs.slice(0, i + 1), ...imgs, ...tail, ...bs.slice(i + 1)]
      })
      setActiveBlock(imgs[0].id)
      focusBlock(imgs[0].id)
    } catch (err) {
      setError(`Gagal mengunggah gambar: ${err.message}`)
    } finally {
      setUploading((u) => Math.max(0, u - files.length))
    }
  }

  async function replaceImage(block, file) {
    try {
      const m = await putImage(file, file.name)
      const old = block.image?.id
      updateBlock(block.id, { image: { id: m.id, name: m.name, size: m.size, type: m.type, width: m.width, height: m.height } })
      if (old) deleteImage(old)
    } catch (err) {
      setError(`Gagal mengganti gambar: ${err.message}`)
    }
  }

  function renameImage(blockId, slug) {
    patch((n) => {
      const b = n.blocks.find((x) => x.id === blockId)
      if (!b) return n
      const name = uniqueImageName(n, slug, blockId)
      const next = { ...n, blocks: n.blocks.map((x) => (x.id === blockId ? { ...x, name } : x)) }
      return b.name && name ? renameMentions(next, b.name, name) : next
    })
  }

  const linkTrade = useCallback((id) => {
    patch((n) => (n.tradeIds?.includes(id) ? n : { ...n, tradeIds: [...(n.tradeIds || []), id] }))
  }, [patch])

  const unlinkTrade = (id) => patch((n) => ({ ...n, tradeIds: (n.tradeIds || []).filter((x) => x !== id) }))

  /** "↗ Trade" di baris sisip: tautkan dan tulis mention-nya di paragraf aktif. */
  function insertTradeMention(t) {
    linkTrade(t.id)
    const cur = blocks.find((b) => b.id === activeBlock)
    if (cur?.kind === 'text') {
      const sep = cur.text && !/\s$/.test(cur.text) ? ' ' : ''
      const text = `${cur.text}${sep}@${t.id} `
      updateBlock(cur.id, { text })
      focusBlock(cur.id, text.length)
    } else {
      const b = textBlock(`@${t.id} `)
      insertBlock(b)
      focusBlock(b.id, b.text.length)
    }
    setMenu(null)
  }

  const jumpToImage = useCallback((blockId) => {
    const el = document.getElementById(`blk-${blockId}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setFlashBlock(blockId)
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlashBlock(null), 1400)
  }, [])

  function showRefs(name) {
    setFlashName(name)
    const first = document.querySelector('.note-body .mention.is-flash')
    first?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlashName(null), 1800)
  }

  // Setelah flashName aktif, gulir ke rujukan pertama.
  useEffect(() => {
    if (!flashName) return
    document.querySelector('.note-body .mention.is-flash')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [flashName])

  const ctx = useMemo(() => ({
    resolve, images, trades: sortedTrades, linkedIds,
    onLinkTrade: linkTrade, onJumpImage: jumpToImage, onOpenTrade, flashName,
  }), [resolve, images, sortedTrades, linkedIds, linkTrade, jumpToImage, onOpenTrade, flashName])

  /* ── tag ── */

  function addTag(raw) {
    const tag = String(raw || '').trim().replace(/^#+/, '').replace(/\s+/g, '_')
    if (tag && !(note.tags || []).some((t) => t.toLowerCase() === tag.toLowerCase())) {
      patch((n) => ({ ...n, tags: [...(n.tags || []), tag] }))
    }
    setTagDraft(null)
  }

  /* ── tampilan ── */

  const type = typeOf(note.type)
  const time = note.createdAt ? new Date(note.createdAt) : null
  const hhmm = time ? `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}` : ''
  const saveText = saveState === 'saving' ? 'menyimpan…' : saveState === 'error' ? '⚠ gagal menyimpan' : 'tersimpan'
  const linkedTrades = [...linkedIds].map((id) => tradesById.get(id)).filter(Boolean)
    .sort((a, b) => effectiveDate(a).localeCompare(effectiveDate(b)))
  const insertAfter = blocks.some((b) => b.id === activeBlock) ? activeBlock : blocks[blocks.length - 1]?.id
  const onlyEmpty = blocks.length === 1 && blocks[0].kind === 'text' && !blocks[0].text

  const insertBar = (
    <div className="insert-bar" onMouseDown={(e) => e.target.tagName === 'BUTTON' && e.preventDefault()}>
      <span className="mono" style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>Sisipkan</span>
      <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => fileRef.current?.click()}>◳ Gambar</button>
      <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => insertBlock(phaseBlock(), insertAfter)}>⊞ Blok fase</button>
      <span style={{ position: 'relative' }}>
        <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setMenu(menu === 'insertTrade' ? null : 'insertTrade')}>↗ Trade</button>
        {menu === 'insertTrade' && (
          <TradePicker trades={sortedTrades} linkedIds={linkedIds} onPick={insertTradeMention} onClose={() => setMenu(null)} />
        )}
      </span>
      <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => insertBlock(checklistBlock(), insertAfter)}>☑ Checklist</button>
      {uploading > 0 && <span className="mono" style={{ fontSize: 11, color: 'var(--color-accent)' }}>mengunggah {uploading} gambar…</span>}
      {uploading === 0 && <span className="mono" style={{ fontSize: 11, color: 'var(--color-neutral-700)' }}>· ⌘V tempel gambar · @ rujuk</span>}
    </div>
  )

  return (
    <div className="note-editor">
      <input
        ref={fileRef} type="file" accept="image/*" multiple hidden
        onChange={(e) => {
          const files = [...(e.target.files || [])]
          if (files.length) addImages(files, { blockId: insertAfter, split: false })
          e.target.value = ''
        }}
      />

      {/* kepala */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8.4 }}>
        <button className="tag tag-accent tag-btn" onClick={() => setMenu(menu === 'more' ? null : 'more')} title="Ganti jenis">
          {type.full}
        </button>
        <span className="mono note-stamp">
          <input
            type="date"
            className="note-date"
            value={note.date || ''}
            onChange={(e) => e.target.value && patch((n) => ({ ...n, date: e.target.value }))}
            title={note.date ? longDate(note.date) : ''}
          />
          {hhmm && ` · ${hhmm}`} · <span style={{ color: saveState === 'error' ? 'var(--color-loss)' : undefined }}>{saveText}</span>
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ position: 'relative' }}>
          <button className="btn btn-secondary btn-icon" title="Tautkan trade" onClick={() => setMenu(menu === 'link' ? null : 'link')}>↗</button>
          {menu === 'link' && (
            <TradePicker
              trades={sortedTrades} linkedIds={linkedIds} right
              onPick={(t) => { linkedIds.has(t.id) ? (!mentioned.has(t.id) && unlinkTrade(t.id)) : linkTrade(t.id) }}
              onClose={() => setMenu(null)}
              toggle
            />
          )}
        </span>
        <span style={{ position: 'relative' }}>
          <button className="btn btn-secondary btn-icon" title="Lainnya" onClick={() => setMenu(menu === 'more' ? null : 'more')}>⋯</button>
          {menu === 'more' && (
            <Popover right onClose={() => setMenu(null)}>
              <div className="mm-section">Jenis catatan</div>
              {NOTE_TYPES.map((t) => (
                <button key={t.key} className="menu-item" onClick={() => { patch((n) => ({ ...n, type: t.key })); setMenu(null) }}>
                  <span className="note-dot" style={{ width: 6, height: 6, background: t.color }} />
                  <span style={{ flex: 1 }}>{t.full}</span>
                  {note.type === t.key && <span style={{ color: 'var(--color-accent)' }}>✓</span>}
                </button>
              ))}
              <div className="mm-note">Mengganti jenis hanya mengubah label & warna — isi tetap.</div>
              <div className="divider" style={{ margin: '4px 0' }} />
              <button className="menu-item danger" onClick={() => { setMenu(null); onDelete() }}>Hapus catatan…</button>
            </Popover>
          )}
        </span>
      </div>

      {/* judul & tag */}
      <div>
        <input
          ref={titleRef}
          className="note-title"
          value={note.title}
          placeholder="Judul catatan"
          onChange={(e) => patch((n) => ({ ...n, title: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              const first = blocks.find((b) => b.kind === 'text' || b.kind === 'heading') || blocks[0]
              if (first) { setActiveBlock(first.id); focusBlock(first.id, first.text?.length) }
            }
          }}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5.6, marginTop: 8.4, alignItems: 'center' }}>
          {(note.tags || []).map((t) => (
            <span key={t} className="tag tag-neutral">
              #{t}
              <span className="tag-x" onClick={() => patch((n) => ({ ...n, tags: n.tags.filter((x) => x !== t) }))}>✕</span>
            </span>
          ))}
          {tagDraft == null ? (
            <button className="tag tag-outline tag-btn" onClick={() => setTagDraft('')}>+ tag</button>
          ) : (
            <input
              autoFocus
              className="tag-draft mono"
              value={tagDraft}
              placeholder="#tag ⏎"
              onChange={(e) => setTagDraft(e.target.value)}
              onBlur={() => addTag(tagDraft)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagDraft); setTagDraft('') }
                if (e.key === 'Escape') setTagDraft(null)
              }}
            />
          )}
        </div>
      </div>

      {error && (
        <div className="mono" style={{ fontSize: 11, color: 'var(--color-loss)' }}>
          {error} <button className="link-btn" onClick={() => setError(null)}>tutup</button>
        </div>
      )}

      {/* badan */}
      <div className="note-body">
        {blocks.map((b, i) => {
          const signal = focus?.id === b.id ? focus : null
          let el
          if (b.kind === 'text') {
            el = (
              <MentionText
                value={b.text}
                onChange={(text) => updateBlock(b.id, { text })}
                placeholder={onlyEmpty ? 'Mulai menulis… ketik @ untuk merujuk gambar atau trade, ⌘V untuk menempel screenshot.' : i === blocks.length - 1 ? 'Lanjut menulis…' : ''}
                ctx={ctx}
                focusSignal={signal}
                onBackspaceEmpty={i > 0 && blocks.length > 1 ? () => removeBlock(b.id) : undefined}
                onPasteImages={(files, start, end) => addImages(files, { blockId: b.id, split: true, start, end })}
              />
            )
          } else if (b.kind === 'heading') {
            el = <HeadingBlock block={b} focusSignal={signal} onChange={(p) => updateBlock(b.id, p)} onRemove={() => removeBlock(b.id)} />
          } else if (b.kind === 'phase') {
            el = (
              <PhaseBlock
                block={b} ctx={ctx} focusSignal={signal}
                onChange={(p) => updateBlock(b.id, p)}
                onRemove={() => removeBlock(b.id, { focusPrev: false })}
                onPasteImages={(files) => addImages(files, { blockId: b.id, split: false })}
              />
            )
          } else if (b.kind === 'image') {
            const idx = imageBlocks(note).findIndex((x) => x.id === b.id) + 1
            const all = imageBlocks(note)
            el = (
              <ImageBlock
                block={b} index={idx} focusSignal={signal}
                flash={flashBlock === b.id}
                refCount={countMentions(note, b.name)}
                onRename={(slug) => renameImage(b.id, slug)}
                onChange={(p) => updateBlock(b.id, p)}
                onRemove={() => removeBlock(b.id, { focusPrev: false })}
                onReplace={(f) => replaceImage(b, f)}
                onOpen={() => onLightbox({ images: all.map((x) => ({ id: x.image?.id, name: x.name || x.image?.name })), index: idx - 1 })}
                onShowRefs={() => showRefs(b.name)}
                onDone={() => {
                  const next = blocks[i + 1]
                  if (next?.kind === 'text') { setActiveBlock(next.id); focusBlock(next.id, 0) }
                }}
              />
            )
          } else if (b.kind === 'checklist') {
            el = <ChecklistBlock block={b} focusSignal={signal} onChange={(p) => updateBlock(b.id, p)} onRemove={() => removeBlock(b.id)} />
          } else {
            return null
          }
          return (
            <div key={b.id} className={'note-block kind-' + b.kind} onFocusCapture={() => setActiveBlock(b.id)}>
              {el}
              {b.id === insertAfter && insertBar}
            </div>
          )
        })}
      </div>

      <div className="divider" />

      {/* trade tertaut */}
      <div style={{ maxWidth: 660 }}>
        <div className="card-kicker" style={{ marginBottom: 8.4 }}>Trade tertaut · {linkedTrades.length}</div>
        {linkedTrades.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--color-neutral-600)', lineHeight: 1.6 }}>
            Belum ada. Ketik <span className="mono">@</span> lalu nama pair di badan catatan, atau tekan <span className="mono">↗</span> di atas —
            mention trade otomatis menautkannya, jadi tidak perlu langkah terpisah.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5.6 }}>
            {linkedTrades.map((t) => {
              const d = deriveTrade(t)
              const r = d.actualR ?? d.realizedR
              return (
                <div key={t.id} className="linked-row" onClick={() => onOpenTrade(t)}>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--color-neutral-600)', width: 52 }}>{shortDate(effectiveDate(t))}</span>
                  <span style={{ fontSize: 13, flex: 1 }}>{tradeLabel(t)}</span>
                  {t.status !== 'closed' && <span className="mono" style={{ fontSize: 11, color: 'var(--color-accent)' }}>berjalan</span>}
                  <span className={'mono ' + toneClass(r)} style={{ fontSize: 12 }}>{r != null ? rVal(r).replace(/(\.\d)\d/, '$1') : '—'}</span>
                  <span className={'mono ' + toneClass(d.netPnl ?? d.realizedPnl)} style={{ fontSize: 12, minWidth: 64, textAlign: 'right' }}>
                    {money(d.netPnl ?? d.realizedPnl, { decimals: 0 })}
                  </span>
                  {mentioned.has(t.id) ? (
                    <span className="mono linked-x" title="Disebut lewat @mention di catatan ini" style={{ cursor: 'default' }}>@</span>
                  ) : (
                    <span className="linked-x" title="Lepas tautan" onClick={(e) => { e.stopPropagation(); unlinkTrade(t.id) }}>✕</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/* ─────────────────────────── popover & pemilih trade ─────────────────────────── */

function Popover({ children, right, onClose, width = 240 }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onMouseDown={onClose} />
      <div className="popover" style={{ [right ? 'right' : 'left']: 0, width }}>{children}</div>
    </>
  )
}

function TradePicker({ trades, linkedIds, onPick, onClose, right, toggle }) {
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return trades
      .filter((t) => !s || [t.pair, t.timeframe, ...(t.tags || []), shortDate(effectiveDate(t))].join(' ').toLowerCase().includes(s))
      .slice(0, 8)
  }, [trades, q])
  return (
    <Popover right={right} onClose={onClose} width={360}>
      <input
        autoFocus
        className="input"
        style={{ minHeight: 32, fontSize: 13, marginBottom: 4 }}
        placeholder="Cari pair, tag, tanggal…"
        value={q}
        onChange={(e) => { setQ(e.target.value); setCursor(0) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(list.length - 1, c + 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)) }
          if (e.key === 'Enter' && list[cursor]) { e.preventDefault(); onPick(list[cursor]) }
        }}
      />
      {list.length === 0 && <div className="ac-empty">Tidak ada trade yang cocok.</div>}
      {list.map((t, i) => (
        <div
          key={t.id}
          className={'mm-item' + (i === cursor ? ' is-cursor' : '')}
          onMouseEnter={() => setCursor(i)}
          onClick={() => onPick(t)}
        >
          {toggle && (
            <span className={'check-box' + (linkedIds.has(t.id) ? ' is-done' : '')} style={{ width: 13, height: 13, fontSize: 9 }}>
              {linkedIds.has(t.id) ? '✓' : ''}
            </span>
          )}
          <TradeLine t={t} linked={!toggle && linkedIds.has(t.id)} />
        </div>
      ))}
      <div className="mm-foot">
        <span>{toggle ? 'klik untuk tautkan / lepas' : '⏎ sisipkan sebagai @mention'}</span>
        <span className="mono">{trades.length} trade</span>
      </div>
    </Popover>
  )
}
