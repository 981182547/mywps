import { Info, Upload, X } from 'lucide-react'
import { categoryById, type ToolDef } from './registry'

export function EmptyDrop({
  tool,
  dragging,
  onPick,
  title,
  hint,
  formats
}: {
  tool: ToolDef
  dragging: boolean
  onPick: () => void
  title: string
  hint: string
  formats: string[]
}) {
  const tint = categoryById(tool.category).tint
  return (
    <div className={`dropzone${dragging ? ' dragging' : ''}`} onClick={onPick} role="button" tabIndex={0} data-testid="dropzone">
      <div className={`dz-icon icon-soft tint-${tint}`}>
        <Upload size={28} />
      </div>
      <h3>{dragging ? '松开鼠标即可添加' : title}</h3>
      <p>点击选择文件，或直接拖到这里</p>
      <p style={{ color: 'var(--text-3)', fontSize: 12.5 }}>{hint}</p>
      <div className="formats">
        {formats.map((f) => (
          <span key={f} className="chip">
            {f}
          </span>
        ))}
      </div>
    </div>
  )
}

export function IgnoredNotice({ count, what, onClose }: { count: number; what: string; onClose: () => void }) {
  if (count <= 0) return null
  return (
    <div className="alert info" style={{ margin: '10px 14px 0', alignItems: 'center' }}>
      <Info size={15} />
      <span style={{ flex: 1 }}>已忽略 {count} 个不支持的文件（这里只能添加 {what}）</span>
      <button className="btn ghost icon sm" onClick={onClose} aria-label="关闭提示">
        <X size={14} />
      </button>
    </div>
  )
}
