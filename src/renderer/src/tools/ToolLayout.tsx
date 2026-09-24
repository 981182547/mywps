import { AlertCircle, ArrowLeft, CheckCircle2, ExternalLink, FileText, FolderOpen, RotateCcw } from 'lucide-react'
import type { ReactNode } from 'react'
import { baseName, dirOf } from '../lib/format'
import type { JobState } from '../lib/hooks'
import { categoryById, type ToolDef } from './registry'

interface LayoutProps {
  tool: ToolDef
  onBack: () => void
  files: ReactNode
  side: ReactNode
  footer: ReactNode
}

export function ToolLayout({ tool, onBack, files, side, footer }: LayoutProps) {
  const Icon = tool.icon
  const tint = categoryById(tool.category).tint
  return (
    <div className="tool-page">
      <div className={`tool-header tint-${tint}`}>
        <button className="btn ghost icon back-btn" onClick={onBack} aria-label="返回" title="返回">
          <ArrowLeft size={18} />
        </button>
        <div className="th-icon icon-solid">
          <Icon size={22} />
        </div>
        <div>
          <h1>{tool.name}</h1>
          <p>{tool.desc}</p>
        </div>
      </div>
      <div className="tool-body">
        {files}
        <aside className="panel side-panel">
          <div className="side-scroll">{side}</div>
          {footer && <div className="side-footer">{footer}</div>}
        </aside>
      </div>
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <div className="segmented" role="radiogroup" style={disabled ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function OutputField({
  sourcePath,
  custom,
  onChoose,
  onClear
}: {
  sourcePath?: string
  custom: string | null
  onChoose: () => void
  onClear: () => void
}) {
  const dir = custom ?? (sourcePath ? dirOf(sourcePath) : null)
  return (
    <Field label="保存到" hint={custom ? undefined : '默认保存在源文件所在的文件夹，不会覆盖原文件'}>
      <div className="output-box">
        <FolderOpen size={15} style={{ color: 'var(--text-3)', flex: 'none' }} />
        <span className="path" title={dir ?? ''}>
          <bdi>{dir ?? '与源文件相同的文件夹'}</bdi>
        </span>
        <button className="btn sm" onClick={onChoose}>
          更改
        </button>
      </div>
      {custom && (
        <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={onClear}>
          <RotateCcw size={13} /> 恢复为源文件所在文件夹
        </button>
      )}
    </Field>
  )
}

/** 底部操作区：开始按钮 / 进度 / 错误 */
export function RunFooter({
  state,
  label,
  disabled,
  disabledReason,
  onRun,
  onCancel
}: {
  state: JobState
  label: string
  disabled: boolean
  disabledReason?: string
  onRun: () => void
  onCancel?: () => void
}) {
  if (state.status === 'running') {
    const pct = Math.round(state.ratio * 100)
    return (
      <>
        <div className="progress-text">
          <span>{state.message}</span>
          <span>{pct}%</span>
        </div>
        <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${Math.max(4, pct)}%` }} />
        </div>
        {onCancel && (
          <button className="btn ghost sm" style={{ alignSelf: 'center' }} onClick={onCancel} data-action="cancel">
            取消
          </button>
        )}
      </>
    )
  }
  return (
    <>
      {state.status === 'error' && (
        <div className="alert error" role="alert">
          <AlertCircle size={16} />
          <span>{state.message}</span>
        </div>
      )}
      {disabled && disabledReason && state.status !== 'error' && <div className="hint" style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center' }}>{disabledReason}</div>}
      <button className="btn primary lg block" disabled={disabled} onClick={onRun} data-action="run">
        {label}
      </button>
    </>
  )
}

/** 处理完成后的结果视图 */
export function ResultView({ outputs, onReset }: { outputs: string[]; onReset: () => void }) {
  const single = outputs.length === 1
  return (
    <div className="result" data-testid="result">
      <div className="check">
        <CheckCircle2 size={30} />
      </div>
      <h3>处理完成</h3>
      <p>{single ? '已生成 1 个文件' : `已生成 ${outputs.length} 个文件`}</p>
      <div className="result-files">
        {outputs.map((p) => (
          <button key={p} className="result-file" onClick={() => window.qx.openPath(p)} title={p}>
            <FileText size={15} />
            <span>{baseName(p)}</span>
            <ExternalLink size={13} />
          </button>
        ))}
      </div>
      <div className="btn-row" style={{ width: '100%', marginTop: 14 }}>
        {single && (
          <button className="btn primary" onClick={() => window.qx.openPath(outputs[0])}>
            打开文件
          </button>
        )}
        <button className="btn" onClick={() => window.qx.showInFolder(outputs[0])}>
          打开所在文件夹
        </button>
      </div>
      <button className="btn ghost block" style={{ marginTop: 8 }} onClick={onReset}>
        <RotateCcw size={14} /> 继续处理
      </button>
    </div>
  )
}
