import { AlertTriangle, Lock, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { parseRangeGroups } from '../../../shared/ranges'
import type { FileInfo, SplitMode } from '../../../shared/types'
import { PdfThumb, usePdfPreview } from '../components/Thumbs'
import { dirOf, formatBytes } from '../lib/format'
import { useFileDrop, useJob, useOutputDir } from '../lib/hooks'
import { Field, OutputField, ResultView, RunFooter, ToolLayout } from './ToolLayout'
import { EmptyDrop, IgnoredNotice } from './common'
import type { ToolDef } from './registry'

type Kind = SplitMode['kind']
const PDF_FILTER = [{ name: 'PDF 文件', extensions: ['pdf'] }]

function label(g: number[]): string {
  if (g.length === 1) return `第 ${g[0] + 1} 页`
  const contiguous = g.every((v, i) => i === 0 || Math.abs(v - g[i - 1]) === 1)
  return contiguous ? `第 ${g[0] + 1}-${g[g.length - 1] + 1} 页` : `${g.length} 页`
}

export function SplitTool({
  tool,
  initialFiles,
  onBack,
  initialMode
}: {
  tool: ToolDef
  initialFiles?: FileInfo[]
  onBack: () => void
  initialMode: Kind
}) {
  const [file, setFile] = useState<FileInfo | null>(null)
  const [ignored, setIgnored] = useState(0)
  const [kind, setKind] = useState<Kind>(initialMode)
  const [every, setEvery] = useState('1')
  const [ranges, setRanges] = useState('')
  const [extract, setExtract] = useState('')
  const out = useOutputDir()
  const job = useJob()
  const preview = usePdfPreview(file?.path, 170)
  const extractOnly = initialMode === 'extract'

  const accept = (files: FileInfo[]) => {
    const pdf = files.find((f) => f.ext === 'pdf')
    setIgnored(files.filter((f) => f.ext !== 'pdf').length + (pdf ? files.filter((f) => f.ext === 'pdf').length - 1 : 0))
    if (pdf) {
      setFile(pdf)
      job.reset()
    }
  }

  useEffect(() => {
    if (initialFiles?.length) accept(initialFiles)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pick = async () => accept(await window.qx.pickFiles(PDF_FILTER, false))
  const { dragging, bind } = useFileDrop(accept)

  const pageCount = preview && !preview.encrypted && !preview.error ? preview.pageCount : 0

  // 计算拆分结果预览
  const plan = useMemo((): { groups: number[][] } | { error: string } | null => {
    if (!pageCount) return null
    try {
      if (kind === 'every') {
        const n = Number(every)
        if (!Number.isInteger(n) || n < 1) return { error: '每份页数必须是大于 0 的整数' }
        const groups: number[][] = []
        for (let s = 0; s < pageCount; s += n) groups.push(Array.from({ length: Math.min(n, pageCount - s) }, (_, i) => s + i))
        return { groups }
      }
      if (kind === 'ranges') {
        if (!ranges.trim()) return { error: '' }
        return { groups: parseRangeGroups(ranges, pageCount) }
      }
      if (!extract.trim()) return { error: '' }
      return { groups: [parseRangeGroups(extract, pageCount).flat()] }
    } catch (e) {
      return { error: (e as Error).message }
    }
  }, [pageCount, kind, every, ranges, extract])

  const running = job.state.status === 'running'
  let reason: string | undefined
  if (!file) reason = '请先添加一个 PDF 文件'
  else if (!preview) reason = '正在读取文件…'
  else if (preview.encrypted) reason = '文件已加密，暂不支持'
  else if (preview.error) reason = preview.error
  else if (!plan || 'error' in plan) reason = plan && 'error' in plan && plan.error ? plan.error : '请填写页码范围'

  const run = () => {
    if (!file) return
    const mode: SplitMode =
      kind === 'every' ? { kind, n: Number(every) } : kind === 'ranges' ? { kind, ranges } : { kind, ranges: extract }
    job.run({ type: 'pdf-split', path: file.path, mode, output: { dir: out.custom ?? dirOf(file.path) } })
  }

  const groups = plan && 'groups' in plan ? plan.groups : []
  const shown = groups.slice(0, 24)

  const filesPanel = (
    <section className={`panel files-panel${dragging ? ' dragging' : ''}`} {...bind}>
      {!file ? (
        <EmptyDrop
          tool={tool}
          dragging={dragging}
          onPick={pick}
          title={extractOnly ? '添加要提取页面的 PDF 文件' : '添加要拆分的 PDF 文件'}
          formats={['PDF']}
          hint="一次处理一个文件"
        />
      ) : (
        <>
          <IgnoredNotice count={ignored} onClose={() => setIgnored(0)} what="1 个 PDF 文件" />
          <div className="single-file">
            <PdfThumb preview={preview} className="big-thumb" iconSize={32} />
            <div className="sf-info" style={{ flex: 1, minWidth: 0 }}>
              <h3 title={file.path}>{file.name}</h3>
              <div style={{ color: 'var(--text-3)', fontSize: 12.5 }}>{dirOf(file.path)}</div>
              <div className="stat-row">
                <div className="stat">
                  <div className="v">{preview ? (preview.encrypted ? '—' : preview.pageCount) : '…'}</div>
                  <div className="l">总页数</div>
                </div>
                <div className="stat">
                  <div className="v">{formatBytes(file.size)}</div>
                  <div className="l">文件大小</div>
                </div>
                <div className="stat">
                  <div className="v">{groups.length || '—'}</div>
                  <div className="l">将生成文件</div>
                </div>
              </div>
              {preview?.encrypted && (
                <div className="alert error">
                  <Lock size={15} /> 这个文件已加密，请先解除密码后再处理
                </div>
              )}
              {preview?.error && (
                <div className="alert error">
                  <AlertTriangle size={15} /> {preview.error}
                </div>
              )}
              {groups.length > 0 && (
                <div className="preview-list">
                  <h4>{kind === 'extract' ? `将提取 ${groups[0].length} 页，生成 1 个文件` : '拆分结果预览'}</h4>
                  <div className="preview-items" data-testid="split-preview">
                    {shown.map((g, i) => (
                      <span className="chip" key={i}>
                        {kind === 'extract' ? g.map((x) => x + 1).slice(0, 30).join('、') + (g.length > 30 ? '…' : '') : label(g)}
                      </span>
                    ))}
                    {groups.length > shown.length && <span className="chip">… 共 {groups.length} 个文件</span>}
                  </div>
                </div>
              )}
              <button className="btn sm" style={{ marginTop: 18 }} onClick={pick} disabled={running}>
                <RefreshCw size={14} /> 更换文件
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  )

  const option = (k: Kind, title: string, desc: string, extra: React.ReactNode) => (
    <div
      className={`option-card${kind === k ? ' on' : ''}`}
      onClick={() => setKind(k)}
      role="radio"
      aria-checked={kind === k}
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setKind(k)}
    >
      <span className="radio" />
      <div style={{ flex: 1 }}>
        <div className="oc-title">{title}</div>
        <div className="oc-desc">{desc}</div>
        {kind === k && (
          <div className="oc-extra" onClick={(e) => e.stopPropagation()}>
            {extra}
          </div>
        )}
      </div>
    </div>
  )

  const side =
    job.state.status === 'done' ? (
      <ResultView outputs={job.state.outputs} onReset={() => { job.reset(); setFile(null) }} />
    ) : (
      <>
        {extractOnly ? (
          <Field label="要提取的页面" hint={<>例如 <b>1-3,5,8-</b>。页面会按填写顺序排列，合成 1 个新 PDF。</>}>
            <input className="input" value={extract} onChange={(e) => setExtract(e.target.value)} placeholder="例如 1-3,5" aria-label="要提取的页面" disabled={running} autoFocus />
          </Field>
        ) : (
          <Field label="拆分方式">
            <div className="option-cards" role="radiogroup">
              {option(
                'every',
                '按固定页数拆分',
                '每隔 N 页生成一个文件',
                <div className="input-suffix">
                  <input className="input" type="number" min={1} value={every} onChange={(e) => setEvery(e.target.value)} aria-label="每份页数" disabled={running} />
                  <span>页/份</span>
                </div>
              )}
              {option(
                'ranges',
                '按自定义范围拆分',
                '用逗号分隔，每段生成一个文件',
                <input className="input" value={ranges} onChange={(e) => setRanges(e.target.value)} placeholder="例如 1-3,4-8,9-" aria-label="拆分范围" disabled={running} />
              )}
              {option(
                'extract',
                '提取指定页面',
                '选中的页面合成一个文件',
                <input className="input" value={extract} onChange={(e) => setExtract(e.target.value)} placeholder="例如 1,3,5-7" aria-label="要提取的页面" disabled={running} />
              )}
            </div>
          </Field>
        )}
        <OutputField sourcePath={file?.path} custom={out.custom} onChoose={out.choose} onClear={out.clear} />
        {groups.length > 1 && <div className="hint" style={{ fontSize: 12, color: 'var(--text-3)', marginTop: -8 }}>生成多个文件时，会自动放进一个新文件夹。</div>}
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
          <RunFooter state={job.state} onCancel={job.cancel} label={extractOnly || kind === 'extract' ? '开始提取' : '开始拆分'} disabled={!!reason || running} disabledReason={reason} onRun={run} />
        )
      }
    />
  )
}
