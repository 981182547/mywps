import { CheckCircle2, Download, FilePlus2, FolderOpen, Loader2, RefreshCw, RotateCcw, Trash2, TriangleAlert, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { FileInfo, Job, OfficeStatus } from '../../../shared/types'
import { formatBytes, uid } from '../lib/format'
import { useFileDrop, useJob, useOutputDir } from '../lib/hooks'
import { Field, ResultView, RunFooter, ToolLayout } from './ToolLayout'
import { EmptyDrop, IgnoredNotice } from './common'
import type { ToolDef } from './registry'

const WORD = ['doc', 'docx', 'docm', 'dot', 'dotx', 'wps', 'wpt', 'rtf', 'odt', 'txt']
const EXCEL = ['xls', 'xlsx', 'xlsm', 'xlt', 'xltx', 'et', 'ett', 'csv', 'ods']
const PPT = ['ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'pot', 'potx', 'dps', 'dpt', 'odp']
export const OFFICE_EXTS = { word: WORD, excel: EXCEL, ppt: PPT, all: [...WORD, ...EXCEL, ...PPT] }

function DocIcon({ ext }: { ext: string }) {
  const [label, cls] = WORD.includes(ext) ? ['W', 'doc-w'] : EXCEL.includes(ext) ? ['X', 'doc-x'] : PPT.includes(ext) ? ['P', 'doc-p'] : ['?', '']
  return <span className={`doc-icon ${cls}`}>{label}</span>
}

let statusCache: Promise<OfficeStatus> | null = null
function useOfficeStatus() {
  const [status, setStatus] = useState<OfficeStatus | null>(null)
  const load = (refresh = false) => {
    if (!statusCache || refresh) statusCache = window.qx.officeStatus(refresh)
    setStatus(null)
    statusCache.then(setStatus)
  }
  useEffect(() => load(), [])
  return { status, refresh: () => load(true) }
}

function EngineBanner({ status, onRefresh }: { status: OfficeStatus | null; onRefresh: () => void }) {
  if (!status)
    return (
      <div className="engine-banner">
        <Loader2 size={15} className="spin" /> 正在检测办公软件…
      </div>
    )
  if (status.engines.length)
    return (
      <div className="engine-banner ok" data-testid="engine-ok">
        <CheckCircle2 size={15} /> 将使用 <b>{status.engines[0]}</b> 转换，版式与原文件一致
      </div>
    )
  return (
    <div className="engine-banner missing" data-testid="engine-missing">
      <TriangleAlert size={16} />
      <div style={{ flex: 1 }}>
        <b>需要一个办公软件来完成转换</b>
        <div>安装免费的 LibreOffice 即可使用；如果电脑上装有 Microsoft Office 或 WPS，也会自动使用。</div>
        <div className="btn-row" style={{ marginTop: 10, maxWidth: 360 }}>
          <button className="btn primary sm" onClick={() => window.qx.openExternal('https://www.libreoffice.org/download/download/')}>
            <Download size={14} /> 下载 LibreOffice（免费）
          </button>
          <button className="btn sm" onClick={onRefresh}>
            <RefreshCw size={14} /> 重新检测
          </button>
        </div>
      </div>
    </div>
  )
}

/** 批量 Office 文档处理页面 */
export function DocBatchTool({
  tool,
  initialFiles,
  onBack,
  accepts,
  formats,
  runLabel,
  hint,
  options,
  buildJob
}: {
  tool: ToolDef
  initialFiles?: FileInfo[]
  onBack: () => void
  accepts: string[]
  formats: string[]
  runLabel: string
  hint: string
  options?: (running: boolean) => ReactNode
  buildJob: (paths: string[], outDir: string | undefined) => Job
}) {
  const [items, setItems] = useState<{ key: string; info: FileInfo }[]>([])
  const [ignored, setIgnored] = useState(0)
  const out = useOutputDir()
  const job = useJob()
  const office = useOfficeStatus()
  const running = job.state.status === 'running'

  const addFiles = (files: FileInfo[]) => {
    const ok = files.filter((f) => accepts.includes(f.ext))
    setIgnored(files.length - ok.length)
    if (!ok.length) return
    setItems((prev) => {
      const seen = new Set(prev.map((p) => p.info.path))
      return [...prev, ...ok.filter((f) => !seen.has(f.path)).map((info) => ({ key: uid('doc'), info }))]
    })
    job.reset()
  }
  useEffect(() => {
    if (initialFiles?.length) addFiles(initialFiles)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pick = async () => addFiles(await window.qx.pickFiles([{ name: 'Office 文档', extensions: accepts }], true))
  const { dragging, bind } = useFileDrop(addFiles)

  let reason: string | undefined
  if (items.length === 0) reason = '请先添加文件'
  else if (!office.status) reason = '正在检测办公软件…'
  else if (!office.status.engines.length) reason = '请先安装 LibreOffice、Microsoft Office 或 WPS'

  const filesPanel = (
    <section className={`panel files-panel${dragging ? ' dragging' : ''}`} {...bind}>
      <EngineBanner status={office.status} onRefresh={office.refresh} />
      {items.length === 0 ? (
        <EmptyDrop tool={tool} dragging={dragging} onPick={pick} title="添加文档" formats={formats} hint={hint} />
      ) : (
        <>
          <div className="files-toolbar">
            <div className="summary">{items.length} 个文件</div>
            <div className="grow" />
            <button className="btn ghost sm danger" onClick={() => setItems([])} disabled={running}>
              <Trash2 size={14} /> 清空
            </button>
            <button className="btn sm" onClick={pick} disabled={running}>
              <FilePlus2 size={14} /> 添加文件
            </button>
          </div>
          <IgnoredNotice count={ignored} onClose={() => setIgnored(0)} what={formats.join('、')} />
          <div className="files-scroll" data-testid="file-list">
            {items.map((it) => (
              <div key={it.key} className="file-row doc-row">
                <DocIcon ext={it.info.ext} />
                <div className="meta">
                  <div className="name" title={it.info.path}>
                    {it.info.name}
                  </div>
                  <div className="sub">
                    <span>{it.info.ext.toUpperCase()}</span>
                    <span>·</span>
                    <span>{formatBytes(it.info.size)}</span>
                  </div>
                </div>
                <div className="row-actions">
                  <button className="btn ghost icon sm danger" onClick={() => setItems((p) => p.filter((x) => x.key !== it.key))} disabled={running} aria-label="移除">
                    <X size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )

  const side =
    job.state.status === 'done' ? (
      <ResultView outputs={job.state.outputs} notes={job.state.notes} failures={job.state.failures} onReset={() => { job.reset(); setItems([]) }} />
    ) : (
      <>
        {options?.(running)}
        <Field label="保存到" hint={out.custom ? undefined : '默认保存在每个文件所在的文件夹，不会覆盖原文件'}>
          <div className="output-box">
            <FolderOpen size={15} style={{ color: 'var(--text-3)', flex: 'none' }} />
            <span className="path" title={out.custom ?? ''}>
              <bdi>{out.custom ?? '与源文件相同的文件夹'}</bdi>
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
            label={items.length > 1 ? `${runLabel}（${items.length} 个）` : runLabel}
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
