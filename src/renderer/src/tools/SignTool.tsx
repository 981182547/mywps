import { AlertTriangle, ChevronLeft, ChevronRight, Copy, Lock, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FileInfo, SignPlacement } from '../../../shared/types'
import { SignatureCreator } from '../components/SignatureCreator'
import { dirOf, stemOf, uid } from '../lib/format'
import { useJob, useOutputDir } from '../lib/hooks'
import type { PdfHandle } from '../lib/pdf'
import { loadSignatures, saveSignatures, type SignatureItem } from '../lib/signatures'
import { useSinglePdf } from '../lib/single'
import { Field, OutputField, ResultView, RunFooter, ToolLayout } from './ToolLayout'
import { EmptyDrop, IgnoredNotice } from './common'
import { Slider, Toggle } from './controls'
import type { ToolDef } from './registry'

interface Placed extends SignPlacement {
  key: string
}

/** 页面舞台：显示页面，可拖动、缩放签名 */
function Stage({
  handle,
  pageIndex,
  placements,
  images,
  selected,
  onSelect,
  onChange,
  seamPreview
}: {
  handle: PdfHandle
  pageIndex: number
  placements: Placed[]
  images: Map<string, SignatureItem>
  selected: string | null
  onSelect: (k: string | null) => void
  onChange: (key: string, patch: Partial<Placed>) => void
  seamPreview: { src: string; index: number; count: number; width: number; height: number; yRatio: number } | null
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 600, h: 600 })
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [img, setImg] = useState<string | null>(null)
  const drag = useRef<{ key: string; mode: 'move' | 'resize'; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number } | null>(null)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    let alive = true
    handle.pageSize(pageIndex).then((s) => alive && setSize({ w: s.width, h: s.height }))
    return () => {
      alive = false
    }
  }, [handle, pageIndex])
  const scale = size ? Math.max(0.1, Math.min((box.w - 40) / size.w, (box.h - 40) / size.h)) : 1
  const renderW = size ? Math.max(200, Math.ceil((size.w * scale) / 100) * 100) : 200
  useEffect(() => {
    let alive = true
    setImg(null)
    handle.render(pageIndex, renderW).then((s) => alive && setImg(s)).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [handle, pageIndex, renderW])

  const onPointerDown = (e: React.PointerEvent, p: Placed, mode: 'move' | 'resize') => {
    e.stopPropagation()
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    onSelect(p.key)
    drag.current = { key: p.key, mode, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, ow: p.w, oh: p.h }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || !size) return
    const dx = (e.clientX - d.sx) / scale
    const dy = (e.clientY - d.sy) / scale
    if (d.mode === 'move') {
      onChange(d.key, { x: Math.min(size.w - d.ow * 0.2, Math.max(-d.ow * 0.8, d.ox + dx)), y: Math.min(size.h - d.oh * 0.2, Math.max(-d.oh * 0.8, d.oy + dy)) })
    } else {
      // 等比缩放
      const w = Math.max(12, d.ow + dx)
      onChange(d.key, { w, h: (d.oh / d.ow) * w })
    }
  }
  const onPointerUp = () => {
    drag.current = null
  }

  if (!size) return <div className="pp-stage" ref={boxRef} />
  const W = size.w * scale
  const H = size.h * scale
  return (
    <div className="pp-stage" ref={boxRef} onPointerDown={() => onSelect(null)}>
      <div className="pp-page sign-page" style={{ width: W, height: H }} onPointerMove={onPointerMove} onPointerUp={onPointerUp} data-testid="sign-page">
        {img && <img src={img} alt="" draggable={false} />}
        {seamPreview && (
          <div
            className="seam-slice"
            style={{
              width: (seamPreview.width / seamPreview.count) * scale,
              height: seamPreview.height * scale,
              top: H * seamPreview.yRatio - (seamPreview.height * scale) / 2,
              backgroundImage: `url(${seamPreview.src})`,
              backgroundSize: `${seamPreview.width * scale}px ${seamPreview.height * scale}px`,
              backgroundPosition: `${-(seamPreview.width / seamPreview.count) * seamPreview.index * scale}px 0`
            }}
          />
        )}
        {placements
          .filter((p) => p.page === pageIndex)
          .map((p) => {
            const sig = images.get(p.imageId)
            if (!sig) return null
            return (
              <div
                key={p.key}
                className={`placed${selected === p.key ? ' selected' : ''}`}
                style={{ left: p.x * scale, top: p.y * scale, width: p.w * scale, height: p.h * scale }}
                onPointerDown={(e) => onPointerDown(e, p, 'move')}
                data-testid="placed"
              >
                <img src={sig.dataUrl} alt="" draggable={false} />
                {selected === p.key && <span className="resize-handle" onPointerDown={(e) => onPointerDown(e, p, 'resize')} />}
              </div>
            )
          })}
      </div>
    </div>
  )
}

export function SignTool({ tool, initialFiles, onBack }: { tool: ToolDef; initialFiles?: FileInfo[]; onBack: () => void }) {
  const job = useJob()
  const out = useOutputDir()
  const pdf = useSinglePdf(initialFiles, () => job.reset())
  const [library, setLibrary] = useState<SignatureItem[]>(loadSignatures)
  const [creating, setCreating] = useState(false)
  const [placements, setPlacements] = useState<Placed[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [seamOn, setSeamOn] = useState(false)
  const [seamId, setSeamId] = useState<string | null>(null)
  const [seamWidth, setSeamWidth] = useState(120)
  const [seamY, setSeamY] = useState(50)
  const [saveError, setSaveError] = useState('')
  const running = job.state.status === 'running'
  const handle = pdf.handle
  const pageCount = handle?.pageCount ?? 0
  const images = useMemo(() => new Map(library.map((s) => [s.id, s])), [library])

  useEffect(() => {
    setPlacements([])
    setPage(0)
    setSelected(null)
  }, [handle])

  const updateLibrary = (next: SignatureItem[]) => {
    setLibrary(next)
    setSaveError(saveSignatures(next) ? '' : '签名库已满，新签名本次可用但不会被保存')
  }

  const place = async (sig: SignatureItem) => {
    if (!handle) return
    const s = await handle.pageSize(page)
    const w = Math.min(s.width * 0.3, 160)
    const h = (sig.height / sig.width) * w
    const key = uid('pl')
    setPlacements((prev) => [...prev, { key, page, imageId: sig.id, x: (s.width - w) / 2, y: (s.height - h) / 2, w, h }])
    setSelected(key)
  }
  const change = useCallback((key: string, patch: Partial<Placed>) => setPlacements((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p))), [])
  const remove = (key: string) => {
    setPlacements((prev) => prev.filter((p) => p.key !== key))
    setSelected(null)
  }
  const copyToAll = (key: string) => {
    const src = placements.find((p) => p.key === key)
    if (!src) return
    const others = Array.from({ length: pageCount }, (_, i) => i).filter((i) => i !== src.page && !placements.some((p) => p.page === i && p.imageId === src.imageId && Math.abs(p.x - src.x) < 1 && Math.abs(p.y - src.y) < 1))
    setPlacements((prev) => [...prev, ...others.map((i) => ({ ...src, key: uid('pl'), page: i }))])
  }

  // Delete 键删除选中的签名
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) remove(selected)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const seamSig = seamId ? images.get(seamId) : undefined
  const seamTargets = useMemo(() => (pageCount ? Array.from({ length: pageCount }, (_, i) => i) : []), [pageCount])
  const seamIndex = seamTargets.indexOf(page)
  const seamPreview =
    seamOn && seamSig && seamIndex >= 0 && seamTargets.length >= 2
      ? { src: seamSig.dataUrl, index: seamIndex, count: seamTargets.length, width: seamWidth, height: (seamWidth * seamSig.height) / seamSig.width, yRatio: seamY / 100 }
      : null

  const file = pdf.file
  let reason: string | undefined
  if (!file) reason = '请先添加一个 PDF 文件'
  else if (pdf.error) reason = pdf.error.message
  else if (!handle) reason = '正在读取文件…'
  else if (seamOn && !seamSig) reason = '请选择用作骑缝章的印章'
  else if (seamOn && pageCount < 2) reason = '骑缝章至少需要 2 页'
  else if (placements.length === 0 && !seamOn) reason = '点击右侧的签名或印章，放到页面上'

  const run = () => {
    if (!file) return
    const used = new Set([...placements.map((p) => p.imageId), ...(seamOn && seamId ? [seamId] : [])])
    const imgs: Record<string, string> = {}
    for (const id of used) {
      const s = images.get(id)
      if (s) imgs[id] = s.dataUrl
    }
    job.run({
      type: 'pdf-sign',
      path: file.path,
      images: imgs,
      placements: placements.map(({ key: _k, ...p }) => p),
      seam: seamOn && seamId ? { imageId: seamId, width: seamWidth, yRatio: seamY / 100 } : undefined,
      output: { dir: out.custom ?? dirOf(file.path) },
      fileName: `${stemOf(file.name)}_已签署`
    })
  }

  const onPage = placements.filter((p) => p.page === page).length
  const filesPanel = (
    <section className={`panel files-panel${pdf.dragging ? ' dragging' : ''}`} {...pdf.bind}>
      {!file ? (
        <EmptyDrop tool={tool} dragging={pdf.dragging} onPick={pdf.pick} title="添加要签名或盖章的 PDF 文件" formats={['PDF']} hint="在页面上拖动放置签名、印章，支持骑缝章" />
      ) : (
        <>
          <div className="files-toolbar">
            <div className="summary" title={file.path}>
              {file.name}
              <span>已放置 {placements.length} 处</span>
            </div>
            <div className="grow" />
            {selected && (
              <>
                <button className="btn sm" onClick={() => copyToAll(selected)} disabled={running} data-action="copy-all">
                  <Copy size={14} /> 复制到所有页
                </button>
                <button className="btn sm danger" onClick={() => remove(selected)} disabled={running}>
                  <Trash2 size={14} /> 删除
                </button>
              </>
            )}
            <button className="btn ghost sm" onClick={pdf.pick} disabled={running}>
              <RefreshCw size={14} /> 更换文件
            </button>
          </div>
          <IgnoredNotice count={pdf.ignored} onClose={pdf.clearIgnored} what="1 个 PDF 文件" />
          {pdf.error && (
            <div className="alert error" style={{ margin: 14 }}>
              {pdf.error.encrypted ? <Lock size={15} /> : <AlertTriangle size={15} />} {pdf.error.message}
            </div>
          )}
          {handle && (
            <div className="page-preview">
              <Stage
                handle={handle}
                pageIndex={page}
                placements={placements}
                images={images}
                selected={selected}
                onSelect={setSelected}
                onChange={change}
                seamPreview={seamPreview}
              />
              <div className="pp-nav">
                <button className="btn ghost icon sm" onClick={() => setPage((i) => Math.max(0, i - 1))} disabled={page === 0} aria-label="上一页">
                  <ChevronLeft size={16} />
                </button>
                <span>
                  第 {page + 1} / {pageCount} 页{onPage ? ` · 本页 ${onPage} 处` : ''}
                </span>
                <button className="btn ghost icon sm" onClick={() => setPage((i) => Math.min(pageCount - 1, i + 1))} disabled={page >= pageCount - 1} aria-label="下一页">
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )

  const side =
    job.state.status === 'done' ? (
      <ResultView outputs={job.state.outputs} notes={job.state.notes} failures={job.state.failures} onReset={() => { job.reset(); pdf.clear() }} />
    ) : (
      <>
        <Field label="我的签名和印章" hint={library.length ? '点击放到当前页，拖动调整位置，拖动右下角调整大小' : undefined}>
          <div className="sig-library" data-testid="sig-library">
            {library.map((s) => (
              <div key={s.id} className="sig-card" title={s.name}>
                <button className="sig-card-main" onClick={() => place(s)} disabled={!handle || running} aria-label={`放置 ${s.name}`}>
                  <img src={s.dataUrl} alt={s.name} />
                </button>
                <button
                  className="sig-card-del"
                  onClick={() => {
                    updateLibrary(library.filter((x) => x.id !== s.id))
                    setPlacements((prev) => prev.filter((p) => p.imageId !== s.id))
                    if (seamId === s.id) setSeamId(null)
                  }}
                  aria-label={`删除 ${s.name}`}
                  disabled={running}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            <button className="sig-card add" onClick={() => setCreating(true)} disabled={running} data-action="new-signature">
              <Plus size={18} />
              新建
            </button>
          </div>
          {saveError && <div className="hint" style={{ color: 'var(--danger)' }}>{saveError}</div>}
        </Field>
        <Field label="骑缝章" hint="印章会被平均分到每一页的右侧边缘，把页面叠在一起时能拼成完整的印章">
          <Toggle checked={seamOn} onChange={setSeamOn} label="加盖骑缝章" disabled={running || library.length === 0} />
          {seamOn && (
            <>
              <div className="sig-library compact">
                {library.map((s) => (
                  <button key={s.id} className={`sig-card-main pick${seamId === s.id ? ' on' : ''}`} onClick={() => setSeamId(s.id)} aria-label={`骑缝章使用 ${s.name}`}>
                    <img src={s.dataUrl} alt={s.name} />
                  </button>
                ))}
              </div>
              <span className="field-label">印章大小</span>
              <Slider value={seamWidth} min={60} max={220} onChange={setSeamWidth} format={(v) => `${Math.round(v / 2.835)} 毫米`} label="骑缝章大小" disabled={running} />
              <span className="field-label">上下位置</span>
              <Slider value={seamY} min={10} max={90} onChange={setSeamY} format={(v) => `${v}%`} label="骑缝章位置" disabled={running} />
            </>
          )}
        </Field>
        <OutputField sourcePath={file?.path} custom={out.custom} onChoose={out.choose} onClear={out.clear} />
      </>
    )

  return (
    <>
      <ToolLayout
        tool={tool}
        onBack={onBack}
        files={filesPanel}
        side={side}
        footer={job.state.status === 'done' ? null : <RunFooter state={job.state} label="签署并保存" disabled={!!reason || running} disabledReason={reason} onRun={run} onCancel={job.cancel} />}
      />
      {creating && (
        <SignatureCreator
          onClose={() => setCreating(false)}
          onSave={(s) => {
            updateLibrary([...library, s])
            setCreating(false)
            if (handle) void place(s)
          }}
        />
      )}
    </>
  )
}

