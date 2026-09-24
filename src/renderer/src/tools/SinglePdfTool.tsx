import { AlertTriangle, Lock, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import type { FileInfo, Job } from '../../../shared/types'
import { PageThumb } from '../components/PageThumb'
import { dirOf, formatBytes } from '../lib/format'
import { useJob, useOutputDir } from '../lib/hooks'
import type { PdfHandle } from '../lib/pdf'
import { useSinglePdf } from '../lib/single'
import { OutputField, ResultView, RunFooter, ToolLayout } from './ToolLayout'
import { EmptyDrop, IgnoredNotice } from './common'
import type { ToolDef } from './registry'

export interface SingleCtx {
  file: FileInfo | null
  handle: PdfHandle | null
  running: boolean
}

/** 单个 PDF 输入、一组选项、一个输出的通用工具页 */
export function SinglePdfTool({
  tool,
  initialFiles,
  onBack,
  runLabel,
  hint,
  options,
  info,
  validate,
  buildJob
}: {
  tool: ToolDef
  initialFiles?: FileInfo[]
  onBack: () => void
  runLabel: string
  hint: string
  options: (c: SingleCtx) => ReactNode
  /** 文件信息区下方的补充说明（如预计输出） */
  info?: (c: SingleCtx) => ReactNode
  /** 返回不可执行的原因 */
  validate?: (c: SingleCtx) => string | undefined
  buildJob: (file: FileInfo, outDir: string) => Job
}) {
  const job = useJob()
  const out = useOutputDir()
  const pdf = useSinglePdf(initialFiles, () => job.reset())
  const running = job.state.status === 'running'
  const c: SingleCtx = { file: pdf.file, handle: pdf.handle, running }
  const file = pdf.file

  let reason: string | undefined
  if (!file) reason = '请先添加一个 PDF 文件'
  else if (pdf.error) reason = pdf.error.message
  else if (!pdf.handle) reason = '正在读取文件…'
  else reason = validate?.(c)

  const filesPanel = (
    <section className={`panel files-panel${pdf.dragging ? ' dragging' : ''}`} {...pdf.bind}>
      {!file ? (
        <EmptyDrop tool={tool} dragging={pdf.dragging} onPick={pdf.pick} title="添加 PDF 文件" formats={['PDF']} hint={hint} />
      ) : (
        <>
          <IgnoredNotice count={pdf.ignored} onClose={pdf.clearIgnored} what="1 个 PDF 文件" />
          <div className="single-file">
            <div className="big-thumb">{pdf.handle ? <PageThumb handle={pdf.handle} index={0} width={170} /> : null}</div>
            <div className="sf-info" style={{ flex: 1, minWidth: 0 }}>
              <h3 title={file.path}>{file.name}</h3>
              <div style={{ color: 'var(--text-3)', fontSize: 12.5 }}>{dirOf(file.path)}</div>
              <div className="stat-row">
                <div className="stat">
                  <div className="v">{pdf.handle ? pdf.handle.pageCount : pdf.error ? '—' : '…'}</div>
                  <div className="l">总页数</div>
                </div>
                <div className="stat">
                  <div className="v">{formatBytes(file.size)}</div>
                  <div className="l">文件大小</div>
                </div>
              </div>
              {pdf.error && (
                <div className="alert error">
                  {pdf.error.encrypted ? <Lock size={15} /> : <AlertTriangle size={15} />} {pdf.error.message}
                </div>
              )}
              {info?.(c)}
              <button className="btn sm" style={{ marginTop: 18 }} onClick={pdf.pick} disabled={running}>
                <RefreshCw size={14} /> 更换文件
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  )

  const side =
    job.state.status === 'done' ? (
      <ResultView outputs={job.state.outputs} notes={job.state.notes} failures={job.state.failures} onReset={() => { job.reset(); pdf.clear() }} />
    ) : (
      <>
        {options(c)}
        <OutputField sourcePath={file?.path} custom={out.custom} onChoose={out.choose} onClear={out.clear} />
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
            label={runLabel}
            disabled={!!reason || running}
            disabledReason={reason}
            onRun={() => file && job.run(buildJob(file, out.custom ?? dirOf(file.path)))}
            onCancel={job.cancel}
          />
        )
      }
    />
  )
}
