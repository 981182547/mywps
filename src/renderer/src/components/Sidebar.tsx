import { LayoutGrid, ShieldCheck } from 'lucide-react'
import { CATEGORIES, TOOLS, type CategoryId } from '../tools/registry'

interface Props {
  active: 'home' | CategoryId
  onHome: () => void
  onCategory: (id: CategoryId) => void
}

export function Sidebar({ active, onHome, onCategory }: Props) {
  return (
    <nav className="sidebar">
      <button className={`nav-item${active === 'home' ? ' active' : ''}`} onClick={onHome}>
        <span className="nav-icon tint-violet icon-soft">
          <LayoutGrid size={14} />
        </span>
        全部工具
      </button>

      <div className="nav-label">工具分类</div>
      {CATEGORIES.map((c) => {
        const Icon = c.icon
        const ready = TOOLS.filter((t) => t.category === c.id && t.ready).length
        return (
          <button key={c.id} className={`nav-item${active === c.id ? ' active' : ''}`} onClick={() => onCategory(c.id)}>
            <span className={`nav-icon tint-${c.tint} icon-soft`}>
              <Icon size={14} />
            </span>
            {c.name}
            {ready > 0 && <span className="count">{ready}</span>}
          </button>
        )
      })}

      <div className="grow" />
      <div className="privacy-card">
        <strong>
          <ShieldCheck size={14} />
          本地处理，安全放心
        </strong>
        文件不上传服务器，免费、无水印、不限次数。
      </div>
    </nav>
  )
}
