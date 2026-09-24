import { AlertTriangle, ArrowDownAZ, ChevronDown, ChevronUp, FilePlus2, GripVertical, Lightbulb, Lock, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { FileInfo } from '../../../shared/types'
import { parseRanges } from '../../../shared/ranges'
import { PdfThumb } from '../components/Thumbs'
import { dirOf, formatBytes, stemOf, uid } from '../lib/format'
import { useFileDrop, useJob, useOutputDir, useReorder } from '../lib/hooks'
import { previewPdf, type PdfPreview } from '../lib/pdf'
import { Field, OutputField, ResultView, RunFooter, ToolLayout } from './ToolLayout'
import { EmptyDrop, IgnoredNotice } from './common'
import type { ToolDef } from './registry'

interface Item {
  key: string
  info: FileInfo
  preview: PdfPreview | null
  ranges: string
}

const PDF_FILTER = [{ name: 'PDF 文件', extensions: ['pdf'] }]

export function MergeTool({ tool, initialFiles, onBack }: { tool: ToolDef; initialFiles?: FileInfo[]; onBack: () => void }) {
  const [items, setItems] = useState<Item[]>([])
  const [ignored, setIgnored] = useState(0)
  const [fileName, setFileName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const out = useOutputDir()
  const job = useJob()

  const addFiles = (files: FileInfo[]) => {
    const pdfs = files.filter((f) => f.ext === 'pdf')
    setIgnored(files.length - pdfs.length)
    if (pdfs.length === 0) return
    const added = pdfs.map((info) => ({ key: uid('f'), info, preview: null, ranges: '' }))
    setItems((prev) => [...prev, ...added])
    for (const it of added) {
      previewPdf(it.info.path).then((preview) => setItems((prev) => prev.map((x) => (x.key === it.key ? { ...x, preview } : x))))
    }
    job.reset()
  }

  useEffect(() => {
    if (initialFiles?.length) addFiles(initialFiles)
    // 只在首次打开时载入
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const defaultName = items.length ? `${stemOf(items[0].info.name)}_合并` : '合并结果'
  const effectiveName = nameTouched ? fileName : defaultName

  const pick = async () => addFiles(await window.qx.pickFiles(PDF_FILTER, true))
  const { dragging, bind } = useFileDrop(addFiles)
  const reorder = useReorder(items, setItems)

  const update = (key: string, patch: Partial<Item>) => setItems((prev) => prev.map((x) => (x.key === key ? { ...x, ...patch } : x)))
  const remove = (key: string) => setItems((prev) => prev.filter((x) => x.key !== key))

  // 校验每个文件的页码范围，并统计总页数
  const analysis = useMemo(() => {
    let total = 0
    let ready = true
    const errors: Record<string, string> = {}
    for (const it of items) {
      if (!it.preview) {
        ready = false
        continue
      }
      if (it.preview.encrypted || it.preview.error) continue
      try {
        total += parseRanges(it.ranges, it.preview.pageCount).length
      } catch (e) {
        errors[it.key] = (e as Error).message
      }
    }
    return { total, ready, errors }
  }, [items])

  const blocked = items.find((i) => i.preview?.encrypted || i.preview?.error)
  const hasRangeError = Object.keys(analysis.errors).length > 0
  let reason: string | undefined
  if (items.length < 2) reason = '请至少添加 2 个 PDF 文件'
  else if (blocked) reason = blocked.preview?.encrypted ? `“${blocked.info.name}”已加密，请先移除` : `“${blocked.info.name}”无法读取，请先移除`
  else if (hasRangeError) reason = '请修正标红的页码范围'
  else if (!analysis.ready) reason = '正在读取文件…'
  else if (!effectiveName.trim()) reason = '请填写文件名'

  const running = job.state.status === 'running'
  const run = () =>
    job.run({
      type: 'pdf-merge',
      items: items.map((i) => ({ path: i.info.path, ranges: i.ranges.trim() || undefined })),
      output: { dir: out.custom ?? dirOf(items[0].info.path) },
      fileName: effectiveName
    })

  const sortByName = () => setItems([...items].sort((a, b) => a.info.name.localeCompare(b.info.name, 'zh-CN', { numeric: true })))

  const filesPanel = (
    <section className={`panel files-panel${dragging ? ' dragging' : ''}`} {...bind}>
      {items.length === 0 ? (
        <EmptyDrop tool={tool} dragging={dragging} onPick={pick} title="添加要合并的 PDF 文件" formats={['PDF']} hint="可一次选择多个文件，添加后拖动调整顺序" />
      ) : (
        <>
          <div className="files-toolbar">
            <div className="summary">
              {items.length} 个文件<span>合并后共 {analysis.total} 页</span>
            </div>
            <div className="grow" />
            <button className="btn ghost sm" onClick={sortByName} disabled={running} title="按文件名排序">
              <ArrowDownAZ size={14} /> 按名称排序
            </button>
            <button className="btn ghost sm danger" onClick={() => setItems([])} disabled={running}>
              <Trash2 size={14} /> 清空
            </button>
            <button className="btn sm" onClick={pick} disabled={running}>
              <FilePlus2 size={14} /> 添加文件
            </button>
          </div>
          <IgnoredNotice count={ignored} onClose={() => setIgnored(0)} what="PDF" />
          <div className="files-scroll" data-testid="file-list">
            {items.map((it, i) => {
              const err = analysis.errors[it.key]
              const over = reorder.over?.index === i ? (reorder.over.after ? ' drag-over-bottom' : ' drag-over-top') : ''
              return (
                <div key={it.key} className={`file-row${reorder.dragIndex === i ? ' dragged' : ''}${over}`} {...reorder.itemProps(i)}>
                  <span className="handle" title="拖动排序">
                    <GripVertical size={15} />
                  </span>
                  <span className="index">{i + 1}</span>
                  <PdfThumb preview={it.preview} />
                  <div className="meta">
                    <div className="name" title={it.info.path}>
                      {it.info.name}
                    </div>
                    <div className="sub">
                      {it.preview?.encrypted ? (
                        <span className="warn">
                          <Lock size={12} /> 已加密，暂不支持
                        </span>
                      ) : it.preview?.error ? (
                        <span className="warn">
                          <AlertTriangle size={12} /> {it.preview.error}
                        </span>
                      ) : err ? (
                        <span className="warn">
                          <AlertTriangle size={12} /> {err}
                        </span>
                      ) : (
                        <>
                          <span>{it.preview ? `${it.preview.pageCount} 页` : '读取中…'}</span>
                          <span>·</span>
                          <span>{formatBytes(it.info.size)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <input
                    className={`range-input${err ? ' input invalid' : ''}`}
                    placeholder="全部页面"
                    value={it.ranges}
                    onChange={(e) => update(it.key, { ranges: e.target.value })}
                    title="只合并部分页面，例如 1-3,5"
                    aria-label={`${it.info.name} 的页码范围`}
                    disabled={running || !!it.preview?.encrypted}
                    onDragStart={(e) => e.preventDefault()}
                    draggable={false}
                  />
                  <div className="row-actions">
                    <button className="btn ghost icon sm" onClick={() => reorder.move(i, i - 1)} disabled={i === 0 || running} aria-label="上移">
                      <ChevronUp size={15} />
                    </button>
                    <button className="btn ghost icon sm" onClick={() => reorder.move(i, i + 1)} disabled={i === items.length - 1 || running} aria-label="下移">
                      <ChevronDown size={15} />
                    </button>
                    <button className="btn ghost icon sm danger" onClick={() => remove(it.key)} disabled={running} aria-label="移除">
                      <X size={15} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </section>
  )

  const side =
    job.state.status === 'done' ? (
      <ResultView outputs={job.state.outputs} onReset={() => { job.reset(); setItems([]); setNameTouched(false) }} />
    ) : (
      <>
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
              disabled={running}
            />
            <span>.pdf</span>
          </div>
        </Field>
        <div className="tip">
          <Lightbulb size={15} />
          <span>
            在文件右侧填写页码，可以只合并需要的页面，例如 <b>1-3,5</b> 或 <b>8-</b>（第 8 页到最后一页）。留空表示全部页面。
          </span>
        </div>
        <OutputField sourcePath={items[0]?.info.path} custom={out.custom} onChoose={out.choose} onClear={out.clear} />
      </>
    )

  return (
    <ToolLayout
      tool={tool}
      onBack={onBack}
      files={filesPanel}
      side={side}
      footer={job.state.status === 'done' ? null : <RunFooter state={job.state} onCancel={job.cancel} label="开始合并" disabled={!!reason || running} disabledReason={reason} onRun={run} />}
    />
  )
}

