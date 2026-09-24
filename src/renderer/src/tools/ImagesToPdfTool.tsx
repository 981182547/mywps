import { ArrowDownAZ, ImagePlus, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FileInfo, OrientationOption, PageSizeOption } from '../../../shared/types'
import { fileUrl } from '../components/Thumbs'
import { dirOf, stemOf, uid } from '../lib/format'
import { useFileDrop, useJob, useOutputDir, useReorder } from '../lib/hooks'
import { Field, OutputField, ResultView, RunFooter, Segmented, ToolLayout } from './ToolLayout'
import { EmptyDrop, IgnoredNotice } from './common'
import { IMAGE_EXTS, type ToolDef } from './registry'

interface Item {
  key: string
  info: FileInfo
}

const IMAGE_FILTER = [{ name: '图片', extensions: IMAGE_EXTS }]
type Margin = 'none' | 'small' | 'large'
const MARGIN_MM: Record<Margin, number> = { none: 0, small: 6, large: 15 }

/** 显示本地图片；开发模式下 file:// 被拦截时改用读取文件的方式 */
function LocalImage({ path }: { path: string }) {
  const [src, setSrc] = useState(() => fileUrl(path))
  const [fallback, setFallback] = useState(false)
  useEffect(() => {
    return () => {
      if (src.startsWith('blob:')) URL.revokeObjectURL(src)
    }
  }, [src])
  const onError = async () => {
    if (fallback) return
    setFallback(true)
    try {
      const data = await window.qx.readFile(path)
      setSrc(URL.createObjectURL(new Blob([data as BlobPart])))
    } catch {
      /* 保持占位 */
    }
  }
  return <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={onError} />
}

export function ImagesToPdfTool({ tool, initialFiles, onBack }: { tool: ToolDef; initialFiles?: FileInfo[]; onBack: () => void }) {
  const [items, setItems] = useState<Item[]>([])
  const [ignored, setIgnored] = useState(0)
  const [pageSize, setPageSize] = useState<PageSizeOption>('A4')
  const [orientation, setOrientation] = useState<OrientationOption>('auto')
  const [margin, setMargin] = useState<Margin>('small')
  const [fileName, setFileName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const out = useOutputDir()
  const job = useJob()

  const addFiles = (files: FileInfo[]) => {
    const ok = files.filter((f) => IMAGE_EXTS.includes(f.ext))
    setIgnored(files.length - ok.length)
    if (ok.length === 0) return
    setItems((prev) => [...prev, ...ok.map((info) => ({ key: uid('img'), info }))])
    job.reset()
  }

  useEffect(() => {
    if (initialFiles?.length) addFiles(initialFiles)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pick = async () => addFiles(await window.qx.pickFiles(IMAGE_FILTER, true))
  const { dragging, bind } = useFileDrop(addFiles)
  const reorder = useReorder(items, setItems)
  const running = job.state.status === 'running'

  const defaultName = items.length ? `${stemOf(items[0].info.name)}_图片合集` : '图片合集'
  const effectiveName = nameTouched ? fileName : defaultName

  let reason: string | undefined
  if (items.length === 0) reason = '请先添加图片'
  else if (!effectiveName.trim()) reason = '请填写文件名'

  const run = () =>
    job.run({
      type: 'images-to-pdf',
      images: items.map((i) => i.info.path),
      pageSize,
      orientation,
      marginMm: MARGIN_MM[margin],
      output: { dir: out.custom ?? dirOf(items[0].info.path) },
      fileName: effectiveName
    })

  const sortByName = () => setItems([...items].sort((a, b) => a.info.name.localeCompare(b.info.name, 'zh-CN', { numeric: true })))

  const filesPanel = (
    <section className={`panel files-panel${dragging ? ' dragging' : ''}`} {...bind}>
      {items.length === 0 ? (
        <EmptyDrop tool={tool} dragging={dragging} onPick={pick} title="添加要转换的图片" formats={['JPG', 'PNG']} hint="每张图片生成一页，可拖动调整顺序" />
      ) : (
        <>
          <div className="files-toolbar">
            <div className="summary">
              {items.length} 张图片<span>将生成 {items.length} 页</span>
            </div>
            <div className="grow" />
            <button className="btn ghost sm" onClick={sortByName} disabled={running}>
              <ArrowDownAZ size={14} /> 按名称排序
            </button>
            <button className="btn ghost sm danger" onClick={() => setItems([])} disabled={running}>
              <Trash2 size={14} /> 清空
            </button>
            <button className="btn sm" onClick={pick} disabled={running}>
              <ImagePlus size={14} /> 添加图片
            </button>
          </div>
          <IgnoredNotice count={ignored} onClose={() => setIgnored(0)} what="JPG、PNG 图片" />
          <div className="files-scroll" data-testid="file-list">
            <div className="image-grid">
              {items.map((it, i) => {
                const over = reorder.over?.index === i ? ' drag-over' : ''
                return (
                  <div key={it.key} className={`image-tile${reorder.dragIndex === i ? ' dragged' : ''}${over}`} {...reorder.itemProps(i, false)} title={it.info.path}>
                    <div className="it-img">
                      <LocalImage path={it.info.path} />
                    </div>
                    <div className="it-name">{it.info.name}</div>
                    <span className="it-index">{i + 1}</span>
                    <button className="it-remove" onClick={() => setItems(items.filter((x) => x.key !== it.key))} aria-label="移除" disabled={running}>
                      <X size={14} />
                    </button>
                  </div>
                )
              })}
              {!running && (
                <button className="image-tile add" onClick={pick}>
                  <Plus size={22} />
                  添加图片
                </button>
              )}
            </div>
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
        <Field label="页面大小">
          <Segmented<PageSizeOption>
            value={pageSize}
            onChange={setPageSize}
            options={[
              { value: 'A4', label: 'A4' },
              { value: 'A3', label: 'A3' },
              { value: 'Letter', label: 'Letter' },
              { value: 'fit', label: '同图片' }
            ]}
          />
        </Field>
        <Field label="页面方向" hint={orientation === 'auto' && pageSize !== 'fit' ? '横图用横向页面，竖图用纵向页面' : undefined}>
          <Segmented<OrientationOption>
            value={orientation}
            onChange={setOrientation}
            disabled={pageSize === 'fit'}
            options={[
              { value: 'auto', label: '自动' },
              { value: 'portrait', label: '纵向' },
              { value: 'landscape', label: '横向' }
            ]}
          />
        </Field>
        <Field label="页边距">
          <Segmented<Margin>
            value={margin}
            onChange={setMargin}
            options={[
              { value: 'none', label: '无' },
              { value: 'small', label: '窄' },
              { value: 'large', label: '宽' }
            ]}
          />
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
              disabled={running}
            />
            <span>.pdf</span>
          </div>
        </Field>
        <OutputField sourcePath={items[0]?.info.path} custom={out.custom} onChoose={out.choose} onClear={out.clear} />
      </>
    )

  return (
    <ToolLayout
      tool={tool}
      onBack={onBack}
      files={filesPanel}
      side={side}
      footer={job.state.status === 'done' ? null : <RunFooter state={job.state} onCancel={job.cancel} label="生成 PDF" disabled={!!reason || running} disabledReason={reason} onRun={run} />}
    />
  )
}
