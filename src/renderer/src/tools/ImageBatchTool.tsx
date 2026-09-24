import { FolderOpen, ImagePlus, RotateCcw, Trash2, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { FileInfo, Job } from '../../../shared/types'
import { ImageThumbView, useImageThumb } from '../components/ImageThumbView'
import { formatBytes, uid } from '../lib/format'
import { useFileDrop, useJob, useOutputDir } from '../lib/hooks'
import { Field, ResultView, RunFooter, ToolLayout } from './ToolLayout'
import { EmptyDrop, IgnoredNotice } from './common'
import { IMAGE_EXTS, type ToolDef } from './registry'

export interface ImageItem {
  key: string
  info: FileInfo
}

function Tile({ item, onRemove, disabled }: { item: ImageItem; onRemove: () => void; disabled: boolean }) {
  const thumb = useImageThumb(item.info.path)
  return (
    <div className="image-tile" title={item.info.path} style={{ cursor: 'default' }}>
      <div className="it-img">
        <ImageThumbView thumb={thumb} ext={item.info.ext} />
      </div>
      <div className="it-name">{item.info.name}</div>
      <div className="it-meta">
        <span>{thumb ? `${thumb.width}×${thumb.height}` : ''}</span>
        <span>{formatBytes(item.info.size)}</span>
      </div>
      <button className="it-remove" onClick={onRemove} aria-label="移除" disabled={disabled}>
        <X size={14} />
      </button>
    </div>
  )
}

/** 批量图片处理的通用页面：添加多张图片 + 选项 + 输出位置 */
export function ImageBatchTool({
  tool,
  initialFiles,
  onBack,
  runLabel,
  hint,
  options,
  validate,
  buildJob
}: {
  tool: ToolDef
  initialFiles?: FileInfo[]
  onBack: () => void
  runLabel: string
  hint: string
  options: (running: boolean, items: ImageItem[]) => ReactNode
  validate?: () => string | undefined
  buildJob: (paths: string[], outDir: string | undefined) => Job
}) {
  const [items, setItems] = useState<ImageItem[]>([])
  const [ignored, setIgnored] = useState(0)
  const out = useOutputDir()
  const job = useJob()
  const running = job.state.status === 'running'

  const addFiles = (files: FileInfo[]) => {
    const ok = files.filter((f) => IMAGE_EXTS.includes(f.ext))
    setIgnored(files.length - ok.length)
    if (!ok.length) return
    setItems((prev) => {
      const seen = new Set(prev.map((p) => p.info.path))
      return [...prev, ...ok.filter((f) => !seen.has(f.path)).map((info) => ({ key: uid('img'), info }))]
    })
    job.reset()
  }

  useEffect(() => {
    if (initialFiles?.length) addFiles(initialFiles)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pick = async () => addFiles(await window.qx.pickFiles([{ name: '图片', extensions: IMAGE_EXTS }], true))
  const { dragging, bind } = useFileDrop(addFiles)
  const totalSize = items.reduce((s, i) => s + i.info.size, 0)

  let reason: string | undefined
  if (items.length === 0) reason = '请先添加图片'
  else reason = validate?.()

  const filesPanel = (
    <section className={`panel files-panel${dragging ? ' dragging' : ''}`} {...bind}>
      {items.length === 0 ? (
        <EmptyDrop tool={tool} dragging={dragging} onPick={pick} title="添加图片" formats={['JPG', 'PNG', 'WEBP', 'HEIC', 'BMP', 'TIFF', 'GIF']} hint={hint} />
      ) : (
        <>
          <div className="files-toolbar">
            <div className="summary">
              {items.length} 张图片<span>共 {formatBytes(totalSize)}</span>
            </div>
            <div className="grow" />
            <button className="btn ghost sm danger" onClick={() => setItems([])} disabled={running}>
              <Trash2 size={14} /> 清空
            </button>
            <button className="btn sm" onClick={pick} disabled={running}>
              <ImagePlus size={14} /> 添加图片
            </button>
          </div>
          <IgnoredNotice count={ignored} onClose={() => setIgnored(0)} what="图片" />
          <div className="files-scroll" data-testid="file-list">
            <div className="image-grid">
              {items.map((it) => (
                <Tile key={it.key} item={it} disabled={running} onRemove={() => setItems((prev) => prev.filter((x) => x.key !== it.key))} />
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  )

  const side =
    job.state.status === 'done' ? (
      <ResultView outputs={job.state.outputs} notes={job.state.notes} failures={job.state.failures} preview={job.state.preview} onReset={() => { job.reset(); setItems([]) }} />
    ) : (
      <>
        {options(running, items)}
        <Field label="保存到" hint={out.custom ? undefined : '默认保存在每张图片所在的文件夹，不会覆盖原图'}>
          <div className="output-box">
            <FolderOpen size={15} style={{ color: 'var(--text-3)', flex: 'none' }} />
            <span className="path" title={out.custom ?? ''}>
              <bdi>{out.custom ?? '与原图相同的文件夹'}</bdi>
            </span>
            <button className="btn sm" onClick={out.choose}>
              更改
            </button>
          </div>
          {out.custom && (
            <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={out.clear}>
              <RotateCcw size={13} /> 恢复为源文件所在文件夹
            </button>
          )}
        </Field>
      </>
    )

  return (
    <ToolLayout
      tool={tool}
      onBack={onBack}
      files={filesPanel}
      side={side}
      footer={
        job.state.status === 'done' ? null : (
          <RunFooter
            state={job.state}
            label={items.length > 1 ? `${runLabel}（${items.length} 张）` : runLabel}
            disabled={!!reason || running}
            disabledReason={reason}
            onRun={() => job.run(buildJob(items.map((i) => i.info.path), out.custom ?? undefined))}
            onCancel={job.cancel}
          />
        )
      }
    />
  )
}
