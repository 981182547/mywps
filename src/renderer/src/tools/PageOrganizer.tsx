import { ArrowDownUp, CheckSquare, Lock, RefreshCw, RotateCcw, RotateCw, Trash2, Undo2, AlertTriangle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { parseRanges } from '../../../shared/ranges'
import type { FileInfo } from '../../../shared/types'
import { PageThumb } from '../components/PageThumb'
import { dirOf, stemOf } from '../lib/format'
import { useJob, useOutputDir, useReorder } from '../lib/hooks'
import { useSinglePdf } from '../lib/single'
import { Field, OutputField, ResultView, RunFooter, ToolLayout } from './ToolLayout'
import { EmptyDrop, IgnoredNotice } from './common'
import type { ToolDef } from './registry'

export type OrganizeMode = 'rotate' | 'delete' | 'reorder'

interface PageItem {
  key: string
  index: number
  rotate: number
  deleted: boolean
}

const HINTS: Record<OrganizeMode, string> = {
  rotate: '点击页面选中后旋转；不选择任何页面时，旋转按钮作用于全部页面',
  delete: '点击页面选中，再点“删除”或按 Delete 键；删除的页面可以恢复',
  reorder: '拖动页面调整顺序，也可以一键倒序'
}
const SUFFIX: Record<OrganizeMode, string> = { rotate: '已旋转', delete: '已删页', reorder: '已排序' }

function initialPages(n: number): PageItem[] {
  return Array.from({ length: n }, (_, i) => ({ key: `p${i}`, index: i, rotate: 0, deleted: false }))
}

export function PageOrganizer({ tool, initialFiles, onBack, mode }: { tool: ToolDef; initialFiles?: FileInfo[]; onBack: () => void; mode: OrganizeMode }) {
  const job = useJob()
  const out = useOutputDir()
  const pdf = useSinglePdf(initialFiles, () => job.reset())
  const [pages, setPagesRaw] = useState<PageItem[]>([])
  const [history, setHistory] = useState<PageItem[][]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<number | null>(null)
  const [rangeText, setRangeText] = useState('')
  const [rangeError, setRangeError] = useState('')
  const [fileName, setFileName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const running = job.state.status === 'running'

  useEffect(() => {
    setPagesRaw(pdf.handle ? initialPages(pdf.handle.pageCount) : [])
    setHistory([])
    setSelected(new Set())
  }, [pdf.handle])

  const setPages = useCallback(
    (next: PageItem[]) => {
      setHistory((h) => [...h.slice(-49), pages])
      setPagesRaw(next)
    },
    [pages]
  )
  const undo = () => {
    if (history.length === 0) return
    setPagesRaw(history[history.length - 1])
    setHistory(history.slice(0, -1))
  }

  const reorder = useReorder(pages, setPages)

  const targets = selected.size > 0 ? pages.filter((p) => selected.has(p.key)) : pages
  const rotateBy = (delta: number, only?: string) => {
    const keys = only ? new Set([only]) : new Set(targets.map((p) => p.key))
    setPages(pages.map((p) => (keys.has(p.key) ? { ...p, rotate: (p.rotate + delta + 360) % 360 } : p)))
  }
  const toggleDelete = (only?: string) => {
    const keys = only ? new Set([only]) : selected
    if (keys.size === 0) return
    const allDeleted = pages.filter((p) => keys.has(p.key)).every((p) => p.deleted)
    setPages(pages.map((p) => (keys.has(p.key) ? { ...p, deleted: !allDeleted } : p)))
    if (!only) setSelected(new Set())
  }
  const reverse = () => setPages([...pages].reverse())
  const selectWhere = (fn: (p: PageItem, i: number) => boolean) => setSelected(new Set(pages.filter(fn).map((p) => p.key)))

  const onCardClick = (e: React.MouseEvent, i: number) => {
    const key = pages[i].key
    if (e.shiftKey && anchor !== null) {
      const [a, b] = anchor < i ? [anchor, i] : [i, anchor]
      setSelected(new Set(pages.slice(a, b + 1).map((p) => p.key)))
      return
    }
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setSelected(next)
    setAnchor(i)
  }

  const applyRange = () => {
    if (!pdf.handle) return
    try {
      const idx = new Set(parseRanges(rangeText, pdf.handle.pageCount))
      setSelected(new Set(pages.filter((p) => idx.has(p.index)).map((p) => p.key)))
      setRangeError('')
    } catch (e) {
      setRangeError((e as Error).message)
    }
  }

  // 键盘快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || running || !pdf.handle) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undo()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSelected(new Set(pages.map((p) => p.key)))
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selected.size) {
          e.preventDefault()
          toggleDelete()
        }
      } else if (e.key === 'Escape') setSelected(new Set())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const stats = useMemo(() => {
    const kept = pages.filter((p) => !p.deleted)
    return {
      kept: kept.length,
      deleted: pages.length - kept.length,
      rotated: kept.filter((p) => p.rotate !== 0).length,
      moved: kept.some((p, i) => i > 0 && p.index < kept[i - 1].index)
    }
  }, [pages])
  const changed = stats.deleted > 0 || stats.rotated > 0 || stats.moved

  const file = pdf.file
  const defaultName = file ? `${stemOf(file.name)}_${SUFFIX[mode]}` : ''
  const effectiveName = nameTouched ? fileName : defaultName

  let reason: string | undefined
  if (!file) reason = '请先添加一个 PDF 文件'
  else if (pdf.error) reason = pdf.error.message
  else if (!pdf.handle) reason = '正在读取文件…'
  else if (stats.kept === 0) reason = '至少需要保留 1 页'
  else if (!changed) reason = '还没有做任何修改'
  else if (!effectiveName.trim()) reason = '请填写文件名'

  const run = () => {
    if (!file) return
    job.run({
      type: 'pdf-pages',
      path: file.path,
      pages: pages.filter((p) => !p.deleted).map((p) => ({ index: p.index, rotate: p.rotate })),
      output: { dir: out.custom ?? dirOf(file.path) },
      fileName: effectiveName
    })
  }

  const selCount = selected.size
  const filesPanel = (
    <section className={`panel files-panel${pdf.dragging ? ' dragging' : ''}`} {...pdf.bind}>
      {!file ? (
        <EmptyDrop tool={tool} dragging={pdf.dragging} onPick={pdf.pick} title="添加要处理的 PDF 文件" formats={['PDF']} hint={HINTS[mode]} />
      ) : (
        <>
          <div className="files-toolbar wrap">
            <div className="summary" title={file.path}>
              {file.name}
              <span>{pdf.handle ? `${pdf.handle.pageCount} 页${selCount ? ` · 已选 ${selCount} 页` : ''}` : ''}</span>
            </div>
            <div className="grow" />
            <button className="btn ghost sm" onClick={pdf.pick} disabled={running}>
              <RefreshCw size={14} /> 更换文件
            </button>
          </div>
          {pdf.handle && (
            <div className="page-toolbar">
              <div className="group">
                <button className="btn ghost sm" onClick={() => setSelected(new Set(pages.map((p) => p.key)))} disabled={running}>
                  <CheckSquare size={14} /> 全选
                </button>
                <button className="btn ghost sm" onClick={() => selectWhere((p) => p.index % 2 === 0)} disabled={running}>
                  奇数页
                </button>
                <button className="btn ghost sm" onClick={() => selectWhere((p) => p.index % 2 === 1)} disabled={running}>
                  偶数页
                </button>
                {selCount > 0 && (
                  <button className="btn ghost sm" onClick={() => setSelected(new Set())}>
                    取消选择
                  </button>
                )}
              </div>
              <div className="group">
                <button className="btn sm" onClick={() => rotateBy(270)} disabled={running} data-action="rotate-left">
                  <RotateCcw size={14} /> {selCount ? '向左旋转' : '全部左转'}
                </button>
                <button className="btn sm" onClick={() => rotateBy(90)} disabled={running} data-action="rotate-right">
                  <RotateCw size={14} /> {selCount ? '向右旋转' : '全部右转'}
                </button>
                <button className="btn sm danger" onClick={() => toggleDelete()} disabled={running || selCount === 0} data-action="delete">
                  <Trash2 size={14} /> 删除
                </button>
                <button className="btn sm" onClick={reverse} disabled={running} data-action="reverse">
                  <ArrowDownUp size={14} /> 倒序
                </button>
                <button className="btn ghost sm icon" onClick={undo} disabled={running || history.length === 0} title="撤销 (Ctrl+Z)" aria-label="撤销">
                  <Undo2 size={15} />
                </button>
              </div>
            </div>
          )}
          <IgnoredNotice count={pdf.ignored} onClose={pdf.clearIgnored} what="1 个 PDF 文件" />
          {pdf.error && (
            <div className="alert error" style={{ margin: 14 }}>
              {pdf.error.encrypted ? <Lock size={15} /> : <AlertTriangle size={15} />} {pdf.error.message}
            </div>
          )}
          <div className="files-scroll">
            {pdf.handle && (
              <div className="page-grid" data-testid="page-grid">
                {pages.map((p, i) => {
                  const sel = selected.has(p.key)
                  const over = reorder.over?.index === i ? (reorder.over.after ? ' drop-after' : ' drop-before') : ''
                  return (
                    <div
                      key={p.key}
                      className={`page-card${sel ? ' selected' : ''}${p.deleted ? ' deleted' : ''}${reorder.dragIndex === i ? ' dragged' : ''}${over}`}
                      onClick={(e) => !running && onCardClick(e, i)}
                      {...(running ? {} : reorder.itemProps(i, false))}
                      data-page={p.index + 1}
                    >
                      <div className="pc-thumb">
                        <PageThumb handle={pdf.handle!} index={p.index} width={150} rotate={p.rotate} />
                        {p.deleted && (
                          <div className="pc-deleted">
                            <Trash2 size={18} />
                            已删除
                          </div>
                        )}
                        <span className="pc-check" />
                        {p.rotate !== 0 && !p.deleted && <span className="pc-badge">{p.rotate === 270 ? '-90' : p.rotate}°</span>}
                        <div className="pc-actions" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => rotateBy(270, p.key)} aria-label="向左旋转" title="向左旋转" disabled={running}>
                            <RotateCcw size={14} />
                          </button>
                          <button onClick={() => rotateBy(90, p.key)} aria-label="向右旋转" title="向右旋转" disabled={running}>
                            <RotateCw size={14} />
                          </button>
                          <button onClick={() => toggleDelete(p.key)} aria-label={p.deleted ? '恢复' : '删除'} title={p.deleted ? '恢复' : '删除'} disabled={running}>
                            {p.deleted ? <Undo2 size={14} /> : <Trash2 size={14} />}
                          </button>
                        </div>
                      </div>
                      <div className="pc-label">
                        <b>{i + 1}</b>
                        {p.index !== i && <span>原第 {p.index + 1} 页</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )

  const side =
    job.state.status === 'done' ? (
      <ResultView outputs={job.state.outputs} onReset={() => { job.reset(); pdf.clear(); setNameTouched(false) }} />
    ) : (
      <>
        <div className="stat-grid">
          <div className="stat">
            <div className="v">{stats.kept}</div>
            <div className="l">输出页数</div>
          </div>
          <div className="stat">
            <div className="v">{stats.rotated}</div>
            <div className="l">已旋转</div>
          </div>
          <div className="stat">
            <div className="v">{stats.deleted}</div>
            <div className="l">已删除</div>
          </div>
        </div>
        <Field label="按页码选择" hint={rangeError ? <span style={{ color: 'var(--danger)' }}>{rangeError}</span> : '例如 1-3,8,10-，选中后可统一旋转或删除'}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className={`input${rangeError ? ' invalid' : ''}`}
              value={rangeText}
              onChange={(e) => setRangeText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyRange()}
              placeholder="输入页码"
              aria-label="按页码选择"
              disabled={!pdf.handle || running}
            />
            <button className="btn" onClick={applyRange} disabled={!pdf.handle || running || !rangeText.trim()}>
              选择
            </button>
          </div>
        </Field>
        <Field label="文件名">
          <div className="input-suffix">
            <input
              className="input"
              value={effectiveName}
              onChange={(e) => {
                setNameTouched(true)
                setFileName(e.target.value)
              }}
              aria-label="输出文件名"
              disabled={running || !file}
            />
            <span>.pdf</span>
          </div>
        </Field>
        <OutputField sourcePath={file?.path} custom={out.custom} onChoose={out.choose} onClear={out.clear} />
        <div className="hint" style={{ fontSize: 12, color: 'var(--text-3)' }}>快捷键：Ctrl+A 全选，Delete 删除，Ctrl+Z 撤销，Esc 取消选择</div>
      </>
    )

  return (
    <ToolLayout
      tool={tool}
      onBack={onBack}
      files={filesPanel}
      side={side}
      footer={job.state.status === 'done' ? null : <RunFooter state={job.state} onCancel={job.cancel} label="保存为新文件" disabled={!!reason || running} disabledReason={reason} onRun={run} />}
    />
  )
}
