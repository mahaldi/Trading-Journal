import { useMemo, useState } from 'react'
import { Sparkline, Confirm } from '../components/ui'
import { tagLibrary } from '../lib/calc'
import { money, shortDate, toneClass } from '../lib/format'

/**
 * Pustaka tag: setiap baris adalah tag plus performanya — jumlah pemakaian,
 * sparkline lima trade terakhir, dan net PnL. Tag lama yang tidak dipakai
 * diredupkan dan ditawarkan untuk digabung, supaya pustaka tidak membengkak.
 */
export default function Tags({ trades, onRenameTag, onMergeTag, onDeleteTag }) {
  const [q, setQ] = useState('')
  const [menu, setMenu] = useState(null)
  const [merge, setMerge] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)

  const library = useMemo(() => tagLibrary(trades), [trades])
  const filtered = useMemo(
    () => library.filter((t) => t.key.toLowerCase().includes(q.trim().toLowerCase())),
    [library, q]
  )

  function rename(tag) {
    const next = window.prompt(`Ubah nama tag #${tag}`, tag)
    if (next && next.trim() && next.trim() !== tag) onRenameTag(tag, next.trim().replace(/^#/, '').replace(/\s+/g, '_'))
    setMenu(null)
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 'var(--space-6)', alignItems: 'start' }}>
      <div className="card elev-sm" style={{ padding: 'var(--space-6)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
          <div>
            <div className="card-kicker">Tag</div>
            <div className="card-title">Pustaka tag · {library.length}</div>
          </div>
        </div>

        <input
          className="input"
          placeholder="Cari tag…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ marginBottom: 'var(--space-4)' }}
        />

        {filtered.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: 14 }}>
              {library.length === 0
                ? 'Belum ada tag. Tambahkan tag strategi saat mencatat trade.'
                : 'Tidak ada tag yang cocok.'}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {filtered.map((t) => (
              <div
                key={t.key}
                style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-4)',
                  padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)',
                  background: 'var(--color-bg)', boxShadow: 'inset 0 0 0 1px var(--color-neutral-800)',
                  opacity: t.stale ? 0.6 : 1, position: 'relative',
                }}
              >
                <span className={'tag ' + (t.netPnl > 0 ? 'tag-accent' : 'tag-neutral')} style={{ minWidth: 90 }}>
                  #{t.key}
                </span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--color-neutral-500)', minWidth: 34 }}>
                  {t.count}×
                </span>
                {t.stale ? (
                  <span style={{ flex: 1, fontSize: 11, color: 'var(--color-neutral-600)' }}>
                    tidak dipakai {t.daysSince} hari
                  </span>
                ) : (
                  <Sparkline values={t.spark} />
                )}
                <span className="mono" style={{ fontSize: 11, color: 'var(--color-neutral-600)', minWidth: 82, textAlign: 'right' }}>
                  {t.winRate != null ? `${t.winRate.toFixed(0)}% win` : ''}
                  {t.avgR != null ? ` · ${t.avgR.toFixed(1)}R` : ''}
                </span>
                <span className={'mono ' + toneClass(t.netPnl)} style={{ fontSize: 13, minWidth: 84, textAlign: 'right' }}>
                  {money(t.netPnl)}
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setMenu(menu === t.key ? null : t.key)}
                  title="Aksi"
                >
                  ⋯
                </button>

                {menu === t.key && (
                  <div className="ac-list" style={{ right: 0, left: 'auto', width: 190, top: 'calc(100% - 4px)' }}>
                    <div className="ac-item" onClick={() => rename(t.key)}>Ubah nama</div>
                    <div className="ac-item" onClick={() => { setMerge(t.key); setMenu(null) }}>Gabungkan ke…</div>
                    <div className="ac-item" style={{ color: 'var(--color-loss)' }} onClick={() => { setConfirmDel(t.key); setMenu(null) }}>
                      Hapus dari semua trade
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {merge && (
          <div className="dialog-backdrop" onClick={() => setMerge(null)}>
            <div className="dialog" onClick={(e) => e.stopPropagation()}>
              <div className="dialog-title">Gabungkan #{merge}</div>
              <div style={{ fontSize: 13, opacity: 0.8 }}>
                Semua trade bertag <span className="mono">#{merge}</span> akan dipindahkan ke tag tujuan.
                Berguna saat satu strategi tertulis dengan dua ejaan.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
                {library.filter((t) => t.key !== merge).map((t) => (
                  <div
                    key={t.key}
                    className="ac-item"
                    onClick={() => { onMergeTag(merge, t.key); setMerge(null) }}
                  >
                    <span>#{t.key}</span>
                    <small>{t.count}×</small>
                  </div>
                ))}
              </div>
              <div className="dialog-actions">
                <button className="btn btn-secondary" onClick={() => setMerge(null)}>Batal</button>
              </div>
            </div>
          </div>
        )}

        <Confirm
          open={!!confirmDel}
          title={`Hapus tag #${confirmDel}?`}
          body="Tag akan dilepas dari semua trade yang memakainya. Data trade-nya sendiri tetap utuh."
          confirmLabel="Hapus tag"
          danger
          onConfirm={() => { onDeleteTag(confirmDel); setConfirmDel(null) }}
          onCancel={() => setConfirmDel(null)}
        />
      </div>

      <div className="card elev-sm" style={{ padding: 'var(--space-6)', gap: 'var(--space-3)' }}>
        <div className="card-kicker">Ringkasan</div>
        <div className="card-title" style={{ marginBottom: 'var(--space-2)' }}>Tag paling berpengaruh</div>
        {library.slice(0, 5).map((t) => (
          <div key={t.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, gap: 8 }}>
            <span className="text-muted">#{t.key}</span>
            <span className={'mono ' + toneClass(t.netPnl)}>{money(t.netPnl)}</span>
          </div>
        ))}
        {library.some((t) => t.netPnl < 0) && (
          <>
            <div className="divider" style={{ margin: 'var(--space-2) 0' }} />
            <div className="section-step" style={{ marginBottom: 0 }}>Perlu ditinjau</div>
            {library.filter((t) => t.netPnl < 0).map((t) => (
              <div key={t.key} style={{ fontSize: 12 }}>
                <span className="tag tag-neutral">#{t.key}</span>{' '}
                <span className="mono loss">{money(t.netPnl)}</span>{' '}
                <span className="text-muted">dari {t.count} trade</span>
              </div>
            ))}
          </>
        )}
        {library.some((t) => t.stale) && (
          <>
            <div className="divider" style={{ margin: 'var(--space-2) 0' }} />
            <div className="section-step" style={{ marginBottom: 0 }}>Lama tidak dipakai</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {library.filter((t) => t.stale).map((t) => (
                <span key={t.key} className="tag tag-outline">#{t.key} · {t.daysSince}h</span>
              ))}
            </div>
          </>
        )}
        <div className="divider" style={{ margin: 'var(--space-2) 0' }} />
        <p className="card-body" style={{ lineHeight: 1.6, margin: 0 }}>
          Terakhir dipakai:{' '}
          {library[0]?.lastUsed ? shortDate(library[0].lastUsed) : '—'}. Menu ⋯ berisi ubah nama,
          gabungkan dua ejaan tag yang sama, dan hapus.
        </p>
      </div>
    </div>
  )
}
